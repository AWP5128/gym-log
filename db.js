// The saved data as tables, held in memory exactly as saved (stage D of the refactor). Pure (no browser calls).
//
// A "db" is the saved version 4 object itself: { version: 4, currentGym, defaultGym, currentPerson, tables: { person: [rows], ... } }
// (see schema4.js for what each table holds). Nothing here changes a db in place: every write gives a new db that shares
// every table it did not touch with the old one, so a screen can tell by `===` that a table is unchanged.
// A row is found by its key fields (KEYS). A row's other fields are whatever schema4.js saves; this file does not look at them.

import { TABLES, SCHEMA_VERSION, gymFromRows, customFromRows, personFromRows, gymRow, equipmentRows, exerciseTables, personRow, setupRows, setTables, groupLookup } from "./schema4.js";
import { cleanGym } from "./store.js";

// The fields that identify a row in each table (a field that is missing counts as null, as dayType does on a person's
// per-machine row that is not for one day type).
export const KEYS = {
  person: ["id"],
  gym: ["id"],
  gym_member: ["personId", "gymId"],
  gym_equipment: ["gymId", "id"],
  equipment_type: ["id"],
  exercise_type: ["id"],
  exercise: ["id"],
  personal_setup: ["personId", "gymId", "exerciseId", "dayType"],
  workout: ["id"],
  workout_type: ["id"],
  workout_exercise: ["id"],
  logged_set: ["id"],
};

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const same = (a, b) => (a ?? null) === (b ?? null);

// The saved data as a db, or null when it is not version 4 tables. A table the saved data lacks is empty.
export function openDb(raw) {
  if (!isObj(raw) || raw.version !== SCHEMA_VERSION || !isObj(raw.tables)) return null;
  const tables = {};
  for (const t of TABLES) {
    const rows = raw.tables[t];
    if (rows !== undefined && !Array.isArray(rows)) return null;
    tables[t] = rows ?? [];
  }
  return { ...raw, tables };
}

const rowsIn = (db, table) => {
  if (!KEYS[table]) throw new Error("No such table: " + table);
  return db.tables[table] ?? [];
};
const matches = (row, where) => Object.entries(where).every(([k, v]) => same(row[k], v));

// Every row of a table whose fields equal the ones in `where` (no `where` gives the whole table).
export const rowsOf = (db, table, where = {}) => {
  const rows = rowsIn(db, table);
  return Object.keys(where).length ? rows.filter((r) => matches(r, where)) : rows;
};

// The first row that matches, or null.
export const rowOf = (db, table, where) => rowsIn(db, table).find((r) => matches(r, where)) ?? null;

// The same db with `row` saved: it replaces the row with the same key where it stands, or is added at the end.
export function putRow(db, table, row) {
  const rows = rowsIn(db, table);
  const key = Object.fromEntries(KEYS[table].map((k) => [k, row[k]]));
  const at = rows.findIndex((r) => matches(r, key));
  const next = at === -1 ? [...rows, row] : rows.map((r, i) => (i === at ? row : r));
  return { ...db, tables: { ...db.tables, [table]: next } };
}

// Several rows saved one after the other (a row that comes twice ends up as its last version).
export const putRows = (db, table, rows) => rows.reduce((d, r) => putRow(d, table, r), db);

// The same db without the rows that match `where`; the same db object when none matched.
export function dropRows(db, table, where) {
  if (!Object.keys(where).length) throw new Error("dropRows needs at least one field to match (it would drop the whole table)");
  const rows = rowsIn(db, table);
  const kept = rows.filter((r) => !matches(r, where));
  return kept.length === rows.length ? db : { ...db, tables: { ...db.tables, [table]: kept } };
}

// ---------- Which gym and which person (the saved data's own fields, not table rows) ----------
// Each gives the same db when the gym does not exist, as a choice of an unknown gym is ignored.
const hasGym = (db, id) => typeof id === "string" && rowOf(db, "gym", { id }) !== null;

// The gym in use now.
export const useGym = (db, id) => (hasGym(db, id) ? { ...db, currentGym: id } : db);

// The gym the app starts in.
export const setDefault = (db, id) => (hasGym(db, id) ? { ...db, defaultGym: id } : db);

// Back to the default gym.
export const useDefault = (db) => useGym(db, db.defaultGym);

// ---------- Gyms (the gym table; a gym's equipment rows come with the equipment, later) ----------
// The gyms as the screens list them: [{ id, name }].
export const gymsOf = (db) => rowsOf(db, "gym").map((g) => ({ id: g.id, name: g.name }));

// A gym's name (its id when there is no such gym).
export const gymNameOf = (db, id) => rowOf(db, "gym", { id })?.name ?? id;

// A blank name or an unknown gym leaves the db as it was.
export function renameGym(db, id, name) {
  const clean = String(name ?? "").trim();
  const gym = rowOf(db, "gym", { id });
  if (!gym || !clean) return db;
  return putRow(db, "gym", { ...gym, name: clean });
}

// Every person owns the gym: a member row after that person's other gyms, as a conversion lists them.
const withMembers = (db, gymId) => {
  let next = db;
  for (const p of rowsOf(next, "person")) {
    const rows = rowsOf(next, "gym_member");
    if (rows.some((r) => r.personId === p.id && r.gymId === gymId)) continue;
    const last = rows.map((r) => r.personId).lastIndexOf(p.id);
    const member = { personId: p.id, gymId, role: "owner", status: "active", offTypes: [] };
    const list = last === -1 ? [...rows, member] : [...rows.slice(0, last + 1), member, ...rows.slice(last + 1)];
    next = { ...next, tables: { ...next.tables, gym_member: list } };
  }
  return next;
};

// ---------- A gym's equipment ----------
// Saves a gym as the gym functions in gym.js give it ({ name, units, equipment, weightSets, ... }): its gym row, its equipment
// rows (kept where the gym's old ones were, so the list order does not change), the owner rows of a new gym, and the
// exercise and exercise_type tables, which depend on what every gym has. This is the one way equipment is written.
export function putGym(db, id, rawGym) {
  const gym = cleanGym(rawGym);   // a gym is tidied up before it is saved, as when a store is read (adds the starter marks to a gym that lacks them)
  let next = putRow(db, "gym", gymRow(id, gym));
  next = withMembers(next, id);
  const rows = rowsOf(next, "gym_equipment");
  const at = rows.findIndex((r) => r.gymId === id);
  const kept = rows.filter((r) => r.gymId !== id);
  const place = at === -1 ? kept.length : at;   // the rows before the gym's first old row are all kept
  next = { ...next, tables: { ...next.tables, gym_equipment: [...kept.slice(0, place), ...equipmentRows(id, gym), ...kept.slice(place)] } };
  const { exercise, exercise_type } = exerciseTables(next.tables);
  return { ...next, tables: { ...next.tables, exercise, exercise_type } };
}

// ---------- A person's own settings ----------
// Rows of a table that match `pred` are replaced by `rows`, where the first old one stood (at the end when there was none).
const replaceBlock = (db, table, pred, rows) => {
  const old = rowsOf(db, table);
  const at = old.findIndex(pred);
  const kept = old.filter((r) => !pred(r));
  const place = at === -1 ? kept.length : at;   // the rows before the first old one are all kept
  return { ...db, tables: { ...db.tables, [table]: [...kept.slice(0, place), ...rows, ...kept.slice(place)] } };
};

// Saves a person as the store functions give them ({ name, defaults, gyms: { gymId: { machines, never, use } }, superset }):
// the person row, the personal_setup rows and typed-in bests (in the order a conversion lists them), the owner rows of a new
// person, and the exercise and exercise_type tables. Setups for a gym that does not exist are not saved, as in a conversion.
export function putPerson(db, id, person) {
  const isNew = !rowOf(db, "person", { id });
  let next = putRow(db, "person", personRow(id, person));
  if (isNew) {
    const members = rowsOf(next, "gym").map((g) => ({ personId: id, gymId: g.id, role: "owner", status: "active", offTypes: [] }));
    next = putRows(next, "gym_member", members);
  }
  const { rows, manual } = setupRows(id, person, new Set(rowsOf(next, "gym").map((g) => g.id)));
  next = replaceBlock(next, "personal_setup", (r) => r.personId === id, rows);
  // typed-in bests come first in logged_set, person by person, ahead of the real sets
  const logged = rowsOf(next, "logged_set");
  const bests = logged.filter((r) => r.manual === true);
  const people = rowsOf(next, "person").map((p) => p.id);
  const ordered = people.flatMap((pid) => (pid === id ? manual : bests.filter((r) => r.personId === pid)));
  next = { ...next, tables: { ...next.tables, logged_set: [...ordered, ...logged.filter((r) => r.manual !== true)] } };
  const { exercise, exercise_type } = exerciseTables(next.tables);
  return { ...next, tables: { ...next.tables, exercise, exercise_type } };
}

// ---------- Logged sets ----------
// Saves the list of sets the screens keep (the old flat list): the workout, workout_type, workout_exercise and logged_set rows
// are worked out from the whole list again (they depend on it: a workout's start and end, a day's first mode, seq), the typed-in
// bests are kept as they are, and the exercise and exercise_type tables are brought up to date. Every other table is untouched.
export function putSets(db, sets) {
  const made = setTables(db.currentPerson, sets, groupLookup(db.tables));
  const bests = rowsOf(db, "logged_set").filter((r) => r.manual === true);
  const next = {
    ...db,
    tables: {
      ...db.tables,
      workout: made.workout, workout_type: made.workout_type, workout_exercise: made.workout_exercise,
      logged_set: [...bests, ...made.logged_set],
    },
  };
  const { exercise, exercise_type } = exerciseTables(next.tables);
  return { ...next, tables: { ...next.tables, exercise, exercise_type } };
}

// One gym as the screens use it (name, units, equipment, weight sets ...), read from the gym and gym_equipment rows.
// undefined when there is no such gym. It is tidied the same way reading a whole store tidies each gym.
export function gymOf(db, id) {
  const g = rowOf(db, "gym", { id });
  return g ? cleanGym(gymFromRows(db.tables, g)) : undefined;
}

// The exercises you added, from the tables (the same list the whole store gives as `custom`).
export const customOfDb = (db) => customFromRows(db.tables);

// One person as the screens use them (name, defaults, gyms with machines, never and use marks, supersets), read from the tables.
// undefined when there is no such person.
export function personOf(db, id) {
  const p = rowOf(db, "person", { id });
  return p ? personFromRows(db.tables, p) : undefined;
}

// The gyms and added exercises together, in the shape the machines-file and add-gym functions take ({ gyms, custom }).
export function gymsViewOf(db) {
  const gyms = {};
  for (const g of rowsOf(db, "gym")) gyms[g.id] = gymOf(db, g.id);
  return { gyms, custom: customOfDb(db) };
}
