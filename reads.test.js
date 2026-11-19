// Reads of personal settings straight from the store: what the screens show for a machine, the every-machine defaults,
// the warm-up reps and the extras saved on the Set up screen.
import test from "node:test";
import assert from "node:assert/strict";
import {
  configOf, globalDefaultsOf, effectiveConfigOf, ownWarmupRepsOf, warmupRepsOf, savedExtraOf, BUILT_IN_DEFAULTS,
} from "./defaults.js";
import { splitForFrom } from "./extras.js";
import { emptyStore, setNever, setPersonal, setDefaults } from "./store.js";
import { exercises } from "./exercises.js";

// A store with Awp's saved settings for the leg press at the main gym, and every-machine heavy defaults.
function sample() {
  let st = setDefaults(emptyStore(), "awp", { heavy: { reps: 6, sets: 3, warmupReps: 8 } });
  st = setPersonal(st, "awp", "main", "leg-press", {
    notes: "Seat 4", pbWeight: 200, pbReps: 3,
    heavy: { warmup: { weight: 50, extra: 2.5, reps: 7 }, working: { weight: 100, extra: 5, reps: 4, sets: 2 } },
  });
  return st;
}

test("known values: warm-up weight, working weight, reps, sets, notes and extras come from the right fields", () => {
  const st = sample();
  assert.deepEqual(configOf(st, "awp", "main", "leg-press"), {
    notes: "Seat 4", startHeavy: 50, workHeavy: 100, repsHeavy: 4, setsHeavy: 2,
    startVolume: null, workVolume: null, repsVolume: null, setsVolume: null, pbWeight: 200, pbReps: 3,
  });
  assert.deepEqual(globalDefaultsOf(st, "awp"), { repsHeavy: 6, setsHeavy: 3, repsVolume: 10, setsVolume: 4 });
  assert.equal(ownWarmupRepsOf(st, "awp", "main", "leg-press", "Heavy"), 7);
  assert.equal(warmupRepsOf(st, "awp", "main", "calf-press", "Heavy"), 8);   // the every-machine value
  assert.equal(warmupRepsOf(st, "awp", "main", "calf-press", "Volume"), 10);  // nothing set: 10
  assert.equal(savedExtraOf(st, "awp", "main", "leg-press", "start", "Heavy"), 2.5);
  assert.equal(savedExtraOf(st, "awp", "main", "leg-press", "work", "Volume"), undefined);
});

test("the effective settings fill reps and sets from the every-machine defaults, then the built-in ones", () => {
  const st = sample();
  const mine = effectiveConfigOf(st, "awp", "main", "leg-press");
  assert.deepEqual([mine.repsHeavy, mine.setsHeavy, mine.repsVolume, mine.setsVolume], [4, 2, 10, 4]);   // own, own, built-in, built-in
  const other = effectiveConfigOf(st, "awp", "main", "calf-press");
  assert.deepEqual([other.repsHeavy, other.setsHeavy, other.repsVolume, other.setsVolume], [6, 3, 10, 4]);   // every-machine, then built-in
  assert.equal(other.notes, "");
  assert.equal(other.workHeavy, null);
});

test("a person or gym that does not exist reads as empty, with the built-in defaults", () => {
  const st = sample();
  for (const [p, g] of [["nobody", "main"], ["awp", "nowhere"], ["nobody", "nowhere"]]) {
    const cfg = effectiveConfigOf(st, p, g, "leg-press");
    assert.equal(cfg.notes, "");
    assert.equal(cfg.workHeavy, null);
    assert.equal(cfg.pbWeight, null);
    assert.equal(cfg.repsHeavy, p === "awp" ? 6 : BUILT_IN_DEFAULTS.repsHeavy);   // awp's every-machine value still applies at another gym
    assert.equal(warmupRepsOf(st, p, g, "leg-press", "Volume"), 10);
  }
  assert.deepEqual(effectiveConfigOf(emptyStore(), "awp", "main", "leg-press"), {
    notes: "", startHeavy: null, workHeavy: null, repsHeavy: 5, setsHeavy: 4,
    startVolume: null, workVolume: null, repsVolume: 10, setsVolume: 4, pbWeight: null, pbReps: null,
  });
  assert.deepEqual(globalDefaultsOf(st, "nobody"), BUILT_IN_DEFAULTS);
});

test("reads ignore the never marks", () => {
  const st = sample();
  const marked = setNever(st, "awp", "main", ["leg-press"], true);
  assert.deepEqual(configOf(marked, "awp", "main", "leg-press"), configOf(st, "awp", "main", "leg-press"));
});

test("a split saved on the Set up screen is used for that weight, and the highest split otherwise", () => {
  const st = setPersonal(emptyStore(), "awp", "main", "leg-press", { heavy: { working: { weight: 100, extra: 5 } } });
  const e = exercises.find((x) => x.id === "leg-press");
  const cfg = configOf(st, "awp", "main", "leg-press");
  const extraFor = (kind) => savedExtraOf(st, "awp", "main", "leg-press", kind, "Heavy");
  assert.deepEqual(splitForFrom(extraFor, e, 100, cfg, "Heavy"), { pin: 95, extra: 5 });   // the saved split
  assert.notDeepEqual(splitForFrom(extraFor, e, 110, cfg, "Heavy"), { pin: 105, extra: 5 });  // another total is worked out, not the saved split
});
