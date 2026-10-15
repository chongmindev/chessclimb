// Chess.com games to the shape rules.js walks. Mirrors cracktics/games.py (read_games, Game).

import { Chess } from "chess.js";

export function headersOf(pgn) {
  const h = {};
  for (const m of pgn.matchAll(/^\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm)) h[m[1]] = m[2].replace(/\\(.)/g, "$1");
  return h;
}

export function playerColor(h, username) {
  const u = username.toLowerCase();
  if ((h.White || "").toLowerCase() === u) return "w";
  if ((h.Black || "").toLowerCase() === u) return "b";
  return null;
}

function resultFor(r, color) {
  if (r === "1/2-1/2") return "draw";
  if (r !== "1-0" && r !== "0-1") return "?";
  return (r === "1-0") === (color === "w") ? "win" : "loss";
}

/** One PGN game for `username`, or null if they didn't play in it or it isn't standard chess. */
export function gameFromPgn(pgn, username) {
  const h = headersOf(pgn);
  const color = playerColor(h, username);
  if (!color || (h.Variant && h.Variant !== "Standard") || "SetUp" in h) return null;
  const chess = new Chess();
  chess.loadPgn(pgn);
  const moves = chess.history({ verbose: true }).map((m) => ({ from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}) }));
  return gameFromHeaders(h, color, moves);
}

// Chess.com's TCN: two characters per move, each an index into this alphabet. 0-63 are squares
// (a1 = 0, b1 = 1, ..., h8 = 63); a "to" index above 63 encodes a promotion and its direction.
const TCN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?{~}(^)[_]@#$,./&-*++=";
const square = (i) => "abcdefgh"[i % 8] + (Math.floor(i / 8) + 1);

/** Decode a TCN move string to [{from, to, promotion?}] without move generation (~1000x faster than loadPgn). */
export function decodeTcn(tcn) {
  const moves = [];
  for (let i = 0; i < tcn.length; i += 2) {
    const from = TCN.indexOf(tcn[i]);
    let to = TCN.indexOf(tcn[i + 1]);
    if (from < 0 || from > 63 || to < 0) throw new Error(`bad TCN at ${i}`);
    const m = { from: square(from) };
    if (to > 63) {
      m.promotion = "qnrbkp"[Math.floor((to - 64) / 3)];
      to = from + (from < 16 ? -8 : 8) + ((to - 1) % 3) - 1;
    }
    m.to = square(to);
    moves.push(m.promotion ? { from: m.from, to: m.to, promotion: m.promotion } : { from: m.from, to: m.to });
  }
  return moves;
}

/** A game from the Chess.com archive JSON, or null (variants, games without a PGN).
 *  Moves come from the TCN field when present (fast), else from the PGN. */
export function gameFromChessCom(g, username) {
  if (g.rules !== "chess" || !g.pgn) return null;
  const h = headersOf(g.pgn);
  const color = playerColor(h, username);
  if (!color || (h.Variant && h.Variant !== "Standard") || "SetUp" in h) return null;
  let moves;
  try { moves = g.tcn ? decodeTcn(g.tcn) : null; } catch { moves = null; }
  const game = moves ? gameFromHeaders(h, color, moves) : gameFromPgn(g.pgn, username);
  return game && { ...game, timeClass: g.time_class, endTime: g.end_time };
}

function gameFromHeaders(h, color, moves) {
  return {
    color,
    opponent: color === "w" ? h.Black : h.White,
    date: (h.Date || "????.??.??").replaceAll(".", "-"),
    result: resultFor(h.Result || "*", color),
    ...(h.Link ? { link: h.Link } : {}),
    moves,
  };
}

/** Split a multi-game PGN file into game texts. */
export function splitPgn(text) {
  return text.split(/\n(?=\[Event )/).map((s) => s.trim()).filter(Boolean);
}
