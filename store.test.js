import test from "node:test";
import assert from "node:assert/strict";
import {
  STORE_VERSION, emptyStore, cleanStore, migrateLegacy, toLegacySettings, applyLegacySettings,
  supportsWarmup, exportMachines, importMachines,
  gymList, addGym, renameGym, setDefaultGym, setCurrentGym, useDefaultGym,
} from "./store.js";
import { exercises } from "./exercises.js";
import { newGym, makeItem } from "./gym.js";

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

// A version 2 store, as saved on the phone before gyms had their own equipment.
const v2 = () => ({
  version: 2,
  currentGym: "main",
  currentPerson: "awp",
  custom: [],
  gyms: {
    main: {
      name: "My gym",
      machines: {
        "leg-press": { name: "Leg Press", step: 15, pins: [10, 20, 35], stackSpec: { low: 10, step: 10, top: 35, changes: [] } },
      },
    },
  },
  people: { awp: { name: "Awp", defaults: {}, gyms: { main: { machines: { "leg-press": { notes: "Seat 4", pbWeight: 200, pbReps: 3 } } } } } },
});

test("emptyStore has a version, one gym with the built-in equipment and one person", () => {
  const s = emptyStore();
  assert.equal(s.version, STORE_VERSION);
  assert.equal(STORE_VERSION, 3);
  assert.ok(s.people.awp);
  const gym = s.gyms.main;
  assert.equal(Object.keys(gym.equipment).length, exercises.length);
  assert.equal(gym.equipment["leg-press"].type, "stack");
  assert.equal(gym.equipment["leg-press"].unit, "lb");
  assert.equal(gym.equipment.deadlift.type, "barbell");
  assert.equal(gym.units.stack, "lb");
  assert.equal(gym.units.dumbbell, "kg");
});

test("emptyStore gives a fresh store each time", () => {
  const a = emptyStore();
  a.gyms.main.equipment["leg-press"].name = "Changed";
  assert.equal(emptyStore().gyms.main.equipment["leg-press"].name, "Leg Press Machine");
});

test("migrateLegacy puts the shared machine data into the first gym's equipment", () => {
  const s = migrateLegacy(legacy);
  const lp = s.gyms.main.equipment["leg-press"];
  assert.equal(lp.name, "Leg Press");
  assert.equal(lp.step, 15);
  assert.deepEqual(lp.pins, [10, 20, 35]);
  assert.deepEqual(lp.stackSpec, legacy.exercises["leg-press"].stackSpec);
  assert.equal(lp.type, "stack");
  assert.equal(lp.unit, "lb");
  assert.equal(lp.group, "legs");
  assert.equal(s.gyms.main.equipment["pull-up"].name, "Pull-ups (neutral grip)");
  assert.equal(s.gyms.main.equipment["pull-up"].pins, undefined);
  assert.equal(Object.keys(s.gyms.main.equipment).length, exercises.length);
});

test("migrateLegacy keeps the personal settings separate", () => {
  const s = migrateLegacy(legacy);
  const mine = s.people.awp.gyms.main.machines["leg-press"];
  assert.equal(mine.notes, "Seat 4");
  assert.equal(mine.pbWeight, 200);
  assert.deepEqual(mine.heavy.warmup, { weight: 100, extra: 5, reps: null });
  assert.deepEqual(mine.heavy.working, { weight: 115, extra: 2.5, reps: 5, sets: 4 });
  assert.equal(mine.volume.warmup.weight, null);
  assert.deepEqual(s.people.awp.defaults.heavy, { reps: 6, sets: null, warmupReps: null });
  assert.equal(JSON.stringify(s.gyms).includes("Seat 4"), false);
});

test("converting to the store and back gives the same settings", () => {
  const s = migrateLegacy(legacy);
  assert.deepEqual(toLegacySettings(s, "awp", "main"), legacy);
});

test("an exercise you added keeps its stack and is not listed as changed when nothing differs", () => {
  const withCustom = {
    exercises: { "custom-x": { pins: [5, 10], notes: "mine" } },
    custom: [{ id: "custom-x", name: "X", group: "abs", unit: "lb", step: 10, common: true, kind: "weights", custom: true }],
    defaults: {},
  };
  const s = migrateLegacy(withCustom);
  assert.deepEqual(s.gyms.main.equipment["custom-x"].pins, [5, 10]);
  assert.equal(s.gyms.main.equipment["custom-x"].name, "X");
  assert.deepEqual(toLegacySettings(s, "awp", "main"), withCustom);
});

test("applyLegacySettings changes only this person at this gym", () => {
  const s = migrateLegacy(legacy);
  s.gyms.second = newGym("Holiday gym", {}, { "leg-press": makeItem({ name: "Leg Press", group: "legs", pins: [5, 10] }) });
  s.people.sam = { name: "Sam", defaults: {}, gyms: {} };
  const edited = structuredClone(legacy);
  edited.exercises["leg-press"].notes = "Seat 5";
  const next = applyLegacySettings(s, "awp", "main", edited);
  assert.equal(next.people.awp.gyms.main.machines["leg-press"].notes, "Seat 5");
  assert.equal(next.gyms.second.equipment["leg-press"].pins.length, 2);
  assert.equal(next.people.sam.name, "Sam");
  assert.equal(next.gyms.main.name, "My gym");
  assert.equal(s.people.awp.gyms.main.machines["leg-press"].notes, "Seat 4");
});

test("saving with nothing changed leaves the store as it was", () => {
  const s = migrateLegacy(legacy);
  assert.deepEqual(applyLegacySettings(s, "awp", "main", toLegacySettings(s, "awp", "main")), s);
});

test("a new stack from the screens is saved on the item", () => {
  const s = migrateLegacy(legacy);
  const edited = structuredClone(legacy);
  edited.exercises["chest-press"] = { pins: [20, 30, 40], stackSpec: { low: 20, step: 10, top: 40, changes: [] } };
  const next = applyLegacySettings(s, "awp", "main", edited);
  assert.deepEqual(next.gyms.main.equipment["chest-press"].pins, [20, 30, 40]);
  assert.equal(next.gyms.main.equipment["chest-press"].name, "Chest Press Machine");
});

test("clearing a stack removes it from the item but keeps the item", () => {
  const s = migrateLegacy(legacy);
  const edited = structuredClone(legacy);
  edited.exercises["leg-press"].pins = null;
  edited.exercises["leg-press"].stackSpec = null;
  const next = applyLegacySettings(s, "awp", "main", edited);
  assert.equal(next.gyms.main.equipment["leg-press"].pins, undefined);
  assert.equal(next.gyms.main.equipment["leg-press"].stackSpec, undefined);
  assert.equal(next.gyms.main.equipment["leg-press"].name, "Leg Press");
});

test("cleanStore accepts a current store and rejects anything else", () => {
  assert.equal(cleanStore(null), null);
  assert.equal(cleanStore("x"), null);
  assert.equal(cleanStore({ version: 1 }), null);
  assert.equal(cleanStore({ version: 4 }), null);
  assert.equal(cleanStore(emptyStore()).version, STORE_VERSION);
  assert.deepEqual(cleanStore({ version: STORE_VERSION }).custom, []);
});

test("cleanStore tidies a gym with missing parts", () => {
  const s = cleanStore({ version: STORE_VERSION, gyms: { a: { name: "  " }, b: "junk" } });
  assert.equal(s.gyms.a.name, "My gym");
  assert.deepEqual(s.gyms.a.equipment, {});
  assert.equal(s.gyms.a.units.stack, "lb");
  assert.equal(s.gyms.b.name, "My gym");
});

test("cleanStore upgrades a version 2 store and keeps stacks and personal settings", () => {
  const old = v2();
  const s = cleanStore(old);
  assert.equal(s.version, 3);
  const lp = s.gyms.main.equipment["leg-press"];
  assert.equal(lp.name, "Leg Press");
  assert.deepEqual(lp.pins, [10, 20, 35]);
  assert.equal(lp.unit, "lb");
  assert.equal(Object.keys(s.gyms.main.equipment).length, exercises.length);
  assert.equal(s.gyms.main.machines, undefined);
  assert.equal(s.people.awp.gyms.main.machines["leg-press"].notes, "Seat 4");
  assert.equal(old.version, 2);
  assert.ok(old.gyms.main.machines);
});

test("a version 2 store gives the screens the same settings as before", () => {
  const s = cleanStore(v2());
  const flat = toLegacySettings(s, "awp", "main");
  assert.deepEqual(flat.exercises["leg-press"], {
    name: "Leg Press", step: 15, pins: [10, 20, 35],
    stackSpec: { low: 10, step: 10, top: 35, changes: [] },
    notes: "Seat 4", pbWeight: 200, pbReps: 3,
  });
  assert.equal(Object.keys(flat.exercises).length, 1);
});

test("supportsWarmup: machines yes, free weights, pull-ups and timed no", () => {
  assert.equal(supportsWarmup({ unit: "lb" }), true);
  assert.equal(supportsWarmup({ unit: "kg" }), false);
  assert.equal(supportsWarmup({ unit: "kg", min: 0 }), false);
  assert.equal(supportsWarmup({ unit: "lb", kind: "time" }), false);
  assert.equal(supportsWarmup({ unit: "kg", warmup: true }), true);
  assert.equal(supportsWarmup({ unit: "lb", warmup: false }), false);
});

test("exportMachines holds only the shared fields, and only machines that differ from the built-in ones", () => {
  const text = exportMachines(migrateLegacy(legacy), "main");
  const data = JSON.parse(text);
  assert.equal(data.type, "gymlog-machines");
  assert.ok(data.machines["leg-press"].pins);
  assert.equal(data.machines["leg-press"].notes, undefined);
  assert.equal(data.machines["leg-press"].startHeavy, undefined);
  assert.equal(data.machines["pull-up"], undefined);
  assert.equal(Object.keys(data.machines).length, 1);
  assert.equal(text.includes("Seat 4"), false);
});

test("importMachines adds the machines and leaves personal settings alone", () => {
  const text = exportMachines(migrateLegacy(legacy), "main");
  const fresh = emptyStore();
  const r = importMachines(fresh, "main", text);
  assert.equal(r.error, "");
  assert.equal(r.count, 1);
  assert.deepEqual(r.store.gyms.main.equipment["leg-press"].pins, [10, 20, 35]);
  assert.equal(r.store.gyms.main.equipment["leg-press"].name, "Leg Press");
  assert.equal(r.store.people, fresh.people);
  assert.equal(fresh.gyms.main.equipment["leg-press"].pins, undefined);
});

test("importMachines adds a machine the gym does not have yet, and starts a missing gym", () => {
  const text = JSON.stringify({ type: "gymlog-machines", version: 1, gymName: "Other", machines: { "rowing-x": { name: "Rowing X", pins: [10, 20] } } });
  const r = importMachines(emptyStore(), "main", text);
  assert.equal(r.count, 1);
  assert.deepEqual(r.store.gyms.main.equipment["rowing-x"].pins, [10, 20]);
  assert.equal(r.store.gyms.main.equipment["rowing-x"].name, "Rowing X");
  const fresh = importMachines(emptyStore(), "other", text);
  assert.equal(fresh.store.gyms.other.name, "Other");
  assert.ok(fresh.store.gyms.other.equipment["leg-press"]);
});

test("importMachines rejects files that are not machine lists", () => {
  const s = emptyStore();
  assert.ok(importMachines(s, "main", "nope").error);
  assert.ok(importMachines(s, "main", '{"type":"other"}').error);
  assert.equal(importMachines(s, "main", "nope").count, 0);
});

test("emptyStore starts in the first gym, which is also the default gym", () => {
  const s = emptyStore();
  assert.equal(s.currentGym, "main");
  assert.equal(s.defaultGym, "main");
});

test("cleanStore keeps the default gym, and falls back when it is missing or not a gym", () => {
  const two = (extra) => ({
    version: STORE_VERSION,
    gyms: { main: { name: "A" }, home: { name: "B" } },
    ...extra,
  });
  assert.equal(cleanStore(two({ currentGym: "home", defaultGym: "main" })).defaultGym, "main");
  assert.equal(cleanStore(two({ currentGym: "home", defaultGym: "main" })).currentGym, "home");
  assert.equal(cleanStore(two({ currentGym: "home" })).defaultGym, "home");
  assert.equal(cleanStore(two({ currentGym: "home", defaultGym: "gone" })).defaultGym, "home");
  assert.equal(cleanStore(two({ currentGym: "gone", defaultGym: "home" })).currentGym, "main");
  assert.equal(cleanStore(two({ currentGym: "gone", defaultGym: "gone" })).defaultGym, "main");
  assert.equal(cleanStore({ version: STORE_VERSION }).defaultGym, "main");
});

test("a version 2 store upgrades with its gym as both current and default", () => {
  const s = cleanStore(v2());
  assert.equal(s.currentGym, "main");
  assert.equal(s.defaultGym, "main");
});

test("gymList gives each gym's id and name", () => {
  const s = emptyStore();
  s.gyms.home = newGym("Home gym");
  assert.deepEqual(gymList(s), [{ id: "main", name: "My gym" }, { id: "home", name: "Home gym" }]);
  assert.deepEqual(gymList({}), []);
});

test("addGym adds a blank gym with its own id and does not change the current gym", () => {
  const s = emptyStore();
  const r = addGym(s, "  Holiday Gym ");
  assert.equal(r.id, "holiday-gym");
  assert.equal(r.copied, 0);
  assert.equal(r.store.gyms["holiday-gym"].name, "Holiday Gym");
  assert.deepEqual(r.store.gyms["holiday-gym"].equipment, {});
  assert.equal(r.store.gyms["holiday-gym"].units.stack, "lb");
  assert.equal(r.store.currentGym, "main");
  assert.equal(Object.keys(s.gyms).length, 1);
  assert.equal(addGym(r.store, "Holiday Gym").id, "holiday-gym-2");
  const blank = addGym(s, "   ");
  assert.equal(blank.id, null);
  assert.equal(blank.store, s);
});

test("addGym can copy chosen equipment from another gym, with stacks, and nothing personal", () => {
  const s = migrateLegacy(legacy);
  const r = addGym(s, "Home", { from: "main", ids: ["leg-press", "deadlift", "not-there"] });
  const home = r.store.gyms.home;
  assert.equal(r.copied, 2);
  assert.deepEqual(Object.keys(home.equipment).sort(), ["deadlift", "leg-press"]);
  assert.deepEqual(home.equipment["leg-press"].pins, [10, 20, 35]);
  assert.equal(home.equipment["leg-press"].name, "Leg Press");
  home.equipment["leg-press"].pins.push(99);
  assert.deepEqual(s.gyms.main.equipment["leg-press"].pins, [10, 20, 35]);
  assert.equal(r.store.people, s.people);
  assert.equal(JSON.stringify(r.store.gyms.home).includes("Seat 4"), false);
  const none = addGym(s, "Elsewhere", { from: "missing", ids: ["leg-press"] });
  assert.deepEqual(none.store.gyms.elsewhere.equipment, {});
  assert.equal(none.copied, 0);
});

test("a copied gym gives the screens the copied stacks but none of your settings", () => {
  const s = addGym(migrateLegacy(legacy), "Home", { from: "main", ids: ["leg-press"] }).store;
  const flat = toLegacySettings(s, "awp", "home");
  assert.deepEqual(flat.exercises["leg-press"].pins, [10, 20, 35]);
  assert.equal(flat.exercises["leg-press"].notes, undefined);
  assert.equal(flat.exercises["leg-press"].workHeavy, undefined);
  const saved = applyLegacySettings(s, "awp", "home", { ...flat, exercises: { "leg-press": { ...flat.exercises["leg-press"], notes: "Seat 9" } } });
  assert.equal(saved.people.awp.gyms.home.machines["leg-press"].notes, "Seat 9");
  assert.equal(saved.people.awp.gyms.main.machines["leg-press"].notes, "Seat 4");
  assert.deepEqual(saved.gyms.main, s.gyms.main);
});

test("renameGym changes the name only, and ignores a blank name or an unknown gym", () => {
  const s = emptyStore();
  const r = renameGym(s, "main", "  Town gym ");
  assert.equal(r.gyms.main.name, "Town gym");
  assert.equal(r.gyms.main.equipment, s.gyms.main.equipment);
  assert.equal(s.gyms.main.name, "My gym");
  assert.equal(renameGym(s, "main", "  "), s);
  assert.equal(renameGym(s, "nope", "X"), s);
});

test("setDefaultGym, setCurrentGym and useDefaultGym only accept gyms that exist", () => {
  const s = addGym(emptyStore(), "Home").store;
  assert.equal(setDefaultGym(s, "home").defaultGym, "home");
  assert.equal(setDefaultGym(s, "nope"), s);
  assert.equal(setCurrentGym(s, "home").currentGym, "home");
  assert.equal(setCurrentGym(s, "nope"), s);
  const away = { ...setDefaultGym(s, "home"), currentGym: "main" };
  assert.equal(useDefaultGym(away).currentGym, "home");
  assert.equal(useDefaultGym(s).currentGym, "main");
});

test("migrateLegacy starts in the gym it creates, as both current and default", () => {
  const s = migrateLegacy(legacy, { gymId: "home" });
  assert.equal(s.currentGym, "home");
  assert.equal(s.defaultGym, "home");
  assert.ok(s.gyms.home);
});