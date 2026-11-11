// Step 28b: the SQL for person, gym, gym_member and gym_equipment, checked with an in-memory Postgres (PGlite).
// No Docker needed. A small stand-in for Supabase's own roles and auth schema is created first.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const U = { alice: "00000000-0000-0000-0000-00000000000a", bob: "00000000-0000-0000-0000-00000000000b",
  cara: "00000000-0000-0000-0000-00000000000c", dan: "00000000-0000-0000-0000-00000000000d", eve: "00000000-0000-0000-0000-00000000000e" };

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
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    insert into auth.users values ${Object.values(U).map((u) => `('${u}')`).join(",")};`);
  const file = readdirSync("supabase/migrations").filter((f) => f.includes("people_gyms_equipment"))[0];
  await db.exec(readFileSync("supabase/migrations/" + file, "utf8"));
  return db;
  })();
  const db = await (await template).clone();
  opened.push(db);
  await db.exec(`
    insert into person (id, name, auth_user_id) values ('alice','Alice','${U.alice}'),('bob','Bob','${U.bob}'),
      ('cara','Cara','${U.cara}'),('dan','Dan','${U.dan}');
    insert into gym (id, name) values ('main','Main'),('other','Other');
    insert into gym_member (person_id, gym_id, role, status) values ('alice','main','owner','active'),('bob','main','editor','active'),
      ('cara','main','member','active'),('dan','main','member','pending'),('alice','other','owner','active');
    insert into gym_equipment (gym_id, id, exercise_id, equipment_type_id, name) values ('main','leg-press','leg-press','stack','Leg Press'),
      ('other','leg-press','leg-press','plate','Leg Press');`);
  return db;
}
// run a query as a signed-in user (or "anon"), then go back to the superuser
async function as(db, who, sql) {
  await db.exec(who === "anon" ? "set role anon" : `set role authenticated; select set_config('request.jwt.claim.sub','${U[who]}',false)`);
  try { return await db.query(sql); } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)"); }
}
const rows = async (db, who, sql) => (await as(db, who, sql)).rows;

test("the four tables exist with row-level security on", async () => {
  const db = await freshDb();
  const r = await db.query("select relname, relrowsecurity from pg_class where relname in ('person','gym','gym_member','gym_equipment') and relkind='r' order by 1");
  assert.deepEqual(r.rows.map((x) => x.relname), ["gym", "gym_equipment", "gym_member", "person"]);
  assert.ok(r.rows.every((x) => x.relrowsecurity));
});

test("an outsider and the anon role see nothing", async () => {
  const db = await freshDb();
  for (const t of ["gym", "gym_equipment", "gym_member"]) assert.equal((await rows(db, "eve", `select * from ${t}`)).length, 0);
  await assert.rejects(as(db, "anon", "select * from gym"), /permission denied/);
});

test("members see their gym; a pending person sees only their own request", async () => {
  const db = await freshDb();
  assert.deepEqual((await rows(db, "cara", "select id from gym")).map((r) => r.id), ["main"]);
  assert.equal((await rows(db, "cara", "select * from gym_equipment")).length, 1);
  assert.equal((await rows(db, "dan", "select * from gym")).length, 0);
  assert.equal((await rows(db, "dan", "select * from gym_equipment")).length, 0);
  assert.deepEqual((await rows(db, "dan", "select person_id from gym_member")).map((r) => r.person_id), ["dan"]);
});

test("owner and editor change equipment; a member cannot", async () => {
  const db = await freshDb();
  assert.equal((await as(db, "bob", "update gym_equipment set name='LP' where gym_id='main'")).affectedRows, 1);
  assert.equal((await as(db, "cara", "update gym_equipment set name='X' where gym_id='main'")).affectedRows, 0);
  await assert.rejects(as(db, "cara", "insert into gym_equipment (gym_id,id,equipment_type_id,name) values ('main','new','stack','New')"), /row-level security/);
  assert.equal((await db.query("select name from gym_equipment where gym_id='main'")).rows[0].name, "LP");
});

test("equipment of another gym cannot be changed, even by an owner elsewhere", async () => {
  const db = await freshDb();
  assert.equal((await as(db, "bob", "update gym_equipment set name='Z' where gym_id='other'")).affectedRows, 0);
});

test("only the owner deletes a gym", async () => {
  const db = await freshDb();
  assert.equal((await as(db, "bob", "delete from gym where id='main'")).affectedRows, 0);
  assert.equal((await as(db, "alice", "delete from gym where id='main'")).affectedRows, 1);
});

test("access: a person asks as pending; only the owner approves", async () => {
  const db = await freshDb();
  await as(db, "eve", `insert into person (id,name,auth_user_id) values ('eve','Eve','${U.eve}')`);
  await as(db, "eve", "insert into gym_member (person_id,gym_id) values ('eve','main')");           // pending member
  await assert.rejects(as(db, "eve", "insert into gym_member (person_id,gym_id,status) values ('eve','other','active')"), /row-level security/);
  await assert.rejects(as(db, "eve", "update gym_member set status='active' where person_id='eve'"), /Only the gym owner/);
  assert.equal((await rows(db, "eve", "select * from gym_equipment")).length, 0);
  assert.equal((await as(db, "bob", "update gym_member set status='active' where person_id='eve'")).affectedRows, 0);   // an editor cannot approve
  assert.equal((await as(db, "alice", "update gym_member set status='active' where person_id='eve'")).affectedRows, 1);
  assert.equal((await rows(db, "eve", "select * from gym_equipment")).length, 1);
});

test("a member cannot raise their own role but can switch equipment types off", async () => {
  const db = await freshDb();
  await assert.rejects(as(db, "cara", "update gym_member set role='owner' where person_id='cara' and gym_id='main'"), /Only the gym owner/);
  assert.equal((await as(db, "cara", "update gym_member set off_types='{dumbbells}' where person_id='cara' and gym_id='main'")).affectedRows, 1);
});

test("people: you change only yourself and see only people you share a gym with", async () => {
  const db = await freshDb();
  assert.equal((await as(db, "cara", "update person set name='Hacked' where id='alice'")).affectedRows, 0);
  assert.equal((await as(db, "cara", "update person set name='Cara B' where id='cara'")).affectedRows, 1);
  assert.deepEqual((await rows(db, "cara", "select id from person order by id")).map((r) => r.id), ["alice", "bob", "cara"]);   // not dan (pending)
  await assert.rejects(as(db, "cara", `update person set auth_user_id='${U.eve}' where id='cara'`), /row-level security/);
});

test("the first owner row is allowed only on a gym with no members", async () => {
  const db = await freshDb();
  await as(db, "bob", "insert into gym (id,name) values ('bobs','Bobs')");
  await as(db, "bob", "insert into gym_member (person_id,gym_id,role,status) values ('bob','bobs','owner','active')");
  await assert.rejects(as(db, "cara", "insert into gym_member (person_id,gym_id,role,status) values ('cara','bobs','owner','active')"), /row-level security/);
  assert.equal((await rows(db, "bob", "select * from gym where id='bobs'")).length, 1);
});

test("updated_at moves when a row changes", async () => {
  const db = await freshDb();
  await db.exec("update gym set updated_at = '2020-01-01' where id='main'; update gym set name='Main 2' where id='main'");
  assert.ok(new Date((await db.query("select updated_at from gym where id='main'")).rows[0].updated_at) > new Date("2021-01-01"));
});
