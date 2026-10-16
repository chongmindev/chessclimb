// Why the better move is better, in plain words, built from the board and one engine line (no AI text).
//   1. what my move allowed: their reply, and how (left a piece undefended, took a defender away, walked into it…)
//   2. what the better move does about it: takes the attacker, moves the piece away, defends it, checks…
//   3. the engine's line after the better move, cut where the captures stop, and the material at that point

import { Chess } from "chess.js";

const NAME = { k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" };
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const MAX_LINE = 8;   // plies of the engine line to show at most

/** Material on the board, White minus Black, in pawns (P1 N3 B3 R5 Q9). */
export function material(fen) {
  let v = 0;
  for (const ch of fen.split(" ")[0]) {
    const t = ch.toLowerCase();
    if (t in VALUE) v += (ch === t ? -1 : 1) * VALUE[t];
  }
  return v;
}

const b = (s) => `<b>${s}</b>`;
const fmt = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1);

/** "30.Rxe5" / "30…dxe5" for a verbose move played from `fen`. */
export function numbered(fen, m) {
  const [, turn, , , , full] = fen.split(" ");
  return `${full}${turn === "w" ? "." : "…"}${m.san}`;
}

/** Play UCI moves from `fen`; stops at the first illegal one. Returns [{move, fen before, fen after}]. */
function play(fen, ucis) {
  const g = new Chess(fen), out = [];
  for (const u of ucis) {
    const before = g.fen();
    let m;
    try { m = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }); } catch { break; }
    out.push({ move: m, before, after: g.fen() });
  }
  return out;
}

/** Cut a line where it goes quiet: after a move that is not a capture or check, with no capture next. */
function quietCut(plies, min = 2) {
  for (let i = min - 1; i < Math.min(plies.length, MAX_LINE); i++) {
    const m = plies[i].move, next = plies[i + 1]?.move;
    if (!m.captured && !m.san.includes("+") && !next?.captured) return plies.slice(0, i + 1);
  }
  return plies.slice(0, MAX_LINE);
}

/** Squares strictly between a and b on a rank, file or diagonal; [] if they don't share a line. */
export function between(a, b) {
  const f1 = a.charCodeAt(0), r1 = +a[1], f2 = b.charCodeAt(0), r2 = +b[1];
  const df = Math.sign(f2 - f1), dr = Math.sign(r2 - r1);
  if (!(f1 === f2 || r1 === r2 || Math.abs(f2 - f1) === Math.abs(r2 - r1))) return [];
  const out = [];
  for (let f = f1 + df, r = r1 + dr; f !== f2 || r !== r2; f += df, r += dr) out.push(String.fromCharCode(f) + r);
  return out;
}

function amount(n) {
  const words = { 1: "a pawn", 2: "two pawns' worth", 3: "a piece", 5: "a rook", 9: "a queen" };
  return words[n] || `${n} pawns' worth`;
}

/**
 * before: FEN before my move. played, reply, better: SAN (my move, their punishment, the engine's move).
 * line: engine line after the better move {pv: [uci], cp, mate} (White's view), or null.
 * punish: engine line after my move (their best play, usually starting with `reply`), or null.
 * evb / eva: my eval in pawns before / after my move; mate: their mate-in-N after my move, if any.
 * Returns {points: [html], plies: [{move, before, after}]} — plies start with the better move.
 */
export function explainFix({ before, played, reply, better, line = null, punish = null, evb = null, eva = null, mate = null }) {
  const start = new Chess(before), me = start.turn(), opp = me === "w" ? "b" : "w";
  const points = [];
  const pm = new Chess(before).move(played);
  const afterPlayed = pm.after;
  let rm = null;
  try { rm = new Chess(afterPlayed).move(reply); } catch {}
  const bm = new Chess(before).move(better);
  const afterBetter = bm.after;
  const P = b(numbered(before, pm)), R = rm ? b(numbered(afterPlayed, rm)) : "", B = b(numbered(before, bm));
  const sign = me === "w" ? 1 : -1, side = (c) => (c === "w" ? "White" : "Black");
  const lineText = (plies) => plies.map((p, i) => (i === 0 || p.move.color === "w" ? numbered(p.before, p.move) : p.move.san)).join(" ");
  const gain = (fen) => sign * (material(fen) - material(before));

  // Their best play after my move, when it starts with the reply: what the punishment really wins.
  let theirs = "";
  if (rm && punish?.pv?.[0] === rm.from + rm.to + (rm.promotion || "")) {
    const plies = quietCut(play(afterPlayed, punish.pv), 1);
    const d = gain(plies.at(-1).after);
    const worse = eva != null && mate == null && eva < d - 2;   // the eval is well below what the material says
    if (plies.length > 1 && d < 0)
      theirs = ` Best play goes ${b(lineText(plies))}, and you're ${amount(-d)} down${worse ? `, with a much worse position (engine: ${fmt(eva)})` : ""}.`;
  }

  // 1. What my move allowed.
  if (rm) {
    const S = rm.to, target = rm.captured ? NAME[rm.captured] : null;
    const cost = theirs || (mate == null && evb != null && eva != null && evb - eva >= 1 ? ` That costs about ${Math.round(evb - eva)} pawns.` : "");
    if (rm.san.endsWith("#")) points.push(`${P} allowed ${R}, checkmate.`);
    else if (mate != null && mate > 0) points.push(`${P} allowed ${R}, which starts a forced mate in ${mate}.`);
    else if (target && pm.to === S) {
      points.push(`${P} put your ${NAME[pm.piece]} on ${S}, where ${R} takes it.${pm.captured ? ` It won a ${NAME[pm.captured]}, but loses more back.` : ""}${cost}`);
    } else if (target) {
      const guardedBefore = start.attackers(S, me).includes(pm.from);
      const guardedAfter = new Chess(afterPlayed).attackers(S, me);
      const attackedBefore = start.attackers(S, opp).includes(rm.from);
      if (guardedBefore && !guardedAfter.includes(pm.to))
        points.push(`Your ${NAME[pm.piece]} was guarding the ${target} on ${S}. ${P} took it away, and ${R} takes the ${target}.${cost}`);
      else if (!attackedBefore)
        points.push(`${P} opened the way for ${R}, which takes your ${target} on ${S}.${cost}`);
      else if (!guardedAfter.length)
        points.push(`Your ${target} on ${S} was already attacked and ${P} left it undefended, so ${R} takes it.${cost}`);
      else points.push(`${P} let ${R} take your ${target} on ${S}, and you can't win enough back.${cost}`);
    } else if (rm.san.includes("+")) points.push(`${P} allowed ${R}, a check that wins material.${cost}`);
    else points.push(`${P} allowed ${R}.${cost}`);
  }

  // 2. What the better move does about it.
  const reasons = [];
  if (bm.san.endsWith("#")) reasons.push("It's checkmate.");
  if (bm.captured) {
    reasons.push(rm && bm.to === rm.from
      ? `It takes the ${NAME[bm.captured]} on ${bm.to}, the piece that was going to play ${b(rm.san)}.`
      : `It takes the ${NAME[bm.captured]} on ${bm.to}.`);
  }
  if (rm) {
    const S = rm.to, mine = start.get(S);
    const replyLegal = new Chess(afterBetter).moves({ verbose: true }).some((m) => m.from === rm.from && m.to === S);
    const tookAttacker = bm.captured && bm.to === rm.from;
    if (tookAttacker) { /* said above */ }
    else if (!replyLegal && between(rm.from, S).includes(bm.to)) reasons.push(`It blocks the ${NAME[rm.piece]}'s path to ${S}.`);
    else if (rm.captured && start.attackers(S, me).includes(pm.from) && !new Chess(afterPlayed).attackers(S, me).includes(pm.to)
      && new Chess(afterBetter).get(S)?.color === me && new Chess(afterBetter).attackers(S, me).includes(pm.from))
      reasons.push(`It keeps your ${NAME[pm.piece]} on ${pm.from} guarding ${S}.`);
    else if (rm.captured && mine?.color === me && bm.from === S) reasons.push(`It moves your ${NAME[mine.type]} off ${S}, out of reach of ${b(rm.san)}.`);
    else if (!replyLegal) reasons.push(`${b(rm.san)} isn't possible any more.`);
    else if (rm.captured && new Chess(afterBetter).get(S)?.color === me
      && new Chess(afterBetter).attackers(S, me).length > start.attackers(S, me).length)
      reasons.push(`It defends ${S}, so ${b(rm.san)} would cost ${side(opp)} the ${NAME[rm.piece]}.`);
    else if (rm.san.endsWith("#")) {
      const g = new Chess(afterBetter);
      g.move({ from: rm.from, to: S, promotion: rm.promotion });
      if (!g.isCheckmate()) reasons.push(`After it, ${b(rm.san.slice(0, -1))} isn't mate any more.`);
    }
  }
  if (bm.san.includes("+") && !bm.san.endsWith("#")) reasons.push(`It comes with check, so ${opp === "w" ? "White" : "Black"} has to deal with that first.`);
  const myMate = line?.mate != null ? (me === "w" ? line.mate : -line.mate) : null;
  if (myMate != null && myMate > 0) reasons.push(`It leads to mate in ${myMate + 1}.`);   // +1: the better move itself
  const best = play(afterBetter, line?.pv || [])[0];
  if (!reasons.length && best && rm) {
    const still = best.move.from === rm.from && best.move.to === rm.to;
    reasons.push(still
      ? `${b(rm.san)} is still there, but now it doesn't win anything.`
      : `It takes the sting out of ${b(rm.san)}: ${side(opp)}'s best answer is ${b(numbered(afterBetter, best.move))} instead.`);
  }
  if (!reasons.length) reasons.push("Every other move loses more; this one keeps your position together.");
  points.push(`${B}: ${reasons.join(" ")}`);

  // 3. The engine's line after the better move, and where material ends up.
  const plies = [{ move: bm, before, after: afterBetter }, ...play(afterBetter, line?.pv || [])];
  const shown = quietCut(plies, 3);   // at least: the better move, their answer, my follow-up
  if (shown.length > 1) {
    const text = lineText(shown);
    const d = gain(shown.at(-1).after);
    const ev = line && line.mate == null ? sign * line.cp / 100 : null;
    const outcome = d > 0 ? (ev != null && ev < d - 1 ? "you come out ahead" : `you come out ${amount(d)} up`)
      : d < 0 ? `you're ${amount(-d)} down in material but better placed` : "material stays level";
    const instead = mate != null && mate > 0 ? " instead of getting mated" : eva != null && Math.abs(eva) < 20 ? ` instead of ${fmt(eva)}` : "";
    const score = line && line.mate == null ? ` Engine: ${fmt(sign * line.cp / 100)}${instead}.` : "";
    points.push(`Best line: ${b(text)}. After that, ${outcome}.${score}`);
  }
  return { points, plies: shown };
}
