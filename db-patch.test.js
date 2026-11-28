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

// Step 86: the first real sync was refused for exercises (403 42501) because remote.js sent them as an upsert that may overwrite
// (ON CONFLICT DO UPDATE), which needs the update right the database deliberately withholds. Checked here against the real grants.
const ownerWithGym = async (db) => { await claim(db, "me"); await as(db, "me", "select public.create_gym('g-test0001','Test')"); };

test("exercises: add-if-new works for an editor, overwrite is refused (so remote.js sends them add-only)", async () => {
  const db = await freshDb();
  await ownerWithGym(db);
  const add = (extra) => `insert into public.exercise (id, name, exercise_type_id) values ('x1','X','legs') on conflict (id) ${extra}`;
  await as(db, "me", add("do nothing"));
  await as(db, "me", add("do nothing"));                                            // the same row again: quietly left alone
  assert.equal((await db.query("select count(*)::int n from exercise where id = 'x1'")).rows[0].n, 1);
  await assert.rejects(as(db, "me", add("do update set name = excluded.name")), /permission denied for table exercise/);
});

test("every table remote.js upserts has the rights that way of sending needs", async () => {
  const { SYNC_TABLES } = await import("./sync.js");
  const db = await freshDb();
  const addOnly = new Set(["exercise"]), own = new Set(["person", "gym"]);
  for (const t of SYNC_TABLES.filter((x) => !own.has(x))) {
    const need = addOnly.has(t) ? ["insert"] : ["insert", "update"];
    for (const right of need) {
      const r = await db.query(`select has_table_privilege('authenticated', 'public.${t}', '${right}') ok`);
      assert.equal(r.rows[0].ok, true, `${t} needs ${right}`);
    }
  }
});

// Step 88: the single limb switch is sent as an ordinary upsert of the person's own personal_setup row (insert + update rights, own rows only).
test("a person can switch single limb on and off for their own setup row, not another person's", async () => {
  const db = await freshDb();
  await ownerWithGym(db); await claim(db, "fam");
  const put = (who, pid) => as(db, who, `insert into public.personal_setup (person_id, gym_id, exercise_id, day_type, single_limb)
    values ('${pid}', 'g-test0001', 'leg-press', 'none', true) on conflict (person_id, gym_id, exercise_id, day_type) do update set single_limb = excluded.single_limb`);
  await as(db, "me", "insert into public.exercise (id, name, exercise_type_id) values ('leg-press','Leg Press','legs') on conflict (id) do nothing");
  await put("me", "awp");
  assert.equal((await db.query("select single_limb from personal_setup where person_id = 'awp'")).rows[0].single_limb, true);
  await as(db, "me", "update public.personal_setup set single_limb = null where person_id = 'awp'");
  assert.equal((await db.query("select single_limb from personal_setup where person_id = 'awp'")).rows[0].single_limb, null);
  await assert.rejects(put("me", "fam"));
});
