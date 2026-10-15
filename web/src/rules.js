// Drill selection, ported from threatscan/drills.py. Must stay in step with it: the parity test
// (web/test/parity.test.js) runs both on the same recorded evals and requires identical items.
//
// An eval Line is {move: uci|null, cp: int (White's view, mates folded in), mate: int|null (White's view)}.
// `analyse(fen, depth, multipv)` is any async function returning Lines, best first.

import { Chess } from "chess.js";

export const WHITE = "w";
export const BLACK = "b";

const clamp = (v, cap) => Math.max(-cap, Math.min(cap, v));
const pov = (line, color) => (color === WHITE ? line.cp : -line.cp);
const other = (color) => (color === WHITE ? BLACK : WHITE);

export function uciOf(m) {
  return m.from + m.to + (m.promotion || "");
}

function moveOf(chess, uci) {
  return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
}

/** SAN of a UCI move in `fen` (python-chess and chess.js agree on SAN, checked by the parity test). */
export function sanOf(fen, uci) {
  return moveOf(new Chess(fen), uci).san;
}

/** python-chess Board.is_game_over() without claims: mate, stalemate, insufficient material,
 *  the 75-move rule and fivefold repetition. (chess.js's isGameOver also ends on threefold and 50 moves.) */
export function isGameOver(chess, seen) {
  if (chess.isCheckmate() || chess.isStalemate() || chess.isInsufficientMaterial()) return true;
  if (Number(chess.fen().split(" ")[4]) >= 150) return true;
  return seen ? (seen.get(positionKey(chess.fen())) || 0) >= 5 : false;
}

/** Position identity for repetition: placement, side, castling, en passant. */
export function positionKey(fen) {
  return fen.split(" ").slice(0, 4).join(" ");
}

async function sha1hex(text) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stable across rebuilds (same as Python item_id). */
export async function itemId(fen, uci) {
  return (await sha1hex(`${fen} ${uci}`)).slice(0, 12);
}

/** A number in [0, 1) fixed by the position and move (same as Python sample_key). */
export async function sampleKey(seed, fen, uci) {
  return parseInt((await sha1hex(`${seed} ${fen} ${uci}`)).slice(0, 13), 16) / 16 ** 13;
}

/** Centipawns to pawns at one decimal, halves away from zero (same as Python pawns). */
export function pawns(cp) {
  const tenths = Math.floor((Math.abs(cp) + 5) / 10);
  return (cp >= 0 ? tenths : -tenths) / 10 + 0; // + 0 turns -0 into 0, as Python's integer math does
}

/**
 * My moves in one game, each with clamped evals before and after. Stops if my move ends the game.
 * game = {color, moves: [{from, to, promotion?}], opponent, date, result, link?}
 */
export async function* walk(game, analyse, depth, cap) {
  const chess = new Chess();
  const seen = new Map([[positionKey(chess.fen()), 1]]);
  let line = (await analyse(chess.fen(), depth, 1))[0];
  for (let i = 0; i < game.moves.length; i++) {
    const mine = chess.turn() === game.color;
    const fenBefore = chess.fen();
    const before = clamp(pov(line, game.color), cap);
    const bestSan = mine && line.move ? sanOf(fenBefore, line.move) : null;
    const m = moveOf(chess, uciOf(game.moves[i]));
    const key = positionKey(chess.fen());
    seen.set(key, (seen.get(key) || 0) + 1);
    if (mine && isGameOver(chess, seen)) return;
    line = (await analyse(chess.fen(), depth, 1))[0];
    if (mine) {
      yield { game, moveNumber: Math.floor(i / 2) + 1, fenBefore, fen: chess.fen(), move: m, uci: uciOf(m),
              san: m.san, bestSan, before, after: clamp(pov(line, game.color), cap) };
    }
  }
}

const loss = (p) => Math.max(0, p.before - p.after);

export function isThreatCandidate(c, p) {
  return p.moveNumber >= c.threat_min_move && p.before > c.threat_min_before && loss(p) >= c.threat_min_loss;
}

export function isSafeCandidate(c, p) {
  return p.moveNumber >= c.safe_min_move && loss(p) <= c.safe_max_loss;
}

function forcing(fen, uci) {
  const chess = new Chess(fen);
  const m = moveOf(chess, uci);
  return m.flags.includes("c") || m.flags.includes("e") || chess.inCheck();
}

async function base(p) {
  const g = p.game;
  return { id: await itemId(p.fen, p.uci), fen: p.fen, color: g.color, from: p.move.from, to: p.move.to,
           san: p.san, move: p.moveNumber, opp: g.opponent, date: g.date, result: g.result,
           evb: pawns(p.before), eva: pawns(p.after), ...(g.link ? { link: g.link } : {}) };
}

/** Item if the opponent's best reply is a check or capture, else null. `lines` is MultiPV for the opponent. */
export async function threatItem(c, p, lines, cap) {
  const opp = other(p.game.color);
  lines = lines.filter((l) => l.move);
  if (!lines.length || !p.bestSan) return null;
  const top = lines[0];
  if (!forcing(p.fen, top.move)) return null;
  const oppCp = (l) => clamp(pov(l, opp), cap);
  const accept = lines.filter((l) => oppCp(l) >= oppCp(top) - c.accept_within && oppCp(l) >= -p.before + c.accept_min_gain);
  if (!accept.length) return null;
  const mate = top.mate === null || top.mate === undefined ? null : opp === WHITE ? top.mate : -top.mate;
  return { ...(await base(p)), kind: "threat", accept: accept.map((l) => l.move),
           accept_san: accept.map((l) => sanOf(p.fen, l.move)), reply: sanOf(p.fen, top.move),
           mate, better: p.bestSan, swing: pawns(loss(p)) };
}

export async function safeItem(c, p, lines, cap) {
  lines = lines.filter((l) => l.move);
  if (!lines.length || !(c.safe_after_min <= p.after && p.after <= c.safe_after_max)) return null;
  const top = lines[0];
  if (clamp(pov(top, other(p.game.color)), cap) >= c.safe_max_opp_eval) return null;
  return { ...(await base(p)), kind: "safe", reply: sanOf(p.fen, top.move) };
}

/** Run the drill rules on one of my moves (evals at full depth). Returns {threat}, {safe: {key, item}} or null. */
async function classify(p, analyse, cfg) {
  const c = cfg.drills, cap = cfg.engine.eval_cap;
  if (isThreatCandidate(c, p)) {
    const item = await threatItem(c, p, await analyse(p.fen, c.depth, c.multipv), cap);
    return item && { threat: item };
  }
  if (isSafeCandidate(c, p)) {
    const key = await sampleKey(c.seed, p.fen, p.uci);
    if (key < c.safe_sample_rate) {
      const item = await safeItem(c, p, await analyse(p.fen, c.depth, c.multipv), cap);
      return item && { safe: { key, item } };
    }
  }
  return null;
}

function collect(results) {
  const threats = [], safes = [];
  for (const r of results) {
    if (r?.threat) threats.push(r.threat);
    if (r?.safe) safes.push(r.safe);
  }
  return { threats, safes };
}

/** Candidate items from one game: threats, and safe items with their sample key. Every position at full depth. */
export async function gameCandidates(game, analyse, cfg) {
  const results = [];
  for await (const p of walk(game, analyse, cfg.drills.depth, cfg.engine.eval_cap)) results.push(await classify(p, analyse, cfg));
  return collect(results);
}

/**
 * The quick pass: screen every position at scan.screen_depth, then apply the full-depth rules only to my
 * moves within scan.screen_margin of a threshold. Those moves get the same deep evals as gameCandidates,
 * so every item found here is identical to the full pass's; it just may miss a few (measured ~3%).
 */
export async function screenedCandidates(game, analyse, cfg) {
  const c = cfg.drills, cap = cfg.engine.eval_cap, { screen_depth: depth, screen_margin: margin } = cfg.scan;
  const picks = [];
  for await (const p of walk(game, analyse, depth, cap)) {
    const l = loss(p);
    const threat = p.moveNumber >= c.threat_min_move && p.before > c.threat_min_before - margin && l >= c.threat_min_loss - margin;
    const safe = p.moveNumber >= c.safe_min_move && l <= c.safe_max_loss + margin &&
      (await sampleKey(c.seed, p.fen, p.uci)) < c.safe_sample_rate;
    if (threat || safe) picks.push(p);
  }
  const results = [];
  for (const p of picks) {
    const lineBefore = (await analyse(p.fenBefore, c.depth, 1))[0];
    const lineAfter = (await analyse(p.fen, c.depth, 1))[0];
    const deep = { ...p, before: clamp(pov(lineBefore, p.game.color), cap), after: clamp(pov(lineAfter, p.game.color), cap),
                   bestSan: lineBefore.move ? sanOf(p.fenBefore, lineBefore.move) : null };
    results.push(await classify(deep, analyse, cfg));
  }
  return collect(results);
}

/** The deck: every threat, plus the lowest-keyed safe items up to safe_ratio per threat. */
export function selectDeck(threats, safes, cfg) {
  const n = Math.floor(threats.length * cfg.drills.safe_ratio + 0.5);
  return [...threats, ...[...safes].sort((a, b) => a.key - b.key).slice(0, n).map((s) => s.item)];
}

export async function buildItems(games, analyse, cfg) {
  const threats = [], safes = [];
  for (const g of games) {
    const r = await gameCandidates(g, analyse, cfg);
    threats.push(...r.threats);
    safes.push(...r.safes);
  }
  return selectDeck(threats, safes, cfg);
}
