// Single limb logging switch (step 88): a person turns it on for an exercise at a gym; saved on the personal_setup row (single_limb).
import test from "node:test";
import assert from "node:assert/strict";
import { migrateToV4, fromV4, checkV4 } from "./schema4.js";
import { emptyStore, setSingle, singleIds, isSingle, setNever, setUse, DEFAULT_GYM, DEFAULT_PERSON } from "./store.js";
import { toDbRow, fromDbRow } from "./dbload.js";
import { openDb, putPerson, personOf } from "./db.js";
import { toStoreV4 } from "./schema4.js";

const P = DEFAULT_PERSON;
const G = DEFAULT_GYM;

test("setSingle switches an exercise on and off for one person at one gym only; both limbs is the default", () => {
  let s = emptyStore();
  assert.equal(isSingle(s, P, G, "leg-press"), false);
  s = setSingle(s, P, G, "leg-press", true);
  s = setSingle(s, P, G, "quad-extension", true);
  assert.deepEqual(singleIds(s, P, G), { "leg-press": true, "quad-extension": true });
  assert.equal(isSingle(s, P, "other-gym", "leg-press"), false);
  assert.equal(isSingle(s, "someone", G, "leg-press"), false);
  s = setSingle(s, P, G, "leg-press", false);
  assert.deepEqual(singleIds(s, P, G), { "quad-extension": true });
  s = setSingle(s, P, G, "quad-extension", false);
  assert.equal("single" in s.people[P].gyms[G], false);   // nothing left, nothing kept
});

test("the switch survives a trip through the tables, beside notes, never and use", () => {
  let s = emptyStore();
  s = { ...s, people: { ...s.people, [P]: { ...s.people[P], gyms: { [G]: { machines: { "leg-press": { notes: "Seat 4" } } } } } } };
  s = setSingle(s, P, G, "leg-press", true);
  s = setSingle(s, P, G, "hamstring-curl", true);
  s = setNever(s, P, G, ["deadlift"], true);
  s = setUse(s, P, G, { id: "quad-extension", common: false }, "normal");
  const r = migrateToV4({ store: s, settings: null, sets: [] });
  assert.equal(r.ok, true);
  const rows = r.v4.tables.personal_setup;
  assert.equal(rows.find((x) => x.exerciseId === "leg-press" && x.dayType === null).singleLimb, true);
  assert.equal(rows.find((x) => x.exerciseId === "hamstring-curl").singleLimb, true);
  assert.equal(rows.find((x) => x.exerciseId === "deadlift").singleLimb, undefined);
  const back = fromV4(r.v4).store;
  assert.deepEqual(singleIds(back, P, G), { "leg-press": true, "hamstring-curl": true });
  assert.equal(back.people[P].gyms[G].machines["leg-press"].notes, "Seat 4");
  assert.equal(checkV4({ store: s, sets: [] }).ok, true);
  assert.equal(fromDbRow("personal_setup", toDbRow("personal_setup", { personId: P, gymId: G, exerciseId: "x", dayType: null, singleLimb: true })).singleLimb, true);
  assert.equal(toDbRow("personal_setup", { personId: P, gymId: G, exerciseId: "x", dayType: null, singleLimb: true }).single_limb, true);
});

test("saving a person in the tables keeps the switch", () => {
  let s = emptyStore();
  s = setSingle(s, P, G, "leg-press", true);
  const db = putPerson(openDb(toStoreV4(s, [])), P, s.people[P]);
  assert.deepEqual(singleIds({ people: { [P]: personOf(db, P) } }, P, G), { "leg-press": true });
});
