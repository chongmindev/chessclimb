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

  /**
   * Standard games for the player, NEWEST first, optionally by time class. `range` picks how many:
   *   {games: N}  the newest N matching games (reads archives back until it has N)
   *   {days: N}   games that ended in the last N days
   *   {months: N} the last N monthly archives
   *   {all: true} every archive
   * Archives are monthly, so only the months a range needs are read; past months come from the cache.
   */
  async games(username, { range = { months: 2 }, months, timeClasses = ["rapid"], onMonth } = {}) {
    if (months) range = { months };
    let urls = (await this.archives(username)).slice().reverse();
    if (range.months) urls = urls.slice(0, range.months);
    const since = range.days ? this.now().getTime() / 1000 - range.days * 86400 : -Infinity;
    const out = [];
    for (const url of urls) {
      if (range.days) {
        const [year, mon] = url.replace(/\/$/, "").split("/").slice(-2).map(Number);
        if (Date.UTC(year, mon, 1) / 1000 < since) break;      // this month ended before the window
      }
      for (const g of await this.month(username, url)) {
        if (timeClasses.length && !timeClasses.includes(g.time_class)) continue;
        if ((g.end_time ?? Infinity) < since) continue;
        const game = gameFromChessCom(g, username);
        if (game) out.push(game);
      }
      onMonth?.(url, out.length);
      if (range.games && out.length >= range.games) break;
    }
    out.sort((a, b) => b.endTime - a.endTime);
    return range.games ? out.slice(0, range.games) : out;
  }
}
