import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";
import { foldMate, parseInfo, UciEngine } from "../src/uci.js";

test("parseInfo reads score, depth, multipv and first move", () => {
  assert.deepEqual(parseInfo("info depth 13 seldepth 18 multipv 2 score cp -34 nodes 1 nps 2 pv e7e5 g1f3"),
    { depth: 13, multipv: 2, cp: -34, mate: null, move: "e7e5", pv: ["e7e5", "g1f3"], bound: false });
  assert.deepEqual(parseInfo("info depth 9 score mate -2 upperbound pv a1a2"),
    { depth: 9, multipv: 1, cp: null, mate: -2, move: "a1a2", pv: ["a1a2"], bound: true });
  assert.equal(parseInfo("info string NNUE evaluation enabled"), null);
});

test("foldMate matches python-chess Score.score(mate_score)", () => {
  assert.equal(foldMate(1, 10000), 9999);
  assert.equal(foldMate(-3, 10000), -9997);
});

function nodeTransport() {
  const bin = fileURLToPath(new URL("../node_modules/stockfish/bin/stockfish-19-lite-single.js", import.meta.url));
  const p = spawn("node", [bin]);
  let buf = "", cb = () => {};
  p.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { cb(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
  });
  return { send: (l) => p.stdin.write(l + "\n"), onLine: (f) => (cb = f), kill: () => p.kill() };
}

test("real lite engine: scholar's mate and MultiPV from White's point of view", async () => {
  const t = nodeTransport();
  const eng = await new UciEngine(t).init({ Hash: 16 });
  try {
    const c = new Chess();
    for (const m of ["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6"]) c.move(m);
    const [top] = await eng.analyse(c.fen(), 8, 1);
    assert.deepEqual(top, { move: "h5f7", cp: 9999, mate: 1 });

    c.move("Qxf7#");
    assert.deepEqual(await eng.analyse(c.fen(), 8, 1), [{ move: null, cp: 10000, mate: 0 }]);

    const black = new Chess("rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2");
    const lines = await eng.analyse(black.fen(), 8, 3);
    assert.equal(lines.length, 3);
    assert.ok(lines.every((l) => l.move && l.mate === null && Math.abs(l.cp) < 200));
    assert.ok(lines[0].cp <= lines[1].cp && lines[1].cp <= lines[2].cp, "Black's best is lowest for White");
  } finally {
    eng.quit();
    t.kill();
  }
});
