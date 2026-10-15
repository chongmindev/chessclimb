// The drill: show a position right after my move; I answer with the opponent's punishing move or
// "nothing works". Few words: the move I played, a question, three scan chips that light the board,
// and feedback as move cards plus an eval bar.

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
  /** els: {board, arrows, meta, played, question, scan, feedback, actions, next, safe, safeLabel, side, boxes, done, acc, streak} */
  constructor(els, { load, save }) {
    Object.assign(this, { els, load, save });
    this.items = [];
    this.progress = { boxes: {}, seen: {}, turn: 0, stats: { done: 0, ok: 0, streak: 0 } };
    this.cur = null;
    els.safe.addEventListener("click", () => { if (!this.answered) this.answer(null); });
    els.next.addEventListener("click", () => this.next());
    els.scan.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-kind]");
      if (!chip || this.answered) return;
      const kind = chip.dataset.kind;
      if (this.lit.has(kind)) this.lit.delete(kind); else this.lit.add(kind);
      this.paintScan();
      this.render();
    });
  }

  async start() {
    this.progress = (await this.load()) || this.progress;
  }

  /** New deck from the scan. Keeps the current position on screen if it's still in the deck. */
  setItems(items) {
    this.items = items;
    if (!this.cur && items.length) this.next();
    this.paintStats();
  }

  meW() { return this.cur.color === "w"; }
  opp() { return this.meW() ? "Black" : "White"; }

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

  /** Squares lit by the active scan chips: move squares for checks/captures, piece squares for loose. */
  litSquares() {
    const moveSq = new Set(), loose = new Set();
    if (this.answered) return { moveSq, loose };
    for (const kind of ["checks", "captures"]) if (this.lit.has(kind)) for (const m of this.scan[kind]) { moveSq.add(m.from); moveSq.add(m.to); }
    if (this.lit.has("loose")) for (const s of this.scan.loose) loose.add(s);
    return { moveSq, loose };
  }

  render() {
    const el = this.els.board;
    el.replaceChildren();
    const moves = this.answered ? [] : this.game.moves({ verbose: true });
    const targets = this.sel ? moves.filter((m) => m.from === this.sel) : [];
    const { moveSq, loose } = this.litSquares();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const s = this.sqName(r, c), p = this.game.get(s);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sq" + ((FILES.indexOf(s[0]) + +s[1]) % 2 === 1 ? " d" : "") + (this.sel === s ? " sel" : "");
      b.setAttribute("aria-label", s + (p ? ` ${p.color === "w" ? "white" : "black"} ${NAME[p.type]}` : ""));
      const add = (cls, text) => { const x = document.createElement("span"); x.className = cls; if (text) x.textContent = text; b.appendChild(x); };
      if (s === this.cur.from || s === this.cur.to) add("lm");
      if (moveSq.has(s)) add("hintmark");
      if (loose.has(s)) add("loose");
      if (c === 0) add("coord r", s[1]);
      if (r === 7) add("coord f", s[0]);
      if (p) add(`pc ${p.color}${p.type.toUpperCase()}`);
      if (targets.some((m) => m.to === s)) add(p ? "ring" : "dot");
      b.addEventListener("click", () => this.tap(s));
      el.appendChild(b);
    }
  }

  /** A right answer is drawn solid, a wrong one dashed: the shape carries the meaning, not only the color. */
  arrow(from, to, color, dashed = false) {
    const [x1, y1] = this.xy(from), [x2, y2] = this.xy(to);
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
    const ex = x2 - ux * 0.32, ey = y2 - uy * 0.32, hx = x2 - ux * 0.12, hy = y2 - uy * 0.12;
    const px = -uy * 0.22, py = ux * 0.22, bx = x2 - ux * 0.45, by = y2 - uy * 0.45;
    return `<line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke="${color}" stroke-width=".14"${dashed ? ' stroke-dasharray=".22 .14"' : ""}/>` +
      `<polygon points="${hx},${hy} ${bx + px},${by + py} ${bx - px},${by - py}" fill="${color}"/>`;
  }

  drawArrows(list) {
    const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    this.els.arrows.innerHTML = list.map(([f, t, dashed]) => this.arrow(f, t, css("--black") || "#000", dashed)).join("");
  }

  tap(s) {
    if (this.answered) return;
    const p = this.game.get(s);
    if (this.sel) {
      const m = this.game.moves({ verbose: true }).find((m) => m.from === this.sel && m.to === s);
      if (m) return this.answer(m);
    }
    this.sel = p && p.color === this.game.turn() && this.sel !== s ? s : null;
    this.render();
  }

  paintScan() {
    for (const chip of this.els.scan.querySelectorAll("[data-kind]")) {
      const kind = chip.dataset.kind, on = this.lit.has(kind);
      chip.setAttribute("aria-pressed", String(on));
      chip.querySelector("b").textContent = on ? String(this.scan[kind].length) : "?";
    }
  }

  evalBar(before, after, mate) {
    const a = evalX(before), b = evalX(after, mate);
    const lo = Math.min(a, b), hi = Math.max(a, b);
    return `<div class="evalbar" role="img" aria-label="Evaluation for you: ${fmt(before)} before your move, ${mate ? "mate" : fmt(after)} after">
      <div class="track"><i class="zero"></i><i class="span" style="left:${lo}%;width:${hi - lo}%"></i>
        <i class="pt before" style="left:${a}%"></i><i class="pt after" style="left:${b}%"></i></div>
      <div class="ends"><span>${fmt(before)}</span><span class="arrow">→</span><span>${mate ? "Mate" : fmt(after)}</span></div>
    </div>`;
  }

  card(label, move, cls = "") {
    return `<div class="card ${cls}"><span class="label">${label}</span><b>${esc(move)}</b></div>`;
  }

  async answer(m) {
    this.answered = true;
    this.sel = null;
    const cur = this.cur, white = this.meW(), opp = this.opp();
    const theirNum = white ? num(cur.move, false, cur.reply) : num(cur.move + 1, true, cur.reply);
    let ok, verdict, cards = "", bar = "";
    if (cur.kind === "threat") {
      ok = !!m && cur.accept.some((u) => u.slice(0, 4) === m.from + m.to);
      const mate = cur.mate != null && cur.mate > 0;
      verdict = ok ? "Found it" : m ? "Not the one" : "There was a threat";
      cards = this.card(`${opp}'s best`, theirNum, "key") +
        (m && !ok ? this.card("Your try", m.san, "miss") : "") +
        this.card("You played", num(cur.move, white, cur.san), "struck") +
        this.card("Better", num(cur.move, white, cur.better));
      bar = mate ? `<div class="mate">Mate in ${cur.mate}</div>` : this.evalBar(cur.evb, cur.eva, false);
      let rm = null;
      try { rm = new Chess(cur.fen).move(cur.reply); } catch {}
      if (rm) this.drawArrows([[rm.from, rm.to, !ok]]);
    } else {
      ok = !m;
      verdict = ok ? "Safe. Well judged" : "False alarm";
      cards = (m ? this.card("Your try", m.san, "miss") : "") + this.card(`${opp}'s best try`, theirNum);
      bar = this.evalBar(cur.evb, cur.eva, false);
      if (m) this.drawArrows([[m.from, m.to, true]]);
    }
    const link = cur.link ? `<a class="game-link" href="${esc(cur.link)}" target="_blank" rel="noopener">Game ↗</a>` : "";

    const pr = this.progress, b = pr.boxes[cur.id] || 0;
    pr.boxes[cur.id] = ok ? Math.min(5, Math.max(1, b) + 1) : 1;
    pr.seen[cur.id] = pr.turn++;
    pr.stats.done++;
    if (ok) { pr.stats.ok++; pr.stats.streak++; } else pr.stats.streak = 0;
    this.save(pr);

    this.els.feedback.innerHTML = `<div class="fb ${ok ? "ok" : "no"}" role="status">
      <div class="fb-head"><h2>${verdict}</h2>${link}</div>
      <div class="cards">${cards}</div>${bar}</div>`;
    this.els.scan.hidden = true;
    this.els.actions.hidden = true;
    this.els.next.hidden = false;
    this.els.next.focus();
    this.render();
    this.paintStats();
  }

  paintStats() {
    const { stats, boxes } = this.progress;
    this.els.done.textContent = stats.done;
    this.els.acc.textContent = stats.done ? Math.round((100 * stats.ok) / stats.done) + "%" : "–";
    this.els.streak.textContent = stats.streak;
    const counts = [0, 0, 0, 0, 0, 0];
    for (const it of this.items) counts[boxes[it.id] || 0]++;
    const max = Math.max(...counts, 1);
    this.els.boxes.innerHTML = counts.map((n, i) => `<div title="${i === 0 ? "new" : "box " + i}: ${n}"><i style="height:${Math.round(1 + (27 * n) / max)}px"></i><span>${n}</span></div>`).join("");
  }

  next() {
    this.cur = this.pick();
    if (!this.cur) return;
    const cur = this.cur, [, mo, d] = cur.date.split("-");
    this.game = new Chess(cur.fen);
    this.scan = scanSets(cur.fen);
    this.lit = new Set();
    this.sel = null;
    this.answered = false;
    this.els.meta.innerHTML = `<span>vs ${esc(cur.opp)}</span><span>${+mo}/${+d}</span><span>${RESULT[cur.result] || ""}</span>`;
    this.els.played.textContent = num(cur.move, this.meW(), cur.san);
    this.els.question.textContent = `Can ${this.opp()} punish it?`;
    this.els.safeLabel.textContent = "Nothing works";
    if (this.els.side) this.els.side.textContent = `You play ${this.meW() ? "White" : "Black"}`;
    this.els.board.setAttribute("aria-label", `Chess board, ${this.meW() ? "White" : "Black"} at the bottom, ${this.opp()} to move`);
    this.els.feedback.innerHTML = "";
    this.els.scan.hidden = false;
    this.els.actions.hidden = false;
    this.els.next.hidden = true;
    this.paintScan();
    this.drawArrows([]);
    this.render();
    this.paintStats();
  }
}
