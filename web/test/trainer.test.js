import { test } from "node:test";
import assert from "node:assert/strict";
import { evalX, material, scanSets } from "../src/trainer.js";

test("scanSets: the opponent's checks and captures, and my loose pieces", () => {
  // After 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6??: White to move. Every Black piece White attacks is defended
  // (f7 by the king, h7 by the rook, e5 by the knight), so nothing is loose, yet Qxf7# wins.
  const s = scanSets("r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4");
  assert.deepEqual(s.checks.map((m) => m.san).sort(), ["Bxf7+", "Qxe5+", "Qxf7#"]);
  assert.deepEqual(s.captures.map((m) => m.san).sort(), ["Bxf7+", "Qxe5+", "Qxf7#", "Qxh7"]);
  assert.deepEqual(s.loose, []);
  // A knight attacked by the queen with nothing defending it is loose.
  assert.deepEqual(scanSets("4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1").loose, ["d5"]);
});

test("evalX maps pawns onto the bar and pins mates to the end", () => {
  assert.equal(evalX(0), 50);
  assert.equal(evalX(3), 75);
  assert.equal(evalX(-20), 0);
  assert.equal(evalX(-0.5, true), 0);
});

test("material counts White minus Black in pawns", () => {
  assert.equal(material("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"), 0);
  assert.equal(material("4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1"), 6);     // queen vs knight
  assert.equal(material("4k3/8/8/8/8/8/8/4K2r w - - 0 1"), -5);
});
