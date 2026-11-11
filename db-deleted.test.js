// Step 29b: the server remembers deletions (table deleted_row), checked with an in-memory Postgres (PGlite).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { rowKey } from "./sync.js";

const U = { alice: "00000000-0000-0000-0000-00000000000a", bob: "00000000-0000-0000-0000-00000000000b", cara: "00000000-0000-0000-0000-00000000000c" };

// The empty, migrated database is built once per file; each test gets its own quick copy of it.
let template;
const opened = [];
// close every database when the file's tests end, or the test run never finishes
test.after(async () => { for (const d of opened) await d.close(); if (template) await (await template).close(); });
async function freshDb() {
  template ??= (async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    insert into auth.users values ${Object.values(U).map((u) => `('${u}')`).join(",")};`);
  for (const f of readdirSync("supabase/migrations").sort()) await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
  return db;
  })();
  const db = await (await template).clone();
  opened.push(db);
  await db.exec(`
    insert into equipment_type values ('stack','Stack machine');
    insert into exercise_type values ('legs','Legs','{heavy,volume}');
    insert into exercise (id,name,exercise_type_id) values ('leg-press','Leg Press','legs');
    insert into person (id,name,auth_user_id) values ('alice','Alice','${U.alice}'),('bob','Bob','${U.bob}'),('cara','Cara','${U.cara}');
    insert into gym (id,name) values ('main','Main');
    insert into gym_member (person_id,gym_id,role,status) values ('alice','main','owner','active'),('bob','main','editor','active'),('cara','main','member','active');
    insert into gym_equipment (gym_id,id,exercise_id,equipment_type_id,exercise_type_id,name) values ('main','leg-press','leg-press','stack','legs','Leg Press');
    insert into personal_setup (person_id,gym_id,exercise_id,day_type,notes) values ('alice','main','leg-press','heavy','Seat 4');
    insert into workout (id,person_id,gym_id,date) values ('alice:main:2026-11-02','alice','main','2026-11-02');
    insert into workout_type (id,workout_id,exercise_type_id) values ('alice:main:2026-11-02:legs','alice:main:2026-11-02','legs');
    insert into workout_exercise (id,workout_type_id,exercise_id) values ('alice:main:2026-11-02:legs:leg-press','alice:main:2026-11-02:legs','leg-press');
    insert into logged_set (id,person_id,workout_exercise_id,exercise_id,gym_id,time) values
      ('alice:2026-11-02T10:00:00.000Z:leg-press','alice','alice:main:2026-11-02:legs:leg-press','leg-press','main','2026-11-02T10:00:00Z');`);
  return db;
}
async function as(db, who, sql) {
  await db.exec(who === "anon" ? "set role anon" : `set role authenticated; select set_config('request.jwt.claim.sub','${U[who]}',false)`);
  try { return await db.query(sql); } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)"); }
}
const keys = async (db, who, where = "true") => (await as(db, who, `select key from deleted_row where ${where} order by key`)).rows.map((r) => r.key);

test("a deleted set is remembered under the key the sync engine builds", async () => {
  const db = await freshDb();
  await as(db, "alice", "delete from logged_set");
  assert.deepEqual(await keys(db, "alice"), [rowKey("logged_set", { id: "alice:2026-11-02T10:00:00.000Z:leg-press" })]);
});

test("composite keys match the engine's, with day type none for a notes-only row", async () => {
  const db = await freshDb();
  await db.exec("insert into personal_setup (person_id,gym_id,exercise_id,notes) values ('alice','main','leg-press','x')");
  await as(db, "alice", "delete from personal_setup");
  assert.deepEqual(await keys(db, "alice"), [
    rowKey("personal_setup", { personId: "alice", gymId: "main", exerciseId: "leg-press", dayType: "heavy" }),
    rowKey("personal_setup", { personId: "alice", gymId: "main", exerciseId: "leg-press", dayType: null }),
  ].sort());
  await db.exec("delete from gym_equipment");
  assert.ok((await db.query("select key from deleted_row where table_name='gym_equipment'")).rows[0].key === rowKey("gym_equipment", { gymId: "main", id: "leg-press" }));
});

test("deleting a workout remembers its parts and sets too, each tied to the person", async () => {
  const db = await freshDb();
  await as(db, "alice", "delete from workout");
  const r = (await db.query("select table_name, person_id from deleted_row order by table_name")).rows;
  assert.deepEqual(r.map((x) => x.table_name), ["logged_set", "workout", "workout_exercise", "workout_type"]);
  assert.ok(r.every((x) => x.person_id === "alice"));
});

test("private deletes are seen only by their person; gym deletes by the gym's members", async () => {
  const db = await freshDb();
  await db.exec("delete from logged_set; delete from gym_equipment");
  assert.equal((await keys(db, "alice")).length, 2);
  assert.deepEqual(await keys(db, "bob"), [rowKey("gym_equipment", { gymId: "main", id: "leg-press" })]);
  assert.deepEqual(await keys(db, "cara"), [rowKey("gym_equipment", { gymId: "main", id: "leg-press" })]);
  await assert.rejects(as(db, "anon", "select * from deleted_row"), /permission denied/);
});

test("nobody can write to the memory of deletions", async () => {
  const db = await freshDb();
  await assert.rejects(as(db, "alice", "insert into deleted_row (key,table_name) values ('x','y')"), /permission denied/);
  await assert.rejects(as(db, "alice", "delete from deleted_row"), /permission denied/);
});

test("adding a row again clears the memory of its delete", async () => {
  const db = await freshDb();
  await db.exec("delete from logged_set");
  assert.equal((await db.query("select * from deleted_row")).rows.length, 1);
  await db.exec(`insert into logged_set (id,person_id,workout_exercise_id,exercise_id,gym_id,time) values
    ('alice:2026-11-02T10:00:00.000Z:leg-press','alice','alice:main:2026-11-02:legs:leg-press','leg-press','main','2026-11-02T10:00:00Z')`);
  assert.equal((await db.query("select * from deleted_row")).rows.length, 0);
});
