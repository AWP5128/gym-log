import test from "node:test";
import assert from "node:assert/strict";
import {
  makeSet, setGym, setsForGym, tagSets, removeLastSet, bestSet, isNewPb, personalBests, GYM_SPECIFIC_TYPES,
  hasGymBest, describeBest, weightCaption, newBestLevel,
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

test("hasGymBest: machines have a best per gym, free weights do not", () => {
  assert.equal(hasGymBest(lp), true);
  assert.equal(hasGymBest({ type: "plate", unit: "kg" }), true);
  assert.equal(hasGymBest(dl), false);
  assert.equal(hasGymBest({ type: "dumbbell", unit: "kg" }), false);
  assert.equal(hasGymBest({ type: "bodyweight", unit: "kg" }), false);
  assert.equal(hasGymBest({ unit: "lb" }), true);   // no type: judged by the unit, as personalBests does
  assert.equal(hasGymBest({ unit: "kg" }), false);
});

test("describeBest: pounds first with kilos in brackets, whichever unit the best is held in", () => {
  assert.equal(describeBest({ weight: 100, reps: 8 }, "lb"), "100 lb (45.4 kg) x 8");
  assert.equal(describeBest({ weight: 100, reps: 5 }, "kg"), "220.5 lb (100 kg) x 5");
  assert.equal(describeBest({ weight: 67.5, reps: 10 }, "kg"), "148.8 lb (67.5 kg) x 10");
});

test("describeBest: no reps, body weight only, and nothing logged", () => {
  assert.equal(describeBest({ weight: 150, reps: 0 }, "lb"), "150 lb (68 kg)");   // a typed-in best with no reps
  assert.equal(describeBest({ weight: 0, reps: 12 }, "kg"), "Body weight x 12");   // pull-ups with no added weight
  assert.equal(describeBest(null, "lb"), "none yet");
});

test("describeBest: converted and pound figures are shown to one decimal place", () => {
  assert.equal(describeBest({ weight: 132.28, reps: 6 }, "lb"), "132.3 lb (60 kg) x 6");   // a 60 kg set held in lb
  assert.equal(describeBest({ weight: 1.25, reps: 10 }, "kg"), "2.8 lb (1.25 kg) x 10");   // kg figures are kept as they are
  assert.equal(describeBest({ weight: 52.5, reps: 8 }, "lb"), "52.5 lb (23.8 kg) x 8");
});

test("weightCaption: Stack for stack machines, Weight for everything else", () => {
  assert.equal(weightCaption({ type: "stack", unit: "lb" }), "Stack");
  assert.equal(weightCaption({ type: "barbell", unit: "kg" }), "Weight");
  assert.equal(weightCaption({ type: "plate", unit: "lb" }), "Weight");
  assert.equal(weightCaption({ type: "dumbbell", unit: "kg" }), "Weight");
  assert.equal(weightCaption({ unit: "lb" }), "Stack");    // no type: judged by the unit, as elsewhere
  assert.equal(weightCaption({ unit: "kg" }), "Weight");
});

test("newBestLevel: breaking the best ever, only the gym's best, or neither", () => {
  const before = { gym: { weight: 100, reps: 5 }, ever: { weight: 120, reps: 5 } };
  assert.equal(newBestLevel(before, { weight: 130, reps: 5 }), "ever");
  assert.equal(newBestLevel(before, { weight: 120, reps: 6 }), "ever");        // same weight, more reps
  assert.equal(newBestLevel(before, { weight: 110, reps: 5 }), "gym");         // beats here, not ever
  assert.equal(newBestLevel(before, { weight: 100, reps: 6 }), "gym");
  assert.equal(newBestLevel(before, { weight: 100, reps: 5 }), null);          // equal is not a new best
  assert.equal(newBestLevel(before, { weight: 90, reps: 12 }), null);          // lighter is never a best
});

test("newBestLevel: the first set never counts, and free weights only ever have the best ever", () => {
  assert.equal(newBestLevel({ gym: null, ever: null }, { weight: 50, reps: 5 }), null);
  // First time at a second gym: nothing to beat there, and not above the best ever either.
  assert.equal(newBestLevel({ gym: null, ever: { weight: 120, reps: 5 } }, { weight: 100, reps: 5 }), null);
  assert.equal(newBestLevel({ gym: null, ever: { weight: 120, reps: 5 } }, { weight: 130, reps: 5 }), "ever");
  // Free weights (gym is always null).
  assert.equal(newBestLevel({ gym: null, ever: { weight: 90, reps: 3 } }, { weight: 92.5, reps: 1 }), "ever");
});

test("newBestLevel works with personalBests, including a typed-in best and sets in both units", () => {
  const all = [
    { exerciseId: "leg-press", weight: 100, reps: 5, gymId: "main", unit: "lb" },
    { exerciseId: "leg-press", weight: 60, reps: 5, gymId: "home", unit: "kg" },   // about 132 lb
  ];
  const before = personalBests(all, lp, "main");
  assert.equal(newBestLevel(before, { weight: 110, reps: 5 }), "gym");   // beats main (100) but not home's converted 132.28
  assert.equal(newBestLevel(before, { weight: 140, reps: 5 }), "ever");
  const typed = personalBests(all, lp, "main", { weight: 200, reps: 1 });
  assert.equal(newBestLevel(typed, { weight: 150, reps: 5 }), null);     // below the typed-in best at both levels
});