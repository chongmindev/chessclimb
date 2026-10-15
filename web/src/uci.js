// A UCI engine over any line transport (a Web Worker in the browser, a child process in Node).
// Returns Lines in the same shape and scoring as cracktics/engine.py.

import { Chess } from "chess.js";
import { isGameOver } from "./rules.js";

/** python-chess Score.score(mate_score): mate in n -> mate_score - n, mated in n -> -mate_score - n. */
export function foldMate(mate, mateScore) {
  return mate > 0 ? mateScore - mate : -mateScore - mate;
}

/** Parse one `info` line. Returns {depth, multipv, cp, mate, move, bound} from the side to move's view, or null. */
export function parseInfo(line) {
  if (!line.startsWith("info ") || !line.includes(" score ")) return null;
  const t = line.split(" ");
  const out = { depth: 0, multipv: 1, cp: null, mate: null, move: null, bound: false };
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case "depth": out.depth = +t[++i]; break;
      case "multipv": out.multipv = +t[++i]; break;
      case "score":
        if (t[i + 1] === "cp") out.cp = +t[i + 2]; else out.mate = +t[i + 2];
        i += 2;
        if (t[i + 1] === "lowerbound" || t[i + 1] === "upperbound") { out.bound = true; i++; }
        break;
      case "pv": out.move = t[i + 1] || null; i = t.length; break;
    }
  }
  return out;
}

export class UciEngine {
  /** transport: {send(line), onLine(callback)}. */
  constructor(transport, { mateScore = 10000 } = {}) {
    this.t = transport;
    this.mateScore = mateScore;
    this.waiters = [];
    this.queue = Promise.resolve();
    this.t.onLine((line) => {
      for (const w of [...this.waiters]) if (w.test(line)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(line); }
      this.onInfo?.(line);
    });
  }

  _until(test) {
    return new Promise((resolve) => this.waiters.push({ test, resolve }));
  }

  async init(options = {}) {
    this.t.send("uci");
    await this._until((l) => l === "uciok");
    for (const [k, v] of Object.entries(options)) this.t.send(`setoption name ${k} value ${v}`);
    this.t.send("isready");
    await this._until((l) => l === "readyok");
    return this;
  }

  /** Best lines for the side to move in `fen`, best first. One search at a time per engine. */
  analyse(fen, depth, multipv = 1) {
    const run = this.queue.then(() => this._analyse(fen, depth, multipv));
    this.queue = run.catch(() => {});
    return run;
  }

  async _analyse(fen, depth, multipv) {
    const chess = new Chess(fen);
    if (isGameOver(chess, null)) {
      if (!chess.isCheckmate()) return [{ move: null, cp: 0, mate: null }];
      const whiteWon = chess.turn() === "b";
      return [{ move: null, cp: whiteWon ? this.mateScore : -this.mateScore, mate: 0 }];
    }
    const sign = chess.turn() === "w" ? 1 : -1;
    const best = new Map();
    this.onInfo = (line) => {
      const info = parseInfo(line);
      if (info && !info.bound && info.move) best.set(info.multipv, info);
    };
    this.t.send(`setoption name MultiPV value ${multipv}`);
    this.t.send(`position fen ${fen}`);
    this.t.send(`go depth ${depth}`);
    await this._until((l) => l.startsWith("bestmove"));
    this.onInfo = null;
    const lines = [...best.entries()].sort((a, b) => a[0] - b[0]).map(([, i]) => {
      const mate = i.mate === null ? null : sign * i.mate;
      const cp = i.mate === null ? sign * i.cp : sign * foldMate(i.mate, this.mateScore);
      return { move: i.move, cp, mate };
    });
    return lines.length ? lines : [{ move: null, cp: 0, mate: null }];
  }

  quit() {
    this.t.send("quit");
  }
}
