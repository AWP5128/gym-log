import { test } from "node:test";
import assert from "node:assert/strict";
import { exercises, exercisesForGroup, sessionTypes } from "./exercises.js";

test("every exercise has a unique id", () => {
  const ids = exercises.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every exercise has a valid unit, a positive step and a known group", () => {
  const groups = sessionTypes.map((t) => t.id);
  for (const e of exercises) {
    assert.ok(["kg", "lb"].includes(e.unit), `${e.name}: bad unit`);
    assert.ok(e.step > 0, `${e.name}: bad step`);
    assert.ok(groups.includes(e.group), `${e.name}: unknown group`);
  }
});

test("there are four session types and only cardio has no heavy/volume choice", () => {
  assert.deepEqual(sessionTypes.map((t) => t.id), ["legs", "arms", "abs", "cardio"]);
  assert.deepEqual(sessionTypes.filter((t) => !t.weights).map((t) => t.id), ["cardio"]);
});

test("legs shows common exercises only by default", () => {
  const ids = exercisesForGroup("legs").map((e) => e.id);
  assert.equal(ids.length, 7);
  assert.ok(ids.includes("deadlift"));
  assert.ok(ids.includes("pull-up"));
  assert.ok(!ids.includes("hamstring-curl"));
});

test("legs includes less common exercises when asked", () => {
  const ids = exercisesForGroup("legs", true).map((e) => e.id);
  assert.equal(ids.length, 9);
  assert.ok(ids.includes("hamstring-curl"));
});

test("arms does not include leg exercises", () => {
  const ids = exercisesForGroup("arms", true).map((e) => e.id);
  assert.equal(ids.length, 10);
  assert.ok(!ids.includes("leg-press"));
});

test("abs and cardio start empty", () => {
  assert.equal(exercisesForGroup("abs", true).length, 0);
  assert.equal(exercisesForGroup("cardio", true).length, 0);
});

test("a custom list can be passed in", () => {
  const list = [{ id: "x", group: "abs", common: true }];
  assert.equal(exercisesForGroup("abs", false, list).length, 1);
});