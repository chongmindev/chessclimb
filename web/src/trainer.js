// The drill: show a position right after my move; I answer with the opponent's punishing move or
// "nothing works". Ported from trainer/trainer_template.html to chess.js 1.x and IndexedDB progress.

import { Chess } from "chess.js";

const PIECE = { k: "♚︎", q: "♛︎", r: "♜︎", b: "♝︎", n: "♞︎", p: "♟︎" };
const NAME = { k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" };
const FILES = "abcdefgh";
const RESULT = { win: "you won", loss: "you lost", draw: "draw" };

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (v) => (v > 0 ? "+" : "") + v.toFixed(1);
const lbl = (n, white, san) => `<span class="mv">${n}${white ? "." : "…"}${esc(san)}</span>`;

export class Trainer {
  /** els: {board, arrows, meta, prompt, steps, feedback, actions, next, hint, safe, safeLabel, side, boxes, done, acc, streak} */
  constructor(els, { load, save }) {
    Object.assign(this, { els, load, save });
    this.items = [];
    this.progress = { boxes: {}, seen: {}, turn: 0, stats: { done: 0, ok: 0, streak: 0 } };
    this.cur = null;
    els.safe.addEventListener("click", () => { if (!this.answered) this.answer(null); });
    els.hint.addEventListener("click", () => { this.hintOn = !this.hintOn; this.render(); });
    els.next.addEventListener("click", () => this.next());
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

  render() {
    const el = this.els.board;
    el.replaceChildren();
    const moves = this.answered ? [] : this.game.moves({ verbose: true });
    const targets = this.sel ? moves.filter((m) => m.from === this.sel) : [];
    const hintSq = new Set();
    if (this.hintOn && !this.answered) for (const m of moves) if (/[ce]/.test(m.flags) || /[+#]/.test(m.san)) { hintSq.add(m.from); hintSq.add(m.to); }
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const s = this.sqName(r, c), p = this.game.get(s);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sq" + ((FILES.indexOf(s[0]) + +s[1]) % 2 === 1 ? " d" : "") + (this.sel === s ? " sel" : "");
      b.setAttribute("aria-label", s + (p ? ` ${p.color === "w" ? "white" : "black"} ${NAME[p.type]}` : ""));
      const add = (cls, text) => { const x = document.createElement("span"); x.className = cls; if (text) x.textContent = text; b.appendChild(x); };
      if (s === this.cur.from || s === this.cur.to) add("lm");
      if (hintSq.has(s)) add("hintmark");
      if (c === 0) add("coord r", s[1]);
      if (r === 7) add("coord f", s[0]);
      if (p) add("pc " + p.color, PIECE[p.type]);
      if (targets.some((m) => m.to === s)) add(p ? "ring" : "dot");
      b.addEventListener("click", () => this.tap(s));
      el.appendChild(b);
    }
  }

  /** A right answer is drawn solid, a wrong one dashed: the shape carries the meaning, not the color. */
  arrow(from, to, color, dashed = false) {
    const [x1, y1] = this.xy(from), [x2, y2] = this.xy(to);
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
    const ex = x2 - ux * 0.32, ey = y2 - uy * 0.32, hx = x2 - ux * 0.12, hy = y2 - uy * 0.12;
    const px = -uy * 0.22, py = ux * 0.22, bx = x2 - ux * 0.45, by = y2 - uy * 0.45;
    return `<line x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" stroke="${color}" stroke-width=".14"${dashed ? ' stroke-dasharray=".22 .14"' : ""} opacity=".9"/>` +
      `<polygon points="${hx},${hy} ${bx + px},${by + py} ${bx - px},${by - py}" fill="${color}" opacity=".9"/>`;
  }

  drawArrows(list) {
    const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    this.els.arrows.innerHTML = list.map(([f, t, c]) => this.arrow(f, t, css(c) || "#000", c === "--bad")).join("");
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

  async answer(m) {
    this.answered = true;
    this.sel = null;
    const cur = this.cur, white = this.meW(), opp = this.opp();
    const yourMove = lbl(cur.move, white, cur.san);
    let ok, html;
    if (cur.kind === "threat") {
      const uci = m ? m.from + m.to : null;
      ok = !!m && cur.accept.some((u) => u.slice(0, 4) === uci);
      const best = white ? lbl(cur.move, false, cur.reply) : lbl(cur.move + 1, true, cur.reply);
      const better = lbl(cur.move, white, cur.better);
      const what = cur.mate != null && cur.mate > 0 ? `It's mate in ${cur.mate}.`
        : `That swings the position by about ${cur.swing} pawns (from ${fmt(cur.evb)} to ${fmt(cur.eva)} for you).`;
      const others = cur.accept_san.filter((x) => x !== cur.reply);
      const extra = others.length ? ` Also strong: ${others.map((x) => `<span class="mv">${esc(x)}</span>`).join(" ")}.` : "";
      html = ok
        ? `<h2>Found it.</h2><p><span class="mv">${esc(m.san)}</span> punishes ${yourMove}. ${what}${extra}</p><p>In the game you should have played ${better} instead.</p>`
        : `<h2>${m ? "Not the one." : "There was a threat."}</h2><p>${opp}'s best is ${best}. ${what}${extra}</p><p>Instead of ${yourMove}, the engine wanted ${better}.</p>`;
      let rm = null;
      try { rm = new Chess(cur.fen).move(cur.reply); } catch {}
      if (rm) this.drawArrows([[rm.from, rm.to, ok ? "--good" : "--bad"]]);
    } else {
      ok = !m;
      html = ok
        ? `<h2>Correct, it's safe.</h2><p>${yourMove} doesn't hang anything. ${opp}'s best try is <span class="mv">${esc(cur.reply)}</span>, and the position stays about ${fmt(cur.eva)} for you.</p>`
        : `<h2>False alarm.</h2><p><span class="mv">${esc(m.san)}</span> doesn't win anything here. ${yourMove} was a safe move, and ${opp}'s best is only <span class="mv">${esc(cur.reply)}</span>. Over-worrying costs time on the clock, so it's worth getting these right too.</p>`;
      if (m) this.drawArrows([[m.from, m.to, "--bad"]]);
    }
    if (cur.link) html += `<p><a href="${esc(cur.link)}" target="_blank" rel="noopener">View this game on Chess.com</a></p>`;

    const pr = this.progress, b = pr.boxes[cur.id] || 0;
    pr.boxes[cur.id] = ok ? Math.min(5, Math.max(1, b) + 1) : 1;
    pr.seen[cur.id] = pr.turn++;
    pr.stats.done++;
    if (ok) { pr.stats.ok++; pr.stats.streak++; } else pr.stats.streak = 0;
    this.save(pr);

    this.els.feedback.innerHTML = `<div class="fb ${ok ? "ok" : "no"}" role="status">${html}</div>`;
    if (this.els.steps) this.els.steps.hidden = true;     // make room for the feedback on one screen
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
    this.els.boxes.innerHTML = counts.map((n, i) => `<div title="${i === 0 ? "new" : "box " + i}: ${n}"><i style="height:${Math.round(1 + (27 * n) / max)}px"></i><span>${n}</span><span>${i === 0 ? "new" : "box " + i}</span></div>`).join("");
  }

  next() {
    this.cur = this.pick();
    if (!this.cur) return;
    this.game = new Chess(this.cur.fen);
    this.sel = null;
    this.answered = false;
    this.hintOn = false;
    const cur = this.cur, [, mo, d] = cur.date.split("-");
    this.els.meta.innerHTML = `<span>vs ${esc(cur.opp)}</span><span>${+mo}/${+d}</span><span>move ${cur.move}</span><span>${RESULT[cur.result] || ""}</span>`;
    this.els.prompt.innerHTML = `You just played ${lbl(cur.move, this.meW(), cur.san)}. ${this.opp()} to move. Does ${this.opp()} have a move that punishes it?`;
    this.els.safeLabel.textContent = `Nothing works for ${this.opp()}`;
    if (this.els.side) this.els.side.textContent = `You play ${this.meW() ? "White" : "Black"}`;
    this.els.board.setAttribute("aria-label", `Chess board, ${this.meW() ? "White" : "Black"} at the bottom`);
    this.els.feedback.innerHTML = "";
    if (this.els.steps) this.els.steps.hidden = false;
    this.els.actions.hidden = false;
    this.els.next.hidden = true;
    this.drawArrows([]);
    this.render();
    this.paintStats();
  }
}
