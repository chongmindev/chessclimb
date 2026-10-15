// Wires the page: username -> Chess.com games -> scan (cache, Lichess cloud, engine pool) -> trainer.

import { ChessCom } from "./chesscom.js";
import { EnginePool, Evaluator } from "./evals.js";
import { Scan } from "./scan.js";
import { IdbStore, MemoryStore } from "./store.js";
import { Trainer } from "./trainer.js";
import { UciEngine } from "./uci.js";

// JSON modules (import ... with {type: "json"}) are too new for some browsers still in use.
const cfg = await (await fetch(new URL("./config.json", import.meta.url))).json();
const ENGINE_URL = "engine/stockfish-19-lite-single.js";
const $ = (id) => document.getElementById(id);

/** The nameplate LED and the status readout LED follow the scan: idle, fetching, scanning, ready, error. */
const LED_LABEL = { idle: "Standby", fetching: "Fetching games", scanning: "Scanning", ready: "Ready", error: "Fault" };
function setState(state) {
  $("led").dataset.state = state;
  $("status-led").dataset.state = state;
  $("led-label").textContent = LED_LABEL[state];
}

function workerTransport(url) {
  const w = new Worker(url);
  let cb = () => {};
  w.onmessage = (e) => { for (const line of String(e.data).split("\n")) if (line) cb(line.trim()); };
  return { send: (l) => w.postMessage(l), onLine: (f) => (cb = f), terminate: () => w.terminate() };
}

/** One single-threaded engine per core, keeping one core for the page. Measured faster than threads at fixed depth. */
export function poolSize() {
  const cores = navigator.hardwareConcurrency || 2;
  return Math.max(1, Math.min(cores - 1, 8));
}

async function openStore() {
  try { return await IdbStore.open(); } catch { return new MemoryStore(); }
}

let scan = null, pool = null;

/** Range select value -> ChessCom range: g50 = newest 50 games, d30 = past 30 days, all = every archive. */
export function parseRange(value) {
  if (value === "all") return { all: true };
  const n = Number(value.slice(1));
  return value[0] === "g" ? { games: n } : { days: n };
}

async function start(store, trainer, username, rangeValue, timeClasses) {
  const range = parseRange(rangeValue);
  const rangeLabel = $("range").selectedOptions[0]?.textContent.toLowerCase() || rangeValue;
  scan?.stop();
  $("status").hidden = false;
  setState("fetching");
  $("status-text").textContent = "Fetching your finished games from Chess.com…";
  $("error").hidden = true;
  let games;
  try {
    games = await new ChessCom({ store, minInterval: cfg.fetch.min_interval }).games(username, { range, timeClasses });
  } catch (e) {
    $("error").textContent = e.message;
    $("error").hidden = false;
    $("status").hidden = true;
    setState("error");
    return;
  }
  if (!games.length) {
    $("status-text").textContent = `No finished ${timeClasses.join("/") || ""} games (${rangeLabel}).`;
    setState("idle");
    return;
  }
  await store.set("last", { username, range: rangeValue, timeClasses });
  $("who").textContent = `${username} · ${timeClasses.join(", ") || "all"} · ${rangeLabel} · ${games.length} games`;
  $("start").classList.remove("open");
  document.body.dataset.view = "waiting";

  if (!pool) {
    const engines = await Promise.all(Array.from({ length: poolSize() }, () =>
      new UciEngine(workerTransport(ENGINE_URL), { mateScore: cfg.engine.mate_score }).init({ Hash: 16 })));
    pool = new EnginePool(engines);
  }
  // The Lichess cloud is off: measured slower than local engines (docs/decisions.md). Pass a LichessCloud to enable.
  const evaluator = new Evaluator({ store, pool, cloud: null });
  const key = `progress|${username.toLowerCase()}`;
  trainer.load = () => store.get(key);
  trainer.save = (p) => store.set(key, p);
  await trainer.start();

  const t0 = Date.now();
  scan = new Scan({ username, games, evaluator, store, cfg, concurrency: pool.size, onUpdate: (u) => {
    const threats = u.deck.filter((i) => i.kind === "threat").length;
    setState(u.running ? "scanning" : "ready");
    // Quick pass fills the first 60% of the meter, the deep pass the rest.
    const frac = u.total ? u.done / u.total : 1;
    $("bar").style.width = `${Math.round(100 * (u.phase === 1 ? 0.6 * frac : 0.6 + 0.4 * frac))}%`;
    const secs = Math.round((Date.now() - t0) / 1000);
    const pass = u.phase === 1 ? "Quick pass" : "Deep pass";
    $("status-text").textContent = u.running
      ? `${pass} · ${u.done}/${u.total} games · ${u.deck.length} positions · ${secs}s`
      : `${u.total} games · ${u.deck.length} positions · ${threats} threats`;
    document.body.dataset.view = u.deck.length ? "drill" : "waiting";
    trainer.setItems(u.deck);
  } });
  await scan.run();
}

async function main() {
  const store = await openStore();
  const trainer = new Trainer({
    board: $("board"), arrows: $("arrows"), meta: $("meta"), played: $("played"), question: $("question"), scan: $("scan"), feedback: $("feedback"),
    actions: $("actions"), next: $("btn-next"), safe: $("btn-safe"), safeLabel: $("btn-safe-label"),
    side: $("device-side"), boxes: $("boxes"),
    done: $("st-done"), acc: $("st-acc"), streak: $("st-streak"),
  }, { load: async () => null, save: async () => {} });

  const last = await store.get("last");
  if (last) {
    $("username").value = last.username;
    // Older saves stored months; map them to the nearest time span.
    const saved = last.range || { 1: "d30", 2: "d90", 3: "d90", 6: "d182" }[last.months] || "g50";
    if ([...$("range").options].some((o) => o.value === saved)) $("range").value = saved;
    for (const box of document.querySelectorAll("input[name=tc]")) box.checked = last.timeClasses.includes(box.value);
  }
  $("btn-change").addEventListener("click", () => { $("start").classList.add("open"); $("username").focus(); });
  $("start").addEventListener("submit", (e) => {
    e.preventDefault();
    const username = $("username").value.trim();
    if (!username) return;
    const timeClasses = [...document.querySelectorAll("input[name=tc]:checked")].map((b) => b.value);
    start(store, trainer, username, $("range").value, timeClasses);
  });

  $("btn-export").addEventListener("click", async () => {
    const username = $("username").value.trim().toLowerCase();
    const data = { username, progress: await store.get(`progress|${username}`) };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
    a.download = `threat-scan-progress-${username}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("file-import").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      await store.set(`progress|${data.username}`, data.progress);
      $("username").value = data.username;
      $("import-note").textContent = `Progress for ${data.username} imported. Press Scan to continue.`;
    } catch {
      $("import-note").textContent = "That file isn't a progress export.";
    }
  });
}

main();
