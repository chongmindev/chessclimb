// The drill, in up to two steps:
//   find: the position right after my move. Play the opponent's punishing reply, or say nothing works.
//         A wrong try says so and the board stays live; "Reveal" gives up. Only the first try is graded.
//   fix:  for a real blunder, the board rewinds to before my move: play what I should have played.
//         The engine judges it (within trainer.fix_tolerance of the best eval counts); "Show me" gives up.

import { Chess } from "chess.js";

const NAME = { k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" };
const FILES = "abcdefgh";
const RESULT = { win: "Won", loss: "Lost", draw: "Drawn" };
const EVAL_SPAN = 6;   // the eval bar runs from -6 to +6 pawns; beyond that (or mate) pins to the end

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1);
const num = (n, white, san) => `${n}${white ? "." : "…"}${san}`;

/**
 * What a defensive scan looks at, for the side to move in `fen` (the opponent):
 * their checks and captures, and my pieces they attack that nothing of mine defends.
 */
export function scanSets(fen) {
  const g = new Chess(fen);
  const moves = g.moves({ verbose: true });
  const opp = g.turn(), me = opp === "w" ? "b" : "w";
  const loose = [];
  for (const row of g.board()) for (const sq of row) {
    if (!sq || sq.color !== me || sq.type === "k") continue;
    if (g.attackers(sq.square, opp).length && !g.attackers(sq.square, me).length) loose.push(sq.square);
  }
  return {
    checks: moves.filter((m) => /[+#]/.test(m.san)),
    captures: moves.filter((m) => /[ce]/.test(m.flags)),
    loose,
  };
}

/** Position of a pawn value on the eval bar, in percent from the left (my side winning = right). */
export function evalX(pawns, mate = false) {
  const v = mate ? Math.sign(pawns) * EVAL_SPAN : Math.max(-EVAL_SPAN, Math.min(EVAL_SPAN, pawns));
  return 50 + (50 * v) / EVAL_SPAN;
}

export class Trainer {
  /**
   * els: {board, arrows, meta, playedLabel, played, question, scan, actions, safe, reveal, fixRow, showMe,
   *       feedback, next, side, boxes, done, acc, streak}
   * evaluate(fen) -> Promise<{cp, mate}> from White's view; used by the fix step. tolerance in centipawns.
   */
  constructor(els, { load, save, evaluate = null, tolerance = 100 }) {
    Object.assign(this, { els, load, save, evaluate, tolerance });
    this.items = [];
    this.progress = { boxes: {}, seen: {}, turn: 0, stats: { done: 0, ok: 0, streak: 0 } };
    this.cur = null;
    els.safe.addEventListener("click", () => this.say(null));
    els.reveal.addEventListener("click", () => this.reveal());
    els.showMe.addEventListener("click", () => this.showFix());
    els.next.addEventListener("click", () => this.next());
    els.scan.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-kind]");
      if (!chip || this.step !== "find") return;
      const kind = chip.dataset.kind;
      if (this.lit.has(kind)) this.lit.delete(kind); else this.lit.add(kind);
      this.paintScan();
      this.render();
    });
  }

  async start() {
    this.progress = (await this.load()) || this.progress;
  }

  setItems(items) {
    this.items = items;
    if (!this.cur && items.length) this.next();
    this.paintStats();
  }

  meW() { return this.cur.color === "w"; }
  opp() { return this.meW() ? "Black" : "White"; }
  live() { return this.step === "find" || this.step === "fix"; }

  pick() {
    const { boxes, seen, turn } = this.progress;
    const due = this.items.filter((it) => {
      const b = boxes[it.id] || 0;
      return !b || turn - (seen[it.id] ?? -99) >= 2 ** (b - 1) * 3;
    });
    const pool = (due.length ? due : this.items).filter((it) => !this.cur || it.id !== this.cur.id || this.items.length === 1);
    pool.sort((a, b) => (boxes[a.id] || 0) - (boxes[b.id] || 0) || Math.random() - 0.5);
    const low = pool.slice(0, Math.max(6, Math.ceil(pool.length / 4)));
    return low[Math.floor(Math.random() * low.length)];
  }

  sqName(r, c) { return this.meW() ? FILES[c] + (8 - r) : FILES[7 - c] + (r + 1); }
  xy(sq) { const f = FILES.indexOf(sq[0]), r = +sq[1]; return this.meW() ? [f + 0.5, 8 - r + 0.5] : [7 - f + 0.5, r - 1 + 0.5]; }

  litSquares() {
    const moveSq = new Set(), loose = new Set();
    if (this.step !== "find") return { moveSq, loose };
    for (const kind of ["checks", "captures"]) if (this.lit.has(kind)) for (const m of this.scan[kind]) { moveSq.add(m.from); moveSq.add(m.to); }
    if (this.lit.has("loose")) for (const s of this.scan.loose) loose.add(s);
    return { moveSq, loose };
  }

  render() {
    const el = this.els.board;
    el.replaceChildren();
    const moves = this.live() && !this.busy ? this.game.moves({ verbose: true }) : [];
    const targets = this.sel ? moves.filter((m) => m.from === this.sel) : [];
    const { moveSq, loose } = this.litSquares();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const s = this.sqName(r, c), p = this.game.get(s);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sq" + ((FILES.indexOf(s[0]) + +s[1]) % 2 === 1 ? " d" : "") + (this.sel === s ? " sel" : "");
      b.setAttribute("aria-label", s + (p ? ` ${p.color === "w" ? "white" : "black"} ${NAME[p.type]}` : ""));
      const add = (cls, text) => { const x = document.createElement("span"); x.className = cls; if (text) x.textContent = text; b.appendChild(x); };
      if (this.lastMove && (s === this.lastMove[0] || s === this.lastMove[1])) add("lm");
      if (moveSq.has(s)) add("hintmark");
      if (loose.has(s)) add("loose");
      if (c === 0) add("coord r", s[1]);
      if (r === 7) add("coord f", s[0]);
      if (p) add(`pc ${p.color}${p.type.toUpperCase()}`);
      if (targets.some((m) => m.to === s)) add("target");
      b.addEventListener("click", () => this.tap(s));
      el.appendChild(b);
    }
  }

  /** Solid arrow = the right move, dashed = a try that didn't work. */
  arrow(from, to, dashed = false) {
    const [x1, y1] = this.xy(from), [x2, y2] = this.xy(to);
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
    const ex = x2 - ux * 0.32, ey = y2 - uy * 0.32, hx = x2 - ux * 0.12, hy = y2 - uy * 0.12;
    const px = -uy * 0.22, py = ux * 0.22, bx = x2 - ux * 0.45, by = y2 - uy * 0.45;
    return `<line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke-width=".14"${dashed ? ' stroke-dasharray=".22 .14"' : ""}/>` +
      `<polygon points="${hx},${hy} ${bx + px},${by + py} ${bx - px},${by - py}"/>`;
  }

  drawArrows(list) {
    this.els.arrows.innerHTML = list.map(([f, t, dashed]) => this.arrow(f, t, dashed)).join("");
  }

  tap(s) {
    if (!this.live() || this.busy) return;
    const p = this.game.get(s);
    if (this.sel) {
      const m = this.game.moves({ verbose: true }).find((m) => m.from === this.sel && m.to === s);
      if (m) { this.sel = null; return this.step === "find" ? this.say(m) : this.tryFix(m); }
    }
    this.sel = p && p.color === this.game.turn() && this.sel !== s ? s : null;
    this.render();
  }

  // ---------- step 1: find their punishment ----------

  /** An answer in the find step: a move, or null for "nothing works". */
  say(m) {
    if (this.step !== "find") return;
    const cur = this.cur;
    const right = cur.kind === "threat"
      ? !!m && cur.accept.some((u) => u.slice(0, 4) === m.from + m.to)
      : !m;
    if (this.firstTry === null) this.grade(right);
    if (right) return this.found(m);
    // Wrong: say so, keep the board live.
    this.tries++;
    if (m) this.drawArrows([[m.from, m.to, true]]);
    const msg = cur.kind === "threat"
      ? (m ? `<b>${esc(m.san)}</b> isn't it. Try again.` : "There is a punishment. Keep looking.")
      : `<b>${esc(m.san)}</b> doesn't win anything. Look again.`;
    this.note(msg);
    this.els.reveal.hidden = false;
    this.render();
  }

  reveal() {
    if (this.step !== "find") return;
    if (this.firstTry === null) this.grade(false);
    this.found(null, true);
  }

  /** The find step is over: show their reply, then go on to the fix step for real blunders. */
  found(m, revealed = false) {
    const cur = this.cur, white = this.meW(), opp = this.opp();
    const theirs = white ? num(cur.move, false, cur.reply) : num(cur.move + 1, true, cur.reply);
    this.els.scan.hidden = true;
    this.els.actions.hidden = true;
    if (cur.kind === "threat") {
      let rm = null;
      try { rm = new Chess(cur.fen).move(cur.reply); } catch {}
      if (rm) this.drawArrows([[rm.from, rm.to, false]]);
      const head = revealed ? "Here it is" : this.firstTry ? "Found it" : "Got there";
      const bar = cur.mate != null && cur.mate > 0 ? `<div class="mate">Mate in ${cur.mate}</div>` : this.evalBar(cur.evb, cur.eva);
      this.feedback(this.firstTry === true, head,
        this.card(`${opp}'s punishment`, theirs, "key") + this.card("You played", num(cur.move, white, cur.san), "struck"), bar);
      if (cur.before_fen && cur.better) return this.startFix();
      this.finish();
    } else {
      this.drawArrows([]);
      this.feedback(this.firstTry === true, revealed ? "It was safe" : this.firstTry ? "Safe. Well judged" : "Safe after all",
        this.card(`${opp}'s best try`, theirs), this.evalBar(cur.evb, cur.eva));
      this.finish();
    }
  }

  // ---------- step 2: fix my move ----------

  startFix() {
    const cur = this.cur;
    this.step = "fix";
    this.fixTries = 0;
    this.game = new Chess(cur.before_fen);
    this.lastMove = null;
    this.drawArrows([]);       // the punishment arrow belongs to the other position
    this.els.playedLabel.textContent = "Instead of";
    this.els.question.textContent = "What should you have played?";
    this.els.fixRow.hidden = false;
    this.els.showMe.hidden = true;
    this.render();
  }

  async tryFix(m) {
    const cur = this.cur;
    this.fixTries++;
    this.drawArrows([[m.from, m.to, false]]);
    if (m.san === cur.better) return this.fixed(m.san, null, true);
    if (m.from + m.to === cur.from + cur.to) return this.fixNote(m, "That's the move you played.");
    if (!this.evaluate) return this.fixNote(m, "Not the engine's move. Try again.");
    this.busy = true;
    this.render();
    this.note(`Checking <b>${esc(m.san)}</b>…`);
    const after = new Chess(cur.before_fen);
    after.move({ from: m.from, to: m.to, promotion: m.promotion });
    let line;
    try { line = await this.evaluate(after.fen()); } catch { line = null; }
    this.busy = false;
    if (this.cur !== cur || this.step !== "fix") return;
    if (!line) return this.fixNote(m, "Couldn't check that move. Try another.");
    const mine = (this.meW() ? line.cp : -line.cp) / 100;
    if (mine * 100 >= cur.evb * 100 - this.tolerance) return this.fixed(m.san, mine, false);
    this.fixNote(m, `<b>${esc(m.san)}</b> still costs you (${fmt(mine)}). Try again.`);
  }

  fixNote(m, msg) {
    this.drawArrows([[m.from, m.to, true]]);
    this.note(msg);
    this.els.showMe.hidden = false;
    this.render();
  }

  showFix() {
    if (this.step !== "fix") return;
    this.fixed(this.cur.better, null, false, true);
  }

  /** The fix step is over: one block sums up the whole position (their punishment, my move, the fix). */
  fixed(san, evalAfter, best, shown = false) {
    const cur = this.cur, white = this.meW(), opp = this.opp();
    let m = null;
    try { m = new Chess(cur.before_fen).move(san); } catch {}
    if (m) this.drawArrows([[m.from, m.to, false]]);
    const theirs = white ? num(cur.move, false, cur.reply) : num(cur.move + 1, true, cur.reply);
    const cards =
      this.card(`${opp}'s punishment`, theirs) +
      this.card("You played", num(cur.move, white, cur.san), "struck") +
      (shown ? this.card("Should have played", num(cur.move, white, cur.better), "key")
        : this.card(best ? "Your fix · engine's move" : "Your fix holds", num(cur.move, white, san), "key") +
          (best ? "" : this.card("Engine's move", num(cur.move, white, cur.better))));
    const note = evalAfter == null ? "" : `<div class="evalbar-note label">After ${esc(san)} ${fmt(evalAfter)} · best ${fmt(cur.evb)}</div>`;
    this.feedback(!shown && this.firstTry === true, shown ? "Here's the fix" : this.firstTry ? "Found and fixed" : "Fixed", cards, note);
    this.finish();
  }

  // ---------- shared ----------

  finish() {
    this.step = "done";
    this.els.drill?.scrollTo?.(0, 0);
    this.els.fixRow.hidden = true;
    this.els.next.hidden = false;
    this.els.next.focus();
    this.render();
  }

  grade(ok) {
    this.firstTry = ok;
    const pr = this.progress, cur = this.cur, b = pr.boxes[cur.id] || 0;
    pr.boxes[cur.id] = ok ? Math.min(5, Math.max(1, b) + 1) : 1;
    pr.seen[cur.id] = pr.turn++;
    pr.stats.done++;
    if (ok) { pr.stats.ok++; pr.stats.streak++; } else pr.stats.streak = 0;
    this.save(pr);
    this.paintStats();
  }

  note(html) {
    this.els.note.innerHTML = html;
    this.els.note.hidden = !html;
  }

  feedback(ok, head, cards, bar) {
    const link = this.cur.link ? `<a class="game-link" href="${esc(this.cur.link)}" target="_blank" rel="noopener">Game <span class="arr" aria-hidden="true">↗</span></a>` : "";
    this.note("");
    this.els.feedback.innerHTML = `<div class="fb ${ok ? "ok" : "no"}" role="status">
      <div class="fb-head"><h2>${head}</h2>${link}</div><div class="cards">${cards}</div>${bar}</div>`;
  }

  paintScan() {
    for (const chip of this.els.scan.querySelectorAll("[data-kind]")) {
      const kind = chip.dataset.kind, on = this.lit.has(kind);
      chip.setAttribute("aria-pressed", String(on));
      chip.querySelector("b").textContent = on ? String(this.scan[kind].length) : "?";
    }
  }

  evalBar(before, after) {
    const a = evalX(before), b = evalX(after);
    const lo = Math.min(a, b), hi = Math.max(a, b);
    return `<div class="evalbar" role="img" aria-label="Evaluation for you: ${fmt(before)} before your move, ${fmt(after)} after">
      <div class="track"><i class="zero"></i><i class="span" style="left:${lo}%;width:${hi - lo}%"></i>
        <i class="pt before" style="left:${a}%"></i><i class="pt after" style="left:${b}%"></i></div>
      <div class="ends"><span>${fmt(before)}</span><span class="arrow">→</span><span>${fmt(after)}</span></div>
    </div>`;
  }

  card(label, move, cls = "") {
    return `<div class="card ${cls}"><span class="label">${label}</span><b>${esc(move)}</b></div>`;
  }

  paintStats() {
    const { stats, boxes } = this.progress;
    this.els.done.textContent = stats.done;
    this.els.acc.textContent = stats.done ? Math.round((100 * stats.ok) / stats.done) + "%" : "–";
    this.els.streak.textContent = stats.streak;
    const counts = [0, 0, 0, 0, 0, 0];
    for (const it of this.items) counts[boxes[it.id] || 0]++;
    const max = Math.max(...counts, 1);
    this.els.boxes.innerHTML = counts.map((n, i) => `<div title="${i === 0 ? "new" : "box " + i}: ${n}"><i style="height:${Math.round(2 + (22 * n) / max)}px"></i><span>${n}</span></div>`).join("");
  }

  next() {
    this.cur = this.pick();
    if (!this.cur) return;
    const cur = this.cur, [, mo, d] = cur.date.split("-");
    this.game = new Chess(cur.fen);
    this.scan = scanSets(cur.fen);
    this.lit = new Set();
    this.sel = null;
    this.step = "find";
    this.tries = 0;
    this.firstTry = null;
    this.busy = false;
    this.lastMove = [cur.from, cur.to];
    this.els.meta.innerHTML = `<span>vs ${esc(cur.opp)}</span><span>${+mo}/${+d}</span><span>${RESULT[cur.result] || ""}</span>`;
    this.els.playedLabel.textContent = "You played";
    this.els.played.textContent = num(cur.move, this.meW(), cur.san);
    this.els.question.textContent = `Can ${this.opp()} punish it?`;
    if (this.els.side) this.els.side.textContent = `You play ${this.meW() ? "White" : "Black"}`;
    this.els.board.setAttribute("aria-label", `Chess board, ${this.meW() ? "White" : "Black"} at the bottom`);
    this.els.feedback.innerHTML = "";
    this.note("");
    this.els.scan.hidden = false;
    this.els.actions.hidden = false;
    this.els.reveal.hidden = true;
    this.els.fixRow.hidden = true;
    this.els.next.hidden = true;
    this.paintScan();
    this.drawArrows([]);
    this.render();
    this.paintStats();
  }
}
