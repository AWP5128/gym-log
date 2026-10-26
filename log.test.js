import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeSet, stepWeight, todaysSets, defaultsFor, removeLastSet,
} from "./log.js";

const legPress = { id: "leg-press" };

test("makeSet records exercise, weight, reps and time", () => {
  const s = makeSet({
    exerciseId: "leg-press", weight: 100, reps: 5,
    now: new Date("2026-10-26T12:00:00Z"),
  });
  assert.deepEqual(s, {
    exerciseId: "leg-press", weight: 100, reps: 5,
    time: "2026-10-26T12:00:00.000Z",
  });
});

test("stepWeight adds and subtracts one step", () => {
  assert.equal(stepWeight(50, 2.5, 1), 52.5);
  assert.equal(stepWeight(100, 10, -1), 90);
});

test("stepWeight never goes below zero", () => {
  assert.equal(stepWeight(0, 10, -1), 0);
});

test("defaultsFor with no history is zero weight and 5 reps", () => {
  assert.deepEqual(defaultsFor(legPress, []), { weight: 0, reps: 5 });
});

test("defaultsFor copies the latest set of that exercise", () => {
  const sets = [
    { exerciseId: "leg-press", weight: 100, reps: 5, time: "2026-10-20T12:00:00.000Z" },
    { exerciseId: "chest-press", weight: 60, reps: 8, time: "2026-10-21T12:00:00.000Z" },
    { exerciseId: "leg-press", weight: 110, reps: 4, time: "2026-10-22T12:00:00.000Z" },
  ];
  assert.deepEqual(defaultsFor(legPress, sets), { weight: 110, reps: 4 });
});

test("todaysSets only returns today's sets for that exercise", () => {
  const sets = [
    { exerciseId: "leg-press", weight: 100, reps: 5, time: "2026-10-25T12:00:00.000Z" },
    { exerciseId: "leg-press", weight: 110, reps: 5, time: "2026-10-26T12:00:00.000Z" },
    { exerciseId: "chest-press", weight: 60, reps: 8, time: "2026-10-26T12:00:00.000Z" },
  ];
  const result = todaysSets(sets, "leg-press", new Date("2026-10-26T15:00:00Z"));
  assert.equal(result.length, 1);
  assert.equal(result[0].weight, 110);
});

test("removeLastSet removes only the latest set of that exercise", () => {
  const sets = [
    { exerciseId: "a", weight: 1, reps: 1, time: "t1" },
    { exerciseId: "b", weight: 2, reps: 2, time: "t2" },
    { exerciseId: "a", weight: 3, reps: 3, time: "t3" },
  ];
  const result = removeLastSet(sets, "a");
  assert.deepEqual(result.map((s) => s.time), ["t1", "t2"]);
});
