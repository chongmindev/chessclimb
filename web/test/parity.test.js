// The JS rules must choose exactly the items the Python pipeline chose, given the same evals.
// Needs data/parity/ from `uv run python tools/export_parity.py data/games.pgn --user <name>`; skipped without it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { buildItems } from "../src/rules.js";

const dir = new URL("../../data/parity/", import.meta.url);
const have = existsSync(new URL("items.json", dir));
const load = (name) => JSON.parse(readFileSync(new URL(name, dir), "utf8"));
const cfg = JSON.parse(readFileSync(new URL("../src/config.json", import.meta.url), "utf8"));

test("JS rules reproduce the Python deck", { skip: !have && "no data/parity" }, async () => {
  const games = load("games.json"), evals = load("evals.json"), expected = load("items.json");
  const missing = [];
  const analyse = async (fen, depth, multipv) => {
    const lines = evals[`${fen}|${depth}|${multipv}`];
    if (!lines) { missing.push(`${fen}|${depth}|${multipv}`); return [{ move: null, cp: 0, mate: null }]; }
    return lines;
  };
  const items = await buildItems(games, analyse, cfg);
  assert.deepEqual(missing.slice(0, 5), [], `${missing.length} evals requested that Python never asked for`);
  const byId = (xs) => Object.fromEntries(xs.map((x) => [x.id, x]));
  const got = byId(items), want = byId(expected);
  assert.deepEqual(Object.keys(got).sort(), Object.keys(want).sort());
  for (const id of Object.keys(want)) assert.deepEqual(got[id], want[id], `item ${id}`);
  assert.equal(items.length, expected.length);
});
