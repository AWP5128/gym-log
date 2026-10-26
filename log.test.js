import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeSet, todaysSets, defaultsFor, minutesDefault, weightOptions, removeLastSet,
  beats, bestSet, isNewPb, formatSet, isDoneToday, markDone, unmarkDone,
} from "./log.js";

// Local-time dates, so the tests behave the same in any time zone.
const NOW = new Date(2026, 9, 26, 15, 0);
const TODAY_9AM = new Date(2026, 9, 26, 9, 0);
const YESTERDAY = new Date(2026, 9, 25, 15, 0);

const legPress = { id: "leg-press", unit: "lb", step: 10 };
const mk = (weight, reps, when = TODAY_9AM) =>
  makeSet({ exerciseId: "leg-press", weight, reps, now: when });

// ---- makeSet / formatting ----

test("makeSet records exercise, weight, reps, mode and time", () => {
  const s = makeSet({ exerciseId: "leg-press", weight: 100, reps: 5, mode: "heavy", now: new Date("2026-10-26T12:00:00Z") });
  assert.deepEqual(s, {
    exerciseId: "leg-press", weight: 100, reps: 5, mode: "heavy",
    time: "2026-10-26T12:00:00.000Z",
  });
});

test("makeSet records minutes for timed exercises", () => {
  const s = makeSet({ exerciseId: "treadmill", minutes: 20, now: new Date("2026-10-26T12:00:00Z") });
  assert.deepEqual(s, { exerciseId: "treadmill", minutes: 20, time: "2026-10-26T12:00:00.000Z" });
});

test("formatSet shows weight x reps or minutes", () => {
  assert.equal(formatSet(legPress, mk(100, 5)), "100 lb x 5");
  assert.equal(formatSet({ unit: "min" }, { minutes: 20 }), "20 min");
});

// ---- todaysSets ----

test("todaysSets only returns today's sets for that exercise", () => {
  const sets = [
    mk(100, 5, YESTERDAY),
    mk(110, 5),
    makeSet({ exerciseId: "chest-press", weight: 60, reps: 8, now: TODAY_9AM }),
  ];
  const result = todaysSets(sets, "leg-press", NOW);
  assert.equal(result.length, 1);
  assert.equal(result[0].weight, 110);
});

// ---- defaultsFor ----

test("defaultsFor with nothing saved uses one step and 5 reps (heavy)", () => {
  assert.deepEqual(defaultsFor(legPress, [], {}, "heavy", NOW), { weight: 10, reps: 5 });
});

test("defaultsFor uses 10 reps for a volume day", () => {
  assert.deepEqual(defaultsFor(legPress, [], {}, "volume", NOW), { weight: 10, reps: 10 });
});

test("defaultsFor uses saved working weight and reps for the day type", () => {
  const cfg = { workHeavy: 120, repsHeavy: 4, workVolume: 80, repsVolume: 12 };
  assert.deepEqual(defaultsFor(legPress, [], cfg, "heavy", NOW), { weight: 120, reps: 4 });
  assert.deepEqual(defaultsFor(legPress, [], cfg, "volume", NOW), { weight: 80, reps: 12 });
});

test("defaultsFor uses the start weight for the first set of the day", () => {
  const cfg = { startHeavy: 60, workHeavy: 120 };
  assert.deepEqual(defaultsFor(legPress, [], cfg, "heavy", NOW), { weight: 60, reps: 5 });
});

test("defaultsFor moves from the warm-up to the working weight after one set", () => {
  const cfg = { startHeavy: 60, workHeavy: 120, repsHeavy: 5 };
  const sets = [mk(60, 8)];
  assert.deepEqual(defaultsFor(legPress, sets, cfg, "heavy", NOW), { weight: 120, reps: 5 });
});

test("defaultsFor copies the latest set once past the warm-up", () => {
  const cfg = { startHeavy: 60, workHeavy: 120 };
  const sets = [mk(60, 8), mk(130, 4)];
  assert.deepEqual(defaultsFor(legPress, sets, cfg, "heavy", NOW), { weight: 130, reps: 4 });
});

test("defaultsFor falls back to the last weight ever logged when nothing is saved", () => {
  const sets = [mk(100, 5, YESTERDAY), mk(110, 4, YESTERDAY)];
  assert.deepEqual(defaultsFor(legPress, sets, {}, "heavy", NOW), { weight: 110, reps: 5 });
});

test("defaultsFor ignores sets of other exercises", () => {
  const sets = [makeSet({ exerciseId: "chest-press", weight: 60, reps: 8, now: TODAY_9AM })];
  assert.deepEqual(defaultsFor(legPress, sets, {}, "heavy", NOW), { weight: 10, reps: 5 });
});

test("minutesDefault is 10 at first, then the last time used", () => {
  const e = { id: "treadmill" };
  assert.equal(minutesDefault(e, []), 10);
  const sets = [makeSet({ exerciseId: "treadmill", minutes: 25, now: YESTERDAY })];
  assert.equal(minutesDefault(e, sets), 25);
});

// ---- weightOptions ----

test("weightOptions for a lb machine runs from one step to 500", () => {
  const options = weightOptions({ unit: "lb", step: 10 });
  assert.equal(options[0], 10);
  assert.equal(options[options.length - 1], 500);
  assert.equal(options.length, 50);
});

test("weightOptions uses a 15 lb step when set", () => {
  const options = weightOptions({ unit: "lb", step: 15 });
  assert.deepEqual(options.slice(0, 3), [15, 30, 45]);
});

test("weightOptions includes an odd current weight, in order", () => {
  const options = weightOptions({ unit: "lb", step: 10 }, 25);
  assert.equal(options[options.indexOf(25) - 1], 20);
  assert.equal(options[options.indexOf(25) + 1], 30);
});

test("weightOptions respects min of 0 and kg steps", () => {
  const options = weightOptions({ unit: "kg", step: 2.5, min: 0 });
  assert.deepEqual(options.slice(0, 3), [0, 2.5, 5]);
  assert.equal(options[options.length - 1], 200);
});

// ---- removeLastSet ----

test("removeLastSet removes only the latest set of that exercise", () => {
  const sets = [
    { exerciseId: "a", weight: 1, reps: 1, time: "t1" },
    { exerciseId: "b", weight: 2, reps: 2, time: "t2" },
    { exerciseId: "a", weight: 3, reps: 3, time: "t3" },
  ];
  assert.deepEqual(removeLastSet(sets, "a").map((s) => s.time), ["t1", "t2"]);
});

// ---- personal best ----

test("beats: heavier wins, same weight needs more reps", () => {
  assert.ok(beats({ weight: 110, reps: 1 }, { weight: 100, reps: 10 }));
  assert.ok(beats({ weight: 100, reps: 6 }, { weight: 100, reps: 5 }));
  assert.ok(!beats({ weight: 100, reps: 5 }, { weight: 100, reps: 5 }));
  assert.ok(!beats({ weight: 90, reps: 12 }, { weight: 100, reps: 5 }));
  assert.ok(beats({ weight: 1, reps: 1 }, null));
});

test("bestSet finds the heaviest logged set, ties by reps", () => {
  const sets = [mk(100, 5), mk(120, 3), mk(120, 4), mk(110, 8)];
  assert.deepEqual(bestSet(sets, "leg-press"), { weight: 120, reps: 4 });
});

test("bestSet is null with no sets and ignores other exercises", () => {
  assert.equal(bestSet([], "leg-press"), null);
  const sets = [makeSet({ exerciseId: "chest-press", weight: 60, reps: 8 })];
  assert.equal(bestSet(sets, "leg-press"), null);
});

test("bestSet includes a typed-in best from before the app", () => {
  const sets = [mk(100, 5)];
  assert.deepEqual(bestSet(sets, "leg-press", { weight: 150, reps: 3 }), { weight: 150, reps: 3 });
  assert.deepEqual(bestSet([], "leg-press", { weight: 150, reps: 3 }), { weight: 150, reps: 3 });
});

test("bestSet ignores timed sets", () => {
  const sets = [makeSet({ exerciseId: "leg-press", minutes: 20 })];
  assert.equal(bestSet(sets, "leg-press"), null);
});

test("isNewPb is false for the very first set", () => {
  assert.equal(isNewPb([], "leg-press", null, mk(100, 5)), false);
});

test("isNewPb is true when a set beats the best, false when it does not", () => {
  const sets = [mk(100, 5)];
  assert.equal(isNewPb(sets, "leg-press", null, mk(110, 5)), true);
  assert.equal(isNewPb(sets, "leg-press", null, mk(100, 5)), false);
  assert.equal(isNewPb(sets, "leg-press", null, mk(90, 8)), false);
});

test("isNewPb compares against a typed-in best", () => {
  assert.equal(isNewPb([], "leg-press", { weight: 150, reps: 3 }, mk(160, 1)), true);
  assert.equal(isNewPb([], "leg-press", { weight: 150, reps: 3 }, mk(140, 5)), false);
});

// ---- done today ----

test("an exercise is not done until marked", () => {
  assert.equal(isDoneToday([], "leg-press", NOW), false);
});

test("markDone makes it done today, and only today", () => {
  const done = markDone([], "leg-press", NOW);
  assert.equal(isDoneToday(done, "leg-press", NOW), true);
  assert.equal(isDoneToday(done, "chest-press", NOW), false);
  assert.equal(isDoneToday(done, "leg-press", new Date(2026, 9, 27, 9, 0)), false);
});

test("markDone twice does not duplicate, and drops old days", () => {
  let done = markDone([], "leg-press", YESTERDAY);
  done = markDone(done, "leg-press", NOW);
  done = markDone(done, "leg-press", NOW);
  assert.equal(done.length, 1);
});

test("unmarkDone puts the exercise back on the list", () => {
  let done = markDone([], "leg-press", NOW);
  done = markDone(done, "chest-press", NOW);
  done = unmarkDone(done, "leg-press", NOW);
  assert.equal(isDoneToday(done, "leg-press", NOW), false);
  assert.equal(isDoneToday(done, "chest-press", NOW), true);
});