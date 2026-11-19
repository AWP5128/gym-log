import test from "node:test";
import assert from "node:assert/strict";
import { warmupRepsOf, ownWarmupRepsOf, DEFAULT_WARMUP_REPS } from "./defaults.js";
import { emptyStore, migrateLegacy, setDefaults, setPersonal } from "./store.js";

const reps = (store, id, key) => warmupRepsOf(store, "awp", "main", id, key);
const own = (store, id, key) => ownWarmupRepsOf(store, "awp", "main", id, key);
const machine = (store, id, patch) => setPersonal(store, "awp", "main", id, patch);

test("warm-up reps default to 10", () => {
  assert.equal(DEFAULT_WARMUP_REPS, 10);
  assert.equal(reps(emptyStore(), "leg-press", "Heavy"), 10);
});

test("a machine's own warm-up reps win, per day type", () => {
  const s = machine(emptyStore(), "leg-press", { heavy: { warmup: { reps: 8 } } });
  assert.equal(reps(s, "leg-press", "Heavy"), 8);
  assert.equal(reps(s, "leg-press", "Volume"), 10);
  assert.equal(own(s, "leg-press", "Volume"), null);
});

test("the every-machine value is used when a machine has none", () => {
  let s = setDefaults(emptyStore(), "awp", { heavy: { warmupReps: 12 } });
  assert.equal(reps(s, "x", "Heavy"), 12);
  s = machine(s, "x", { heavy: { warmup: { reps: 6 } } });
  assert.equal(reps(s, "x", "Heavy"), 6);
});

test("blank, zero and invalid values are ignored", () => {
  const s = machine(emptyStore(), "x", { heavy: { warmup: { reps: 0 } }, volume: { warmup: { reps: null } } });
  assert.equal(reps(s, "x", "Heavy"), 10);
  assert.equal(reps(s, "x", "Volume"), 10);
});

test("warm-up reps and notes survive the first conversion of the old settings into the store", () => {
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
  assert.equal(mine.heavy.warmup.weight, 100);
  assert.equal(mine.heavy.working.weight, 115);
  assert.equal(mine.heavy.working.reps, 5);
  assert.equal(mine.notes, "Seat 4");
  assert.equal(s.people.awp.defaults.heavy.warmupReps, 9);
  assert.equal(reps(s, "leg-press", "Volume"), 12);
  assert.equal(reps(s, "calf-press", "Heavy"), 9);
});
