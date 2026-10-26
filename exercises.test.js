import { test } from "node:test";
import assert from "node:assert/strict";
import { exercises, exercisesForDay } from "./exercises.js";

test("every exercise has a unique id", () => {
  const ids = exercises.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every exercise has a valid unit and a positive step", () => {
  for (const e of exercises) {
    assert.ok(["kg", "lb"].includes(e.unit), `${e.name}: bad unit`);
    assert.ok(e.step > 0, `${e.name}: bad step`);
  }
});

test("legs day shows common exercises only by default", () => {
  const names = exercisesForDay("legs").map((e) => e.id);
  assert.equal(names.length, 7);
  assert.ok(names.includes("deadlift"));
  assert.ok(names.includes("pull-up"));
  assert.ok(!names.includes("hamstring-curl"));
});

test("legs day includes less common exercises when asked", () => {
  const names = exercisesForDay("legs", true).map((e) => e.id);
  assert.equal(names.length, 9);
  assert.ok(names.includes("hamstring-curl"));
});

test("upper day does not include leg exercises", () => {
  const names = exercisesForDay("upper", true).map((e) => e.id);
  assert.equal(names.length, 10);
  assert.ok(!names.includes("leg-press"));
});

test("combined day shows both lists", () => {
  const names = exercisesForDay("combined").map((e) => e.id);
  assert.ok(names.includes("leg-press"));
  assert.ok(names.includes("chest-press"));
});
