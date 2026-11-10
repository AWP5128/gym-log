// Step 28e: loads the version 4 tables into the database and reads them back, so a copy can be checked against the
// original. Not used by the app (it only runs on the laptop). `client` is anything with an async query(sql, params)
// that returns { rows }: the pg client in db-load.mjs, PGlite in the tests. The app's own camelCase names become the
// database's snake_case names here, and back.
import { TABLES } from "./schema4.js";

// column kinds: t text, n number, i integer, b boolean, j json, a text list, d date, s timestamp
const COLS = {
  equipment_type: { id: "t", label: "t" },
  exercise_type: { id: "t", label: "t", dayTypes: "a" },
  exercise: { id: "t", name: "t", exerciseTypeId: "t", alsoUnder: "a", custom: "j" },
  person: { id: "t", name: "t", defaults: "j", superset: "j" },
  gym: { id: "t", name: "t", units: "j", listDefault: "t", starterFree: "b", starterAbs: "b", pullUpsMoved: "b" },
  gym_member: { personId: "t", gymId: "t", role: "t", status: "t", offTypes: "a" },
  gym_equipment: {
    gymId: "t", id: "t", exerciseId: "t", equipmentTypeId: "t", exerciseTypeId: "t", name: "t", unit: "t", step: "n", common: "b",
    min: "n", pins: "j", stackSpec: "j", hidden: "b", muscle: "t", uses: "t", top: "n",
  },
  personal_setup: { personId: "t", gymId: "t", exerciseId: "t", dayType: "t", warmup: "j", working: "j", notes: "t" },
  workout: { id: "t", personId: "t", gymId: "t", date: "d", start: "s", end: "s" },
  workout_type: { id: "t", workoutId: "t", exerciseTypeId: "t", dayType: "t", start: "s", end: "s" },
  workout_exercise: { id: "t", workoutTypeId: "t", exerciseId: "t", distance: "n", avgHeartRate: "n", zoneMinutes: "j", watts: "n", level: "n" },
  logged_set: {
    id: "t", seq: "i", personId: "t", workoutExerciseId: "t", exerciseId: "t", gymId: "t", time: "s", weight: "n", reps: "n",
    minutes: "n", unit: "t", mode: "t", manual: "b",
  },
};
// parents before children
export const LOAD_ORDER = [
  "equipment_type", "exercise_type", "exercise", "person", "gym", "gym_member", "gym_equipment", "personal_setup",
  "workout", "workout_type", "workout_exercise", "logged_set",
];
const snake = (k) => k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
const camel = (k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const q = (id) => '"' + id + '"';

// Values the database needs filled in where the app leaves them out.
const FILL = {
  exercise_type: { dayTypes: [] }, exercise: { alsoUnder: [] }, person: { defaults: {} }, gym: { units: {} },
  gym_member: { offTypes: [] }, personal_setup: { dayType: "none" }, logged_set: { manual: false },
};

// v4.tables -> { table: [row with snake_case keys] }
export function toRows(v4) {
  const out = {};
  for (const table of LOAD_ORDER) {
    const cols = COLS[table];
    out[table] = (v4.tables[table] ?? []).map((r) => {
      const row = {};
      for (const k of Object.keys(cols)) {
        const v = r[k] ?? FILL[table]?.[k];
        if (v !== undefined && v !== null) row[snake(k)] = v;
      }
      return row;
    });
  }
  return out;
}

const readExpr = (kind, col) =>
  kind === "n" ? `${q(col)}::float8` :
  kind === "s" ? `to_char(${q(col)} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` :
  kind === "d" ? `to_char(${q(col)}, 'YYYY-MM-DD')` : q(col);

export async function readTables(client) {
  const tables = {};
  for (const table of LOAD_ORDER) {
    const cols = COLS[table];
    const select = Object.entries(cols).map(([k, kind]) => readExpr(kind, snake(k)) + " as " + q(k)).join(", ");
    const { rows } = await client.query(`select ${select} from public.${q(table)}`);
    tables[table] = rows.map((r) => {
      const o = {};
      for (const [k, v] of Object.entries(r)) if (v !== null && v !== undefined) o[k] = v;
      if (table === "personal_setup" && o.dayType === "none") delete o.dayType;
      if (table === "logged_set" && o.manual === false) delete o.manual;
      return o;
    });
  }
  return { tables };
}

export async function isEmpty(client) {
  for (const table of ["person", "gym", "workout", "logged_set"]) {
    const { rows } = await client.query(`select count(*)::int as n from public.${q(table)}`);
    if (rows[0].n > 0) return false;
  }
  return true;
}

// Puts everything in, all or nothing. Refuses a database that already holds data unless replace is true.
export async function loadTables(client, v4, { replace = false } = {}) {
  const rows = toRows(v4);
  await client.query("begin");
  try {
    if (replace) await client.query(`truncate table ${TABLES.map((t) => "public." + q(t)).join(", ")} restart identity cascade`);
    else if (!(await isEmpty(client))) throw new Error("The database already holds data. Use --replace to clear it first.");
    const counts = {};
    for (const table of LOAD_ORDER) {
      counts[table] = rows[table].length;
      if (rows[table].length === 0) continue;
      const cols = Object.keys(COLS[table]).map(snake).filter((c) => rows[table].some((r) => c in r));
      const list = cols.map(q).join(", ");
      await client.query(
        `insert into public.${q(table)} (${list}) select ${list} from jsonb_populate_recordset(null::public.${q(table)}, $1::jsonb)`,
        [JSON.stringify(rows[table])]
      );
    }
    await client.query("commit");
    return counts;
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
}

// What the app leaves out and the database fills in, so the two sides compare equal.
const norm = (table, r) => {
  const o = {};
  for (const [k, v] of Object.entries(r)) if (v !== null && v !== undefined) o[k] = v;
  if (table === "personal_setup" && o.dayType === "none") delete o.dayType;
  if (table === "logged_set" && o.manual === false) delete o.manual;
  return o;
};
const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

// A list of problems, empty when the two copies hold the same rows (order does not matter). Names tables
// and counts only, never values, so it is safe to show.
export function compareTables(a, b) {
  const problems = [];
  for (const table of LOAD_ORDER) {
    const left = (a.tables[table] ?? []).map((r) => norm(table, r));
    const right = (b.tables[table] ?? []).map((r) => norm(table, r));
    if (left.length !== right.length) problems.push(`${table}: ${left.length} rows before, ${right.length} after`);
    const seen = new Map();
    for (const r of right) seen.set(canon(r), (seen.get(canon(r)) ?? 0) + 1);
    let missing = 0;
    for (const r of left) {
      const key = canon(r);
      if (seen.get(key)) seen.set(key, seen.get(key) - 1);
      else missing++;
    }
    if (missing) problems.push(`${table}: ${missing} rows differ`);
  }
  return problems;
}
