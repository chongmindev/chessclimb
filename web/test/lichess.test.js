import { test } from "node:test";
import assert from "node:assert/strict";
import { gameFromLichess, Lichess } from "../src/lichess.js";
import { MemoryStore } from "../src/store.js";

const DAY = 86400_000, NOW = Date.UTC(2026, 9, 16);
const game = (n, extra = {}) => ({
  id: `g${n}`, variant: "standard", speed: "rapid", status: "mate", createdAt: NOW - n * DAY, lastMoveAt: NOW - n * DAY + 600_000,
  players: { white: { user: { id: "me", name: "Me" } }, black: { user: { id: "them", name: "Them" } } },
  winner: "white", moves: "e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#", ...extra });

test("gameFromLichess: color, result, link, moves; skips variants and unfinished games", () => {
  const g = gameFromLichess(game(1), "ME");
  assert.equal(g.color, "w");
  assert.equal(g.opponent, "Them");
  assert.equal(g.result, "win");
  assert.equal(g.link, "https://lichess.org/g1");
  assert.equal(g.timeClass, "rapid");
  assert.deepEqual(g.moves.at(-1), { from: "h5", to: "f7" });
  const asBlack = gameFromLichess(game(2, { players: { white: { aiLevel: 3 }, black: { user: { id: "me", name: "Me" } } }, winner: undefined, status: "draw" }), "me");
  assert.equal(asBlack.result, "draw");
  assert.equal(asBlack.opponent, "Stockfish level 3");
  assert.equal(asBlack.link, "https://lichess.org/g2/black");
  assert.equal(gameFromLichess(game(3, { variant: "chess960" }), "me"), null);
  assert.equal(gameFromLichess(game(4, { status: "aborted" }), "me"), null);
  assert.equal(gameFromLichess(game(5, { speed: "classical" }), "me").timeClass, "rapid");
});

function fakeLichess(all) {
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push(url);
    assert.equal(opts.headers.Accept, "application/x-ndjson");
    const q = new URL(url).searchParams;
    assert.equal(q.get("ongoing"), "false");      // fair play: never ongoing games
    let games = all.filter((g) => (!q.get("since") || g.createdAt >= +q.get("since")) && (!q.get("until") || g.createdAt <= +q.get("until")));
    if (q.get("max")) games = games.slice(0, +q.get("max"));
    return { ok: true, status: 200, text: async () => games.map((g) => JSON.stringify(g)).join("\n") + "\n" };
  };
  return { client: new Lichess({ store: new MemoryStore(), fetch, now: () => new Date(NOW) }), calls };
}

test("Lichess.games: newest N, then only newer games from the cache", async () => {
  const all = Array.from({ length: 30 }, (_, i) => game(i + 1));
  const { client, calls } = fakeLichess(all);
  const first = await client.games("me", { range: { games: 5 } });
  assert.deepEqual(first.map((g) => g.link.slice(-3)), ["/g1", "/g2", "/g3", "/g4", "/g5"]);
  assert.match(calls[0], /perfType=rapid%2Cclassical/);
  calls.length = 0;
  all.unshift(game(0));                             // a new game since
  const again = await client.games("me", { range: { games: 5 } });
  assert.equal(again[0].link, "https://lichess.org/g0");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /since=/);
});

test("Lichess.games: a day range reads back only as far as it needs", async () => {
  const all = Array.from({ length: 30 }, (_, i) => game(i + 1));
  const { client } = fakeLichess(all);
  const week = await client.games("me", { range: { days: 7 } });
  assert.equal(week.length, 7);                     // game n ended n days minus 10 minutes ago
});
