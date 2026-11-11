// Step 28c: equipment_type, exercise_type, exercise, personal_setup, checked with an in-memory Postgres (PGlite).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const U = { alice: "00000000-0000-0000-0000-00000000000a", bob: "00000000-0000-0000-0000-00000000000b",
  cara: "00000000-0000-0000-0000-00000000000c", dan: "00000000-0000-0000-0000-00000000000d" };

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
    insert into equipment_type values ('stack','Stack machine'),('dumbbell','Dumbbells');
    insert into exercise_type values ('legs','Legs','{heavy,volume}'),('arms','Arms','{heavy,volume}');
    insert into exercise (id,name,exercise_type_id,also_under) values ('leg-press','Leg Press','legs','{}'),('pull-up','Pull-ups','arms','{legs}');
    insert into person (id,name,auth_user_id) values ('alice','Alice','${U.alice}'),('bob','Bob','${U.bob}'),('cara','Cara','${U.cara}'),('dan','Dan','${U.dan}');
    insert into gym (id,name) values ('main','Main'),('other','Other');
    insert into gym_member (person_id,gym_id,role,status) values ('alice','main','owner','active'),('bob','main','editor','active'),
      ('cara','main','member','active'),('dan','main','member','pending');
    insert into gym_equipment (gym_id,id,exercise_id,equipment_type_id,exercise_type_id,name) values ('main','leg-press','leg-press','stack','legs','Leg Press');
    insert into personal_setup (person_id,gym_id,exercise_id,day_type,working,notes) values
      ('alice','main','leg-press','heavy','{"weight":200,"reps":5,"sets":4}','Seat 4'),('cara','main','leg-press','none',null,'Seat 6');`);
  return db;
}
async function as(db, who, sql) {
  await db.exec(who === "anon" ? "set role anon" : `set role authenticated; select set_config('request.jwt.claim.sub','${U[who]}',false)`);
  try { return await db.query(sql); } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)"); }
}
const rows = async (db, who, sql) => (await as(db, who, sql)).rows;

test("equipment must use a known equipment type, exercise type and exercise", async () => {
  const db = await freshDb();
  await assert.rejects(db.exec("insert into gym_equipment (gym_id,id,exercise_id,equipment_type_id,name) values ('main','x','leg-press','nope','X')"), /foreign key/);
  await assert.rejects(db.exec("insert into gym_equipment (gym_id,id,exercise_id,equipment_type_id,name) values ('main','y','nope','stack','Y')"), /foreign key/);
  await assert.rejects(db.exec("insert into gym_equipment (gym_id,id,equipment_type_id,exercise_type_id,name) values ('main','z','stack','nope','Z')"), /foreign key/);
  await db.exec("insert into gym_equipment (gym_id,id,equipment_type_id,name) values ('main','set:dumbbells','dumbbell','Dumbbells')");   // a weight set has no exercise
});

test("everyone signed in reads the type lists and exercises; anon cannot", async () => {
  const db = await freshDb();
  assert.equal((await rows(db, "dan", "select * from equipment_type")).length, 2);
  assert.equal((await rows(db, "dan", "select * from exercise_type")).length, 2);
  assert.equal((await rows(db, "dan", "select * from exercise")).length, 2);
  await assert.rejects(as(db, "anon", "select * from exercise"), /permission denied/);
});

test("the type lists cannot be changed by users", async () => {
  const db = await freshDb();
  await assert.rejects(as(db, "alice", "insert into exercise_type values ('golf','Golf','{}')"), /permission denied/);
  await assert.rejects(as(db, "alice", "update equipment_type set label='x'"), /permission denied/);
});

test("an owner or editor adds an exercise; a member cannot; nobody edits or deletes one", async () => {
  const db = await freshDb();
  await as(db, "bob", "insert into exercise (id,name,exercise_type_id) values ('calf-raise','Calf Raise','legs')");
  await assert.rejects(as(db, "cara", "insert into exercise (id,name) values ('x','X')"), /row-level security/);
  await assert.rejects(as(db, "dan", "insert into exercise (id,name) values ('x','X')"), /row-level security/);
  await assert.rejects(as(db, "bob", "update exercise set name='Hacked' where id='leg-press'"), /permission denied/);
  await assert.rejects(as(db, "bob", "delete from exercise where id='leg-press'"), /permission denied/);
});

test("personal setup is private to its person", async () => {
  const db = await freshDb();
  assert.deepEqual((await rows(db, "alice", "select notes from personal_setup")).map((r) => r.notes), ["Seat 4"]);
  assert.deepEqual((await rows(db, "cara", "select notes from personal_setup")).map((r) => r.notes), ["Seat 6"]);
  assert.equal((await rows(db, "bob", "select * from personal_setup")).length, 0);       // even the gym's editor
  assert.equal((await as(db, "bob", "update personal_setup set notes='x'")).affectedRows, 0);
  assert.equal((await as(db, "bob", "delete from personal_setup")).affectedRows, 0);
});

test("you can save setup only for yourself and only at a gym you belong to", async () => {
  const db = await freshDb();
  await as(db, "cara", "insert into personal_setup (person_id,gym_id,exercise_id,day_type,working) values ('cara','main','leg-press','volume','{\"weight\":100}')");
  await assert.rejects(as(db, "cara", "insert into personal_setup (person_id,gym_id,exercise_id) values ('alice','main','pull-up')"), /row-level security/);
  await assert.rejects(as(db, "dan", "insert into personal_setup (person_id,gym_id,exercise_id) values ('dan','main','pull-up')"), /row-level security/);   // pending
  await assert.rejects(as(db, "cara", "insert into personal_setup (person_id,gym_id,exercise_id) values ('cara','other','pull-up')"), /row-level security/);   // not a member there
});

test("one row per person, gym, exercise and day type; notes-only rows use 'none'", async () => {
  const db = await freshDb();
  await assert.rejects(as(db, "alice", "insert into personal_setup (person_id,gym_id,exercise_id,day_type) values ('alice','main','leg-press','heavy')"), /duplicate key/);
  await assert.rejects(as(db, "alice", "insert into personal_setup (person_id,gym_id,exercise_id,day_type) values ('alice','main','pull-up','weekend')"), /check/);
  await as(db, "alice", "insert into personal_setup (person_id,gym_id,exercise_id,notes) values ('alice','main','pull-up','Neutral grip')");
  assert.equal((await rows(db, "alice", "select day_type from personal_setup where exercise_id='pull-up'"))[0].day_type, "none");
});

test("setup rows leave with the person or the gym, but not with an exercise", async () => {
  const db = await freshDb();
  await assert.rejects(db.exec("delete from exercise where id='leg-press'"), /foreign key/);
  await db.exec("delete from gym where id='main'");
  assert.equal((await db.query("select * from personal_setup")).rows.length, 0);
});
