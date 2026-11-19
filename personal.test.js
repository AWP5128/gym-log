// The direct personal-settings functions in store.js: what a person has saved for a machine (personalOf, setPersonal),
// the every-machine defaults (defaultsOf, setDefaults) and the exercises you added (customOf, addCustom, removeCustom).
import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyStore, setNever, setUse, personalOf, setPersonal, defaultsOf, setDefaults, customOf, addCustom, removeCustom,
} from "./store.js";

const same = (a, b) => assert.deepEqual(a, b);
const frozenCopy = (v) => JSON.parse(JSON.stringify(v));
const BLOCK = { warmup: { weight: null, extra: null, reps: null }, working: { weight: null, extra: null, reps: null, sets: null } };
const NO_DEFAULTS = { reps: null, sets: null, warmupReps: null };

// ---------- Reading ----------
test("personalOf gives every field of what was saved, and nulls for the rest", () => {
  const s = setPersonal(emptyStore(), "awp", "main", "leg-press", {
    notes: "Seat 4", pbWeight: 200, pbReps: 3,
    heavy: { warmup: { weight: 50, extra: 2.5, reps: 7 }, working: { weight: 100, extra: 5, reps: 4, sets: 2 } },
    volume: { working: { sets: 3 } },
  });
  same(personalOf(s, "awp", "main", "leg-press"), {
    notes: "Seat 4", pbWeight: 200, pbReps: 3,
    heavy: { warmup: { weight: 50, extra: 2.5, reps: 7 }, working: { weight: 100, extra: 5, reps: 4, sets: 2 } },
    volume: { warmup: { weight: null, extra: null, reps: null }, working: { weight: null, extra: null, reps: null, sets: 3 } },
  });
  same(personalOf(s, "awp", "main", "chest-press"), { notes: "", pbWeight: null, pbReps: null, heavy: BLOCK, volume: BLOCK });   // another machine
  same(personalOf(s, "awp", "other-gym", "leg-press"), { notes: "", pbWeight: null, pbReps: null, heavy: BLOCK, volume: BLOCK });   // another gym
});

test("personalOf for an exercise, gym or person with nothing saved gives all nulls and no notes", () => {
  const want = { notes: "", pbWeight: null, pbReps: null, heavy: BLOCK, volume: structuredClone(BLOCK) };
  same(personalOf(emptyStore(), "awp", "main", "leg-press"), want);
  same(personalOf(emptyStore(), "nobody", "nowhere", "leg-press"), want);
});

test("defaultsOf gives every field, with nulls for what is not set", () => {
  same(defaultsOf(emptyStore(), "nobody"), { heavy: NO_DEFAULTS, volume: NO_DEFAULTS });
  const s = setDefaults(emptyStore(), "awp", { heavy: { reps: 6, warmupReps: 8 }, volume: { sets: 3 } });
  same(defaultsOf(s, "awp"), { heavy: { reps: 6, sets: null, warmupReps: 8 }, volume: { reps: null, sets: 3, warmupReps: null } });
});

// ---------- Writing ----------
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

test("setPersonal keeps never and use as they were", () => {
  let s = setNever(emptyStore(), "awp", "main", ["leg-press"], true);
  s = setUse(s, "awp", "main", { id: "calf-press", common: true }, "rare");
  const next = setPersonal(s, "awp", "main", "leg-press", { notes: "n" });
  same(next.people.awp.gyms.main.never, { "leg-press": true });
  same(next.people.awp.gyms.main.use, { "calf-press": "rare" });
});

test("setPersonal for a person who does not exist creates them", () => {
  const next = setPersonal(emptyStore(), "sam", "main", "leg-press", { notes: "n" });
  same(next.people.sam, { name: "sam", gyms: { main: { machines: { "leg-press": { notes: "n" } } } }, defaults: {} });
});

test("values are cleaned: text numbers are dropped, negatives and zero are kept", () => {
  const s = setPersonal(emptyStore(), "awp", "main", "leg-press", { pbWeight: "9", heavy: { working: { weight: NaN, reps: -3, sets: 0 }, warmup: { extra: 2.5 } } });
  const got = personalOf(s, "awp", "main", "leg-press");
  assert.equal(got.pbWeight, null);
  assert.equal(got.heavy.working.weight, null);
  assert.equal(got.heavy.working.reps, -3);
  assert.equal(got.heavy.working.sets, 0);
  assert.equal(got.heavy.warmup.extra, 2.5);
});

test("notes: an empty string clears them, but a note of only spaces is kept as it is", () => {
  let s = setPersonal(emptyStore(), "awp", "main", "leg-press", { notes: "x" });
  assert.equal(personalOf(setPersonal(s, "awp", "main", "leg-press", { notes: "" }), "awp", "main", "leg-press").notes, "");
  s = setPersonal(emptyStore(), "awp", "main", "leg-press", { notes: "   " });
  assert.equal(personalOf(s, "awp", "main", "leg-press").notes, "   ");
});

test("setDefaults changes only what the patch names: a field left out stays, null clears, junk is ignored", () => {
  let s = setDefaults(emptyStore(), "awp", { heavy: { reps: 6, sets: 3 }, volume: { warmupReps: 12 } });
  s = setDefaults(s, "awp", { heavy: { sets: 5 } });
  same(defaultsOf(s, "awp"), { heavy: { reps: 6, sets: 5, warmupReps: null }, volume: { reps: null, sets: null, warmupReps: 12 } });
  s = setDefaults(s, "awp", { heavy: { reps: null, sets: null }, volume: { warmupReps: "x" } });
  same(defaultsOf(s, "awp"), { heavy: NO_DEFAULTS, volume: NO_DEFAULTS });
  same(s.people.awp.defaults, {});   // a day type with nothing set is not saved
});

test("setDefaults leaves the old store, the machines and the other people alone", () => {
  let s = setPersonal(emptyStore(), "awp", "main", "leg-press", { notes: "x" });
  s.people.sam = { name: "Sam", defaults: {}, gyms: {} };
  const before = frozenCopy(s);
  const next = setDefaults(s, "awp", { heavy: { reps: 6 } });
  same(frozenCopy(s), before);
  assert.equal(next.people.sam, s.people.sam);
  assert.equal(next.gyms, s.gyms);
  same(personalOf(next, "awp", "main", "leg-press").notes, "x");
});

// ---------- Equipment is never touched ----------
test("setPersonal and setDefaults never touch equipment, and setPersonal does not create a gym that does not exist", () => {
  const s = emptyStore();
  s.gyms.main.equipment.deadlift.pins = [5, 10];   // stray pins on an item that uses the gym's barbell set
  same(setPersonal(s, "awp", "main", "leg-press", { notes: "n" }).gyms.main.equipment.deadlift.pins, [5, 10]);
  same(setDefaults(s, "awp", { heavy: { reps: 6 } }).gyms.main.equipment.deadlift.pins, [5, 10]);
  assert.equal(setPersonal(s, "awp", "nowhere", "leg-press", { notes: "n" }).gyms.nowhere, undefined);
});

test("setPersonal keeps an empty entry for another exercise", () => {
  const s = emptyStore();
  s.people.awp.gyms.main.machines = { "pull-up": {} };
  assert.ok("pull-up" in setPersonal(s, "awp", "main", "leg-press", { notes: "n" }).people.awp.gyms.main.machines);
});

// ---------- Exercises you added ----------
test("addCustom gives each new exercise its own id, ignores a blank name, and removeCustom removes by id", () => {
  let s = emptyStore();
  const defs = [{ name: "Face Pull", group: "arms", unit: "lb", step: 5 }, { name: "Face Pull", group: "arms", unit: "kg" }, { name: "Stretch", group: "abs", unit: "min" }, { name: "   " }];
  for (const d of defs) s = addCustom(s, d);
  same(customOf(s).map((c) => c.id), ["custom-face-pull", "custom-face-pull-2", "custom-stretch"]);
  const stretch = customOf(s).find((c) => c.id === "custom-stretch");
  assert.equal(stretch.kind, "time");
  assert.equal(stretch.unit, "min");
  same(removeCustom(s, "custom-face-pull").custom.map((c) => c.id), ["custom-face-pull-2", "custom-stretch"]);
  same(removeCustom(s, "nothing-here").custom, s.custom);
});
