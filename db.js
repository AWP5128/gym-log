// The saved data as tables, held in memory exactly as saved (stage D of the refactor). Pure (no browser calls).
//
// A "db" is the saved version 4 object itself: { version: 4, currentGym, defaultGym, currentPerson, tables: { person: [rows], ... } }
// (see schema4.js for what each table holds). Nothing here changes a db in place: every write gives a new db that shares
// every table it did not touch with the old one, so a screen can tell by `===` that a table is unchanged.
// A row is found by its key fields (KEYS). A row's other fields are whatever schema4.js saves; this file does not look at them.

import { TABLES, SCHEMA_VERSION, gymRow, weightSetRows } from "./schema4.js";
import { blankGym } from "./store.js";
import { uniqueId } from "./gym.js";

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

// Adds a gym with no equipment (but its own Dumbbells and Barbell), owned by every person. It does not change the current gym.
// Gives { db, id }; id is null when the name is blank and the db is then unchanged.
export function addBlankGym(db, name) {
  const clean = String(name ?? "").trim();
  if (!clean) return { db, id: null };
  const id = uniqueId(clean, rowsOf(db, "gym").map((g) => g.id), "gym");
  const gym = blankGym(clean);
  let next = putRow(db, "gym", gymRow(id, gym));
  for (const p of rowsOf(next, "person")) {
    const rows = rowsOf(next, "gym_member");
    const last = rows.map((r) => r.personId).lastIndexOf(p.id);   // after this person's other gyms, as a conversion lists them
    const member = { personId: p.id, gymId: id, role: "owner", status: "active", offTypes: [] };
    const list = last === -1 ? [...rows, member] : [...rows.slice(0, last + 1), member, ...rows.slice(last + 1)];
    next = { ...next, tables: { ...next.tables, gym_member: list } };
  }
  return { db: putRows(next, "gym_equipment", weightSetRows(id, gym)), id };
}
