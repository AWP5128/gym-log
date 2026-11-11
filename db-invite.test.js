// Step 30a: invite-only sign-in, checked with an in-memory Postgres (PGlite). No Docker needed.
// A small stand-in for Supabase's roles and auth.users (with email and confirmed time) is created first.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const U = { me: "00000000-0000-0000-0000-0000000000a1", fam: "00000000-0000-0000-0000-0000000000a2",
  stranger: "00000000-0000-0000-0000-0000000000a3", unconfirmed: "00000000-0000-0000-0000-0000000000a4",
  twin: "00000000-0000-0000-0000-0000000000a5" };

let template;
const opened = [];
test.after(async () => { for (const d of opened) await d.close(); if (template) await (await template).close(); });   // or the run never finishes
async function freshDb() {
  template ??= (async () => {
    const db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
      grant usage on schema public to anon, authenticated;
      insert into auth.users values
        ('${U.me}', 'Me@Example.com', now()), ('${U.fam}', 'fam@example.com', now()), ('${U.stranger}', 'stranger@example.com', now()),
        ('${U.unconfirmed}', 'late@example.com', null), ('${U.twin}', 'me@example.com', now());`);
    for (const f of ["20261110104000_people_gyms_equipment", "20261111100000_invites"])
      await db.exec(readFileSync(`supabase/migrations/${f}.sql`, "utf8"));
    return db;
  })();
  const db = await (await template).clone();
  opened.push(db);
  // invites are added the way the owner will do it: from the laptop, as the superuser
  await db.exec(`insert into invite (email, person_id, name) values ('me@example.com','awp','Awp'),('fam@example.com','fam','Fam'),('late@example.com','late','Late')`);
  return db;
}
async function as(db, who, sql) {
  await db.exec(who === "anon" ? "set role anon" : `set role authenticated; select set_config('request.jwt.claim.sub','${U[who]}',false)`);
  try { return await db.query(sql); } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)"); }
}
const rows = async (db, who, sql) => (await as(db, who, sql)).rows;
const claim = async (db, who) => (await rows(db, who, "select app.claim_invite() as p"))[0].p;

test("the app cannot read or write the invite table", async () => {
  const db = await freshDb();
  await assert.rejects(as(db, "me", "select * from invite"), /permission denied/);
  await assert.rejects(as(db, "stranger", "insert into invite (email, person_id, name) values ('x@example.com','x','X')"), /permission denied/);
  await assert.rejects(as(db, "anon", "select * from invite"), /permission denied/);
});

test("a confirmed, invited email becomes the invited person; the email match ignores capitals", async () => {
  const db = await freshDb();
  assert.equal(await claim(db, "me"), "awp");               // signed in as Me@Example.com, invited as me@example.com
  assert.deepEqual((await rows(db, "me", "select id, name from person")).map((r) => [r.id, r.name]), [["awp", "Awp"]]);
  const inv = (await db.query("select claimed_by, claimed_at from invite where email='me@example.com'")).rows[0];
  assert.equal(inv.claimed_by, U.me);
  assert.ok(inv.claimed_at);
});

test("claiming again just returns the same person", async () => {
  const db = await freshDb();
  assert.equal(await claim(db, "me"), "awp");
  assert.equal(await claim(db, "me"), "awp");
  assert.equal((await db.query("select count(*)::int as n from person")).rows[0].n, 1);
});

test("an invite links to a person that already exists and keeps their data", async () => {
  const db = await freshDb();
  await db.exec(`insert into person (id, name, defaults) values ('awp','Awp (loaded)','{"unit":"kg"}')`);
  assert.equal(await claim(db, "me"), "awp");
  const p = (await db.query("select name, auth_user_id, defaults from person where id='awp'")).rows[0];
  assert.equal(p.auth_user_id, U.me);
  assert.equal(p.name, "Awp (loaded)");
  assert.deepEqual(p.defaults, { unit: "kg" });
});

test("a person already linked to another sign-in cannot be taken over", async () => {
  const db = await freshDb();
  await db.exec(`insert into person (id, name, auth_user_id) values ('awp','Awp','${U.fam}')`);
  await assert.rejects(claim(db, "me"), /already linked/);
});

test("no invite, an unconfirmed email, or an already-claimed invite all fail", async () => {
  const db = await freshDb();
  await assert.rejects(claim(db, "stranger"), /No invitation/);
  await assert.rejects(claim(db, "unconfirmed"), /Email not confirmed/);
  assert.equal(await claim(db, "me"), "awp");
  await assert.rejects(claim(db, "twin"), /No invitation/);              // same email, a different sign-in
  await assert.rejects(as(db, "anon", "select app.claim_invite()"), /permission denied/);
});

test("a stranger cannot make themselves a person, a gym or a member", async () => {
  const db = await freshDb();
  await assert.rejects(as(db, "stranger", `insert into person (id,name,auth_user_id) values ('eve','Eve','${U.stranger}')`), /row-level security/);
  await assert.rejects(as(db, "stranger", "insert into gym (id,name) values ('g','G')"), /row-level security/);
  await assert.rejects(as(db, "stranger", "select app.create_gym('g','G')"), /Not linked/);
});

test("create_gym makes the caller the owner; again is harmless; someone else's gym id is refused", async () => {
  const db = await freshDb();
  await claim(db, "me"); await claim(db, "fam");
  await as(db, "me", "select app.create_gym('main','Main')");
  await as(db, "me", "select app.create_gym('main','Main')");        // same owner, no change
  assert.deepEqual((await rows(db, "me", "select person_id, role, status from gym_member where gym_id='main'")),
    [{ person_id: "awp", role: "owner", status: "active" }]);
  await assert.rejects(as(db, "fam", "select app.create_gym('main','Mine')"), /taken/);
  await assert.rejects(as(db, "fam", "insert into gym_member (person_id,gym_id,role,status) values ('fam','main','owner','active')"), /row-level security/);
  await assert.rejects(as(db, "fam", "insert into gym_member (person_id,gym_id) values ('fam','main')"), /row-level security/);   // no self-request any more
  assert.equal((await rows(db, "fam", "select * from gym")).length, 0);
});

test("the owner adds a person to a gym; only the owner", async () => {
  const db = await freshDb();
  await claim(db, "me"); await claim(db, "fam");
  await as(db, "me", "select app.create_gym('main','Main')");
  await as(db, "me", "insert into gym_member (person_id,gym_id,role,status) values ('fam','main','member','active')");
  assert.equal((await rows(db, "fam", "select * from gym")).length, 1);
  await assert.rejects(as(db, "fam", "insert into gym_member (person_id,gym_id,role,status) values ('fam','main','owner','active')"), /row-level security|duplicate/);
});

test("the public wrappers work for a signed-in person and are closed to anon", async () => {
  const db = await freshDb();
  await db.exec(readFileSync("supabase/migrations/20261111110000_public_wrappers.sql", "utf8"));
  assert.equal((await rows(db, "me", "select public.claim_invite() as p"))[0].p, "awp");
  await as(db, "me", "select public.create_gym('main','Main')");
  assert.deepEqual(await rows(db, "me", "select person_id, role from gym_member where gym_id='main'"), [{ person_id: "awp", role: "owner" }]);
  await assert.rejects(as(db, "anon", "select public.claim_invite()"), /permission denied/);
  await assert.rejects(as(db, "anon", "select public.create_gym('g','G')"), /permission denied/);
  await assert.rejects(as(db, "stranger", "select public.claim_invite()"), /No invitation/);
});
