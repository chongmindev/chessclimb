// The scan: analyse games newest first, several at once, and grow the deck as each game finishes.
// Games already analysed (with the same rules) are read from the store, so a return visit only
// analyses new games.

import { gameCandidates, selectDeck } from "./rules.js";

export function gameKey(game) {
  return game.link || `${game.date} ${game.opponent} ${game.moves.length}`;
}

/** A fingerprint of the drill rules: change a threshold and old candidates are recomputed. */
export function rulesVersion(cfg) {
  return JSON.stringify(cfg.drills);
}

export class Scan {
  /** onUpdate({deck, done, total, running, stats}) fires after every game. */
  constructor({ username, games, evaluator, store, cfg, concurrency = 1, onUpdate = () => {} }) {
    Object.assign(this, { username, games, evaluator, store, cfg, concurrency, onUpdate });
    this.prefix = `${username.toLowerCase()}|${rulesVersion(cfg)}|`;
    this.threats = [];
    this.safes = [];
    this.done = 0;
    this.failed = [];
    this.stopped = false;
  }

  deck() {
    return selectDeck(this.threats, this.safes, this.cfg);
  }

  _emit(running) {
    this.onUpdate({ deck: this.deck(), done: this.done, total: this.games.length, running, failed: this.failed.length, stats: this.evaluator.stats });
  }

  async run() {
    const queue = [...this.games];
    // Cached games first, so the deck shows what we already know before any engine work.
    const pending = [];
    for (const g of queue) {
      const c = await this.store.getCandidates(this.prefix + gameKey(g));
      if (c) this._add(c); else pending.push(g);
    }
    this._emit(pending.length > 0);
    const worker = async () => {
      while (pending.length && !this.stopped) {
        const g = pending.shift();
        try {
          const c = await gameCandidates(g, this.evaluator.forGame(), this.cfg);
          await this.store.putCandidates(this.prefix + gameKey(g), c);
          this._add(c);
        } catch (e) {
          // One bad game must not stop the scan. It isn't cached, so it is retried next visit.
          console.error(`threatscan: skipped game ${gameKey(g)}`, e);
          this.failed.push(gameKey(g));
          this.done++;
        }
        this._emit(pending.length > 0);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, this.concurrency) }, worker));
    this._emit(false);
    return this.deck();
  }

  _add(c) {
    this.threats.push(...c.threats);
    this.safes.push(...c.safes);
    this.done++;
  }

  stop() {
    this.stopped = true;
  }
}
