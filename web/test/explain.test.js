import { test } from "node:test";
import assert from "node:assert/strict";
import { between, walkthrough } from "../src/explain.js";

const plain = (s) => s.replace(/<[^>]+>/g, "");
const SCHOLAR = "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3";   // Black to move, f7 under fire

test("between lists the squares on a shared line", () => {
  assert.deepEqual(between("h5", "f7"), ["g6"]);
  assert.deepEqual(between("a1", "a4"), ["a2", "a3"]);
  assert.deepEqual(between("a1", "b3"), []);
});

test("a quiet fix is just the move and one line", () => {
  const w = walkthrough({ before: SCHOLAR, played: "Nf6", reply: "Qxf7#", better: "g6",
    line: { pv: ["h5f3", "g8f6", "g1e2"], cp: -20, mate: null } });
  assert.equal(plain(w.reason), "Blocks the queen's path to f7.");
  assert.equal(w.idea, false);
  assert.equal(w.steps.length, 1);
});

test("moving the piece out of reach, when a defender walked away", () => {
  const before = "4k3/8/1b6/8/3N4/8/8/3QK3 w - - 0 1";   // Qd1 guards the d4 knight; Bb6 eyes it
  assert.equal(plain(walkthrough({ before, played: "Qb3", reply: "Bxd4", better: "Nf5" }).reason),
    "Gets your knight out of reach of Bxd4.");
});

test("a line with captures is walked through, move by move", () => {
  // White: Ra6 can take the b6 bishop that eyes d4; after Kd7, Nf5 is calm.
  const before = "4k3/8/Rb6/8/3N4/8/8/4K3 w - - 0 1";
  const w = walkthrough({ before, played: "Ra8+", reply: "Kd7", better: "Rxb6",
    line: { pv: ["e8d7", "d4f5"], cp: 900, mate: null } });
  assert.equal(plain(w.reason), "Takes the bishop on b6.");
  assert.equal(w.idea, true);
  assert.deepEqual(w.steps.map((s) => s.ply.move.san), ["Rxb6", "Kd7", "Nf5"]);
  assert.equal(w.steps[1].text, "Black's best reply.");
  assert.equal(w.summary, "You come out a piece up.");
});

test("captions: a fork, then the capture it sets up", () => {
  const before = "4k3/2q5/5r2/8/8/2N5/8/4K3 w - - 0 1";   // Nd5 hits the queen on c7 and the rook on f6
  const w = walkthrough({ before, played: "Kd2", reply: "Rf2+", better: "Nd5",
    line: { pv: ["c7c6", "d5f6"], cp: 900, mate: null } });
  assert.equal(plain(w.reason), "Attacks the queen, so Black has no time for Rf2+.");
  assert.equal(w.steps[2].text, "You take the rook with check.");
});
