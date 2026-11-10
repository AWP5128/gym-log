// Step 28e: loading the version 4 tables into the database and reading them back, on an in-memory Postgres (PGlite).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { migrateToV4, toStoreV4 } from "./schema4.js";
import { migrateLegacy, addGym, cleanStore, emptyStore } from "./store.js";
import { updateItem, hideItem, hideWeightSet, addItem } from "./gym.js";
import { makeSet } from "./log.js";
import { loadTables, readTables, compareTables, toRows } from "./dbload.js";

async function freshDb() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    grant usage on schema public to anon, authenticated;`);
  for (const f of readdirSync("supabase/migrations").sort()) await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
  return db;
}

// two gyms, hidden items, a muscle, a custom exercise, notes, a second person, a typed-in best, old sets with no gym
function richV4() {
  let s = migrateLegacy({ exercises: { "leg-press": { name: "Leg Press", pins: [10, 20], notes: "Seat 4", heavy: { warmup: { weight: 40, reps: 10 }, working: { weight: 100, reps: 5, sets: 4 } } } } });
  const a = addGym(s, "Hotel", { from: "main", ids: ["leg-press", "deadlift"] });
  s = a.store;
  let hotel = updateItem(s.gyms[a.id], "deadlift", { muscle: "glutes" });
  hotel = hideItem(hotel, "leg-press");
  hotel = hideWeightSet(hotel, "dumbbells");
  hotel = addItem(hotel, { name: "Cable Row", group: "arms", type: "stack", unit: "kg" }).gym;
  s = { ...s, gyms: { ...s.gyms, [a.id]: hotel } };
  s.people.awp.superset = { pairs: [["bicep-curl", "tricep-extension"]], suitable: ["bicep-curl", "pull-up"] };
  s.people.awp.gyms[a.id] = { machines: { "leg-press": { pbWeight: 150, pbReps: 3, notes: "Hotel seat" } } };
  s.people.sam = { name: "Sam", defaults: { heavy: { reps: 8, sets: 3, warmupReps: 12 } }, gyms: { main: { machines: {} } } };
  const sets = [
    makeSet({ exerciseId: "leg-press", weight: 100.5, reps: 8, mode: "heavy", gymId: "main", unit: "lb", now: new Date("2026-11-01T10:00:00Z") }),
    makeSet({ exerciseId: "pull-up", weight: 10, reps: 6, mode: "heavy", gymId: "main", unit: "kg", now: new Date("2026-11-01T10:20:00Z") }),
    makeSet({ exerciseId: "bicep-curl", weight: 50, reps: 10, mode: "volume", gymId: "main", unit: "lb", now: new Date("2026-11-03T10:00:00Z") }),
    makeSet({ exerciseId: "leg-press", weight: 90, reps: 9, mode: "heavy", gymId: a.id, unit: "lb", now: new Date("2026-11-03T12:00:00Z") }),
    makeSet({ exerciseId: "crunch", reps: 20, now: new Date("2026-11-03T12:10:00Z") }),
    makeSet({ exerciseId: "custom-x", minutes: 12, gymId: "main", now: new Date("2026-11-04T09:00:00Z") }),
  ];
  return toStoreV4(cleanStore(s), sets);
}

test("the rich data loads and reads back identical", async () => {
  const v4 = richV4();
  const db = await freshDb();
  const counts = await loadTables(db, v4);
  assert.equal(counts.logged_set, v4.tables.logged_set.length);
  assert.ok(counts.gym_equipment > 40 && counts.personal_setup >= 2 && counts.workout >= 3);
  assert.deepEqual(compareTables(v4, await readTables(db)), []);
});

test("an empty store loads and reads back identical", async () => {
  const v4 = toStoreV4(cleanStore(emptyStore()), []);
  const db = await freshDb();
  await loadTables(db, v4);
  assert.deepEqual(compareTables(v4, await readTables(db)), []);
});

test("a database that already holds data is refused unless replace is asked for", async () => {
  const v4 = richV4();
  const db = await freshDb();
  await loadTables(db, v4);
  await assert.rejects(loadTables(db, v4), /already holds data/);
  await loadTables(db, v4, { replace: true });
  assert.deepEqual(compareTables(v4, await readTables(db)), []);
});

test("a failed load changes nothing", async () => {
  const v4 = richV4();
  const bad = JSON.parse(JSON.stringify(v4));
  bad.tables.logged_set[0].exerciseId = "no-such-exercise";
  const db = await freshDb();
  await assert.rejects(loadTables(db, bad), /foreign key/);
  assert.equal((await db.query("select count(*)::int as n from person")).rows[0].n, 0);
  await loadTables(db, v4);   // and the database is still usable
});

test("the comparison notices a changed or missing row, and names only tables", async () => {
  const v4 = richV4();
  const db = await freshDb();
  await loadTables(db, v4);
  await db.exec("update person set name = 'Someone else' where id = 'sam'; delete from logged_set where seq = 0");
  const problems = compareTables(v4, await readTables(db));
  assert.ok(problems.some((p) => p.startsWith("person")) && problems.some((p) => p.startsWith("logged_set")));
  assert.ok(!problems.join(" ").includes("Someone else"));
});

test("names and blanks convert both ways", () => {
  const rows = toRows(richV4());
  assert.ok(rows.personal_setup.every((r) => ["none", "heavy", "volume"].includes(r.day_type)));
  assert.ok(rows.gym_member.every((r) => Array.isArray(r.off_types)));
  assert.ok(rows.logged_set.every((r) => typeof r.manual === "boolean"));
  assert.ok(rows.gym_equipment.some((r) => r.stack_spec !== undefined || r.pins !== undefined));
});
