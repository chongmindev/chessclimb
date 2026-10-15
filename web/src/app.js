// Wires the page: username -> Chess.com games -> scan (cache, Lichess cloud, engine pool) -> trainer.

import { ChessCom } from "./chesscom.js";
import { EnginePool, Evaluator, LichessCloud } from "./evals.js";
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

async function start(store, trainer, username, months, timeClasses) {
  scan?.stop();
  $("status").hidden = false;
  setState("fetching");
  $("status-text").textContent = "Fetching your finished games from Chess.com…";
  $("error").hidden = true;
  let games;
  try {
    games = await new ChessCom({ store, minInterval: cfg.fetch.min_interval }).games(username, { months, timeClasses });
  } catch (e) {
    $("error").textContent = e.message;
    $("error").hidden = false;
    $("status").hidden = true;
    setState("error");
    return;
  }
  if (!games.length) {
    $("status-text").textContent = `No finished ${timeClasses.join("/") || ""} games in the last ${months} month(s) of archives.`;
    setState("idle");
    return;
  }
  await store.set("last", { username, months, timeClasses });

  if (!pool) {
    const engines = await Promise.all(Array.from({ length: poolSize() }, () =>
      new UciEngine(workerTransport(ENGINE_URL), { mateScore: cfg.engine.mate_score }).init({ Hash: 16 })));
    pool = new EnginePool(engines);
  }
  const evaluator = new Evaluator({ store, pool, cloud: new LichessCloud({ mateScore: cfg.engine.mate_score }) });
  const key = `progress|${username.toLowerCase()}`;
  trainer.load = () => store.get(key);
  trainer.save = (p) => store.set(key, p);
  await trainer.start();

  const t0 = Date.now();
  scan = new Scan({ username, games, evaluator, store, cfg, concurrency: pool.size, onUpdate: (u) => {
    const threats = u.deck.filter((i) => i.kind === "threat").length;
    setState(u.running ? "scanning" : "ready");
    $("bar").style.width = `${Math.round((100 * u.done) / u.total)}%`;
    const secs = Math.round((Date.now() - t0) / 1000);
    $("status-text").textContent = u.running
      ? `Analysing game ${u.done + 1} of ${u.total}, newest first · ${u.deck.length} positions so far (${threats} threats) · ${secs}s · ${pool.size} engines`
      : `All ${u.total} games analysed · ${u.deck.length} positions (${threats} threats, ${u.deck.length - threats} safe)`;
    $("trainer").hidden = u.deck.length === 0;
    $("waiting").hidden = u.deck.length > 0;
    trainer.setItems(u.deck);
  } });
  await scan.run();
}

async function main() {
  const store = await openStore();
  const trainer = new Trainer({
    board: $("board"), arrows: $("arrows"), meta: $("meta"), prompt: $("prompt"), feedback: $("feedback"),
    actions: $("actions"), next: $("btn-next"), hint: $("btn-hint"), safe: $("btn-safe"), safeLabel: $("btn-safe-label"),
    side: $("device-side"), boxes: $("boxes"),
    done: $("st-done"), acc: $("st-acc"), streak: $("st-streak"),
  }, { load: async () => null, save: async () => {} });

  const last = await store.get("last");
  if (last) {
    $("username").value = last.username;
    $("months").value = String(last.months);
    for (const box of document.querySelectorAll("input[name=tc]")) box.checked = last.timeClasses.includes(box.value);
  }
  $("start").addEventListener("submit", (e) => {
    e.preventDefault();
    const username = $("username").value.trim();
    if (!username) return;
    const timeClasses = [...document.querySelectorAll("input[name=tc]:checked")].map((b) => b.value);
    start(store, trainer, username, +$("months").value, timeClasses);
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
