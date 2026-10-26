import { test } from "node:test";
import assert from "node:assert/strict";
import { emptySettings, configFor, updateExercise } from "./settings.js";
import { BUILT_IN_DEFAULTS, globalDefaults, updateGlobalDefaults, effectiveConfig } from "./defaults.js";

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
  const cfg = configFor(emptySettings(), "leg-press");
  assert.equal(cfg.setsHeavy, null);
  assert.equal(cfg.setsVolume, null);
});

test("effectiveConfig fills reps and sets from the every-machine defaults", () => {
  const s = updateGlobalDefaults(emptySettings(), { repsVolume: 12, setsVolume: 3 });
  const cfg = effectiveConfig(s, "leg-press");
  assert.equal(cfg.repsVolume, 12);
  assert.equal(cfg.setsVolume, 3);
  assert.equal(cfg.repsHeavy, 5);
  assert.equal(cfg.setsHeavy, 4);
});

test("a machine's own reps and sets win over the every-machine defaults", () => {
  let s = updateGlobalDefaults(emptySettings(), { repsVolume: 12, setsVolume: 3 });
  s = updateExercise(s, "leg-press", { repsVolume: 8, setsVolume: 5 });
  assert.equal(effectiveConfig(s, "leg-press").repsVolume, 8);
  assert.equal(effectiveConfig(s, "leg-press").setsVolume, 5);
  assert.equal(effectiveConfig(s, "chest-press").repsVolume, 12);
});

test("effectiveConfig keeps weights and notes empty when not set", () => {
  const cfg = effectiveConfig(emptySettings(), "leg-press");
  assert.equal(cfg.workVolume, null);
  assert.equal(cfg.startHeavy, null);
  assert.equal(cfg.notes, "");
});