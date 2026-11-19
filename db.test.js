import test from "node:test";
import assert from "node:assert/strict";
import { KEYS, openDb, rowsOf, rowOf, putRow, putRows, dropRows } from "./db.js";
import { TABLES, toStoreV4, readStore, readSets } from "./schema4.js";
import { emptyStore, addGym, setPersonal, setNever, setUse, setDefaults } from "./store.js";
import { makeSet } from "./log.js";
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
