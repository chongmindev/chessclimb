// Finished games from the Lichess games export (https://lichess.org/api#tag/Games/operation/apiGamesUser).
// Fair play: finished games only (ongoing=false, finished=true are sent explicitly).
// The export streams ndjson, newest first, at about 20 games a second. Games are cached per player and time
// controls: a later run downloads only games newer than the cache, plus older ones if the range reaches past it.

import { Chess } from "chess.js";

// The app's time-control chips, as Lichess speeds. Lichess's classical counts as rapid; correspondence as daily.
export const PERFS = { bullet: ["ultraBullet", "bullet"], blitz: ["blitz"], rapid: ["rapid", "classical"], daily: ["correspondence"] };
const CLASS = { ultraBullet: "bullet", bullet: "bullet", blitz: "blitz", rapid: "rapid", classical: "rapid", correspondence: "daily" };
const UNFINISHED = new Set(["created", "started", "aborted", "noStart", "unknownFinish"]);

const name = (side) => side?.user?.name || (side?.aiLevel ? `Stockfish level ${side.aiLevel}` : "Anonymous");

/** One Lichess game for `username` in the shape rules.js walks, or null (variants, set-up positions, unfinished). */
export function gameFromLichess(g, username) {
  if (g.variant !== "standard" || g.initialFen || !g.moves || UNFINISHED.has(g.status)) return null;
  const u = username.toLowerCase();
  const id = (side) => (side?.user?.id || side?.user?.name || "").toLowerCase();
  const color = id(g.players?.white) === u ? "w" : id(g.players?.black) === u ? "b" : null;
  if (!color) return null;
  const chess = new Chess(), moves = [];
  try {
    for (const san of g.moves.split(" ")) {
      const m = chess.move(san);
      moves.push(m.promotion ? { from: m.from, to: m.to, promotion: m.promotion } : { from: m.from, to: m.to });
    }
  } catch { return null; }
  const mine = color === "w" ? "white" : "black";
  return {
    color,
    opponent: name(g.players[color === "w" ? "black" : "white"]),
    date: new Date(g.lastMoveAt ?? g.createdAt).toISOString().slice(0, 10),
    result: g.winner ? (g.winner === mine ? "win" : "loss") : "draw",
    link: `https://lichess.org/${g.id}${color === "b" ? "/black" : ""}`,
    moves,
    timeClass: CLASS[g.speed] || g.speed,
    endTime: Math.floor((g.lastMoveAt ?? g.createdAt) / 1000),
  };
}

/** What the cache keeps of each game. */
function slim(g) {
  const side = (s) => ({ ...(s?.user ? { user: { id: s.user.id, name: s.user.name } } : {}), ...(s?.aiLevel ? { aiLevel: s.aiLevel } : {}) });
  return { id: g.id, variant: g.variant, speed: g.speed, status: g.status, createdAt: g.createdAt, lastMoveAt: g.lastMoveAt,
    players: { white: side(g.players?.white), black: side(g.players?.black) }, winner: g.winner, moves: g.moves,
    ...(g.initialFen ? { initialFen: g.initialFen } : {}) };
}

export class Lichess {
  constructor({ store, fetch: f = (...a) => globalThis.fetch(...a), baseUrl = "https://lichess.org", now = () => new Date() } = {}) {
    Object.assign(this, { store, baseUrl, now });
    this.fetch = f;
  }

  /** Stream one export request; calls onGame for each game as it arrives. */
  async _export(username, params, onGame) {
    const q = new URLSearchParams({ moves: "true", tags: "false", clocks: "false", evals: "false", opening: "false",
      ongoing: "false", finished: "true", ...params });
    const res = await this.fetch(`${this.baseUrl}/api/games/user/${encodeURIComponent(username)}?${q}`,
      { headers: { Accept: "application/x-ndjson" } });
    if (res.status === 404) throw new Error("No Lichess player with that username.");
    if (res.status === 429) throw new Error("Lichess asked us to slow down. Try again in a minute.");
    if (!res.ok) throw new Error(`Lichess answered ${res.status}.`);
    const lines = (text) => text.split("\n").filter((l) => l.trim()).forEach((l) => onGame(JSON.parse(l)));
    if (!res.body?.getReader) return lines(await res.text());
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const cut = buf.lastIndexOf("\n");
      if (cut >= 0) { lines(buf.slice(0, cut)); buf = buf.slice(cut + 1); }
    }
    lines(buf);
  }

  /**
   * Standard games for the player, NEWEST first, by time class. `range`: {games: N} | {days: N} | {all: true}.
   * onProgress(n) reports games downloaded so far.
   */
  async games(username, { range = { games: 50 }, timeClasses = ["rapid"], onProgress } = {}) {
    const u = username.toLowerCase();
    const perfs = timeClasses.flatMap((t) => PERFS[t] || []);
    const key = `lichess/${u}/${perfs.join(",") || "all"}`;
    const base = perfs.length ? { perfType: perfs.join(",") } : {};
    // cache: games newest first; covered = every game created at or after this time is in it (0: since the start)
    const cache = (await this.store.getArchive(key)) || { games: [], covered: null };
    let downloaded = 0;
    const take = (list) => (g) => { list.push(slim(g)); onProgress?.(++downloaded); };

    if (cache.games.length) {            // newer than the cache
      const fresh = [];
      await this._export(u, { ...base, since: String(cache.games[0].createdAt + 1) }, take(fresh));
      cache.games = [...fresh, ...cache.games];
    }
    const since = range.days ? this.now().getTime() - range.days * 86400_000 : range.all ? 0 : null;
    const usable = () => cache.games.filter((g) => gameFromLichess(g, u)).length;
    const enough = () => cache.covered === 0 || (since != null ? cache.covered != null && cache.covered <= since
      : usable() >= range.games);
    if (!enough()) {                     // older than the cache
      const older = [], params = { ...base };
      if (cache.games.length) params.until = String(cache.games.at(-1).createdAt - 1);
      if (since) params.since = String(since);
      const want = since == null ? Math.max(range.games - usable(), 1) + 10 : null;   // a few spare for variants/aborts
      if (want) params.max = String(want);
      await this._export(u, params, take(older));
      cache.games = [...cache.games, ...older];
      cache.covered = want && older.length >= want ? older.at(-1).createdAt : since ?? 0;
    } else if (cache.covered == null) cache.covered = cache.games.at(-1)?.createdAt ?? null;
    await this.store.putArchive(key, cache);

    const out = [];
    for (const g of cache.games) {
      if (since && (g.lastMoveAt ?? g.createdAt) < since) continue;
      const game = gameFromLichess(g, u);
      if (game) out.push(game);
    }
    out.sort((a, b) => b.endTime - a.endTime);
    return range.games ? out.slice(0, range.games) : out;
  }
}
