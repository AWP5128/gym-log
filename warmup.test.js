import test from "node:test";
import assert from "node:assert/strict";
import { warmupReps, ownWarmupReps, updateGlobalDefaults, DEFAULT_WARMUP_REPS } from "./defaults.js";
import { emptySettings, updateExercise } from "./settings.js";
import { migrateLegacy, toLegacySettings } from "./store.js";

test("warm-up reps default to 10", () => {
  assert.equal(DEFAULT_WARMUP_REPS, 10);
  assert.equal(warmupReps(emptySettings(), "leg-press", "Heavy"), 10);
});

test("a machine's own warm-up reps win, per day type", () => {
  const s = updateExercise(emptySettings(), "leg-press", { warmRepsHeavy: 8 });
  assert.equal(warmupReps(s, "leg-press", "Heavy"), 8);
  assert.equal(warmupReps(s, "leg-press", "Volume"), 10);
  assert.equal(ownWarmupReps(s, "leg-press", "Volume"), null);
});

test("the every-machine value is used when a machine has none", () => {
  let s = updateGlobalDefaults(emptySettings(), { warmRepsHeavy: 12 });
  assert.equal(warmupReps(s, "x", "Heavy"), 12);
  s = updateExercise(s, "x", { warmRepsHeavy: 6 });
  assert.equal(warmupReps(s, "x", "Heavy"), 6);
});

test("blank, zero and invalid values are ignored", () => {
  const s = updateExercise(emptySettings(), "x", { warmRepsHeavy: 0, warmRepsVolume: null });
  assert.equal(warmupReps(s, "x", "Heavy"), 10);
  assert.equal(warmupReps(s, "x", "Volume"), 10);
});

test("warm-up reps and notes survive the store and come back", () => {
  const legacy = {
    exercises: {
      "leg-press": { notes: "Seat 4", warmRepsHeavy: 8, warmRepsVolume: 12, startHeavy: 100, workHeavy: 115, repsHeavy: 5 },
    },
    custom: [],
    defaults: { warmRepsHeavy: 9 },
  };
  const s = migrateLegacy(legacy);
  const mine = s.people.awp.gyms.main.machines["leg-press"];
  assert.equal(mine.heavy.warmup.reps, 8);
  assert.equal(mine.volume.warmup.reps, 12);
  assert.equal(mine.notes, "Seat 4");
  assert.deepEqual(toLegacySettings(s, "awp", "main"), legacy);
});
