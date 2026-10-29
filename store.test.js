import test from "node:test";
import assert from "node:assert/strict";
import {
  STORE_VERSION, emptyStore, cleanStore, migrateLegacy, toLegacySettings, applyLegacySettings,
  supportsWarmup, exportMachines, importMachines,
} from "./store.js";

const legacy = {
  exercises: {
    "leg-press": {
      name: "Leg Press", step: 15, pins: [10, 20, 35],
      stackSpec: { low: 10, step: 10, top: 35, changes: [{ at: 20, step: 15 }] },
      notes: "Seat 4",
      startHeavy: 100, startExtraHeavy: 5, workHeavy: 115, workExtraHeavy: 2.5, repsHeavy: 5, setsHeavy: 4,
      workVolume: 85, repsVolume: 10,
      pbWeight: 200, pbReps: 3,
    },
    "pull-up": { workHeavy: 10, repsHeavy: 5 },
  },
  custom: [{ id: "custom-x", name: "X", group: "abs" }],
  defaults: { repsHeavy: 6, setsVolume: 3 },
};

test("emptyStore has a version, one gym and one person", () => {
  const s = emptyStore();
  assert.equal(s.version, STORE_VERSION);
  assert.ok(s.gyms.main);
  assert.ok(s.people.awp);
});

test("migrateLegacy splits shared machine data from personal settings", () => {
  const s = migrateLegacy(legacy);
  assert.deepEqual(s.gyms.main.machines["leg-press"], {
    name: "Leg Press", step: 15, pins: [10, 20, 35], stackSpec: legacy.exercises["leg-press"].stackSpec,
  });
  assert.equal(s.gyms.main.machines["pull-up"], undefined);
  const mine = s.people.awp.gyms.main.machines["leg-press"];
  assert.equal(mine.notes, "Seat 4");
  assert.equal(mine.pbWeight, 200);
  assert.deepEqual(mine.heavy.warmup, { weight: 100, extra: 5, reps: null });
  assert.deepEqual(mine.heavy.working, { weight: 115, extra: 2.5, reps: 5, sets: 4 });
  assert.equal(mine.volume.warmup.weight, null);
  assert.deepEqual(s.people.awp.defaults.heavy, { reps: 6, sets: null, warmupReps: null });
});

test("converting to the store and back gives the same settings", () => {
  const s = migrateLegacy(legacy);
  assert.deepEqual(toLegacySettings(s, "awp", "main"), legacy);
});

test("applyLegacySettings changes only this person at this gym", () => {
  const s = migrateLegacy(legacy);
  s.gyms.second = { name: "Holiday gym", machines: { "leg-press": { pins: [5, 10] } } };
  s.people.sam = { name: "Sam", defaults: {}, gyms: {} };
  const edited = structuredClone(legacy);
  edited.exercises["leg-press"].notes = "Seat 5";
  const next = applyLegacySettings(s, "awp", "main", edited);
  assert.equal(next.people.awp.gyms.main.machines["leg-press"].notes, "Seat 5");
  assert.equal(next.gyms.second.machines["leg-press"].pins.length, 2);
  assert.equal(next.people.sam.name, "Sam");
  assert.equal(next.gyms.main.name, "My gym");
  assert.equal(s.people.awp.gyms.main.machines["leg-press"].notes, "Seat 4");
});

test("clearing a stack removes it from the shared machine", () => {
  const s = migrateLegacy(legacy);
  const edited = structuredClone(legacy);
  edited.exercises["leg-press"].pins = null;
  edited.exercises["leg-press"].stackSpec = null;
  const next = applyLegacySettings(s, "awp", "main", edited);
  assert.equal(next.gyms.main.machines["leg-press"].pins, undefined);
  assert.equal(next.gyms.main.machines["leg-press"].stackSpec, undefined);
  assert.equal(next.gyms.main.machines["leg-press"].name, "Leg Press");
});

test("cleanStore accepts a current store and rejects anything else", () => {
  assert.equal(cleanStore(null), null);
  assert.equal(cleanStore("x"), null);
  assert.equal(cleanStore({ version: 1 }), null);
  assert.equal(cleanStore(emptyStore()).version, STORE_VERSION);
  assert.deepEqual(cleanStore({ version: STORE_VERSION }).custom, []);
});

test("supportsWarmup: machines yes, free weights, pull-ups and timed no", () => {
  assert.equal(supportsWarmup({ unit: "lb" }), true);
  assert.equal(supportsWarmup({ unit: "kg" }), false);
  assert.equal(supportsWarmup({ unit: "kg", min: 0 }), false);
  assert.equal(supportsWarmup({ unit: "lb", kind: "time" }), false);
  assert.equal(supportsWarmup({ unit: "kg", warmup: true }), true);
  assert.equal(supportsWarmup({ unit: "lb", warmup: false }), false);
});

test("exportMachines holds only the shared fields", () => {
  const text = exportMachines(migrateLegacy(legacy), "main");
  const data = JSON.parse(text);
  assert.equal(data.type, "gymlog-machines");
  assert.ok(data.machines["leg-press"].pins);
  assert.equal(data.machines["leg-press"].notes, undefined);
  assert.equal(data.machines["leg-press"].startHeavy, undefined);
  assert.equal(text.includes("Seat 4"), false);
});

test("importMachines adds the machines and leaves personal settings alone", () => {
  const text = exportMachines(migrateLegacy(legacy), "main");
  const fresh = emptyStore();
  const r = importMachines(fresh, "main", text);
  assert.equal(r.error, "");
  assert.equal(r.count, 1);
  assert.deepEqual(r.store.gyms.main.machines["leg-press"].pins, [10, 20, 35]);
  assert.equal(r.store.people, fresh.people);
});

test("importMachines rejects files that are not machine lists", () => {
  const s = emptyStore();
  assert.ok(importMachines(s, "main", "nope").error);
  assert.ok(importMachines(s, "main", '{"type":"other"}').error);
  assert.equal(importMachines(s, "main", "nope").count, 0);
});