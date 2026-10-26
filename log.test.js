import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeSet, stepWeight, todaysSets, defaultsFor, removeLastSet, weightOptions,
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
test("weightOptions for a lb machine runs from one step to 500", () => {
  const options = weightOptions({ unit: "lb", step: 10 });
  assert.equal(options[0], 10);
  assert.equal(options[options.length - 1], 500);
  assert.equal(options.length, 50);
  assert.ok(options.includes(100));
});

test("weightOptions includes an odd current weight, in order", () => {
  const options = weightOptions({ unit: "lb", step: 10 }, 25);
  assert.ok(options.includes(25));
  assert.equal(options[options.indexOf(25) - 1], 20);
  assert.equal(options[options.indexOf(25) + 1], 30);
});

test("weightOptions respects min of 0 and kg steps", () => {
  const options = weightOptions({ unit: "kg", step: 2.5, min: 0 });
  assert.deepEqual(options.slice(0, 3), [0, 2.5, 5]);
  assert.equal(options[options.length - 1], 200);
});

test("defaultsFor uses the machine's default weight when there is no history", () => {
  const e = { id: "leg-press", step: 10, defaultWeight: 120 };
  assert.deepEqual(defaultsFor(e, []), { weight: 120, reps: 5 });
});

test("defaultsFor falls back to one step when there is no default", () => {
  const e = { id: "leg-press", step: 10 };
  assert.deepEqual(defaultsFor(e, []), { weight: 10, reps: 5 });
});