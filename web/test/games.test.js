import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { gameFromChessCom, gameFromPgn, headersOf, splitPgn } from "../src/games.js";

const PGN = `[Event "Live Chess"]
[White "Dudacio"]
[Black "x"]
[Result "0-1"]
[Date "2026.10.01"]
[Link "https://www.chess.com/game/live/1"]

1. e4 {[%clk 0:09:58]} 1... e5 {[%clk 0:09:57]} 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 0-1`;

test("parses a Chess.com PGN with clock comments", () => {
  const g = gameFromPgn(PGN, "DUDACIO");
  assert.equal(g.color, "w");
  assert.equal(g.opponent, "x");
  assert.equal(g.result, "loss");
  assert.equal(g.date, "2026-10-01");
  assert.equal(g.moves.length, 7);
  assert.deepEqual(g.moves[6], { from: "h5", to: "f7" });
});

test("skips games the player wasn't in and variants", () => {
  assert.equal(gameFromPgn(PGN, "someone"), null);
  assert.equal(gameFromChessCom({ rules: "chess960", pgn: PGN }, "dudacio"), null);
  assert.equal(gameFromPgn(PGN.replace('[Result', '[Variant "Chess960"]\n[Result'), "dudacio"), null);
});

test("header values may contain escaped quotes", () => {
  assert.equal(headersOf('[White "a \\"b\\""]').White, 'a "b"');
});

const parity = new URL("../../data/parity/games.json", import.meta.url);
const pgnFile = new URL("../../data/games.pgn", import.meta.url);
test("matches Python's parsing of the reference games", { skip: !(existsSync(parity) && existsSync(pgnFile)) && "no data/parity" }, () => {
  const want = JSON.parse(readFileSync(parity, "utf8"));
  const got = splitPgn(readFileSync(pgnFile, "utf8")).map((p) => gameFromPgn(p, "Dudacio")).filter(Boolean);
  assert.equal(got.length, want.length);
  got.forEach((g, i) => assert.deepEqual(g, want[i], `game ${i}`));
});

const archive = new URL("../../data/chesscom_cache/dudacio/2026-09.json", import.meta.url);
test("TCN decoding matches chess.js PGN parsing on a real archive", { skip: !existsSync(archive) && "no cached archive" }, () => {
  const games = JSON.parse(readFileSync(archive, "utf8")).games.filter((g) => g.rules === "chess" && g.tcn);
  let promotions = 0, castles = 0;
  for (const g of games) {
    const fast = gameFromChessCom(g, "Dudacio");
    const slow = gameFromPgn(g.pgn, "Dudacio");
    assert.deepEqual(fast.moves, slow.moves, g.url);
    assert.deepEqual({ ...fast, timeClass: undefined, endTime: undefined, moves: undefined },
                     { ...slow, timeClass: undefined, endTime: undefined, moves: undefined });
    promotions += fast.moves.filter((m) => m.promotion).length;
    castles += slow.moves.filter((m, i) => (m.from === "e1" || m.from === "e8") && Math.abs(m.from.charCodeAt(0) - m.to.charCodeAt(0)) === 2).length;
  }
  assert.ok(games.length > 50 && promotions > 0 && castles > 0, `coverage: ${games.length} games, ${promotions} promotions, ${castles} castles`);
});

