import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySettings, configFor, updateExercise } from "./settings.js";
import {
  BUILT_IN_DEFAULTS, DEFAULT_WARMUP_REPS, globalDefaults, updateGlobalDefaults, effectiveConfig,
  ownWarmupReps, warmupReps,
} from "./defaults.js";

const LEG_PRESS = "leg-press";
// Settings where every machine uses 12 reps and 3 sets on a volume day.
const volume12x3 = () => updateGlobalDefaults(emptySettings(), { repsVolume: 12, setsVolume: 3 });

test("globalDefaults are 5 reps (heavy) and 10 reps (volume), 4 sets each, until changed", () => {
  assert.deepEqual(globalDefaults(emptySettings()), BUILT_IN_DEFAULTS);
  assert.deepEqual(BUILT_IN_DEFAULTS, { repsHeavy: 5, setsHeavy: 4, repsVolume: 10, setsVolume: 4 });
});

test("updateGlobalDefaults saves values and leaves the old settings unchanged", () => {
  const before = emptySettings();
  const after = updateGlobalDefaults(before, { repsVolume: 12, setsVolume: 3 });
  assert.equal(globalDefaults(after).repsVolume, 12);
  assert.equal(globalDefaults(after).setsVolume, 3);
  assert.equal(globalDefaults(after).repsHeavy, 5);
  assert.equal(globalDefaults(before).repsVolume, 10);
});

test("globalDefaults ignores blank, zero and negative values", () => {
  const s = updateGlobalDefaults(emptySettings(), { repsHeavy: null, setsHeavy: 0, repsVolume: -2 });
  assert.deepEqual(globalDefaults(s), BUILT_IN_DEFAULTS);
});

test("configFor has empty sets fields", () => {
  const cfg = configFor(emptySettings(), LEG_PRESS);
  assert.equal(cfg.setsHeavy, null);
  assert.equal(cfg.setsVolume, null);
});

test("effectiveConfig fills reps and sets from the every-machine defaults", () => {
  const cfg = effectiveConfig(volume12x3(), LEG_PRESS);
  assert.deepEqual(
    [cfg.repsVolume, cfg.setsVolume, cfg.repsHeavy, cfg.setsHeavy],
    [12, 3, 5, 4]
  );
});

test("a machine's own reps and sets win over the every-machine defaults", () => {
  const s = updateExercise(volume12x3(), LEG_PRESS, { repsVolume: 8, setsVolume: 5 });
  assert.equal(effectiveConfig(s, LEG_PRESS).repsVolume, 8);
  assert.equal(effectiveConfig(s, LEG_PRESS).setsVolume, 5);
  assert.equal(effectiveConfig(s, "chest-press").repsVolume, 12);
});

test("effectiveConfig keeps weights and notes empty when not set", () => {
  const cfg = effectiveConfig(emptySettings(), LEG_PRESS);
  assert.equal(cfg.workVolume, null);
  assert.equal(cfg.startHeavy, null);
  assert.equal(cfg.notes, "");
});

test("warm-up reps: the machine's own, else the every-machine value, else 10", () => {
  assert.equal(DEFAULT_WARMUP_REPS, 10);
  assert.equal(warmupReps(emptySettings(), LEG_PRESS, "Heavy"), 10);
  assert.equal(ownWarmupReps(emptySettings(), LEG_PRESS, "Heavy"), null);

  const everyMachine = updateGlobalDefaults(emptySettings(), { warmRepsHeavy: 8 });
  assert.equal(warmupReps(everyMachine, LEG_PRESS, "Heavy"), 8);
  assert.equal(warmupReps(everyMachine, LEG_PRESS, "Volume"), 10);

  const own = updateExercise(everyMachine, LEG_PRESS, { warmRepsHeavy: 6 });
  assert.equal(ownWarmupReps(own, LEG_PRESS, "Heavy"), 6);
  assert.equal(warmupReps(own, LEG_PRESS, "Heavy"), 6);
  assert.equal(warmupReps(own, "chest-press", "Heavy"), 8);

  const blank = updateExercise(emptySettings(), LEG_PRESS, { warmRepsHeavy: 0 });
  assert.equal(warmupReps(blank, LEG_PRESS, "Heavy"), 10);
});