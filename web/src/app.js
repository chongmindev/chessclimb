// Wires the page: username -> Chess.com games -> scan (cache, Lichess cloud, engine pool) -> trainer.

import { ChessCom } from "./chesscom.js";
import { EnginePool, Evaluator } from "./evals.js";
import { Scan } from "./scan.js";
import { Select } from "./select.js";
import { sound } from "./sound.js";
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

/**
 * Fit each hero line to a share of the stage width (data-fit, default all of it), then shrink all of them together if the block is taller than
 * the room between the label and the rule. Runs on load, when fonts arrive and on resize.
 */
function fitHero() {
  const h1 = $("hero-title"), hero = h1?.closest(".hero");
  if (!h1 || !hero.offsetParent) return;
  const lines = [...h1.querySelectorAll(".fit")];
  const width = h1.clientWidth;
  for (const line of lines) {
    line.style.fontSize = "100px";
    line.style.fontSize = `${(100 * width * Number(line.dataset.fit || 1)) / line.scrollWidth}px`;
  }
  const others = [...hero.children].reduce((sum, el) => sum + (el.contains(h1) ? 0 : el.offsetHeight), 0);
  const label = h1.previousElementSibling?.offsetHeight || 0;
  const room = hero.clientHeight - others - label - 24;
  if (h1.offsetHeight > room && room > 0) {
    const k = room / h1.offsetHeight;
    for (const line of lines) line.style.fontSize = `${parseFloat(line.style.fontSize) * k}px`;
  }
}

/** One button flips paper and ink. The choice is saved; with none saved the system setting applies. */
function setupTheme() {
  const btn = $("btn-theme");
  const paint = () => {
    const dark = document.documentElement.dataset.theme === "dark";
    btn.setAttribute("aria-pressed", String(dark));
    btn.title = dark ? "Switch to day mode" : "Switch to night mode";
    btn.setAttribute("aria-label", btn.title);
    document.querySelector('meta[name="theme-color"]').content = dark ? "#0e0e10" : "#ffffff";
  };
  btn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch {}
    paint();
  });
  paint();
}

function setupSound() {
  const btn = $("btn-sound");
  const paint = () => {
    btn.setAttribute("aria-pressed", String(sound.on));
    btn.title = sound.on ? "Sound on" : "Sound off";
    btn.setAttribute("aria-label", btn.title);
  };
  btn.addEventListener("click", () => { sound.set(!sound.on); paint(); if (sound.on) sound.play("right"); });
  paint();
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
  // The fix step asks the same engines (and cache) whether a move holds.
  trainer.evaluate = async (fen) => (await evaluator.forGame()(fen, cfg.drills.depth, 1))[0];
  // Explanations want the engine's whole line, which the cache doesn't keep: a fresh search, one position.
  trainer.analyse = (fen) => pool.analyse(fen, cfg.drills.depth, 1, true);
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
  setupTheme();
  setupSound();
  const range = new Select($("range"));
  fitHero();
  document.fonts?.ready.then(fitHero);
  new ResizeObserver(fitHero).observe(document.querySelector(".stage"));
  const store = await openStore();
  const trainer = new Trainer({
    board: $("board"), arrows: $("arrows"), pop: $("pop"), meta: $("meta"), step: $("step"), playedLabel: $("played-label"), played: $("played"), question: $("question"),
    scan: $("scan"), feedback: $("feedback"), drill: document.querySelector(".drill"), note: $("note"), reveal: $("btn-reveal"), fixRow: $("fix-row"), showMe: $("btn-show"),
    actions: $("actions"), next: $("btn-next"), fixGo: $("btn-fix"), safe: $("btn-safe"),
    plies: $("plies"), prev: $("btn-prev"), fwd: $("btn-fwd"), material: $("material"),
    side: $("device-side"), boxes: $("boxes"),
    done: $("st-done"), acc: $("st-acc"), streak: $("st-streak"),
  }, { load: async () => null, save: async () => {}, tolerance: cfg.trainer.fix_tolerance, cue: (kind) => sound.play(kind) });

  const last = await store.get("last");
  if (last) {
    $("username").value = last.username;
    // Older saves stored months; map them to the nearest time span.
    const saved = last.range || { 1: "d30", 2: "d90", 3: "d90", 6: "d182" }[last.months] || "g50";
    if ([...$("range").options].some((o) => o.value === saved)) { $("range").value = saved; range.sync(); }
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
    a.download = `cracktics-progress-${username}.json`;
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
