import test from "node:test";
import assert from "node:assert/strict";
import { migrateToV4, fromV4, checkV4, withoutEmptyGyms } from "./schema4.js";
import { emptyStore, cleanStore, neverIds, isNever, setNever, useIds, useOf, defaultUse, setUse, DEFAULT_GYM, DEFAULT_PERSON } from "./store.js";
import { toDbRow, fromDbRow } from "./dbload.js";

const P = DEFAULT_PERSON;
const G = DEFAULT_GYM;

test("setNever marks and clears exercises for one person at one gym only", () => {
  let s = emptyStore();
  s = setNever(s, P, G, ["leg-press", "deadlift"], true);
  assert.deepEqual(neverIds(s, P, G), { "leg-press": true, deadlift: true });
  assert.equal(isNever(s, P, G, "leg-press"), true);
  assert.equal(isNever(s, P, "other-gym", "leg-press"), false);
  assert.equal(isNever(s, "someone", G, "leg-press"), false);
  s = setNever(s, P, G, ["leg-press"], false);
  assert.deepEqual(neverIds(s, P, G), { deadlift: true });
  s = setNever(s, P, G, ["deadlift"], false);
  assert.equal("never" in s.people[P].gyms[G], false);   // nothing left, nothing kept
  assert.deepEqual(s.people[P].gyms[G].machines, {});
});

test("setNever leaves the personal settings and other gyms alone", () => {
  let s = emptyStore();
  s = { ...s, people: { ...s.people, [P]: { ...s.people[P], gyms: { ...s.people[P].gyms, [G]: { machines: { x: { notes: "n" } } }, g2: { machines: {} } } } } };
  const t = setNever(s, P, G, ["x"], true);
  assert.deepEqual(t.people[P].gyms[G].machines, { x: { notes: "n" } });
  assert.deepEqual(t.people[P].gyms.g2, { machines: {} });
});

test("never marks survive the clean-up of a saved store", () => {
  const s = setNever(emptyStore(), P, G, ["leg-press"], true);
  const back = cleanStore(JSON.parse(JSON.stringify(s)));
  assert.equal(isNever(back, P, G, "leg-press"), true);
});

test("never marks go into personal_setup rows and come back (with and without other setup)", () => {
  let s = emptyStore();
  s = { ...s, people: { ...s.people, [P]: { ...s.people[P], gyms: { [G]: { machines: {
    "leg-press": { notes: "Seat 4", heavy: { working: { weight: 100, reps: 5, sets: 4 } } },
    "chest-press": { notes: "only a note" },
  } } } } } };
  s = setNever(s, P, G, ["leg-press", "chest-press", "deadlift"], true);
  const r = migrateToV4({ store: s, settings: null, sets: [] });
  assert.equal(r.ok, true);
  const rows = r.v4.tables.personal_setup.filter((x) => x.never);
  assert.deepEqual(rows.map((x) => x.exerciseId).sort(), ["chest-press", "deadlift", "leg-press"]);
  assert.ok(rows.every((x) => x.dayType === null));
  const back = fromV4(r.v4).store;
  assert.deepEqual(neverIds(back, P, G), { "leg-press": true, "chest-press": true, deadlift: true });
  assert.equal(back.people[P].gyms[G].machines["leg-press"].notes, "Seat 4");
  assert.equal(back.people[P].gyms[G].machines.deadlift, undefined);   // a mark alone makes no machine settings
  assert.equal(checkV4({ store: s, sets: [] }).ok, true);
});

test("the never column is a boolean in the database rows", () => {
  const row = toDbRow("personal_setup", { personId: P, gymId: G, exerciseId: "x", dayType: null, never: true });
  assert.equal(row.never, true);
  assert.equal(fromDbRow("personal_setup", row).never, true);
});

const common = { id: "leg-press", common: true };
const lessCommon = { id: "quad-extension", common: false };

test("an exercise starts as Normal, or Rare when the built-in data says less common", () => {
  const s = emptyStore();
  assert.equal(defaultUse(common), "normal");
  assert.equal(defaultUse(lessCommon), "rare");
  assert.equal(useOf(s, P, G, common), "normal");
  assert.equal(useOf(s, P, G, lessCommon), "rare");
});

test("setUse saves only a choice that differs from the default, and Never replaces Rare", () => {
  let s = emptyStore();
  s = setUse(s, P, G, common, "rare");
  assert.deepEqual(useIds(s, P, G), { "leg-press": "rare" });
  assert.equal(useOf(s, P, G, common), "rare");
  s = setUse(s, P, G, lessCommon, "normal");
  assert.equal(useOf(s, P, G, lessCommon), "normal");
  s = setUse(s, P, G, lessCommon, "rare");   // back to its default: nothing saved
  assert.deepEqual(useIds(s, P, G), { "leg-press": "rare" });
  s = setUse(s, P, G, common, "never");
  assert.equal(useOf(s, P, G, common), "never");
  assert.deepEqual(useIds(s, P, G), {});
  s = setUse(s, P, G, common, "normal");   // Never undone, and Normal is the default
  assert.equal("never" in s.people[P].gyms[G], false);
  assert.equal("use" in s.people[P].gyms[G], false);
  assert.equal(useOf(s, P, "other-gym", common), "normal");
});

test("setNever keeps Rare and Normal choices", () => {
  let s = setUse(emptyStore(), P, G, common, "rare");
  s = setNever(s, P, G, ["deadlift"], true);
  assert.deepEqual(useIds(s, P, G), { "leg-press": "rare" });
});

test("Rare and Normal choices go into personal_setup and come back, with a never mark and notes", () => {
  let s = emptyStore();
  s = { ...s, people: { ...s.people, [P]: { ...s.people[P], gyms: { [G]: { machines: { "leg-press": { notes: "Seat 4" } } } } } } };
  s = setUse(s, P, G, common, "rare");
  s = setUse(s, P, G, lessCommon, "normal");
  s = setUse(s, P, G, { id: "deadlift", common: true }, "never");
  const r = migrateToV4({ store: s, settings: null, sets: [] });
  assert.equal(r.ok, true);
  const rows = r.v4.tables.personal_setup;
  assert.equal(rows.find((x) => x.exerciseId === "leg-press" && x.dayType === null).use, "rare");
  assert.equal(rows.find((x) => x.exerciseId === "quad-extension").use, "normal");
  const back = fromV4(r.v4).store;
  assert.deepEqual(useIds(back, P, G), { "leg-press": "rare", "quad-extension": "normal" });
  assert.deepEqual(neverIds(back, P, G), { deadlift: true });
  assert.equal(back.people[P].gyms[G].machines["leg-press"].notes, "Seat 4");
  assert.equal(checkV4({ store: s, sets: [] }).ok, true);
  assert.equal(fromDbRow("personal_setup", toDbRow("personal_setup", { personId: P, gymId: G, exerciseId: "x", dayType: null, use: "rare" })).use, "rare");
});
