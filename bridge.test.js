// Step 45 (stage C, patch C0): writes down, as tests, what the legacy "flat settings" bridge really does.
// The bridge is toLegacySettings (store -> the flat object the screens use) and applyLegacySettings
// (flat object -> store). It lives only in memory: what is saved on the phone is the store (version 4 tables).
// Stage C replaces it with direct functions, which must reproduce EVERY behaviour pinned here, or change it on purpose.
// Nothing in this file changes the app. Some pinned behaviours look like quirks; they are pinned because they are real.
import test from "node:test";
import assert from "node:assert/strict";
import { emptyStore, migrateLegacy, toLegacySettings, applyLegacySettings, setNever, setUse } from "./store.js";
import { newGym } from "./gym.js";
import { rng, randomFlat } from "./genflat.js";

const to = toLegacySettings;
const apply = applyLegacySettings;
const eq = (s, gym = "main") => s.gyms[gym].equipment;
const none = { exercises: {}, custom: [], defaults: {} };
const same = (a, b) => assert.deepEqual(a, b);
const frozenCopy = (v) => JSON.parse(JSON.stringify(v));

// ---------- A generated family of stores: the round trip holds for all of them ----------
test("generated settings survive flat -> store -> flat unchanged (200 cases)", () => {
  const rand = rng(12345);
  for (let i = 0; i < 200; i++) {
    const flat = randomFlat(rand);
    const store = migrateLegacy(flat);
    same(to(store, "awp", "main"), flat);
  }
});

test("saving what the screens just read changes nothing in the store (200 cases)", () => {
  const rand = rng(777);
  for (let i = 0; i < 200; i++) {
    const store = migrateLegacy(randomFlat(rand));
    same(apply(store, "awp", "main", to(store, "awp", "main")), store);
  }
});

test("a save never changes the store it was given, and leaves other gyms and people as the same objects", () => {
  const rand = rng(99);
  for (let i = 0; i < 50; i++) {
    const store = migrateLegacy(randomFlat(rand));
    store.gyms.second = newGym("Second", {}, { "leg-press": { name: "Leg Press", group: "legs", type: "stack", unit: "lb", step: 10, pins: [5, 10] } });
    store.people.sam = { name: "Sam", defaults: { heavy: { reps: 3, sets: null, warmupReps: null } }, gyms: { second: { machines: { "leg-press": { notes: "s" } } } } };
    const before = frozenCopy(store);
    const flat = to(store, "awp", "main");
    flat.exercises["leg-press"] = { ...(flat.exercises["leg-press"] || {}), notes: "changed " + i };
    const next = apply(store, "awp", "main", flat);
    same(frozenCopy(store), before);
    assert.equal(next.gyms.second, store.gyms.second);
    assert.equal(next.people.sam, store.people.sam);
    assert.equal(next.people.awp.gyms.main.machines["leg-press"].notes, "changed " + i);
  }
});

// ---------- What a save REPLACES as a whole (a direct version must do the same, or be changed on purpose) ----------
test("a save clears the stack of every item that is missing from the flat data", () => {
  const s = emptyStore();
  eq(s)["chest-press"].pins = [10, 20];
  eq(s)["chest-press"].stackSpec = { low: 10, step: 10, top: 20, changes: [] };
  const next = apply(s, "awp", "main", none);
  assert.equal(eq(next)["chest-press"].pins, undefined);
  assert.equal(eq(next)["chest-press"].stackSpec, undefined);
  assert.equal(eq(next)["chest-press"].name, "Chest Press Machine");   // the item itself stays
});

test("a save also drops stray pins on items that use a gym weight set (the flat data never shows them)", () => {
  const s = emptyStore();
  eq(s).deadlift.pins = [5, 10];
  assert.equal(to(s, "awp", "main").exercises.deadlift, undefined);
  assert.equal(eq(apply(s, "awp", "main", to(s, "awp", "main"))).deadlift.pins, undefined);
});

test("a save replaces the person's every-machine defaults as a whole, each day type holding all three fields", () => {
  const s = emptyStore();
  s.people.awp.defaults = { heavy: { reps: 6, sets: 3, warmupReps: 8 } };
  same(apply(s, "awp", "main", none).people.awp.defaults, {});
  same(apply(s, "awp", "main", { ...none, defaults: { repsVolume: 12 } }).people.awp.defaults, { volume: { reps: 12, sets: null, warmupReps: null } });
});

test("a save replaces the person's machines at that gym as a whole: empty entries are dropped", () => {
  const s = emptyStore();
  const blank = { warmup: { weight: null, extra: null, reps: null }, working: { weight: null, extra: null, reps: null, sets: null } };
  s.people.awp.gyms.main.machines = { "leg-press": { notes: "x" }, "chest-press": {}, "pull-up": { heavy: blank } };
  same(apply(s, "awp", "main", to(s, "awp", "main")).people.awp.gyms.main.machines, { "leg-press": { notes: "x" } });
});

test("a save leaves never, use and the person's superset marks exactly as they were", () => {
  let s = emptyStore();
  s.people.awp.superset = { pairs: { a: ["b"] }, suitable: { a: true } };
  s = setNever(s, "awp", "main", ["leg-press"], true);
  s = setUse(s, "awp", "main", { id: "calf-press", common: true }, "rare");
  const flat = to(s, "awp", "main");
  flat.exercises["leg-press"] = { notes: "n" };
  const next = apply(s, "awp", "main", flat);
  same(next.people.awp.gyms.main.never, { "leg-press": true });
  same(next.people.awp.gyms.main.use, { "calf-press": "rare" });
  same(next.people.awp.superset, { pairs: { a: ["b"] }, suitable: { a: true } });
});

test("a save replaces the list of exercises you added: flat data without one wipes it", () => {
  const s = emptyStore();
  s.custom = [{ id: "custom-x", name: "X", group: "abs", unit: "lb", step: 10 }];
  same(apply(s, "awp", "main", { exercises: {}, defaults: {} }).custom, []);
  same(to(s, "awp", "main").custom, s.custom);
});

// ---------- How values are cleaned on the way in ----------
test("only finite numbers are kept; numbers typed as text, NaN and Infinity are dropped; negatives and zero are KEPT", () => {
  const next = apply(emptyStore(), "awp", "main", { ...none, exercises: { "leg-press": {
    startHeavy: "5", workHeavy: NaN, workVolume: Infinity, pbWeight: "9", repsHeavy: -3, setsHeavy: 0, startExtraHeavy: 2.5, junk: 1,
  } } });
  same(next.people.awp.gyms.main.machines["leg-press"], {
    heavy: { warmup: { weight: null, extra: 2.5, reps: null }, working: { weight: null, extra: null, reps: -3, sets: 0 } },
  });
});

test("notes: an empty string is dropped, but a note of only spaces is kept as it is", () => {
  const empty = apply(emptyStore(), "awp", "main", { ...none, exercises: { "leg-press": { notes: "" } } });
  same(empty.people.awp.gyms.main.machines, {});
  const spaces = apply(emptyStore(), "awp", "main", { ...none, exercises: { "leg-press": { notes: "   " } } });
  same(spaces.people.awp.gyms.main.machines["leg-press"], { notes: "   " });
});

test("shared fields: the name is trimmed and a blank one ignored, a step must be above zero, pins keep only numbers", () => {
  const next = apply(emptyStore(), "awp", "main", { ...none, exercises: { "leg-press": { name: "  Leg  ", step: -5, pins: [10, NaN, "x", 20] } } });
  assert.equal(eq(next)["leg-press"].name, "Leg");
  assert.equal(eq(next)["leg-press"].step, 10);   // the built-in step: -5 was ignored
  same(eq(next)["leg-press"].pins, [10, 20]);
  const blank = apply(emptyStore(), "awp", "main", { ...none, exercises: { "leg-press": { name: "   " } } });
  assert.equal(eq(blank)["leg-press"].name, "Leg Press Machine");
});

test("a day type block exists only when one of its seven fields has a number, and then holds all seven", () => {
  const next = apply(emptyStore(), "awp", "main", { ...none, exercises: { "leg-press": { setsVolume: 3 } } });
  same(next.people.awp.gyms.main.machines["leg-press"], {
    volume: { warmup: { weight: null, extra: null, reps: null }, working: { weight: null, extra: null, reps: null, sets: 3 } },
  });
});

// ---------- Missing people, gyms and items ----------
test("a save for a person or gym that does not exist creates them (the new gym is called My gym and has the built-in exercises only)", () => {
  const s = emptyStore();
  const next = apply(s, "sam", "holiday", { ...none, exercises: { "leg-press": { notes: "n" } } });
  same(next.people.sam, { name: "sam", gyms: { holiday: { machines: { "leg-press": { notes: "n" } } } }, defaults: {} });
  assert.equal(next.gyms.holiday.name, "My gym");
  assert.equal(Object.keys(eq(next, "holiday")).length, 19);
  assert.equal(next.gyms.main, s.gyms.main);
});

test("reading for a person or gym that does not exist gives empty settings", () => {
  same(to(emptyStore(), "nobody", "nowhere"), none);
});

test("shared data for an id the gym lacks creates the item; personal data alone does not", () => {
  const next = apply(emptyStore(), "awp", "main", { ...none, exercises: { "brand-new": { name: "Brand New", pins: [5] }, "other-new": { notes: "hi" } } });
  assert.equal(eq(next)["brand-new"].name, "Brand New");
  assert.equal(eq(next)["other-new"], undefined);
  same(next.people.awp.gyms.main.machines["other-new"], { notes: "hi" });
});

// ---------- What the flat data shows ----------
test("the flat data lists only what differs from the built-in exercise or holds personal data", () => {
  same(to(emptyStore(), "awp", "main"), none);
  const s = emptyStore();
  eq(s)["leg-press"].name = "Leg Press";
  eq(s).deadlift.name = "Deadlift";   // an item with a weight set: only its name can differ
  eq(s).deadlift.step = 25;
  same(to(s, "awp", "main").exercises, { "leg-press": { name: "Leg Press" }, deadlift: { name: "Deadlift" } });
});

test("a personal entry and a shared change for the same machine appear together in one flat entry", () => {
  const s = emptyStore();
  eq(s)["leg-press"].pins = [10, 20];
  s.people.awp.gyms.main.machines["leg-press"] = { notes: "Seat 4", pbWeight: 200, heavy: { warmup: { weight: 50, extra: null, reps: null }, working: { weight: 100, extra: 2.5, reps: 5, sets: 4 } } };
  same(to(s, "awp", "main").exercises["leg-press"], {
    pins: [10, 20], notes: "Seat 4", pbWeight: 200, startHeavy: 50, workHeavy: 100, workExtraHeavy: 2.5, repsHeavy: 5, setsHeavy: 4,
  });
});
