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
const chestSet = () => makeSet({ exerciseId: "chest-press", weight: 60, reps: 8, now: TODAY_9AM });

// What defaultsFor suggests for the leg press today.
const suggest = (sets, cfg, mode = "heavy") => defaultsFor(legPress, sets, cfg, mode, NOW);
const lbOptions = (step, current) => weightOptions({ unit: "lb", step }, current);

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
  const result = todaysSets([mk(100, 5, YESTERDAY), mk(110, 5), chestSet()], "leg-press", NOW);
  assert.equal(result.length, 1);
  assert.equal(result[0].weight, 110);
});

// ---- defaultsFor ----

test("defaultsFor with nothing saved uses one step and 5 reps (heavy)", () => {
  assert.deepEqual(suggest([], {}), { weight: 10, reps: 5 });
});

test("defaultsFor uses 10 reps for a volume day", () => {
  assert.deepEqual(suggest([], {}, "volume"), { weight: 10, reps: 10 });
});

test("defaultsFor uses saved working weight and reps for the day type", () => {
  const cfg = { workHeavy: 120, repsHeavy: 4, workVolume: 80, repsVolume: 12 };
  assert.deepEqual(suggest([], cfg), { weight: 120, reps: 4 });
  assert.deepEqual(suggest([], cfg, "volume"), { weight: 80, reps: 12 });
});

test("defaultsFor uses the start weight for the first set of the day", () => {
  assert.deepEqual(suggest([], { startHeavy: 60, workHeavy: 120 }), { weight: 60, reps: 5 });
});

test("defaultsFor moves from the warm-up to the working weight after one set", () => {
  const cfg = { startHeavy: 60, workHeavy: 120, repsHeavy: 5 };
  assert.deepEqual(suggest([mk(60, 8)], cfg), { weight: 120, reps: 5 });
});

test("defaultsFor copies the latest set once past the warm-up", () => {
  const cfg = { startHeavy: 60, workHeavy: 120 };
  assert.deepEqual(suggest([mk(60, 8), mk(130, 4)], cfg), { weight: 130, reps: 4 });
});

test("defaultsFor falls back to the last weight ever logged when nothing is saved", () => {
  assert.deepEqual(suggest([mk(100, 5, YESTERDAY), mk(110, 4, YESTERDAY)], {}), { weight: 110, reps: 5 });
});

test("defaultsFor ignores sets of other exercises", () => {
  assert.deepEqual(suggest([chestSet()], {}), { weight: 10, reps: 5 });
});

test("minutesDefault is 10 at first, then the last time used", () => {
  const e = { id: "treadmill" };
  assert.equal(minutesDefault(e, []), 10);
  const sets = [makeSet({ exerciseId: "treadmill", minutes: 25, now: YESTERDAY })];
  assert.equal(minutesDefault(e, sets), 25);
});

// ---- weightOptions ----

test("weightOptions for a lb machine runs from one step to 500", () => {
  const options = lbOptions(10);
  assert.equal(options[0], 10);
  assert.equal(options.at(-1), 500);
  assert.equal(options.length, 50);
});

test("weightOptions uses a 15 lb step when set", () => {
  assert.deepEqual(lbOptions(15).slice(0, 3), [15, 30, 45]);
});

test("weightOptions includes an odd current weight, in order", () => {
  const options = lbOptions(10, 25);
  assert.equal(options[options.indexOf(25) - 1], 20);
  assert.equal(options[options.indexOf(25) + 1], 30);
});

test("weightOptions respects min of 0 and kg steps", () => {
  const options = weightOptions({ unit: "kg", step: 2.5, min: 0 });
  assert.deepEqual(options.slice(0, 3), [0, 2.5, 5]);
  assert.equal(options.at(-1), 200);
});

// ---- removeLastSet ----

test("removeLastSet removes only the latest set of that exercise", () => {
  const sets = [["a", 1], ["b", 2], ["a", 3]].map(([exerciseId, n]) => ({ exerciseId, weight: n, reps: n, time: "t" + n }));
  assert.deepEqual(removeLastSet(sets, "a").map((s) => s.time), ["t1", "t2"]);
});

// ---- personal best ----

test("beats: heavier wins, same weight needs more reps", () => {
  const w = (weight, reps) => ({ weight, reps });
  assert.ok(beats(w(110, 1), w(100, 10)));
  assert.ok(beats(w(100, 6), w(100, 5)));
  assert.ok(!beats(w(100, 5), w(100, 5)));
  assert.ok(!beats(w(90, 12), w(100, 5)));
  assert.ok(beats(w(1, 1), null));
});

test("bestSet finds the heaviest logged set, ties by reps", () => {
  const sets = [mk(100, 5), mk(120, 3), mk(120, 4), mk(110, 8)];
  assert.deepEqual(bestSet(sets, "leg-press"), { weight: 120, reps: 4 });
});

test("bestSet is null with no sets and ignores other exercises", () => {
  assert.equal(bestSet([], "leg-press"), null);
  assert.equal(bestSet([chestSet()], "leg-press"), null);
});

test("bestSet includes a typed-in best from before the app", () => {
  const typed = { weight: 150, reps: 3 };
  assert.deepEqual(bestSet([mk(100, 5)], "leg-press", typed), typed);
  assert.deepEqual(bestSet([], "leg-press", typed), typed);
});

test("bestSet ignores timed sets", () => {
  assert.equal(bestSet([makeSet({ exerciseId: "leg-press", minutes: 20 })], "leg-press"), null);
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
  const typed = { weight: 150, reps: 3 };
  assert.equal(isNewPb([], "leg-press", typed, mk(160, 1)), true);
  assert.equal(isNewPb([], "leg-press", typed, mk(140, 5)), false);
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