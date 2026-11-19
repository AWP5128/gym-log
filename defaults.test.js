import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyStore, setDefaults, setPersonal } from "./store.js";
import {
  BUILT_IN_DEFAULTS, DEFAULT_WARMUP_REPS, configOf, globalDefaultsOf, effectiveConfigOf, ownWarmupRepsOf, warmupRepsOf,
} from "./defaults.js";

const ME = "awp";
const GYM = "main";
const LEG_PRESS = "leg-press";
// A store where every machine uses 12 reps and 3 sets on a volume day.
const volume12x3 = () => setDefaults(emptyStore(), ME, { volume: { reps: 12, sets: 3 } });
const machine = (store, id, patch) => setPersonal(store, ME, GYM, id, patch);
const effective = (store, id) => effectiveConfigOf(store, ME, GYM, id);
const warmup = (store, id, key) => warmupRepsOf(store, ME, GYM, id, key);
const ownWarmup = (store, id, key) => ownWarmupRepsOf(store, ME, GYM, id, key);

test("the every-machine defaults are 5 reps (heavy) and 10 reps (volume), 4 sets each, until changed", () => {
  assert.deepEqual(globalDefaultsOf(emptyStore(), ME), BUILT_IN_DEFAULTS);
  assert.deepEqual(BUILT_IN_DEFAULTS, { repsHeavy: 5, setsHeavy: 4, repsVolume: 10, setsVolume: 4 });
});

test("setDefaults saves values and leaves the old store unchanged", () => {
  const before = emptyStore();
  const after = setDefaults(before, ME, { volume: { reps: 12, sets: 3 } });
  assert.equal(globalDefaultsOf(after, ME).repsVolume, 12);
  assert.equal(globalDefaultsOf(after, ME).setsVolume, 3);
  assert.equal(globalDefaultsOf(after, ME).repsHeavy, 5);
  assert.equal(globalDefaultsOf(before, ME).repsVolume, 10);
});

test("the every-machine defaults ignore blank, zero and negative values", () => {
  const s = setDefaults(emptyStore(), ME, { heavy: { reps: null, sets: 0 }, volume: { reps: -2 } });
  assert.deepEqual(globalDefaultsOf(s, ME), BUILT_IN_DEFAULTS);
});

test("a machine with nothing saved has empty fields and no notes", () => {
  const cfg = configOf(emptyStore(), ME, GYM, LEG_PRESS);
  assert.equal(cfg.setsHeavy, null);
  assert.equal(cfg.setsVolume, null);
  assert.equal(cfg.workVolume, null);
  assert.equal(cfg.startHeavy, null);
  assert.equal(cfg.notes, "");
});

test("the effective settings fill reps and sets from the every-machine defaults", () => {
  const cfg = effective(volume12x3(), LEG_PRESS);
  assert.deepEqual([cfg.repsVolume, cfg.setsVolume, cfg.repsHeavy, cfg.setsHeavy], [12, 3, 5, 4]);
});

test("a machine's own reps and sets win over the every-machine defaults", () => {
  const s = machine(volume12x3(), LEG_PRESS, { volume: { working: { reps: 8, sets: 5 } } });
  assert.equal(effective(s, LEG_PRESS).repsVolume, 8);
  assert.equal(effective(s, LEG_PRESS).setsVolume, 5);
  assert.equal(effective(s, "chest-press").repsVolume, 12);
});

test("the effective settings keep weights and notes empty when not set", () => {
  const cfg = effective(emptyStore(), LEG_PRESS);
  assert.equal(cfg.workVolume, null);
  assert.equal(cfg.startHeavy, null);
  assert.equal(cfg.notes, "");
});

test("warm-up reps: the machine's own, else the every-machine value, else 10", () => {
  assert.equal(DEFAULT_WARMUP_REPS, 10);
  assert.equal(warmup(emptyStore(), LEG_PRESS, "Heavy"), 10);
  assert.equal(ownWarmup(emptyStore(), LEG_PRESS, "Heavy"), null);

  const everyMachine = setDefaults(emptyStore(), ME, { heavy: { warmupReps: 8 } });
  assert.equal(warmup(everyMachine, LEG_PRESS, "Heavy"), 8);
  assert.equal(warmup(everyMachine, LEG_PRESS, "Volume"), 10);

  const own = machine(everyMachine, LEG_PRESS, { heavy: { warmup: { reps: 6 } } });
  assert.equal(ownWarmup(own, LEG_PRESS, "Heavy"), 6);
  assert.equal(warmup(own, LEG_PRESS, "Heavy"), 6);
  assert.equal(warmup(own, "chest-press", "Heavy"), 8);

  const blank = machine(emptyStore(), LEG_PRESS, { heavy: { warmup: { reps: 0 } } });
  assert.equal(warmup(blank, LEG_PRESS, "Heavy"), 10);
});
