import test from "node:test";
import assert from "node:assert/strict";
import {
  makeSet, setGym, setsForGym, tagSets, removeLastSet, bestSet, isNewPb, personalBests, GYM_SPECIFIC_TYPES,
} from "./log.js";

const at = (iso) => new Date(iso);
const lp = { id: "leg-press", unit: "lb", type: "stack" };
const dl = { id: "deadlift", unit: "kg", type: "barbell" };

test("makeSet records the gym and unit when given, and nothing extra when not", () => {
  const plain = makeSet({ exerciseId: "x", weight: 50, reps: 5, now: at("2026-11-01T10:00:00Z") });
  assert.deepEqual(plain, { exerciseId: "x", time: "2026-11-01T10:00:00.000Z", weight: 50, reps: 5 });
  const tagged = makeSet({ exerciseId: "x", weight: 50, reps: 5, gymId: "home", unit: "kg", now: at("2026-11-01T10:00:00Z") });
  assert.equal(tagged.gymId, "home");
  assert.equal(tagged.unit, "kg");
  const timed = makeSet({ exerciseId: "t", minutes: 10, gymId: "home", unit: "kg", now: at("2026-11-01T10:00:00Z") });
  assert.equal(timed.unit, undefined);
  assert.equal(timed.minutes, 10);
});

test("a set with no gym belongs to the first gym", () => {
  assert.equal(setGym({ exerciseId: "x" }), "main");
  assert.equal(setGym({ exerciseId: "x", gymId: "home" }), "home");
  const all = [{ exerciseId: "a" }, { exerciseId: "b", gymId: "home" }, { exerciseId: "c", gymId: "main" }];
  assert.deepEqual(setsForGym(all, "main").map((s) => s.exerciseId), ["a", "c"]);
  assert.deepEqual(setsForGym(all, "home").map((s) => s.exerciseId), ["b"]);
});

test("tagSets stamps old sets with the first gym and a unit, and leaves stamped sets alone", () => {
  const all = [
    { exerciseId: "leg-press", weight: 100, reps: 5, time: "t1" },
    { exerciseId: "deadlift", weight: 60, reps: 5, time: "t2", gymId: "home", unit: "kg" },
    { exerciseId: "treadmill", minutes: 10, time: "t3" },
  ];
  const unitOf = (id) => (id === "leg-press" ? "lb" : "kg");
  const out = tagSets(all, "main", unitOf);
  assert.deepEqual(out[0], { exerciseId: "leg-press", weight: 100, reps: 5, time: "t1", gymId: "main", unit: "lb" });
  assert.equal(out[1], all[1]);
  assert.deepEqual(out[2], { exerciseId: "treadmill", minutes: 10, time: "t3", gymId: "main" });
  assert.equal(all[0].gymId, undefined);
  assert.equal(tagSets([{ exerciseId: "a", weight: 1, reps: 1 }])[0].gymId, "main");
  assert.equal(tagSets([{ exerciseId: "a", weight: 1, reps: 1 }])[0].unit, undefined);
  const stamped = tagSets([{ exerciseId: "a", weight: 1, reps: 1, gymId: "home" }], "main", () => "kg")[0];
  assert.equal(stamped.gymId, "home");
  assert.equal(stamped.unit, "kg");
});

test("removeLastSet can be limited to one gym", () => {
  const all = [
    { exerciseId: "x", gymId: "main", reps: 1 },
    { exerciseId: "x", gymId: "home", reps: 2 },
    { exerciseId: "x", gymId: "main", reps: 3 },
    { exerciseId: "x", gymId: "home", reps: 4 },
  ];
  assert.deepEqual(removeLastSet(all, "x").map((s) => s.reps), [1, 2, 3]);
  assert.deepEqual(removeLastSet(all, "x", "main").map((s) => s.reps), [1, 2, 4]);
  assert.deepEqual(removeLastSet(all, "x", "home").map((s) => s.reps), [1, 2, 3]);
  assert.equal(removeLastSet(all, "x", "elsewhere"), all);
  assert.equal(removeLastSet(all, "y"), all);
});

test("bestSet without options is unchanged: heaviest, then most reps, with a typed-in best", () => {
  const all = [
    { exerciseId: "x", weight: 100, reps: 5, gymId: "home", unit: "kg" },
    { exerciseId: "x", weight: 100, reps: 8, gymId: "main" },
    { exerciseId: "x", weight: 90, reps: 12 },
    { exerciseId: "y", weight: 500, reps: 1 },
  ];
  assert.deepEqual(bestSet(all, "x"), { weight: 100, reps: 8 });
  assert.deepEqual(bestSet(all, "x", { weight: 120, reps: 2 }), { weight: 120, reps: 2 });
  assert.equal(bestSet(all, "z"), null);
  assert.deepEqual(bestSet(all, "z", { weight: 5 }), { weight: 5, reps: 0 });
});

test("bestSet at one gym looks only at that gym's sets", () => {
  const all = [
    { exerciseId: "x", weight: 100, reps: 5, gymId: "home" },
    { exerciseId: "x", weight: 80, reps: 5, gymId: "main" },
    { exerciseId: "x", weight: 70, reps: 5 },
  ];
  assert.deepEqual(bestSet(all, "x", null, { gymId: "home" }), { weight: 100, reps: 5 });
  assert.deepEqual(bestSet(all, "x", null, { gymId: "main" }), { weight: 80, reps: 5 });
  assert.equal(bestSet(all, "x", null, { gymId: "elsewhere" }), null);
});

test("bestSet converts between kg and lb when asked for a unit", () => {
  const all = [
    { exerciseId: "x", weight: 100, reps: 5, gymId: "a", unit: "lb" },
    { exerciseId: "x", weight: 50, reps: 5, gymId: "b", unit: "kg" },
  ];
  assert.deepEqual(bestSet(all, "x", null, { unit: "kg" }), { weight: 50, reps: 5 });
  assert.deepEqual(bestSet(all, "x", null, { unit: "lb" }), { weight: 110.23, reps: 5 });
  const light = [{ exerciseId: "x", weight: 100, reps: 5, gymId: "a", unit: "lb" }];
  assert.deepEqual(bestSet(light, "x", null, { unit: "kg" }), { weight: 45.36, reps: 5 });
  assert.deepEqual(bestSet(light, "x", null, { unit: "lb" }), { weight: 100, reps: 5 });
  assert.deepEqual(bestSet([{ exerciseId: "x", weight: 77, reps: 1 }], "x", null, { unit: "kg" }), { weight: 77, reps: 1 });
});

test("isNewPb takes the same options", () => {
  const all = [
    { exerciseId: "x", weight: 100, reps: 5, gymId: "home" },
    { exerciseId: "x", weight: 60, reps: 5, gymId: "main" },
  ];
  const next = { weight: 80, reps: 5 };
  assert.equal(isNewPb(all, "x", null, next), false);
  assert.equal(isNewPb(all, "x", null, next, { gymId: "main" }), true);
  assert.equal(isNewPb(all, "x", null, next, { gymId: "home" }), false);
  assert.equal(isNewPb([], "x", null, next), false);
});

test("personalBests: a machine has a best for this gym and a best ever", () => {
  const all = [
    { exerciseId: "leg-press", weight: 200, reps: 5, gymId: "main", unit: "lb" },
    { exerciseId: "leg-press", weight: 100, reps: 5, gymId: "home", unit: "kg" },
    { exerciseId: "leg-press", weight: 120, reps: 5, gymId: "home", unit: "kg" },
  ];
  const main = personalBests(all, lp, "main");
  assert.deepEqual(main.gym, { weight: 200, reps: 5 });
  assert.deepEqual(main.ever, { weight: 264.55, reps: 5 });
  assert.deepEqual(personalBests(all, { ...lp, unit: "kg", type: "stack" }, "home").gym, { weight: 120, reps: 5 });
  assert.equal(personalBests(all, lp, "elsewhere").gym, null);
  assert.ok(GYM_SPECIFIC_TYPES.includes("plate"));
});

test("personalBests: free weights have the best ever only", () => {
  const all = [
    { exerciseId: "deadlift", weight: 90, reps: 3, gymId: "main", unit: "kg" },
    { exerciseId: "deadlift", weight: 100, reps: 1, gymId: "home", unit: "kg" },
  ];
  const r = personalBests(all, dl, "main");
  assert.equal(r.gym, null);
  assert.deepEqual(r.ever, { weight: 100, reps: 1 });
});

test("personalBests: a typed-in best counts, and an exercise with no type is judged by its unit", () => {
  const all = [{ exerciseId: "leg-press", weight: 100, reps: 5, gymId: "main" }];
  const r = personalBests(all, { id: "leg-press", unit: "lb" }, "main", { weight: 150, reps: 2 });
  assert.deepEqual(r.gym, { weight: 150, reps: 2 });
  assert.deepEqual(r.ever, { weight: 150, reps: 2 });
  assert.equal(personalBests(all, { id: "leg-press", unit: "kg" }, "main").gym, null);
  assert.deepEqual(personalBests([], lp, "main"), { gym: null, ever: null });
});