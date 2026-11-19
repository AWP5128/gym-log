// Step 46 (stage C, patch C1): the direct personal-settings functions in store.js are proved equal to the flat-settings path
// the app uses today (toLegacySettings -> change the flat data -> applyLegacySettings). The app does not use them yet.
// Where they are deliberately NOT equal, a test below says so and why.
import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyStore, migrateLegacy, toLegacySettings, applyLegacySettings, setNever, setUse,
  personalOf, setPersonal, defaultsOf, setDefaults, customOf, addCustom, removeCustom,
} from "./store.js";
import { updateExercise, addCustomExercise, removeCustomExercise, configFor } from "./settings.js";
// The old flat way of changing the every-machine defaults, kept here only while this file compares the two paths.
const updateGlobalDefaults = (settings, patch) => ({ ...settings, defaults: { ...(settings.defaults || {}), ...patch } });
import { rng, randomFlat, STACKS } from "./genflat.js";

const to = toLegacySettings;
const apply = applyLegacySettings;
const same = (a, b) => assert.deepEqual(a, b);
const frozenCopy = (v) => JSON.parse(JSON.stringify(v));

// flat field name (before Heavy/Volume) -> [group, field] in a day type's block (the same table store.js uses)
const FIELD_MAP = [
  ["start", "warmup", "weight"], ["startExtra", "warmup", "extra"], ["warmReps", "warmup", "reps"],
  ["work", "working", "weight"], ["workExtra", "working", "extra"], ["reps", "working", "reps"], ["sets", "working", "sets"],
];
const DAYS = [["Heavy", "heavy"], ["Volume", "volume"]];
const fin = (v) => (Number.isFinite(v) ? v : null);

// A random change to one exercise, written both the old way (flat names) and the new way (nested), plus which exercise.
function randomChange(rand) {
  const pick = (n) => Math.floor(rand() * n);
  const id = STACKS[pick(STACKS.length)];
  const flat = {};
  const nested = {};
  const value = () => (rand() < 0.25 ? null : 5 * (1 + pick(30)));
  if (rand() < 0.4) { const n = rand() < 0.3 ? "" : rand() < 0.2 ? null : "Seat " + pick(9); flat.notes = n; nested.notes = n; }
  if (rand() < 0.2) { const v = value(); flat.pbWeight = v; nested.pbWeight = v; }
  if (rand() < 0.2) { const v = value(); flat.pbReps = v; nested.pbReps = v; }
  for (const [Cap, mode] of DAYS) {
    for (const [prefix, group, key] of FIELD_MAP) {
      if (rand() < 0.3) {
        const v = value();
        flat[prefix + Cap] = v;
        ((nested[mode] ??= {})[group] ??= {})[key] = v;
      }
    }
  }
  return { id, flat, nested };
}

// A random store, sometimes with never, use, superset marks and a second person and gym.
function randomStore(rand) {
  let s = migrateLegacy(randomFlat(rand));
  if (rand() < 0.5) {
    s = setNever(s, "awp", "main", ["hip-adduction"], true);
    s = setUse(s, "awp", "main", { id: "calf-press", common: true }, "rare");
    s.people.awp.superset = { pairs: { "leg-press": ["calf-press"] }, suitable: { "leg-press": true } };
  }
  if (rand() < 0.5) s.people.sam = { name: "Sam", defaults: {}, gyms: { main: { machines: { "leg-press": { notes: "s" } } } } };
  return s;
}

// ---------- Reading ----------
test("personalOf gives every field, and equals what the flat settings hold (200 cases)", () => {
  const rand = rng(2024);
  for (let i = 0; i < 200; i++) {
    const s = randomStore(rand);
    const flat = to(s, "awp", "main");
    for (const id of STACKS) {
      const c = flat.exercises[id] || {};
      const got = personalOf(s, "awp", "main", id);
      assert.equal(got.notes, typeof c.notes === "string" ? c.notes : "");
      assert.equal(got.pbWeight, fin(c.pbWeight));
      assert.equal(got.pbReps, fin(c.pbReps));
      for (const [Cap, mode] of DAYS) for (const [prefix, group, key] of FIELD_MAP) assert.equal(got[mode][group][key], fin(c[prefix + Cap]), id + " " + prefix + Cap);
      // the screens' own reader agrees on the fields it covers
      const cfg = configFor(flat, id);
      assert.equal(got.notes, cfg.notes);
      assert.equal(got.heavy.working.weight, cfg.workHeavy);
      assert.equal(got.volume.warmup.weight, cfg.startVolume);
    }
  }
});

test("personalOf for an exercise, gym or person with nothing saved gives all nulls and no notes", () => {
  const empty = { notes: "", pbWeight: null, pbReps: null };
  const block = { warmup: { weight: null, extra: null, reps: null }, working: { weight: null, extra: null, reps: null, sets: null } };
  const want = { ...empty, heavy: block, volume: structuredClone(block) };
  same(personalOf(emptyStore(), "awp", "main", "leg-press"), want);
  same(personalOf(emptyStore(), "nobody", "nowhere", "leg-press"), want);
});

test("defaultsOf gives every field, and equals the flat defaults (200 cases)", () => {
  const rand = rng(31);
  for (let i = 0; i < 200; i++) {
    const s = randomStore(rand);
    const flat = to(s, "awp", "main");
    const got = defaultsOf(s, "awp");
    for (const [Cap, mode] of DAYS) for (const [prefix, key] of [["reps", "reps"], ["sets", "sets"], ["warmReps", "warmupReps"]]) assert.equal(got[mode][key], fin(flat.defaults[prefix + Cap]));
  }
  same(defaultsOf(emptyStore(), "nobody"), { heavy: { reps: null, sets: null, warmupReps: null }, volume: { reps: null, sets: null, warmupReps: null } });
});

// ---------- Writing: equal to the flat path ----------
test("setPersonal gives the same store as changing the flat data and saving it (300 cases)", () => {
  const rand = rng(555);
  for (let i = 0; i < 300; i++) {
    const s = randomStore(rand);
    const { id, flat, nested } = randomChange(rand);
    const viaFlat = apply(s, "awp", "main", updateExercise(to(s, "awp", "main"), id, flat));
    const direct = setPersonal(s, "awp", "main", id, nested);
    same(direct, viaFlat);
  }
});

test("setDefaults gives the same store as changing the flat defaults and saving them (300 cases)", () => {
  const rand = rng(8);
  for (let i = 0; i < 300; i++) {
    const s = randomStore(rand);
    const flatPatch = {};
    const nested = {};
    for (const [Cap, mode] of DAYS) {
      for (const [prefix, key] of [["reps", "reps"], ["sets", "sets"], ["warmReps", "warmupReps"]]) {
        if (rand() < 0.35) { const v = rand() < 0.25 ? null : 1 + Math.floor(rand() * 12); flatPatch[prefix + Cap] = v; (nested[mode] ??= {})[key] = v; }
      }
    }
    same(setDefaults(s, "awp", nested), apply(s, "awp", "main", updateGlobalDefaults(to(s, "awp", "main"), flatPatch)));
  }
});

test("addCustom and removeCustom give the same list as the flat path", () => {
  let s = emptyStore();
  const defs = [{ name: "Face Pull", group: "arms", unit: "lb", step: 5 }, { name: "Face Pull", group: "arms", unit: "kg" }, { name: "Stretch", group: "abs", unit: "min" }, { name: "   " }];
  for (const d of defs) {
    const viaFlat = apply(s, "awp", "main", addCustomExercise(to(s, "awp", "main"), d));
    const direct = addCustom(s, d);
    same(direct.custom, viaFlat.custom);
    s = direct;
  }
  same(customOf(s).map((c) => c.id), ["custom-face-pull", "custom-face-pull-2", "custom-stretch"]);
  const viaFlat = apply(s, "awp", "main", removeCustomExercise(to(s, "awp", "main"), "custom-face-pull"));
  same(removeCustom(s, "custom-face-pull").custom, viaFlat.custom);
  same(removeCustom(s, "nothing-here").custom, s.custom);
});

// ---------- Writing: what is promised on its own ----------
test("setPersonal changes only what the patch names: a field left out stays, null clears", () => {
  let s = setPersonal(emptyStore(), "awp", "main", "leg-press", { notes: "Seat 4", pbWeight: 200, heavy: { working: { weight: 115, extra: 2.5, reps: 5, sets: 4 } } });
  s = setPersonal(s, "awp", "main", "leg-press", { heavy: { warmup: { weight: 50 } } });
  const got = personalOf(s, "awp", "main", "leg-press");
  assert.equal(got.notes, "Seat 4");
  assert.equal(got.heavy.working.weight, 115);
  assert.equal(got.heavy.warmup.weight, 50);
  s = setPersonal(s, "awp", "main", "leg-press", { notes: null, heavy: { working: { weight: null } } });
  const cleared = personalOf(s, "awp", "main", "leg-press");
  assert.equal(cleared.notes, "");
  assert.equal(cleared.heavy.working.weight, null);
  assert.equal(cleared.heavy.working.reps, 5);
});

test("an exercise left with nothing set loses its entry; other exercises, never, use and superset marks are untouched", () => {
  let s = emptyStore();
  s.people.awp.superset = { pairs: { a: ["b"] }, suitable: { a: true } };
  s = setNever(s, "awp", "main", ["calf-press"], true);
  s = setPersonal(s, "awp", "main", "leg-press", { notes: "x" });
  s = setPersonal(s, "awp", "main", "chest-press", { notes: "y" });
  const before = frozenCopy(s);
  const next = setPersonal(s, "awp", "main", "leg-press", { notes: "" });
  same(frozenCopy(s), before);   // the store it was given is not changed
  same(Object.keys(next.people.awp.gyms.main.machines), ["chest-press"]);
  same(next.people.awp.gyms.main.never, { "calf-press": true });
  same(next.people.awp.superset, { pairs: { a: ["b"] }, suitable: { a: true } });
  assert.equal(next.gyms, s.gyms);   // gyms are the same object: nothing about equipment changed
});

test("setPersonal for a person who does not exist creates them, the same way a save does", () => {
  const s = emptyStore();
  const next = setPersonal(s, "sam", "main", "leg-press", { notes: "n" });
  same(next.people.sam, { name: "sam", gyms: { main: { machines: { "leg-press": { notes: "n" } } } }, defaults: {} });
  same(next.people.sam, apply(s, "sam", "main", { exercises: { "leg-press": { notes: "n" } }, custom: [], defaults: {} }).people.sam);
});

test("values are cleaned like a save cleans them: text numbers are dropped, negatives and zero are kept", () => {
  const s = setPersonal(emptyStore(), "awp", "main", "leg-press", { pbWeight: "9", heavy: { working: { weight: NaN, reps: -3, sets: 0 }, warmup: { extra: 2.5 } } });
  const got = personalOf(s, "awp", "main", "leg-press");
  assert.equal(got.pbWeight, null);
  assert.equal(got.heavy.working.weight, null);
  assert.equal(got.heavy.working.reps, -3);
  assert.equal(got.heavy.working.sets, 0);
  assert.equal(got.heavy.warmup.extra, 2.5);
});

// ---------- Where it deliberately differs from a save through the flat settings ----------
// A flat save rewrites a lot that was not changed. These are the consequences, pinned in bridge.test.js; the direct
// functions do NOT repeat them. If real data holds any of these, the first direct save leaves the saved data slightly
// different from what the flat save would have left (it keeps what the flat save would have thrown away).
test("DIFFERENCE: an empty entry for another exercise is kept by setPersonal (a flat save drops it)", () => {
  const s = emptyStore();
  s.people.awp.gyms.main.machines = { "pull-up": {} };
  assert.ok("pull-up" in setPersonal(s, "awp", "main", "leg-press", { notes: "n" }).people.awp.gyms.main.machines);
  assert.ok(!("pull-up" in apply(s, "awp", "main", updateExercise(to(s, "awp", "main"), "leg-press", { notes: "n" })).people.awp.gyms.main.machines));
});

test("DIFFERENCE: setPersonal and setDefaults never touch equipment (a flat save clears stacks of items missing from the flat data)", () => {
  const s = emptyStore();
  s.gyms.main.equipment.deadlift.pins = [5, 10];   // stray pins on an item that uses the gym's barbell set
  assert.deepEqual(setPersonal(s, "awp", "main", "leg-press", { notes: "n" }).gyms.main.equipment.deadlift.pins, [5, 10]);
  assert.deepEqual(setDefaults(s, "awp", { heavy: { reps: 6 } }).gyms.main.equipment.deadlift.pins, [5, 10]);
  assert.equal(apply(s, "awp", "main", updateExercise(to(s, "awp", "main"), "leg-press", { notes: "n" })).gyms.main.equipment.deadlift.pins, undefined);
});

test("DIFFERENCE: setPersonal does not create a gym that does not exist (a flat save creates one called My gym)", () => {
  const s = emptyStore();
  assert.equal(setPersonal(s, "awp", "nowhere", "leg-press", { notes: "n" }).gyms.nowhere, undefined);
  assert.equal(apply(s, "awp", "nowhere", { exercises: { "leg-press": { notes: "n" } }, custom: [], defaults: {} }).gyms.nowhere.name, "My gym");
});
