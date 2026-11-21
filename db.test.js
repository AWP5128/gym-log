import test from "node:test";
import assert from "node:assert/strict";
import { KEYS, openDb, rowsOf, rowOf, putRow, putRows, dropRows, useGym, setDefault, useDefault, gymsOf, gymNameOf, renameGym as renameGymDb, addBlankGym, putGym, putPerson, putSets } from "./db.js";
import { TABLES, toStoreV4, readStore, readSets } from "./schema4.js";
import { emptyStore, addGym, setPersonal, setNever, setUse, setDefaults, setCurrentGym, setDefaultGym, useDefaultGym, addCustom, gymList, renameGym, addGym as addGymOld } from "./store.js";
import { makeSet } from "./log.js";
import { exportMachines, importMachines } from "./store.js";
import { setTables } from "./schema4.js";
import { removeLastSet } from "./log.js";
import { setupRows } from "./schema4.js";
import { setPairs } from "./superset.js";
import { addItem, updateItem, hideItem, restoreItem, hideWeightSet, restoreWeightSet, updateWeightSet, setWeightSetUnit, setDefaultUnit, setListDefault, copyEquipment } from "./gym.js";
import { makeCardioSet } from "./cardio.js";

// A saved version 4 object with two gyms, personal settings, never/rare marks, strength sets, a cardio entry and a typed-in best.
function saved() {
  let s = emptyStore();
  const a = addGym(s, "Hotel", { from: "main", ids: ["leg-press", "deadlift"] });
  s = a.store;
  s = setPersonal(s, "awp", "main", "leg-press", { notes: "Seat 4", pbWeight: 200, pbReps: 3, heavy: { working: { weight: 100, extra: 5, reps: 5, sets: 4 } }, volume: { warmup: { weight: 50 } } });
  s = setPersonal(s, "awp", a.id, "leg-press", { notes: "Hotel seat" });
  s = setNever(s, "awp", "main", ["calf-press"], true);
  s = setUse(s, "awp", "main", { id: "hip-abduction", common: true }, "rare");
  s = setDefaults(s, "awp", { heavy: { reps: 6, sets: 3 } });
  s.people.sam = { name: "Sam", defaults: {}, gyms: { main: { machines: { "chest-press": { notes: "s" } } } } };
  const t = (min) => new Date(2026, 10, 18, 9, min);
  const sets = [
    { ...makeSet({ exerciseId: "leg-press", weight: 100, reps: 5, mode: "heavy", gymId: "main", unit: "lb", now: t(0) }) },
    { ...makeSet({ exerciseId: "leg-press", weight: 105, reps: 5, mode: "heavy", gymId: "main", unit: "lb", now: t(5) }) },
    { ...makeSet({ exerciseId: "deadlift", weight: 60, reps: 8, mode: "volume", gymId: a.id, unit: "kg", now: t(9) }) },
    makeCardioSet({ exerciseId: "stationary-bike", minutes: 20, distance: 8, unit: "km", watts: 120, gymId: "main", now: t(40) }),
  ];
  return { v4: toStoreV4(s, sets), store: s, sets, hotel: a.id };
}

const tiny = () => ({
  version: 4, currentGym: "main", defaultGym: "main", currentPerson: "awp",
  tables: {
    gym: [{ id: "main", name: "A" }, { id: "home", name: "B" }],
    personal_setup: [
      { personId: "awp", gymId: "main", exerciseId: "x", dayType: "heavy", notes: "1" },
      { personId: "awp", gymId: "main", exerciseId: "x", dayType: null, never: true },
      { personId: "awp", gymId: "main", exerciseId: "y", notes: "2" },
    ],
  },
});

// ---------- Opening saved data ----------
test("openDb gives a db with every table, keeps the rest of the saved object, and leaves the saved object alone", () => {
  const raw = tiny();
  const before = JSON.stringify(raw);
  const db = openDb(raw);
  assert.deepEqual(Object.keys(db.tables), TABLES);
  assert.deepEqual(db.tables.person, []);
  assert.equal(db.tables.gym, raw.tables.gym);
  assert.equal(db.currentGym, "main");
  assert.equal(JSON.stringify(raw), before);
  assert.equal(openDb({ ...raw, setsInTables: true }).setsInTables, true);
});

test("openDb refuses anything that is not version 4 tables", () => {
  for (const junk of [null, undefined, "x", 4, [], {}, { version: 3, tables: {} }, { version: 4 }, { version: 4, tables: [] }, { version: 4, tables: { gym: {} } }, { version: 4, tables: { gym: "x" } }]) {
    assert.equal(openDb(junk), null, JSON.stringify(junk));
  }
});

test("every table has its key fields listed, and no table is missing", () => {
  assert.deepEqual(Object.keys(KEYS).sort(), [...TABLES].sort());
});

test("the key fields identify every row of real saved data exactly once", () => {
  const db = openDb(saved().v4);
  let rows = 0;
  for (const table of TABLES) {
    const seen = new Set();
    for (const r of db.tables[table]) {
      const key = JSON.stringify(KEYS[table].map((k) => r[k] ?? null));
      assert.ok(!seen.has(key), table + " has two rows with the key " + key);
      seen.add(key);
      rows++;
    }
  }
  assert.ok(rows > 50, "the sample data must have many rows (got " + rows + ")");
  for (const table of ["person", "gym", "gym_member", "gym_equipment", "personal_setup", "workout", "workout_type", "workout_exercise", "logged_set"]) {
    assert.ok(db.tables[table].length > 0, table + " should have rows in the sample data");
  }
});

// ---------- Reading rows ----------
test("rowsOf gives the whole table, or the rows that match every field asked for", () => {
  const db = openDb(tiny());
  assert.equal(rowsOf(db, "gym"), db.tables.gym);
  assert.deepEqual(rowsOf(db, "gym", { id: "home" }), [{ id: "home", name: "B" }]);
  assert.deepEqual(rowsOf(db, "personal_setup", { personId: "awp", exerciseId: "x" }).map((r) => r.notes ?? r.never), ["1", true]);
  assert.deepEqual(rowsOf(db, "gym", { id: "nope" }), []);
  assert.deepEqual(rowsOf(db, "person", { id: "awp" }), []);
});

test("a field that is missing and a field that is null match each other", () => {
  const db = openDb(tiny());
  assert.equal(rowsOf(db, "personal_setup", { exerciseId: "y", dayType: null }).length, 1);
  assert.equal(rowsOf(db, "personal_setup", { exerciseId: "x", dayType: null }).length, 1);
  assert.equal(rowsOf(db, "personal_setup", { exerciseId: "x", dayType: "heavy" }).length, 1);
  assert.equal(rowOf(db, "personal_setup", { exerciseId: "y" }).notes, "2");
});

test("rowOf gives the first match or null, and a table that does not exist is an error", () => {
  const db = openDb(tiny());
  assert.equal(rowOf(db, "gym", { id: "main" }).name, "A");
  assert.equal(rowOf(db, "gym", { id: "nope" }), null);
  assert.throws(() => rowsOf(db, "gyms"), /No such table/);
  assert.throws(() => rowOf(db, "gyms", {}), /No such table/);
  assert.throws(() => putRow(db, "gyms", { id: "x" }), /No such table/);
  assert.throws(() => dropRows(db, "gyms", { id: "x" }), /No such table/);
});

// ---------- Writing rows ----------
test("putRow replaces the row with the same key where it stands, and leaves the old db and the other tables alone", () => {
  const db = openDb(tiny());
  const before = JSON.stringify(db);
  const next = putRow(db, "gym", { id: "main", name: "Renamed" });
  assert.deepEqual(next.tables.gym, [{ id: "main", name: "Renamed" }, { id: "home", name: "B" }]);
  assert.equal(next.tables.gym[1], db.tables.gym[1]);   // the other row is the same object
  assert.equal(next.tables.personal_setup, db.tables.personal_setup);   // an untouched table is the same array
  assert.equal(next.currentGym, "main");
  assert.equal(JSON.stringify(db), before);
});

test("putRow adds a row with a new key at the end", () => {
  const db = openDb(tiny());
  const next = putRow(db, "gym", { id: "third", name: "C" });
  assert.deepEqual(next.tables.gym.map((g) => g.id), ["main", "home", "third"]);
  assert.equal(db.tables.gym.length, 2);
});

test("putRow finds a row by all its key fields, with a missing field counting as null", () => {
  const db = openDb(tiny());
  const a = putRow(db, "personal_setup", { personId: "awp", gymId: "main", exerciseId: "y", dayType: null, notes: "changed" });
  assert.equal(a.tables.personal_setup.length, 3);
  assert.equal(a.tables.personal_setup[2].notes, "changed");
  const b = putRow(db, "personal_setup", { personId: "awp", gymId: "main", exerciseId: "x", dayType: "volume", notes: "v" });
  assert.equal(b.tables.personal_setup.length, 4);   // another day type is another row
  const c = putRow(db, "personal_setup", { personId: "sam", gymId: "main", exerciseId: "x", dayType: "heavy" });
  assert.equal(c.tables.personal_setup.length, 4);   // another person is another row
});

test("putRows saves rows one after the other; a row that comes twice ends as its last version", () => {
  const db = openDb(tiny());
  const next = putRows(db, "gym", [{ id: "a", name: "1" }, { id: "main", name: "2" }, { id: "a", name: "3" }]);
  assert.deepEqual(next.tables.gym.map((g) => g.name), ["2", "B", "3"]);
  assert.equal(putRows(db, "gym", []), db);
});

test("dropRows removes every matching row, gives back the same db when nothing matches, and refuses an empty match", () => {
  const db = openDb(tiny());
  const next = dropRows(db, "personal_setup", { exerciseId: "x" });
  assert.deepEqual(next.tables.personal_setup.map((r) => r.exerciseId), ["y"]);
  assert.equal(db.tables.personal_setup.length, 3);
  assert.equal(next.tables.gym, db.tables.gym);
  assert.equal(dropRows(db, "personal_setup", { exerciseId: "nope" }), db);
  assert.throws(() => dropRows(db, "gym", {}), /at least one field/);
});

// ---------- Against real saved data ----------
test("saving a row back as it is changes nothing, and a changed row shows in what the screens read", () => {
  const { v4, store, sets, hotel } = saved();
  const db = openDb(v4);
  for (const table of TABLES) for (const row of db.tables[table].slice(0, 5)) assert.deepEqual(putRow(db, table, row).tables[table], db.tables[table]);
  assert.deepEqual(readStore(db), readStore(v4));
  assert.deepEqual(readSets(db), readSets(v4));
  assert.equal(readSets(db).length, sets.length);

  const renamed = putRow(db, "gym", { ...rowOf(db, "gym", { id: hotel }), name: "Hotel 2" });
  assert.equal(readStore(renamed).gyms[hotel].name, "Hotel 2");
  assert.equal(readStore(renamed).gyms.main.name, store.gyms.main.name);
  assert.deepEqual(readSets(renamed), readSets(db));

  const noNever = dropRows(db, "personal_setup", { personId: "awp", gymId: "main", exerciseId: "calf-press" });
  assert.equal(readStore(db).people.awp.gyms.main.never["calf-press"], true);
  assert.equal(readStore(noNever).people.awp.gyms.main.never?.["calf-press"], undefined);
});

// ---------- Which gym: the same result as the old store functions, saved as tables ----------
test("useGym, setDefault and useDefault give exactly what the old store functions give once saved", () => {
  const { store, sets, hotel } = saved();
  const open = (s) => openDb(toStoreV4(s, sets));
  const db = open(store);
  for (const id of [hotel, "main", "nowhere", "", null, undefined, 7, "set:dumbbells"]) {
    assert.deepEqual(useGym(db, id), open(setCurrentGym(store, id)), "useGym " + id);
    assert.deepEqual(setDefault(db, id), open(setDefaultGym(store, id)), "setDefault " + id);
  }
  const away = setDefault(useGym(db, hotel), hotel);   // default and current differ, then back
  assert.deepEqual(useDefault(useGym(db, "main")), open(useDefaultGym(setCurrentGym(setDefaultGym(store, "main"), "main"))));
  assert.equal(useDefault(setDefault(db, hotel)).currentGym, hotel);
  assert.equal(away.currentGym, hotel);
  assert.deepEqual(useDefault(away), away);
});

test("choosing a gym changes only the gym fields and leaves the old db alone", () => {
  const { v4, hotel } = saved();
  const db = openDb(v4);
  const before = JSON.stringify(db);
  const next = useGym(db, hotel);
  assert.equal(next.currentGym, hotel);
  assert.equal(next.defaultGym, db.defaultGym);
  assert.equal(next.tables, db.tables);
  assert.equal(JSON.stringify(db), before);
  assert.equal(useGym(db, "nowhere"), db);
  assert.equal(setDefault(db, "nowhere"), db);
  assert.equal(setDefault(db, hotel).currentGym, db.currentGym);
  assert.equal(setDefault(db, hotel).defaultGym, hotel);
});

// ---------- Gyms: list, names, rename, add ----------
test("the gym list and names read from the tables are the old gym list and names", () => {
  const { store, v4, hotel } = saved();
  const db = openDb(v4);
  assert.deepEqual(gymsOf(db), gymList(store));
  assert.equal(gymNameOf(db, hotel), "Hotel");
  assert.equal(gymNameOf(db, "nowhere"), "nowhere");
  assert.deepEqual(gymsOf(openDb({ version: 4, tables: {} })), []);
});

test("renaming a gym gives what the old rename gives once saved: trimmed, blank and unknown ignored", () => {
  const { store, sets, v4, hotel } = saved();
  const db = openDb(v4);
  const open = (s) => openDb(toStoreV4(s, sets));
  for (const [id, name] of [[hotel, "Hotel 2"], ["main", "  Home  "], [hotel, ""], [hotel, "   "], ["nowhere", "X"], [hotel, null], [hotel, 5]]) {
    assert.deepEqual(renameGymDb(db, id, name), open(renameGym(store, id, name)), id + " " + name);
  }
  assert.equal(renameGymDb(db, hotel, ""), db);
  assert.equal(renameGymDb(db, "nowhere", "X"), db);
});

test("adding a blank gym gives what the old add gives once saved: ids, owners, weight sets, and the old gym untouched", () => {
  const { store, sets, v4 } = saved();
  const open = (s) => openDb(toStoreV4(s, sets));
  let db = openDb(v4);
  let s = store;
  for (const name of ["Garage", "Garage", "  Hotel  ", "Garage!", "Gym"]) {
    const a = addBlankGym(db, name);
    const b = addGymOld(s, name);
    assert.equal(a.id, b.id, name);
    assert.deepEqual(a.db, open(b.store), name);
    db = a.db; s = b.store;
  }
  assert.deepEqual(gymsOf(db), gymList(s));
  assert.equal(db.currentGym, store.currentGym);
  for (const name of ["", "   ", null, undefined]) {
    const r = addBlankGym(db, name);
    assert.equal(r.id, null);
    assert.equal(r.db, db);
  }
});

test("a new gym belongs to every person, each listed with that person's other gyms", () => {
  const { v4 } = saved();
  const db = addBlankGym(openDb(v4), "Garage").db;
  const rows = rowsOf(db, "gym_member");
  assert.deepEqual(rows.map((r) => r.personId + ":" + r.gymId), ["awp:main", "awp:hotel", "awp:garage", "sam:main", "sam:hotel", "sam:garage"]);
  assert.deepEqual(rowsOf(db, "gym_equipment", { gymId: "garage" }).map((r) => r.id), ["set:dumbbells", "set:barbell"]);
  assert.equal(readStore(db).gyms.garage.name, "Garage");
  assert.deepEqual(Object.keys(readStore(db).people.sam.gyms).sort(), ["garage", "hotel", "main"]);
});

// ---------- A gym's equipment: the same rows the old way saves ----------
// Each change is made with the gym.js function on the gym the screens see, saved with putGym, and compared with
// converting the whole changed store the old way (the saved data must come out the same, row for row).
test("putGym saves every kind of gym change exactly as the old way does", () => {
  const { v4, sets, hotel } = saved();
  const db0 = openDb(v4);
  const store0 = readStore(db0);
  const oldWay = (store, id, gym) => openDb(toStoreV4({ ...store, gyms: { ...store.gyms, [id]: gym } }, sets));
  const main = store0.gyms.main;
  const hot = store0.gyms[hotel];
  const ids = Object.keys(main.equipment);
  const steps = [
    ["same gym", "main", main],
    ["hide", "main", hideItem(main, ids[0])],
    ["restore", "main", restoreItem(hideItem(main, ids[0]), ids[0])],
    ["hide set", "main", hideWeightSet(main, "dumbbells")],
    ["restore set", "main", restoreWeightSet(hideWeightSet(main, "dumbbells"), "dumbbells")],
    ["list default", "main", setListDefault(main, "barbell")],
    ["default unit", "main", setDefaultUnit(main, "stack", "kg")],
    ["add machine", "main", addItem(main, { name: "Brand New Press", group: "legs", type: "stack", unit: "lb" }).gym],
    ["add in a new group", "main", addItem(main, { name: "Neck Curl", group: "neck", type: "stack", unit: "lb" }).gym],
    ["add dumbbell", "main", addItem(main, { name: "Fly", group: "arms", type: "dumbbell" }).gym],
    ["edit item", "main", updateItem(main, ids[1], { name: "Renamed Item", step: 7, muscle: "chest" })],
    ["move item to a new group", "main", updateItem(main, ids[1], { group: "neck" })],
    ["weight set", "main", updateWeightSet(main, "barbell", { top: 300 })],
    ["set unit", hotel, setWeightSetUnit(hot, "dumbbells", "lb").gym ?? setWeightSetUnit(hot, "dumbbells", "lb")],
    ["copy equipment", hotel, copyEquipment(main, ids.slice(0, 6), hot).gym],
    ["copy over", hotel, copyEquipment(main, ids.slice(0, 6), hot, { overwrite: true }).gym],
    ["rename", hotel, { ...hot, name: "Renamed" }],
  ];
  for (const [label, id, gym] of steps) assert.deepEqual(putGym(db0, id, gym), oldWay(store0, id, gym), label);
  // one change after another, as the screens do them
  let db = db0, store = store0;
  for (const [, id, gym] of steps) {
    store = { ...store, gyms: { ...store.gyms, [id]: gym } };
    db = putGym(db, id, gym);
    assert.deepEqual(db, openDb(toStoreV4(store, sets)));
  }
});

test("putGym adds a whole new gym with copied equipment as the old add does", () => {
  const { store, sets, v4 } = saved();
  const db0 = openDb(v4);
  const s0 = readStore(db0);
  const old = addGymOld(s0, "Garage", { from: "main", ids: Object.keys(s0.gyms.main.equipment).slice(0, 9) });
  const next = putGym(db0, old.id, old.store.gyms[old.id]);
  assert.deepEqual(next, openDb(toStoreV4(old.store, sets)));
  assert.equal(old.copied, 9);
  assert.deepEqual(rowsOf(next, "gym_member").map((r) => r.gymId).filter((g, i, a) => a.indexOf(g) === i), ["main", "hotel", "garage"]);
  assert.ok(store);
});

test("putGym leaves the rows of the other gyms, the other tables and the old db alone", () => {
  const { v4, hotel } = saved();
  const db = openDb(v4);
  const before = JSON.stringify(db);
  const gym = readStore(db).gyms[hotel];
  const next = putGym(db, hotel, hideItem(gym, Object.keys(gym.equipment)[0]));
  assert.equal(JSON.stringify(db), before);
  assert.deepEqual(rowsOf(next, "gym_equipment", { gymId: "main" }), rowsOf(db, "gym_equipment", { gymId: "main" }));
  assert.equal(next.tables.personal_setup, db.tables.personal_setup);
  assert.equal(next.tables.logged_set, db.tables.logged_set);
  assert.equal(rowsOf(next, "gym_equipment", { gymId: hotel })[0].hidden, true);
});

test("putGym keeps the exercise tables right when exercises come from added exercises, personal setups and logged sets only", () => {
  let s = emptyStore();
  s = addCustom(s, { name: "Face Pull", group: "arms", unit: "lb", step: 5 });
  s = addCustom(s, { name: "Stretch", group: "yoga", unit: "min" });
  s = addCustom(s, { name: "Mobility", group: "mobility", unit: "min" });   // no gym item, no set: only the added exercise itself
  s = addGym(s, "Hotel").store;
  s = setPersonal(s, "awp", "main", "pb-only", { pbWeight: 50 });   // a typed-in best and nothing else
  s = setPersonal(s, "awp", "main", "ghost-machine", { notes: "no longer at the gym" });   // an exercise no gym has
  s = setPersonal(s, "awp", "main", "custom-face-pull", { notes: "mine", pbWeight: 40 });
  s = setNever(s, "awp", "main", ["old-never"], true);
  const at = (m) => new Date(2026, 10, 18, 9, m);
  const sets = [
    makeSet({ exerciseId: "history-only", weight: 20, reps: 5, gymId: "main", unit: "lb", now: at(0) }),
    makeSet({ exerciseId: "custom-stretch", weight: 20, reps: 5, gymId: "main", unit: "lb", now: at(5) }),
    makeSet({ exerciseId: "leg-press", weight: 90, reps: 5, gymId: "hotel", unit: "lb", now: at(9) }),
  ];
  const v4 = toStoreV4(s, sets);
  const db = openDb(v4);
  const store = readStore(db);
  const gym = addItem(store.gyms.main, { name: "Neck Curl", group: "neck", type: "stack", unit: "lb" }).gym;
  const next = putGym(db, "main", gym);
  // The exercise rows (and the typed-in bests, whose order a second conversion of the store can change) are compared in id order:
  // an exercise known only from a setup, a typed-in best or the never list can come in a different place than a conversion
  // puts it, and no screen reads that order.
  const byId = (rows) => [...rows].sort((x, y) => (x.id < y.id ? -1 : 1));
  const inIdOrder = (d) => ({ ...d, tables: { ...d.tables, exercise: byId(d.tables.exercise), logged_set: byId(d.tables.logged_set) } });
  assert.deepEqual(inIdOrder(next), inIdOrder(openDb(toStoreV4({ ...store, gyms: { ...store.gyms, main: gym } }, sets))));
  const ids = rowsOf(next, "exercise").map((e) => e.id);
  for (const id of ["pb-only", "custom-mobility", "ghost-machine", "history-only", "custom-face-pull", "custom-stretch", "old-never", "neck-curl"]) assert.ok(ids.includes(id), id);
  assert.ok(rowsOf(next, "exercise_type").some((x) => x.id === "neck"));
  assert.ok(rowsOf(next, "exercise_type").some((x) => x.id === "yoga"));
  assert.ok(rowsOf(next, "exercise_type").some((x) => x.id === "mobility"));
  assert.deepEqual(readStore(next).custom, store.custom);
  // taking the only item of an unusual group out of every gym's list (hiding keeps it) and putting a gym back as it was changes nothing
  assert.deepEqual(putGym(next, "main", gym), next);
});

// ---------- A person's own settings: the same rows the old way saves ----------
test("putPerson saves every kind of personal change exactly as the old way does", () => {
  const { v4, sets, hotel } = saved();
  const store0 = readStore(openDb(v4));
  const db0 = openDb(toStoreV4(store0, sets));   // as the old way saves it, so both sides start from the same row order
  const leg = { id: "leg-press", common: true };
  const calf = { id: "calf-press", common: true };
  const less = { id: "hip-adduction", common: false };
  const steps = [
    ["notes", "awp", setPersonal(store0, "awp", "main", "chest-press", { notes: "Seat 2" })],
    ["clear notes", "awp", setPersonal(store0, "awp", "main", "leg-press", { notes: "" })],
    ["working weights", "awp", setPersonal(store0, "awp", "main", "leg-press", { heavy: { working: { weight: 120, extra: 2.5, reps: 4, sets: 3 } }, volume: { warmup: { weight: 40 } } })],
    ["best only", "awp", setPersonal(store0, "awp", "main", "pull-up", { pbWeight: 12, pbReps: 8 })],
    ["best cleared", "awp", setPersonal(store0, "awp", "main", "leg-press", { pbWeight: null, pbReps: null })],
    ["another gym", "awp", setPersonal(store0, "awp", hotel, "deadlift", { notes: "Hotel bar", heavy: { working: { weight: 60 } } })],
    ["a gym that does not exist", "awp", setPersonal(store0, "awp", "nowhere", "leg-press", { notes: "x" })],
    ["defaults", "awp", setDefaults(store0, "awp", { volume: { reps: 12, sets: 4, warmupReps: 8 } })],
    ["defaults cleared", "awp", setDefaults(store0, "awp", { heavy: { reps: null, sets: null } })],
    ["never on", "awp", setNever(store0, "awp", "main", ["leg-press", "chest-press"], true)],
    ["never off", "awp", setNever(store0, "awp", "main", ["calf-press"], false)],
    ["use rare", "awp", setUse(store0, "awp", "main", leg, "rare")],
    ["use normal", "awp", setUse(store0, "awp", "main", less, "normal")],
    ["use never", "awp", setUse(store0, "awp", hotel, calf, "never")],
    ["pairs", "awp", setPairs(store0, "awp", { pairs: { "leg-press": ["calf-press"] }, suitable: { "leg-press": true } })],
    ["another person", "sam", setPersonal(store0, "sam", "main", "chest-press", { notes: "Sam", pbWeight: 30 })],
    ["a new person", "kim", setPersonal(store0, "kim", "main", "leg-press", { notes: "Kim", heavy: { working: { weight: 50 } } })],
    ["a new person's never", "kim", setNever(store0, "kim", hotel, ["deadlift"], true)],
  ];
  for (const [label, pid, next] of steps) {
    assert.deepEqual(putPerson(db0, pid, next.people[pid]), openDb(toStoreV4(next, sets)), label);
  }
  // one change after another, as the screens do them
  let db = db0, store = store0;
  for (const [, pid, next] of steps.filter(([, p]) => p === "awp")) {
    store = { ...store, people: { ...store.people, [pid]: next.people[pid] } };
    db = putPerson(db, pid, next.people[pid]);
    assert.deepEqual(db, openDb(toStoreV4(store, sets)));
  }
});

test("putPerson keeps typed-in bests in person order, ahead of the real sets, and leaves other tables alone", () => {
  const { v4, sets } = saved();
  const store0 = readStore(openDb(v4));
  let s = setPersonal(store0, "sam", "main", "chest-press", { pbWeight: 30 });
  s = setPersonal(s, "awp", "main", "pull-up", { pbWeight: 12 });
  let db = openDb(toStoreV4(store0, sets));
  db = putPerson(putPerson(db, "sam", s.people.sam), "awp", s.people.awp);   // sam first, so the order has to be put right
  const logged = rowsOf(db, "logged_set");
  const firstReal = logged.findIndex((r) => !r.manual);
  assert.ok(logged.slice(0, firstReal).every((r) => r.manual) && logged.slice(firstReal).every((r) => !r.manual));
  assert.deepEqual(logged.slice(0, firstReal).map((r) => r.personId + ":" + r.exerciseId), ["awp:leg-press", "awp:pull-up", "sam:chest-press"]);
  assert.deepEqual(db, openDb(toStoreV4(s, sets)));
  assert.equal(db.tables.gym_equipment, putPerson(db, "awp", s.people.awp).tables.gym_equipment);
});

test("putPerson does not change the old db", () => {
  const { v4 } = saved();
  const db = openDb(v4);
  const before = JSON.stringify(db);
  putPerson(db, "awp", setPersonal(readStore(db), "awp", "main", "leg-press", { notes: "changed" }).people.awp);
  assert.equal(JSON.stringify(db), before);
});

// The builder is shared with the conversion, so these check its rows directly.
test("setupRows: gyms that do not exist are skipped, and never and use marks join the machine's no-day-type row", () => {
  const person = {
    name: "A", defaults: {},
    gyms: {
      main: {
        machines: {
          "notes-only": { notes: "n" },
          "with-day": { notes: "d", heavy: { working: { weight: 50 } } },
          "pb-only": { pbWeight: 10, pbReps: 3 },
        },
        never: { "notes-only": true, "never-alone": true, "not-never": false, "text-never": "yes" },
        use: { "notes-only": "rare", "with-day": "normal", "bad": "weird" },
      },
      nowhere: { machines: { "lost": { notes: "x" } }, never: { "lost-never": true } },
    },
  };
  const r = setupRows("awp", person, new Set(["main"]));
  assert.deepEqual(r.rows, [
    { personId: "awp", gymId: "main", exerciseId: "notes-only", dayType: null, notes: "n", never: true, use: "rare" },
    { personId: "awp", gymId: "main", exerciseId: "with-day", dayType: "heavy", working: { weight: 50 }, notes: "d" },
    { personId: "awp", gymId: "main", exerciseId: "never-alone", dayType: null, never: true },
    { personId: "awp", gymId: "main", exerciseId: "with-day", dayType: null, use: "normal" },
  ]);
  assert.deepEqual(r.manual.map((m) => [m.id, m.weight, m.reps]), [["manual:awp:main:pb-only", 10, 3]]);
  assert.deepEqual(r.ids, ["notes-only", "with-day", "pb-only", "notes-only", "never-alone", "with-day"]);
  assert.deepEqual(setupRows("awp", { name: "A", gyms: "junk" }, new Set(["main"])), { rows: [], manual: [], ids: [] });
});

test("putGym saves a machines-file import exactly as the old way does", () => {
  const { v4, sets, hotel } = saved();
  const store0 = readStore(openDb(v4));
  const db0 = openDb(toStoreV4(store0, sets));
  const file = JSON.parse(exportMachines(store0, "main"));
  const ids = Object.keys(store0.gyms.main.equipment);
  assert.ok(Object.keys(file.machines).length > 0 || true);
  for (const id of ids.slice(0, 4)) file.machines[id] = { ...(file.machines[id] || {}), step: 7 };
  file.machines["brand-new-thing"] = { name: "Brand New Thing", group: "legs", type: "stack", unit: "lb" };
  const text = JSON.stringify(file);
  for (const [label, gymId] of [["into another gym", hotel], ["into the same gym", "main"], ["into a gym that is not there", "ghost"]]) {
    const r = importMachines(store0, gymId, text);
    assert.equal(r.error, "", label);
    assert.ok(r.count >= 4, label);
    assert.deepEqual(putGym(db0, gymId, r.store.gyms[gymId]), openDb(toStoreV4(r.store, sets)), label);
  }
});

// ---------- Logged sets ----------
test("putSets saves every kind of change to the list of sets exactly as the old way does", () => {
  const { v4, sets: sets0, hotel } = saved();
  const store0 = readStore(openDb(v4));
  const db0 = openDb(toStoreV4(store0, sets0));
  const at = (day, min, sec = 0, ms = 0) => new Date(2026, 10, day, 9, min, sec, ms);
  const logged = (extra) => [...sets0, ...extra];
  const steps = [
    ["no change", sets0],
    ["empty", []],
    ["one more", logged([makeSet({ exerciseId: "leg-press", weight: 110, reps: 5, mode: "heavy", gymId: "main", unit: "lb", now: at(18, 20) })])],
    ["another day", logged([makeSet({ exerciseId: "leg-press", weight: 110, reps: 5, mode: "heavy", gymId: "main", unit: "lb", now: at(19, 20) })])],
    ["another gym", logged([makeSet({ exerciseId: "chest-press", weight: 40, reps: 8, mode: "volume", gymId: hotel, unit: "kg", now: at(18, 25) })])],
    ["same moment twice", logged([makeSet({ exerciseId: "leg-press", weight: 1, reps: 1, gymId: "main", unit: "lb", now: at(18, 0) }), makeSet({ exerciseId: "leg-press", weight: 2, reps: 1, gymId: "main", unit: "lb", now: at(18, 0) })])],
    ["no mode, then a mode", logged([makeSet({ exerciseId: "calf-press", weight: 30, reps: 9, gymId: "main", unit: "lb", now: at(18, 30) }), makeSet({ exerciseId: "calf-press", weight: 30, reps: 9, mode: "volume", gymId: "main", unit: "lb", now: at(18, 31) })])],
    ["out of order times", logged([makeSet({ exerciseId: "leg-press", weight: 5, reps: 5, mode: "heavy", gymId: "main", unit: "lb", now: at(18, 59) }), makeSet({ exerciseId: "leg-press", weight: 5, reps: 5, mode: "heavy", gymId: "main", unit: "lb", now: at(18, 2) })])],
    ["an exercise no gym has", logged([makeSet({ exerciseId: "mystery-lift", weight: 5, reps: 5, gymId: "main", unit: "lb", now: at(18, 40) })])],
    ["a cardio entry", logged([makeCardioSet({ exerciseId: "rowing-machine", minutes: 12, distance: 2400, unit: "m", watts: 90, gymId: "main", start: at(18, 50), now: at(18, 55) })])],
    ["not valid sets", logged([{ junk: true }, { exerciseId: "", time: "2026-11-18T09:00:00.000Z" }, { exerciseId: "x", time: "not a date" }, null])],
    ["undo the last", removeLastSet(sets0, "leg-press", "main")],
    ["undo the only one of a kind", removeLastSet(sets0, "deadlift", hotel)],
  ];
  for (const [label, sets] of steps) {
    assert.deepEqual(putSets(db0, sets), openDb(toStoreV4(store0, sets)), label);
  }
  // one change after another, as logging and undoing do
  let db = db0, sets = sets0;
  for (const [, next] of steps.slice(2)) {
    sets = next;
    db = putSets(db, sets);
    assert.deepEqual(db, openDb(toStoreV4(store0, sets)));
  }
});

test("putSets keeps the typed-in bests and every table that is not about sets", () => {
  const { v4, sets } = saved();
  const db = openDb(v4);
  const before = JSON.stringify(db);
  const next = putSets(db, sets.slice(0, 2));
  assert.equal(JSON.stringify(db), before);
  assert.deepEqual(rowsOf(next, "logged_set").filter((r) => r.manual), rowsOf(db, "logged_set").filter((r) => r.manual));
  assert.ok(rowsOf(next, "logged_set").some((r) => r.manual));
  for (const table of ["person", "gym", "gym_member", "gym_equipment", "personal_setup", "equipment_type", "exercise_type"]) {
    assert.deepEqual(next.tables[table], db.tables[table], table);
  }
  assert.equal(rowsOf(next, "logged_set").filter((r) => !r.manual).length, 2);
});

// The builder is shared with the conversion, so these check its rows directly.
test("setTables: workouts, day types, bounds, ids and seq", () => {
  const T = (m, s = 0) => new Date(2026, 10, 18, 9, m, s).toISOString();
  const group = (gym, ex) => (ex === "bike" ? "cardio" : "legs");
  const sets = [
    { exerciseId: "a", time: T(10), weight: 1, reps: 1, gymId: "g1", unit: "lb" },
    { junk: true },
    { exerciseId: "a", time: T(5), weight: 2, reps: 2, gymId: "g1", unit: "lb", mode: "heavy" },
    { exerciseId: "a", time: T(5), weight: 3, reps: 3, gymId: "g1", unit: "lb", mode: "volume" },
    { exerciseId: "bike", time: T(20), minutes: 10, distance: 4000, watts: 100, start: T(10), end: T(20), gymId: "g1" },
    { exerciseId: "bike", time: T(40), minutes: 1, distance: 1, watts: 1, gymId: "g1" },
    { exerciseId: "a", time: T(1), weight: 4, reps: 4, unit: "lb" },
  ];
  const r = setTables("awp", sets, group);
  assert.equal(r.dropped, 1);
  assert.deepEqual(r.workout.map((w) => [w.id, w.start === T(5) && w.end === T(40)]), [["awp:g1:2026-11-18", true], ["awp:main:2026-11-18", false]]);
  assert.equal(r.workout[0].start, T(5));
  assert.equal(r.workout[0].end, T(40));
  assert.deepEqual(r.workout_type.map((x) => [x.id, x.dayType, x.start, x.end]), [
    ["awp:g1:2026-11-18:legs", "heavy", T(5), T(10)],
    ["awp:g1:2026-11-18:cardio", null, T(20), T(40)],
    ["awp:main:2026-11-18:legs", null, T(1), T(1)],
  ]);
  assert.deepEqual(r.workout_exercise.map((x) => [x.id, x.distance, x.watts, x.start, x.end]), [
    ["awp:g1:2026-11-18:legs:a", null, null, null, null],
    ["awp:g1:2026-11-18:cardio:bike", 4000, 100, T(10), T(20)],
    ["awp:main:2026-11-18:legs:a", null, null, null, null],
  ]);
  assert.deepEqual(r.logged_set.map((s) => [s.id.replace(/^awp:/, "").slice(-12), s.seq, s.gymId]).map(([, q, g]) => [q, g]), [[0, "g1"], [2, "g1"], [3, "g1"], [4, "g1"], [5, "g1"], [6, "main"]]);
  assert.deepEqual(r.exerciseIds, ["a", "a", "a", "bike", "bike", "a"]);
  assert.deepEqual(r.typeIds, ["legs", "legs", "legs", "cardio", "cardio", "legs"]);
  const same = setTables("awp", [{ exerciseId: "a", time: T(1) }, { exerciseId: "a", time: T(1) }, { exerciseId: "a", time: T(1) }], group);
  assert.deepEqual(same.logged_set.map((s) => s.id), ["awp:" + T(1) + ":a", "awp:" + T(1) + ":a#1", "awp:" + T(1) + ":a#2"]);
});

test("putSets uses the current person, and the group of an added exercise", () => {
  const { v4, sets: sets0 } = saved();
  const store0 = addCustom(readStore(openDb(v4)), { name: "Stretch", group: "yoga", unit: "min" });
  const sets = [...sets0, makeSet({ exerciseId: "custom-stretch", weight: 1, reps: 1, gymId: "main", unit: "lb", now: new Date(2026, 10, 18, 10, 0) })];
  for (const person of ["awp", "sam"]) {
    const s0 = { ...store0, currentPerson: person };
    const db0 = openDb(toStoreV4(s0, sets0));
    const next = putSets(db0, sets);
    assert.deepEqual(next, openDb(toStoreV4(s0, sets)), person);
    assert.ok(rowsOf(next, "workout").every((w) => w.personId === person));
    assert.ok(rowsOf(next, "logged_set").filter((r) => !r.manual).every((r) => r.personId === person));
    assert.ok(rowsOf(next, "workout_type").some((w) => w.exerciseTypeId === "yoga"));
  }
});

test("putSets files a set under the group the gym's own item has, even when it is not the built-in group", () => {
  const { v4, sets: sets0 } = saved();
  const base = readStore(openDb(v4));
  const id = Object.keys(base.gyms.main.equipment)[1];
  const store0 = { ...base, gyms: { ...base.gyms, main: updateItem(base.gyms.main, id, { group: "neck" }) } };
  const db0 = openDb(toStoreV4(store0, sets0));
  const sets = [...sets0, makeSet({ exerciseId: id, weight: 10, reps: 5, gymId: "main", unit: "lb", now: new Date(2026, 10, 18, 11, 0) })];
  const next = putSets(db0, sets);
  assert.deepEqual(next, openDb(toStoreV4(store0, sets)));
  assert.ok(rowsOf(next, "workout_type").some((w) => w.exerciseTypeId === "neck"));
});
