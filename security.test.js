// Step 31: the database seen by an attacker. In-memory Postgres (PGlite), all migrations applied, plus a copy of
// Supabase's habit of granting every new public table and function to anon and authenticated (the migrations must undo that).
// Roles: anon = not signed in; authenticated = signed in. "stranger" is signed in and confirmed but NOT invited.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const U = { me: "00000000-0000-0000-0000-0000000000a1", fam: "00000000-0000-0000-0000-0000000000a2",
  stranger: "00000000-0000-0000-0000-0000000000a3", unconfirmed: "00000000-0000-0000-0000-0000000000a4",
  twin: "00000000-0000-0000-0000-0000000000a5" };
const DENIED = /permission denied|row-level security/;

let template;
test.after(async () => { if (template) await (await template).close(); });   // or the run never finishes

async function as(db, who, sql) {
  await db.exec(who === "anon" ? "set role anon" : `set role authenticated; select set_config('request.jwt.claim.sub','${U[who]}',false)`);
  try { return await db.query(sql); } finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)"); }
}
const rows = async (db, who, sql) => (await as(db, who, sql)).rows;
const count = async (db, who, sql) => (await rows(db, who, `select count(*)::int as n from ${sql}`))[0].n;
// A change that must not happen: either refused outright, or it matches no row the person may touch.
async function blocked(db, who, sql, label = sql) {
  try { assert.equal((await as(db, who, sql)).affectedRows, 0, label); }
  catch (e) { if (e.name === "AssertionError") throw e; assert.match(e.message, DENIED, label); }
}
const su = async (db, sql) => (await db.query(sql)).rows;          // superuser: what the owner sees from the dashboard

async function freshDb(t) {
  template ??= (async () => {
    const db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
      grant usage on schema public to anon, authenticated;
      -- what a hosted Supabase project does to everything created later in schema public:
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
      insert into auth.users values
        ('${U.me}', 'Me@Example.com', now()), ('${U.fam}', 'fam@example.com', now()), ('${U.stranger}', 'stranger@example.com', now()),
        ('${U.unconfirmed}', 'late@example.com', null), ('${U.twin}', 'me@example.com', now());`);
    for (const f of readdirSync("supabase/migrations").filter((x) => x.endsWith(".sql")).sort())
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8"));
    await db.exec(`insert into invite (email, person_id, name) values
      ('me@example.com','awp','Awp'), ('fam@example.com','fam','Fam'), ('late@example.com','late','Late')`);
    await as(db, "me", "select public.claim_invite()");
    await as(db, "fam", "select public.claim_invite()");
    await as(db, "me", "select public.create_gym('main','Main gym')");
    await as(db, "fam", "select public.create_gym('famgym','Fam gym')");
    await db.exec(`
      insert into equipment_type values ('stack','Stack');
      insert into exercise_type values ('legs','Legs','{heavy,volume}'), ('arms','Arms','{heavy,volume}');
      insert into exercise (id, name, exercise_type_id) values ('leg-press','Leg press','legs'), ('curl','Curl','arms');
      insert into gym_equipment (gym_id, id, exercise_id, equipment_type_id, exercise_type_id, name) values
        ('main','leg-press','leg-press','stack','legs','Leg press'), ('famgym','curl','curl','stack','arms','Curl');
      insert into workout (id, person_id, gym_id, date) values
        ('awp:main:2026-11-02','awp','main','2026-11-02'), ('fam:famgym:2026-11-02','fam','famgym','2026-11-02');
      insert into workout_type (id, workout_id, exercise_type_id, day_type) values
        ('awp:main:2026-11-02:legs','awp:main:2026-11-02','legs','heavy'), ('fam:famgym:2026-11-02:arms','fam:famgym:2026-11-02','arms','heavy');
      insert into workout_exercise (id, workout_type_id, exercise_id) values
        ('awp:main:2026-11-02:legs:leg-press','awp:main:2026-11-02:legs','leg-press'), ('fam:famgym:2026-11-02:arms:curl','fam:famgym:2026-11-02:arms','curl');
      insert into logged_set (id, person_id, workout_exercise_id, exercise_id, gym_id, time, weight, reps, unit, mode) values
        ('awp:1:leg-press','awp','awp:main:2026-11-02:legs:leg-press','leg-press','main',now(),100,8,'kg','heavy'),
        ('fam:1:curl','fam','fam:famgym:2026-11-02:arms:curl','curl','famgym',now(),20,10,'kg','heavy');
      insert into personal_setup (person_id, gym_id, exercise_id, day_type, notes) values
        ('awp','main','leg-press','none','awp private note'), ('fam','famgym','curl','none','fam note');`);
    return db;
  })();
  const db = await (await template).clone();
  t.after(() => db.close());          // each test closes its own copy at once, so memory stays small
  return db;
}

const ofAwp = (t) => `${t} where ${t === "workout_type" || t === "workout_exercise" ? "id like 'awp:%'" : "person_id = 'awp'"}`;
const PRIVATE = ["workout", "workout_type", "workout_exercise", "logged_set", "personal_setup"];
const tablesOf = async (db) => (await su(db, "select tablename from pg_tables where schemaname='public' order by 1")).map((r) => r.tablename);

// ---------- the doors ----------
test("the list of tables is the one this check was written for (a new table must be reviewed)", async (t) => {
  const db = await freshDb(t);
  assert.deepEqual(await tablesOf(db), ["deleted_row", "equipment_type", "exercise", "exercise_type", "gym", "gym_equipment", "gym_member",
    "invite", "logged_set", "person", "personal_setup", "workout", "workout_exercise", "workout_type"]);
  assert.deepEqual((await su(db, "select proname from pg_proc where pronamespace='public'::regnamespace order by 1")).map((r) => r.proname), ["claim_invite", "create_gym"]);
});

test("row-level security is on for every table", async (t) => {
  const db = await freshDb(t);
  assert.deepEqual(await su(db, "select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity"), []);
});

test("anon (not signed in) is refused on every table, for read, add, change and delete", async (t) => {
  const db = await freshDb(t);
  for (const t of await tablesOf(db)) {
    await assert.rejects(as(db, "anon", `select * from ${t}`), DENIED, `select ${t}`);
    await assert.rejects(as(db, "anon", `insert into ${t} default values`), DENIED, `insert ${t}`);
    const col = (await su(db, `select column_name from information_schema.columns where table_schema='public' and table_name='${t}' order by ordinal_position limit 1`))[0].column_name;
    await assert.rejects(as(db, "anon", `update ${t} set ${col} = ${col}`), DENIED, `update ${t}`);
    await assert.rejects(as(db, "anon", `delete from ${t}`), DENIED, `delete ${t}`);
  }
});

test("anon cannot call any public function or anything in the app schema", async (t) => {
  const db = await freshDb(t);
  await assert.rejects(as(db, "anon", "select public.claim_invite()"), DENIED);
  await assert.rejects(as(db, "anon", "select public.create_gym('x','x')"), DENIED);
  await assert.rejects(as(db, "anon", "select app.claim_invite()"), DENIED);
  await assert.rejects(as(db, "anon", "select app.my_person_id()"), DENIED);
});

test("privileges are the least that the app needs (signed-in) and none at all for anon", async (t) => {
  const db = await freshDb(t);
  const PRIV = ["select", "insert", "update", "delete", "truncate", "references", "trigger"];
  const all = "select,insert,update,delete";
  const WANT = { person: all, gym: all, gym_member: all, gym_equipment: all, personal_setup: all, workout: all, workout_type: all,
    workout_exercise: all, logged_set: all, equipment_type: "select", exercise_type: "select", exercise: "select,insert", deleted_row: "select", invite: "" };
  for (const t of await tablesOf(db)) {
    for (const who of ["anon", "authenticated"]) {
      const have = [];
      for (const p of PRIV) if ((await su(db, `select has_table_privilege('${who}','public.${t}','${p}') as h`))[0].h) have.push(p);
      assert.equal(have.join(","), who === "anon" ? "" : WANT[t], `${who} on ${t}`);
    }
  }
});

test("every function that runs with the owner's rights has its search path fixed; the public ones run with the caller's rights", async (t) => {
  const db = await freshDb(t);
  assert.deepEqual(await su(db, `select proname from pg_proc where pronamespace in ('app'::regnamespace,'public'::regnamespace)
    and prosecdef and not coalesce(proconfig::text like '%search_path%', false)`), []);
  assert.deepEqual(await su(db, "select proname from pg_proc where pronamespace='public'::regnamespace and prosecdef"), []);
});

test("the invite table cannot be read or written by anyone signed in", async (t) => {
  const db = await freshDb(t);
  for (const who of ["me", "stranger"]) {
    await assert.rejects(as(db, who, "select * from invite"), DENIED);
    await assert.rejects(as(db, who, "insert into invite (email, person_id, name) values ('x@example.com','x','X')"), DENIED);
    await assert.rejects(as(db, who, "update invite set person_id = 'awp'"), DENIED);
    await assert.rejects(as(db, who, "delete from invite"), DENIED);
  }
});

// ---------- signed in but not invited ----------
test("a confirmed but uninvited sign-in cannot become a person, create a gym or join one", async (t) => {
  const db = await freshDb(t);
  await assert.rejects(as(db, "stranger", "select public.claim_invite()"), /No invitation/);
  await assert.rejects(as(db, "stranger", "select public.create_gym('mine','Mine')"), /Not linked to a person/);
  await assert.rejects(as(db, "stranger", "insert into person (id, name, auth_user_id) values ('x','X','" + U.stranger + "')"), DENIED);
  await assert.rejects(as(db, "stranger", "insert into gym (id, name) values ('g','G')"), DENIED);
  await assert.rejects(as(db, "stranger", "insert into gym_member (person_id, gym_id, role, status) values ('awp','main','member','active')"), DENIED);
  await assert.rejects(as(db, "stranger", "insert into exercise (id, name) values ('evil','Evil')"), DENIED);
  assert.equal((await su(db, "select count(*)::int as n from person"))[0].n, 2);
});

test("an uninvited sign-in sees none of the people, gyms, equipment, logs or deletions", async (t) => {
  const db = await freshDb(t);
  for (const t of ["person", "gym", "gym_member", "gym_equipment", "deleted_row", ...PRIVATE]) assert.equal(await count(db, "stranger", t), 0, t);
  await assert.rejects(as(db, "stranger", "select * from invite"), DENIED);
});

test("an invited email that is not confirmed is refused", async (t) => {
  const db = await freshDb(t);
  await assert.rejects(as(db, "unconfirmed", "select public.claim_invite()"), /Email not confirmed/);
});

// ---------- two people ----------
test("one person cannot read another's private rows, even when they share a gym", async (t) => {
  const db = await freshDb(t);
  for (const t of PRIVATE) assert.equal(await count(db, "fam", ofAwp(t)), 0, `before sharing: ${t}`);
  await as(db, "me", "insert into gym_member (person_id, gym_id, role, status) values ('fam','main','member','active')");
  for (const t of PRIVATE) assert.equal(await count(db, "fam", ofAwp(t)), 0, `after sharing: ${t}`);
  assert.equal(await count(db, "fam", "gym where id = 'main'"), 1);          // the shared gym itself is visible
});

test("one person cannot write into another's private data", async (t) => {
  const db = await freshDb(t);
  await assert.rejects(as(db, "fam", "insert into logged_set (id, person_id, exercise_id, gym_id, manual) values ('x1','awp','leg-press','main',true)"), DENIED);
  await assert.rejects(as(db, "fam", "insert into logged_set (id, person_id, exercise_id, gym_id, manual) values ('x2','fam','curl','main',true)"), DENIED);          // own set, a gym they are not in
  await assert.rejects(as(db, "fam", "insert into logged_set (id, person_id, workout_exercise_id, exercise_id, gym_id, time) values ('x3','fam','awp:main:2026-11-02:legs:leg-press','curl','famgym',now())"), DENIED);   // hung on awp's workout
  await assert.rejects(as(db, "fam", "insert into workout (id, person_id, gym_id, date) values ('awp:main:2026-11-03','awp','main','2026-11-03')"), DENIED);
  await assert.rejects(as(db, "fam", "insert into workout_type (id, workout_id, exercise_type_id) values ('awp:main:2026-11-02:arms','awp:main:2026-11-02','arms')"), DENIED);
  await assert.rejects(as(db, "fam", "insert into workout_exercise (id, workout_type_id, exercise_id) values ('awp:main:2026-11-02:legs:curl','awp:main:2026-11-02:legs','curl')"), DENIED);
  await assert.rejects(as(db, "fam", "insert into personal_setup (person_id, gym_id, exercise_id, notes) values ('awp','main','curl','x')"), DENIED);
  for (const [verb, t] of PRIVATE.flatMap((t) => [["update", t], ["delete", t]])) {
    const change = { logged_set: "weight = 1", personal_setup: "notes = 'x'", workout: "gym_id = 'famgym'", workout_type: "day_type = 'volume'", workout_exercise: "watts = 1" }[t];
    const r = await as(db, "fam", (verb === "update" ? `update ${t} set ${change}` : `delete from ${t}`) + ` where ${ofAwp(t).split(" where ")[1]}`);
    assert.equal(r.affectedRows, 0, `${verb} ${t}`);
  }
  assert.deepEqual(await su(db, "select weight::int as w from logged_set where id = 'awp:1:leg-press'"), [{ w: 100 }]);
  assert.equal((await su(db, "select count(*)::int as n from workout where person_id = 'awp'"))[0].n, 1);
  assert.equal((await su(db, "select notes from personal_setup where person_id = 'awp'"))[0].notes, "awp private note");
});

test("one person cannot see, change, delete or join another person's gym", async (t) => {
  const db = await freshDb(t);
  assert.equal(await count(db, "fam", "gym where id = 'main'"), 0);
  assert.equal(await count(db, "fam", "gym_equipment where gym_id = 'main'"), 0);
  assert.equal(await count(db, "fam", "gym_member where gym_id = 'main'"), 0);
  assert.equal(await count(db, "fam", "person where id = 'awp'"), 0);
  await assert.rejects(as(db, "fam", "insert into gym_member (person_id, gym_id, role, status) values ('fam','main','owner','active')"), DENIED);
  await assert.rejects(as(db, "fam", "insert into gym_member (person_id, gym_id, role, status) values ('fam','main','member','pending')"), DENIED);
  await assert.rejects(as(db, "fam", "insert into gym_equipment (gym_id, id, equipment_type_id, name) values ('main','x','stack','X')"), DENIED);
  assert.equal((await as(db, "fam", "update gym set name = 'mine' where id = 'main'")).affectedRows, 0);
  assert.equal((await as(db, "fam", "delete from gym where id = 'main'")).affectedRows, 0);
  assert.equal((await as(db, "fam", "update gym_equipment set name = 'x' where gym_id = 'main'")).affectedRows, 0);
  assert.equal((await as(db, "fam", "delete from gym_equipment where gym_id = 'main'")).affectedRows, 0);
  assert.equal((await as(db, "fam", "delete from gym_member where gym_id = 'main'")).affectedRows, 0);
  assert.equal((await su(db, "select name from gym where id = 'main'"))[0].name, "Main gym");
});

test("a person cannot change who they are: id, sign-in link, or anyone else's row", async (t) => {
  const db = await freshDb(t);
  await assert.rejects(as(db, "fam", `update person set auth_user_id = '${U.stranger}' where id = 'fam'`), DENIED);
  await assert.rejects(as(db, "fam", "update person set id = 'awp' where id = 'fam'"), /row-level security|duplicate|violates/);
  assert.equal((await as(db, "fam", "update person set name = 'hacked' where id = 'awp'")).affectedRows, 0);
  assert.equal((await as(db, "fam", "delete from person")).affectedRows, 0);
  assert.equal((await su(db, "select name from person where id = 'awp'"))[0].name, "Awp");
  assert.equal((await as(db, "fam", "update person set name = 'Fam Two' where id = 'fam'")).affectedRows, 1);        // their own row is fine
});

// ---------- inside a shared gym ----------
test("a member sees the gym and its equipment but cannot edit, add people, or promote themselves", async (t) => {
  const db = await freshDb(t);
  await as(db, "me", "insert into gym_member (person_id, gym_id, role, status) values ('fam','main','member','active')");
  assert.equal(await count(db, "fam", "gym_equipment where gym_id = 'main'"), 1);
  assert.equal((await as(db, "fam", "update gym_equipment set name = 'x' where gym_id = 'main'")).affectedRows, 0);
  assert.equal((await as(db, "fam", "update gym set name = 'x' where id = 'main'")).affectedRows, 0);
  assert.equal((await as(db, "fam", "delete from gym where id = 'main'")).affectedRows, 0);
  await assert.rejects(as(db, "fam", "insert into gym_member (person_id, gym_id, role, status) values ('late','main','member','active')"), DENIED);
  await assert.rejects(as(db, "fam", "update gym_member set role = 'owner' where person_id = 'fam' and gym_id = 'main'"), /Only the gym owner/);
  assert.equal((await su(db, "select role from gym_member where person_id = 'fam' and gym_id = 'main'"))[0].role, "member");
});

test("an editor can edit equipment but still cannot add people, promote, or delete the gym", async (t) => {
  const db = await freshDb(t);
  await as(db, "me", "insert into gym_member (person_id, gym_id, role, status) values ('fam','main','editor','active')");
  assert.equal((await as(db, "fam", "update gym_equipment set name = 'Leg press 2' where gym_id = 'main'")).affectedRows, 1);
  await assert.rejects(as(db, "fam", "insert into gym_member (person_id, gym_id, role, status) values ('late','main','member','active')"), DENIED);
  await assert.rejects(as(db, "fam", "update gym_member set role = 'owner' where person_id = 'fam' and gym_id = 'main'"), /Only the gym owner/);
  assert.equal((await as(db, "fam", "delete from gym where id = 'main'")).affectedRows, 0);
});

test("deleted-row notes: a gym mate learns of shared deletions, never of private ones", async (t) => {
  const db = await freshDb(t);
  await as(db, "me", "insert into gym_member (person_id, gym_id, role, status) values ('fam','main','member','active')");
  await as(db, "me", "delete from logged_set where id = 'awp:1:leg-press'");
  await as(db, "me", "delete from gym_equipment where gym_id = 'main'");
  const seen = (await rows(db, "fam", "select table_name from deleted_row order by 1")).map((r) => r.table_name);
  assert.deepEqual(seen, ["gym_equipment"]);
  await assert.rejects(as(db, "fam", "delete from deleted_row"), DENIED);
  await assert.rejects(as(db, "fam", "insert into deleted_row (key, table_name) values ('x','x')"), DENIED);
});

test("the lookup lists and exercises: readable when signed in, changed only from the laptop (or added by gym owners and editors)", async (t) => {
  const db = await freshDb(t);
  assert.equal(await count(db, "stranger", "exercise"), 2);
  for (const sql of ["insert into equipment_type values ('x','X')", "insert into exercise_type values ('x','X','{}')"]) await assert.rejects(as(db, "me", sql), DENIED);
  for (const sql of ["update equipment_type set label = 'x'", "delete from equipment_type", "update exercise_type set label = 'x'", "delete from exercise_type",
    "update exercise set name = 'x'", "delete from exercise"]) await blocked(db, "me", sql);
  assert.equal((await as(db, "me", "insert into exercise (id, name) values ('new-one','New one')")).affectedRows, 1);        // an owner may add one
  await assert.rejects(as(db, "stranger", "insert into exercise (id, name) values ('evil','Evil')"), DENIED);
  assert.equal((await su(db, "select name from exercise where id = 'leg-press'"))[0].name, "Leg press");
});

// ---------- the two functions ----------
test("claim_invite: repeating is harmless; a used invite cannot be claimed by a second sign-in with the same email", async (t) => {
  const db = await freshDb(t);
  assert.equal((await rows(db, "me", "select public.claim_invite() as p"))[0].p, "awp");
  assert.equal((await rows(db, "me", "select public.claim_invite() as p"))[0].p, "awp");
  await assert.rejects(as(db, "twin", "select public.claim_invite()"), /No invitation|already linked/);
  assert.equal((await su(db, "select count(*)::int as n from person where auth_user_id is not null"))[0].n, 2);
});

test("claim_invite cannot take over a person that is linked to a different sign-in", async (t) => {
  const db = await freshDb(t);
  await db.exec(`insert into auth.users values ('00000000-0000-0000-0000-0000000000b1','boss@example.com', now());
    insert into invite (email, person_id, name) values ('boss@example.com','awp','Awp again')`);
  U.boss = "00000000-0000-0000-0000-0000000000b1";
  await assert.rejects(as(db, "boss", "select public.claim_invite()"), /already linked/);
  assert.equal((await su(db, "select auth_user_id from person where id = 'awp'"))[0].auth_user_id, U.me);
});

test("create_gym: a taken id is refused for everyone but its owner; the owner repeating is harmless; members cannot take over", async (t) => {
  const db = await freshDb(t);
  await assert.rejects(as(db, "fam", "select public.create_gym('main','Mine now')"), /taken/);
  await as(db, "me", "select public.create_gym('main','Main gym')");                       // the owner again: nothing changes
  await as(db, "me", "insert into gym_member (person_id, gym_id, role, status) values ('fam','main','editor','active')");
  await assert.rejects(as(db, "fam", "select public.create_gym('main','Mine now')"), /taken/);
  assert.equal((await su(db, "select name from gym where id = 'main'"))[0].name, "Main gym");
  assert.equal((await su(db, "select count(*)::int as n from gym_member where gym_id = 'main' and role = 'owner'"))[0].n, 1);
});

test("create_gym makes the caller the owner of a new gym, and nobody else gets a membership", async (t) => {
  const db = await freshDb(t);
  await as(db, "fam", "select public.create_gym('fam-2','Second')");
  assert.deepEqual(await su(db, "select person_id, role, status from gym_member where gym_id = 'fam-2'"), [{ person_id: "fam", role: "owner", status: "active" }]);
});

// ---------- what the sync (step 30b-3) will meet ----------
// The app writes with "insert ... on conflict do update" (an upsert). The rules (step 30a) closed the insert doors on person and
// gym, so an upsert of those two is refused even for your own existing row: step 30b-3 must send a plain UPDATE for them
// (and create_gym for a new gym), and may upsert everything else.
test("sync: upserts of person and gym are refused, plain updates work, private rows upsert fine", async (t) => {
  const db = await freshDb(t);
  await assert.rejects(as(db, "me", "insert into person (id, name) values ('awp','Awp') on conflict (id) do update set name = excluded.name"), /row-level security/);
  await assert.rejects(as(db, "me", "insert into gym (id, name) values ('main','Renamed') on conflict (id) do update set name = excluded.name"), /row-level security/);
  assert.equal((await as(db, "me", "update person set defaults = '{\"u\":1}' where id = 'awp'")).affectedRows, 1);
  assert.equal((await as(db, "me", "update gym set name = 'Renamed' where id = 'main'")).affectedRows, 1);
  for (const sql of [
    "insert into logged_set (id, person_id, exercise_id, gym_id, manual, weight) values ('awp:1:leg-press','awp','leg-press','main',true,105) on conflict (id) do update set weight = excluded.weight",
    "insert into personal_setup (person_id, gym_id, exercise_id, day_type, notes) values ('awp','main','leg-press','none','new') on conflict (person_id, gym_id, exercise_id, day_type) do update set notes = excluded.notes",
    "insert into gym_equipment (gym_id, id, equipment_type_id, name) values ('main','leg-press','stack','Renamed') on conflict (gym_id, id) do update set name = excluded.name",
    "insert into gym_member (person_id, gym_id, role, status) values ('awp','main','owner','active') on conflict (person_id, gym_id) do update set role = excluded.role",
  ]) assert.equal((await as(db, "me", sql)).affectedRows, 1, sql);
});
