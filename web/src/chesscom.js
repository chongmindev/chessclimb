// Finished games from the Chess.com Published Data API, in the browser. Mirrors threatscan/fetch.py.
// Fair play: only the monthly archives (finished games). Never /games or /games/to-move.

import { gameFromChessCom } from "./games.js";

export class ChessCom {
  constructor({ store, fetch: f = (...a) => globalThis.fetch(...a), baseUrl = "https://api.chess.com/pub", minInterval = 1, now = () => new Date(), sleep } = {}) {
    Object.assign(this, { store, baseUrl, now });
    this.fetch = f;
    this.minInterval = minInterval * 1000;
    this.sleep = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.last = 0;
  }

  async _json(url) {
    const wait = this.last + this.minInterval - Date.now();
    if (wait > 0) await this.sleep(wait);
    this.last = Date.now();
    const res = await this.fetch(url);
    if (res.status === 404) throw new Error("No Chess.com player with that username.");
    if (!res.ok) throw new Error(`Chess.com answered ${res.status} for ${url}`);
    return res.json();
  }

  /** Monthly archive URLs, oldest first. Never cached: a new month can appear. */
  async archives(username) {
    return (await this._json(`${this.baseUrl}/player/${encodeURIComponent(username.toLowerCase())}/games/archives`)).archives;
  }

  /** Raw games of one archive. Past months are final and cached; the current month is refetched. */
  async month(username, url) {
    const [year, mon] = url.replace(/\/$/, "").split("/").slice(-2).map(Number);
    const now = this.now();
    const final = year * 12 + mon < now.getUTCFullYear() * 12 + now.getUTCMonth() + 1;
    const key = `${username.toLowerCase()}/${year}-${String(mon).padStart(2, "0")}`;
    if (final) {
      const cached = await this.store.getArchive(key);
      if (cached) return cached;
    }
    const games = (await this._json(url)).games;
    if (final) await this.store.putArchive(key, games);
    return games;
  }

  /** Standard games for the player from the last `months` archives, NEWEST first, optionally by time class. */
  async games(username, { months = 2, timeClasses = ["rapid"], onMonth } = {}) {
    const urls = (await this.archives(username)).slice(-months).reverse();
    const out = [];
    for (const url of urls) {
      const raw = await this.month(username, url);
      for (const g of raw) {
        if (timeClasses.length && !timeClasses.includes(g.time_class)) continue;
        const game = gameFromChessCom(g, username);
        if (game) out.push(game);
      }
      onMonth?.(url, out.length);
    }
    return out.sort((a, b) => b.endTime - a.endTime);
  }
}
