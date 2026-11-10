// Step 28d: workout, workout_type, workout_exercise, logged_set, checked with an in-memory Postgres (PGlite).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const U = { alice: "00000000-0000-0000-0000-00000000000a", bob: "00000000-0000-0000-0000-00000000000b",
  cara: "00000000-0000-0000-0000-00000000000c", dan: "00000000-0000-0000-0000-00000000000d" };

async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    insert into auth.users values ${Object.values(U).map((u) => `('${u}')`).join(",")};`);
  for (const f of readdirSync("supabase/migrations").sort()) await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
  await db.exec(`
    insert into equipment_type values ('stack','Stack machine');
    insert into exercise_type values ('legs','Legs','{heavy,volume}'),('cardio','Cardio','{}');
    insert into exercise (id,name,exercise_type_id) values ('leg-press','Leg Press','legs'),('run','Run','cardio');
    insert into person (id,name,auth_user_id) values ('alice','Alice','${U.alice}'),('bob','Bob','${U.bob}'),('cara','Cara','${U.cara}'),('dan','Dan','${U.dan}');
    insert into gym (id,name) values ('main','Main'),('other','Other');
    insert into gym_member (person_id,gym_id,role,status) values ('alice','main','owner','active'),('bob','main','editor','active'),
      ('cara','main','member','active'),('dan','main','member','pending');
    insert into workout (id,person_id,gym_id,date) values ('alice:main:2026-11-02','alice','main','2026-11-02');
    insert into workout_type (id,workout_id,exercise_type_id,day_type) values ('alice:main:2026-11-02:legs','alice:main:2026-11-02','legs','heavy');
    insert into workout_exercise (id,workout_type_id,exercise_id) values ('alice:main:2026-11-02:legs:leg-press','alice:main:2026-11-02:legs','leg-press');
    insert into logged_set (id,seq,person_id,workout_exercise_id,exercise_id,gym_id,time,weight,reps,unit,mode) values
      ('alice:set-0',0,'alice','alice:main:2026-11-02:legs:leg-press','leg-press','main','2026-11-02T10:00:00Z',200,5,'lb','heavy'),
      ('alice:set-1',1,'alice','alice:main:2026-11-02:legs:leg-press','leg-press','main','2026-11-02T10:04:00Z',210,5,'lb','heavy');`);
  return db;
}
async function as(db, who, sql) {
  await db.exec(who === "anon" ? "set role anon" : `set role authenticated; select set_config('request.jwt.claim.sub','${U[who]}',false)`);
  try { return await db.query(sql); } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)"); }
}
const rows = async (db, who, sql) => (await as(db, who, sql)).rows;
const T = ["workout", "workout_type", "workout_exercise", "logged_set"];

test("you see your own workouts and sets; nobody else does, not even the gym's owner", async () => {
  const db = await freshDb();
  for (const t of T) assert.ok((await rows(db, "alice", `select * from ${t}`)).length >= 1, t);
  for (const who of ["bob", "cara", "dan"]) for (const t of T) assert.equal((await rows(db, who, `select * from ${t}`)).length, 0, who + " " + t);
  for (const t of T) await assert.rejects(as(db, "anon", `select * from ${t}`), /permission denied/);
});

test("others cannot change or delete your log", async () => {
  const db = await freshDb();
  assert.equal((await as(db, "bob", "update logged_set set weight=999")).affectedRows, 0);
  assert.equal((await as(db, "bob", "delete from logged_set")).affectedRows, 0);
  assert.equal((await as(db, "bob", "delete from workout")).affectedRows, 0);
  assert.equal((await db.query("select * from logged_set")).rows.length, 2);
});

test("you log a set at your gym; not for someone else, not into someone else's workout, not at a gym you are not in", async () => {
  const db = await freshDb();
  await as(db, "alice", "insert into logged_set (id,seq,person_id,workout_exercise_id,exercise_id,gym_id,time,weight,reps,unit) values ('alice:set-2',2,'alice','alice:main:2026-11-02:legs:leg-press','leg-press','main','2026-11-02T10:08:00Z',220,5,'lb')");
  await assert.rejects(as(db, "bob", "insert into logged_set (id,person_id,workout_exercise_id,exercise_id,gym_id,time) values ('x','bob','alice:main:2026-11-02:legs:leg-press','leg-press','main',now())"), /row-level security/);
  await assert.rejects(as(db, "bob", "insert into logged_set (id,person_id,exercise_id,gym_id,time,manual) values ('y','alice','leg-press','main',now(),true)"), /row-level security/);
  await assert.rejects(as(db, "alice", "insert into logged_set (id,person_id,exercise_id,gym_id,manual) values ('z','alice','leg-press','other',true)"), /row-level security/);
  await assert.rejects(as(db, "dan", "insert into workout (id,person_id,gym_id,date) values ('dan:main:2026-11-02','dan','main','2026-11-02')"), /row-level security/);   // pending
});

test("a workout, its parts and exercises are built by their owner only", async () => {
  const db = await freshDb();
  await as(db, "bob", "insert into workout (id,person_id,gym_id,date) values ('bob:main:2026-11-02','bob','main','2026-11-02')");
  await as(db, "bob", "insert into workout_type (id,workout_id,exercise_type_id) values ('bob:t','bob:main:2026-11-02','cardio')");
  await as(db, "bob", "insert into workout_exercise (id,workout_type_id,exercise_id,distance,avg_heart_rate) values ('bob:e','bob:t','run',5.2,141)");
  await assert.rejects(as(db, "bob", "insert into workout_type (id,workout_id,exercise_type_id) values ('bob:t2','alice:main:2026-11-02','cardio')"), /row-level security/);
  await assert.rejects(as(db, "bob", "insert into workout_exercise (id,workout_type_id,exercise_id) values ('bob:e2','alice:main:2026-11-02:legs','run')"), /row-level security/);
  assert.equal((await rows(db, "bob", "select distance from workout_exercise"))[0].distance, "5.2");
});

test("a typed-in best is a manual set with no workout and no time", async () => {
  const db = await freshDb();
  await as(db, "cara", "insert into logged_set (id,person_id,exercise_id,gym_id,manual,weight,reps) values ('manual:cara:main:leg-press','cara','leg-press','main',true,300,3)");
  await assert.rejects(as(db, "cara", "insert into logged_set (id,person_id,exercise_id,gym_id) values ('bad','cara','leg-press','main')"), /check/);   // a normal set needs a workout and a time
  assert.equal((await rows(db, "cara", "select * from logged_set")).length, 1);
});

test("one workout per person, gym and day; one part per type; one row per exercise", async () => {
  const db = await freshDb();
  await assert.rejects(as(db, "alice", "insert into workout (id,person_id,gym_id,date) values ('dup','alice','main','2026-11-02')"), /duplicate key/);
  await assert.rejects(as(db, "alice", "insert into workout_type (id,workout_id,exercise_type_id) values ('dup2','alice:main:2026-11-02','legs')"), /duplicate key/);
  await assert.rejects(as(db, "alice", "insert into workout_exercise (id,workout_type_id,exercise_id) values ('dup3','alice:main:2026-11-02:legs','leg-press')"), /duplicate key/);
});

test("deleting a workout removes its parts and sets", async () => {
  const db = await freshDb();
  await as(db, "alice", "delete from workout where id='alice:main:2026-11-02'");
  for (const t of T) assert.equal((await db.query(`select * from ${t}`)).rows.length, 0, t);
});
