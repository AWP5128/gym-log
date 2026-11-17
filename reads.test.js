// Step 47 (stage C, patch C2): the screens read personal settings straight from the store. Each new read is proved to give
// exactly what the old flat read gave, over many generated stores, so switching the screens over cannot change what they show.
import test from "node:test";
import assert from "node:assert/strict";
import { emptySettings, configFor } from "./settings.js";
import {
  globalDefaults, effectiveConfig, ownWarmupReps, warmupReps,
  configOf, globalDefaultsOf, effectiveConfigOf, ownWarmupRepsOf, warmupRepsOf, savedExtraOf,
} from "./defaults.js";
import { savedExtra, splitFor, splitForFrom } from "./extras.js";
import { emptyStore, migrateLegacy, toLegacySettings, setNever } from "./store.js";
import { exercises } from "./exercises.js";
import { rng, randomFlat, STACKS } from "./genflat.js";

const IDS = [...STACKS, "calf-press", "deadlift", "not-an-exercise"];
const KEYS = ["Heavy", "Volume"];
// What the app held before this step: the flat settings for the current person and gym.
const flatOf = (store, p = "awp", g = "main") => ({ ...emptySettings(), ...toLegacySettings(store, p, g) });
const stores = (n, seed) => { const r = rng(seed); return Array.from({ length: n }, () => migrateLegacy(randomFlat(r))); };

test("configOf gives what configFor gave (300 generated stores)", () => {
  for (const st of stores(300, 4001)) {
    const flat = flatOf(st);
    for (const id of IDS) assert.deepEqual(configOf(st, "awp", "main", id), configFor(flat, id));
  }
});

test("globalDefaultsOf and effectiveConfigOf give what the flat versions gave", () => {
  for (const st of stores(300, 4002)) {
    const flat = flatOf(st);
    assert.deepEqual(globalDefaultsOf(st, "awp"), globalDefaults(flat));
    for (const id of IDS) assert.deepEqual(effectiveConfigOf(st, "awp", "main", id), effectiveConfig(flat, id));
  }
});

test("warm-up reads give what the flat versions gave, for both day types", () => {
  for (const st of stores(300, 4003)) {
    const flat = flatOf(st);
    for (const id of IDS) for (const key of KEYS) {
      assert.equal(ownWarmupRepsOf(st, "awp", "main", id, key), ownWarmupReps(flat, id, key));
      assert.equal(warmupRepsOf(st, "awp", "main", id, key), warmupReps(flat, id, key));
      for (const kind of ["start", "work"]) assert.equal(savedExtraOf(st, "awp", "main", id, kind, key), savedExtra(flat, id, kind, key));
    }
  }
});

test("splitForFrom gives what splitFor gave: the saved split when it fits, otherwise the highest one", () => {
  const ex = exercises.find((e) => e.id === "leg-press");
  let usedSaved = 0;
  for (const st of stores(300, 4004)) {
    const flat = flatOf(st);
    for (const id of ["leg-press", "calf-press", "hip-abduction"]) for (const key of KEYS) {
      const e = { ...ex, id };
      const cfg = configFor(flat, id);
      const totals = [cfg["start" + key], cfg["work" + key], 100, 102.5, 137.5, 5, null].filter((t, i, a) => a.indexOf(t) === i);
      for (const total of totals) {
        const was = splitFor(flat, e, total, cfg, key);
        const now = splitForFrom((kind) => savedExtraOf(st, "awp", "main", id, kind, key), e, total, configOf(st, "awp", "main", id), key);
        assert.deepEqual(now, was);
        if (total !== null && was.extra > 0 && total === cfg["work" + key]) usedSaved++;
      }
    }
  }
  assert.ok(usedSaved > 20, "the generated data must reach the saved-split path (reached " + usedSaved + ")");
});

test("a person or gym that does not exist reads as empty, like the flat read", () => {
  const st = migrateLegacy(randomFlat(rng(9)));
  for (const [p, g] of [["nobody", "main"], ["awp", "nowhere"], ["nobody", "nowhere"]]) {
    const flat = flatOf(st, p, g);
    for (const id of IDS) {
      assert.deepEqual(effectiveConfigOf(st, p, g, id), effectiveConfig(flat, id));
      assert.equal(warmupRepsOf(st, p, g, id, "Heavy"), warmupReps(flat, id, "Heavy"));
    }
  }
  assert.deepEqual(effectiveConfigOf(emptyStore(), "awp", "main", "leg-press"), effectiveConfig(flatOf(emptyStore()), "leg-press"));
});

test("reads ignore the never marks, as the flat read did", () => {
  const st = setNever(migrateLegacy(randomFlat(rng(5))), "awp", "main", ["leg-press"], true);
  assert.deepEqual(configOf(st, "awp", "main", "leg-press"), configFor(flatOf(st), "leg-press"));
});

test("known values: warm-up weight, working weight, reps, sets, notes and extras come from the right fields", () => {
  const st = emptyStore();
  st.people.awp.defaults = { heavy: { reps: 6, sets: 3, warmupReps: 8 } };
  st.people.awp.gyms.main.machines["leg-press"] = {
    notes: "Seat 4", pbWeight: 200, pbReps: 3,
    heavy: { warmup: { weight: 50, extra: 2.5, reps: 7 }, working: { weight: 100, extra: 5, reps: 4, sets: 2 } },
  };
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

test("a split saved on the Set up screen is used for that weight, and the highest split otherwise", () => {
  const st = emptyStore();
  st.people.awp.gyms.main.machines["leg-press"] = { heavy: { warmup: { weight: null, extra: null, reps: null }, working: { weight: 100, extra: 5, reps: null, sets: null } } };
  const e = exercises.find((x) => x.id === "leg-press");
  const cfg = configOf(st, "awp", "main", "leg-press");
  const extraFor = (kind) => savedExtraOf(st, "awp", "main", "leg-press", kind, "Heavy");
  assert.deepEqual(splitForFrom(extraFor, e, 100, cfg, "Heavy"), { pin: 95, extra: 5 });   // the saved split
  assert.notDeepEqual(splitForFrom(extraFor, e, 110, cfg, "Heavy"), { pin: 105, extra: 5 });  // another total is worked out, not the saved split
});
