// migrateLegacy turns the settings saved by the first versions of the app (a flat object, kept on the phone as
// gymlog.settings) into the permanent store, once. These tests pin how it reads and cleans that old data.
import test from "node:test";
import assert from "node:assert/strict";
import { emptyStore, migrateLegacy } from "./store.js";

const none = { exercises: {}, custom: [], defaults: {} };
const same = (a, b) => assert.deepEqual(a, b);
const eq = (s, gym = "main") => s.gyms[gym].equipment;
const mine = (s) => s.people.awp.gyms.main.machines;
const from = (exercises, more = {}) => migrateLegacy({ ...none, exercises, ...more });

test("old settings for nothing give the same store as a new one", () => {
  const s = migrateLegacy(none);
  same(s.people.awp.defaults, {});
  same(mine(s), {});
  same(Object.keys(eq(s)), Object.keys(eq(emptyStore())));
});

test("only finite numbers are kept; numbers typed as text, NaN and Infinity are dropped; negatives and zero are KEPT", () => {
  const s = from({ "leg-press": {
    startHeavy: "5", workHeavy: NaN, workVolume: Infinity, pbWeight: "9", repsHeavy: -3, setsHeavy: 0, startExtraHeavy: 2.5, junk: 1,
  } });
  same(mine(s)["leg-press"], {
    heavy: { warmup: { weight: null, extra: 2.5, reps: null }, working: { weight: null, extra: null, reps: -3, sets: 0 } },
  });
});

test("notes: an empty string is dropped, but a note of only spaces is kept as it is", () => {
  same(mine(from({ "leg-press": { notes: "" } })), {});
  same(mine(from({ "leg-press": { notes: "   " } }))["leg-press"], { notes: "   " });
});

test("shared fields: the name is trimmed and a blank one ignored, a step must be above zero, pins keep only numbers", () => {
  const s = from({ "leg-press": { name: "  Leg  ", step: -5, pins: [10, NaN, "x", 20] } });
  assert.equal(eq(s)["leg-press"].name, "Leg");
  assert.equal(eq(s)["leg-press"].step, 10);   // the built-in step: -5 was ignored
  same(eq(s)["leg-press"].pins, [10, 20]);
  assert.equal(eq(from({ "leg-press": { name: "   " } }))["leg-press"].name, "Leg Press Machine");
});

test("a day type block exists only when one of its seven fields has a number, and then holds all seven", () => {
  same(mine(from({ "leg-press": { setsVolume: 3 } }))["leg-press"], {
    volume: { warmup: { weight: null, extra: null, reps: null }, working: { weight: null, extra: null, reps: null, sets: 3 } },
  });
});

test("the every-machine defaults keep a day type only when one of its fields has a number, and then hold all three", () => {
  same(migrateLegacy(none).people.awp.defaults, {});
  same(migrateLegacy({ ...none, defaults: { repsVolume: 12 } }).people.awp.defaults, { volume: { reps: 12, sets: null, warmupReps: null } });
  same(migrateLegacy({ ...none, defaults: { repsVolume: "12", setsHeavy: NaN } }).people.awp.defaults, {});
});

test("shared data for an id the built-in list lacks creates the item; personal data alone does not", () => {
  const s = from({ "brand-new": { name: "Brand New", pins: [5] }, "other-new": { notes: "hi" } });
  assert.equal(eq(s)["brand-new"].name, "Brand New");
  assert.equal(eq(s)["other-new"], undefined);
  same(mine(s)["other-new"], { notes: "hi" });
});

test("the list of exercises you added is kept as it is, and a missing list is empty", () => {
  const custom = [{ id: "custom-x", name: "X", group: "abs", unit: "lb", step: 10 }];
  same(migrateLegacy({ ...none, custom }).custom, custom);
  same(migrateLegacy({ exercises: {}, defaults: {} }).custom, []);
});

test("settings that are not an object give an empty store", () => {
  for (const junk of [null, undefined, "x", 5, []]) {
    const s = migrateLegacy(junk);
    same(mine(s), {});
    same(s.custom, []);
  }
});

test("a machine entry that is not an object is skipped", () => {
  const s = from({ "leg-press": "junk", "chest-press": null, "calf-press": { notes: "ok" } });
  same(Object.keys(mine(s)), ["calf-press"]);
});

test("the new gym and person take the names and ids asked for", () => {
  const s = migrateLegacy(none, { gymId: "home", personId: "sam", gymName: "Home", personName: "Sam" });
  assert.equal(s.currentGym, "home");
  assert.equal(s.defaultGym, "home");
  assert.equal(s.currentPerson, "sam");
  assert.equal(s.gyms.home.name, "Home");
  assert.equal(s.people.sam.name, "Sam");
});
