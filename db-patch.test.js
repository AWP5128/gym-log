// Step 84: what remote.js sends for a person and a gym (a PATCH by id, and create_gym for a gym that is not online yet), run as the
// same statements against the real migrations in an in-memory Postgres (PGlite): the row rules must say yes to these and no to the
// upsert the app used before. Uses the same stand-in for Supabase's roles and auth.users as db-invite.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const U = { me: "00000000-0000-0000-0000-0000000000a1", fam: "00000000-0000-0000-0000-0000000000a2" };
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
      insert into auth.users values ('${U.me}', 'me@example.com', now()), ('${U.fam}', 'fam@example.com', now());`);
    for (const f of readdirSync("supabase/migrations").filter((n) => n.endsWith(".sql")).sort())   // every migration, in order, as the hosted project has them
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
    return db;
  })();
  const db = await (await template).clone();
  opened.push(db);
  await db.exec(`insert into person (id, name) values ('awp','Awp (loaded)'), ('fam','Fam');
    insert into invite (email, person_id, name) values ('me@example.com','awp','Awp'),('fam@example.com','fam','Fam')`);
  return db;
}
async function as(db, who, sql) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${U[who]}',false)`);
  try { return await db.query(sql); } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)"); }
}
const claim = (db, who) => as(db, who, "select public.claim_invite()");

const patchPerson = (id) => `update public.person set name = 'Awp', defaults = '{"heavy":{"reps":5}}', superset = null where id = '${id}' returning id`;
const patchGym = (id) => `update public.gym set name = 'Hotel', units = '{"stack":"lb"}', list_default = null, starter_free = true, starter_abs = null,
  starter_cardio = null, pull_ups_moved = null, outdoors = null where id = '${id}' returning id`;

test("a person PATCHes their own row, and only their own", async () => {
  const db = await freshDb();
  await claim(db, "me"); await claim(db, "fam");
  assert.equal((await as(db, "me", patchPerson("awp"))).rows.length, 1);
  assert.equal((await db.query("select name from person where id = 'awp'")).rows[0].name, "Awp");
  assert.equal((await as(db, "me", patchPerson("fam"))).rows.length, 0);       // nothing answers: the app reports it, and changes nothing
  assert.equal((await db.query("select name from person where id = 'fam'")).rows[0].name, "Fam");
});

test("a gym that is not online: the PATCH finds no row, create_gym makes it with the caller as owner, then the PATCH sets every column", async () => {
  const db = await freshDb();
  await claim(db, "me");
  assert.equal((await as(db, "me", patchGym("g-abc12345"))).rows.length, 0);
  await as(db, "me", "select public.create_gym('g-abc12345', 'Hotel')");
  assert.equal((await as(db, "me", patchGym("g-abc12345"))).rows.length, 1);
  const g = (await db.query("select name, units, starter_free, outdoors from gym where id = 'g-abc12345'")).rows[0];
  assert.deepEqual(g, { name: "Hotel", units: { stack: "lb" }, starter_free: true, outdoors: null });
  assert.deepEqual((await db.query("select person_id, role, status from gym_member where gym_id = 'g-abc12345'")).rows, [{ person_id: "awp", role: "owner", status: "active" }]);
  await as(db, "me", "select public.create_gym('g-abc12345', 'Hotel')");       // again is harmless
  assert.equal((await db.query("select count(*)::int as n from gym_member where gym_id = 'g-abc12345'")).rows[0].n, 1);
});

test("the owner's membership upsert that follows is accepted; someone else's gym cannot be PATCHed or created", async () => {
  const db = await freshDb();
  await claim(db, "me"); await claim(db, "fam");
  await as(db, "me", "select public.create_gym('g-abc12345', 'Hotel')");
  await as(db, "me", `insert into public.gym_member (person_id, gym_id, role, status, off_types) values ('awp','g-abc12345','owner','active','{}')
    on conflict (person_id, gym_id) do update set role = excluded.role, status = excluded.status, off_types = excluded.off_types`);
  assert.equal((await as(db, "fam", patchGym("g-abc12345"))).rows.length, 0);   // not a member: the PATCH sees nothing
  await assert.rejects(as(db, "fam", "select public.create_gym('g-abc12345', 'Mine')"), /That gym id is taken/);
});

test("why the PATCH is needed: the upsert the app used before is refused for a person and for a gym", async () => {
  const db = await freshDb();
  await claim(db, "me");
  await assert.rejects(as(db, "me", `insert into public.gym (id, name) values ('g-new11111', 'X') on conflict (id) do update set name = excluded.name`), /row-level security/);
  await assert.rejects(as(db, "me", `insert into public.person (id, name) values ('awp', 'Awp') on conflict (id) do update set name = excluded.name`), /row-level security|permission|violates/);
});
