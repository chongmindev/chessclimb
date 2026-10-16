import { test } from "node:test";
import assert from "node:assert/strict";
import { between, explainFix } from "../src/explain.js";

const text = (points) => points.join(" ").replace(/<[^>]+>/g, "");
const SCHOLAR = "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3";   // Black to move, f7 under fire

test("between lists the squares on a shared line", () => {
  assert.deepEqual(between("h5", "f7"), ["g6"]);
  assert.deepEqual(between("a1", "a4"), ["a2", "a3"]);
  assert.deepEqual(between("a1", "b3"), []);
});

test("a mate allowed, and a block that stops it", () => {
  const ex = explainFix({ before: SCHOLAR, played: "Nf6", reply: "Qxf7#", better: "g6",
    line: { pv: ["h5f3", "g8f6", "g1e2"], cp: -20, mate: null }, evb: 0, eva: -99, mate: 0 });
  const t = text(ex.points);
  assert.match(t, /3…Nf6 allowed 4\.Qxf7#, checkmate/);
  assert.match(t, /blocks the queen's path to f7/);
  assert.match(t, /Best line: 3…g6 4\.Qf3 Nf6/);
  assert.deepEqual(ex.plies.map((p) => p.move.san), ["g6", "Qf3", "Nf6"]);
});

test("a defender walked away; moving the piece out of reach fixes it", () => {
  const before = "4k3/8/1b6/8/3N4/8/8/3QK3 w - - 0 1";   // Qd1 guards the d4 knight; Bb6 eyes it
  const t = text(explainFix({ before, played: "Qb3", reply: "Bxd4", better: "Nf5", line: null, evb: 3, eva: 0 }).points);
  assert.match(t, /Your queen was guarding the knight on d4\. 1\.Qb3 took it away/);
  assert.match(t, /moves your knight off d4/);
});

test("taking the attacker is called out", () => {
  const before = "4k3/8/Rb6/8/3N4/8/8/4K3 w - - 0 1";
  const ex = explainFix({ before, played: "Ra8+", reply: "Kd7", better: "Rxb6",
    line: { pv: ["e8d7", "d4f5"], cp: 900, mate: null }, evb: 9, eva: 2 });
  assert.match(text(ex.points), /takes the bishop on b6/);
  assert.match(text(ex.points), /you come out a piece up/);
});
