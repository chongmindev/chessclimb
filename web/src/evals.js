// Where evals come from, cheapest first: cache -> Lichess cloud -> local engine pool.
// Lines are always White's view with mates folded in (see uci.js), whatever the source.

import { Chess } from "chess.js";
import { foldMate } from "./uci.js";

/** Pick a cached entry that answers (depth, multipv): same or deeper, at least as many lines. */
export function fromEntries(entries, depth, multipv) {
  const ok = (entries || []).filter((e) => e.depth >= depth && (e.multipv >= multipv || e.complete));
  if (!ok.length) return null;
  ok.sort((a, b) => b.depth - a.depth);
  return ok[0].lines.slice(0, multipv);
}

/** Lichess writes castling as king-takes-rook (e1h1); standard UCI, which chess.js and Stockfish use, is e1g1. */
export function standardCastling(fen, uci) {
  if (!uci) return uci;
  const piece = new Chess(fen).get(uci.slice(0, 2));
  if (piece?.type !== "k") return uci;
  const castles = { e1h1: "e1g1", e1a1: "e1c1", e8h8: "e8g8", e8a8: "e8c8" };
  return castles[uci] || uci;
}

/** Lichess cloud eval. Returns {depth, lines, complete} or null when Lichess doesn't have the position. */
export class LichessCloud {
  constructor({ fetch: f = (...a) => globalThis.fetch(...a), minInterval = 0.2, mateScore = 10000, sleep } = {}) {
    this.fetch = f;
    this.minInterval = minInterval * 1000;
    this.mateScore = mateScore;
    this.sleep = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.queue = Promise.resolve();
    this.last = 0;
    this.pausedUntil = 0;
    this.requests = this.hits = 0;
  }

  /** One request at a time (Lichess API rule); on 429 back off a full minute and report a miss. */
  get(fen, multipv) {
    const run = this.queue.then(() => this._get(fen, multipv));
    this.queue = run.catch(() => {});
    return run;
  }

  async _get(fen, multipv) {
    const now = Date.now();
    if (now < this.pausedUntil) return null;
    const wait = this.last + this.minInterval - now;
    if (wait > 0) await this.sleep(wait);
    this.last = Date.now();
    this.requests++;
    let res;
    try {
      res = await this.fetch(`https://lichess.org/api/cloud-eval?fen=${encodeURIComponent(fen)}&multiPv=${multipv}`);
    } catch {
      return null;
    }
    if (res.status === 429) { this.pausedUntil = Date.now() + 60_000; return null; }
    if (!res.ok) return null;
    const d = await res.json();
    const legal = new Chess(fen).moves().length;
    const lines = d.pvs.map((pv) => {
      const move = standardCastling(fen, pv.moves.split(" ")[0] || null);
      return "mate" in pv ? { move, cp: foldMate(pv.mate, this.mateScore), mate: pv.mate } : { move, cp: pv.cp, mate: null };
    });
    if (lines.length < Math.min(multipv, legal)) return null;
    this.hits++;
    return { depth: d.depth, lines, complete: lines.length >= legal };
  }
}

/** A pool of engines; each request goes to the next idle one. */
export class EnginePool {
  constructor(engines) {
    this.idle = [...engines];
    this.size = engines.length;
    this.waiting = [];
    this.searches = 0;
  }

  async analyse(fen, depth, multipv, withPv = false) {
    const eng = this.idle.pop() || (await new Promise((r) => this.waiting.push(r)));
    try {
      this.searches++;
      return await eng.analyse(fen, depth, multipv, withPv);
    } finally {
      const next = this.waiting.shift();
      if (next) next(eng); else this.idle.push(eng);
    }
  }

  quit() {
    for (const e of this.idle) e.quit?.();
  }
}

/**
 * The eval chain. `store` keeps entries per FEN: {depth, multipv, lines, source, complete}.
 * forGame() gives each game its own analyse(), which stops asking the cloud after that game's first miss
 * (once a game leaves the cloud's coverage it almost never comes back).
 */
export class Evaluator {
  constructor({ store, cloud = null, pool, cloudMaxPly = 40 }) {
    Object.assign(this, { store, cloud, pool, cloudMaxPly });
    this.stats = { cache: 0, cloud: 0, engine: 0 };
  }

  forGame() {
    let cloudOpen = !!this.cloud, ply = 0;
    const seen = new Map();
    return async (fen, depth, multipv = 1) => {
      if (!seen.has(fen)) seen.set(fen, ply++);
      const entries = await this.store.getEvals(fen);
      const hit = fromEntries(entries, depth, multipv);
      if (hit) { this.stats.cache++; return hit; }
      if (cloudOpen && seen.get(fen) <= this.cloudMaxPly) {
        const c = await this.cloud.get(fen, multipv);
        if (c) {
          await this.store.addEval(fen, { depth: c.depth, multipv: c.lines.length, lines: c.lines, source: "cloud", complete: c.complete });
          this.stats.cloud++;
          return c.lines.slice(0, multipv);
        }
        cloudOpen = false;
      }
      const lines = await this.pool.analyse(fen, depth, multipv);
      await this.store.addEval(fen, { depth, multipv, lines, source: "engine", complete: lines.length < multipv });
      this.stats.engine++;
      return lines;
    };
  }
}
