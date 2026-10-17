import { test } from "node:test";
import assert from "node:assert/strict";
import { pickNext } from "../src/trainer.js";

const items = ["a", "b", "c", "d"].map((id) => ({ id }));
const progress = (seen, boxes = {}, turn = Object.keys(seen).length) => ({ seen, boxes, turn });

test("unanswered positions come before any review", () => {
  const p = progress({ a: 0, b: 1 }, { a: 1, b: 1 }, 10);   // a and b are long overdue
  for (let i = 0; i < 20; i++) assert.ok(["c", "d"].includes(pickNext(items, p, null).id));
});

test("never the position just shown while there are others", () => {
  const p = progress({ a: 0, b: 1, c: 2 });
  for (let i = 0; i < 20; i++) assert.equal(pickNext(items, p, "c").id, "d");
  assert.equal(pickNext([{ id: "a" }], progress({ a: 0 }), "a").id, "a");
});

test("once everything is answered: misses that are due first, then the oldest", () => {
  // turn 10: a missed at 2 (due), b hit at 3 (box 2, due after 6 -> due at 9), c hit at 8, d hit at 9
  const p = progress({ a: 2, b: 3, c: 8, d: 9 }, { a: 1, b: 2, c: 2, d: 2 }, 10);
  assert.equal(pickNext(items, p, "d").id, "a");
  const q = progress({ a: 9, b: 3, c: 8, d: 7 }, { a: 1, b: 2, c: 2, d: 2 }, 10);
  assert.equal(pickNext(items, q, "a").id, "b");   // a not due yet (1 ago); b is
  const none = progress({ a: 9, b: 8, c: 7, d: 6 }, { a: 2, b: 2, c: 2, d: 2 }, 10);
  assert.equal(pickNext(items, none, null).id, "d");   // nothing due: the one seen longest ago
});
