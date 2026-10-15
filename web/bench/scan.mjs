// End-to-end scan benchmark in Node: real Chess.com fetch, real Lichess cloud (optional), N lite engines
// as child processes, in-memory store. Same code paths as the browser except the transport and storage.
//
// Usage: node bench/scan.mjs <username> [--engines 7] [--cloud on|off] [--games 30]
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ChessCom } from "../src/chesscom.js";
import { EnginePool, Evaluator, LichessCloud } from "../src/evals.js";
import { Scan } from "../src/scan.js";
import { MemoryStore } from "../src/store.js";
import { UciEngine } from "../src/uci.js";

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : d; };
const username = args[0];
const nEngines = +opt("engines", 7), cloudOn = opt("cloud", "on") === "on", nGames = +opt("games", 30);
const cfg = JSON.parse(readFileSync(new URL("../src/config.json", import.meta.url), "utf8"));
const bin = fileURLToPath(new URL("../node_modules/stockfish/bin/stockfish-19-lite-single.js", import.meta.url));

function transport() {
  const p = spawn("node", [bin]);
  let buf = "", cb = () => {};
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { cb(buf.slice(0, i).trim()); buf = buf.slice(i + 1); } });
  return { send: (l) => p.stdin.write(l + "\n"), onLine: (f) => (cb = f), kill: () => p.kill() };
}

const store = new MemoryStore();
const games = (await new ChessCom({ store }).games(username, { months: 2, timeClasses: ["rapid"] })).slice(0, nGames);
const transports = Array.from({ length: nEngines }, transport);
const engines = await Promise.all(transports.map((t) => new UciEngine(t).init({ Hash: 16 })));
const cloud = cloudOn ? new LichessCloud() : null;
const evaluator = new Evaluator({ store, pool: new EnginePool(engines), cloud });

const t0 = Date.now();
let firstItem = null, quickDone = null;
const deck = await new Scan({ username, games, store, cfg, evaluator, concurrency: nEngines, onUpdate: (u) => {
  if (firstItem === null && u.deck.length) firstItem = (Date.now() - t0) / 1000;
  if (quickDone === null && u.phase === 2) quickDone = { s: (Date.now() - t0) / 1000, items: u.deck.length };
} }).run();
const total = (Date.now() - t0) / 1000;
console.log(JSON.stringify({ games: games.length, engines: nEngines, cloud: cloudOn, firstItem, quickDone,
  total, items: deck.length, threats: deck.filter((i) => i.kind === "threat").length, stats: evaluator.stats,
  cloudRequests: cloud?.requests ?? 0, cloudHits: cloud?.hits ?? 0 }));
for (const e of engines) e.quit();
for (const t of transports) t.kill();
