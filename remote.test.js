// Step 29c: the connection to the online database, tested with a pretend fetch (no network) and, for the row
// conversion, with real rows read back from an in-memory Postgres (PGlite) in the form the web service returns them.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { makeRemote } from "./remote.js";
import { rowKey, hashRow, SYNC_TABLES } from "./sync.js";
import { toDbRow, fromDbRow, loadTables, LOAD_ORDER } from "./dbload.js";
import { migrateToV4 } from "./schema4.js";
import { migrateLegacy, cleanStore } from "./store.js";
import { makeSet } from "./log.js";

const json = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
function pretend(handler) {
  const calls = [];
  const fetchFn = async (url, init) => {
    const call = { url, method: init.method, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body) };
    calls.push(call);
    return handler(call);
  };
  return { calls, fetchFn };
}
const make = (handler, extra = {}) => {
  const p = pretend(handler);
  return { ...p, remote: makeRemote({ url: "https://x.supabase.co/", key: "pub-key", getToken: async () => "user-token", fetchFn: p.fetchFn, ...extra }) };
};
const up = (table, row) => ({ key: rowKey(table, row), table, op: "upsert", row });

test("push sends consecutive rows of one table together, as the signed-in person", async () => {
  const { remote, calls } = make(() => json(201));
  const changes = [
    up("workout", { id: "a", personId: "awp", gymId: "main", date: "2026-11-02" }), up("workout", { id: "b", personId: "awp", gymId: "main", date: "2026-11-03" }),
    up("gym_member", { personId: "awp", gymId: "main", role: "owner", status: "active", offTypes: [] }),
  ];
  const r = await remote.push(changes);
  assert.deepEqual(r.done, changes.map((c) => c.key));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /^https:\/\/x\.supabase\.co\/rest\/v1\/workout\?on_conflict=id&columns=id,person_id,gym_id,date,/);
  assert.equal(calls[0].body.length, 2);
  assert.equal(calls[0].headers.apikey, "pub-key");
  assert.equal(calls[0].headers.Authorization, "Bearer user-token");
  assert.match(calls[0].headers.Prefer, /merge-duplicates/);
  assert.match(calls[1].url, /gym_member\?on_conflict=person_id,gym_id&/);
  assert.deepEqual(calls[1].body[0], { person_id: "awp", gym_id: "main", role: "owner", status: "active", off_types: [] });
});

test("push deletes one row at a time, with the key in the address", async () => {
  const { remote, calls } = make(() => json(204));
  const keys = [rowKey("personal_setup", { personId: "awp", gymId: "main", exerciseId: "leg-press", dayType: null }), rowKey("logged_set", { id: "awp:2026-11-02T10:00:00.000Z:leg-press" })];
  const r = await remote.push(keys.map((key) => ({ key, table: key.split("|")[0], op: "delete" })));
  assert.deepEqual(r.done, keys);
  assert.equal(calls[0].method, "DELETE");
  assert.ok(calls[0].url.endsWith("personal_setup?person_id=eq.awp&gym_id=eq.main&exercise_id=eq.leg-press&day_type=eq.none"));
  assert.ok(calls[1].url.endsWith("logged_set?id=eq.awp%3A2026-11-02T10%3A00%3A00.000Z%3Aleg-press"));
});

test("a refused group is retried row by row so only the refused row is reported, without its data", async () => {
  const { remote, calls } = make((c) => (c.body.some((r) => r.id === "bad") ? json(403, { code: "42501", message: "new row violates row-level security policy" }) : json(201)));
  const rows = ["a", "bad", "c"].map((id) => up("gym_equipment", { gymId: "main", id, name: "secret " + id }));
  const r = await remote.push(rows);
  assert.deepEqual(r.done, [rows[0].key, rows[2].key]);
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].key, rows[1].key);
  assert.match(r.failed[0].error, /403 42501/);
  assert.ok(!r.failed[0].error.includes("secret"));
  assert.equal(calls.length, 4);
});

test("no token, signed out, server errors and a lost connection all throw (the engine treats them as offline)", async () => {
  const ch = [up("gym", { id: "main", name: "Main" })];
  await assert.rejects(makeRemote({ url: "https://x.co", key: "k", getToken: async () => null, fetchFn: async () => json(201) }).push(ch), /Not signed in/);
  await assert.rejects(make(() => json(401)).remote.push(ch), /Signed out/);
  await assert.rejects(make(() => json(503)).remote.push(ch), /Server error 503/);
  await assert.rejects(make(() => { throw new TypeError("Failed to fetch"); }).remote.push(ch), /Failed to fetch/);
  await assert.rejects(make(() => json(401)).remote.pull(null), /Signed out/);
});

test("pull with no cursor reads every table and the deletions, in pages, and returns the newest time", async () => {
  const gyms = [1, 2, 3, 4, 5].map((n) => ({ id: "g" + n, name: "Gym " + n, units: {}, updated_at: `2026-11-10T10:00:0${n}.123456+00:00` }));
  const { remote, calls } = make((c) => {
    const table = c.url.split("/rest/v1/")[1].split("?")[0];
    if (table === "gym") { const [a, b] = c.headers.Range.split("-").map(Number); return json(206, gyms.slice(a, b + 1)); }
    if (table === "deleted_row") return json(200, [{ key: 'logged_set|["x"]', deleted_at: "2026-11-10T11:00:00.5+00:00" }]);
    return json(200, []);
  }, { pageSize: 2 });
  const r = await remote.pull(null);
  assert.deepEqual(r.rows.map((x) => x.row.id), ["g1", "g2", "g3", "g4", "g5"]);
  assert.ok(r.rows.every((x) => x.table === "gym" && !("updated_at" in x.row)));
  assert.deepEqual(r.deletes, [{ key: 'logged_set|["x"]' }]);
  assert.equal(r.cursor, "2026-11-10T11:00:00.5+00:00");
  const gymCalls = calls.filter((c) => c.url.includes("/gym?"));
  assert.deepEqual(gymCalls.map((c) => c.headers.Range), ["0-1", "2-3", "4-5"]);
  assert.equal(calls.length, SYNC_TABLES.length - 1 + 3 + 1);
  assert.ok(!calls[0].url.includes("updated_at=gte"));
});

test("pull with a cursor asks only for newer rows, starting a little earlier, with the time properly encoded", async () => {
  const { remote, calls } = make(() => json(200, []));
  const r = await remote.pull("2026-11-10T12:00:00.000000+00:00");
  assert.ok(calls.every((c) => /(updated_at|deleted_at)=gte\.2026-11-10T11%3A55%3A00\.000Z/.test(c.url)));
  assert.equal(r.cursor, "2026-11-10T12:00:00.000000+00:00");      // nothing new: the cursor stays
});

// ---- rows as the real database returns them ----
let template;
const opened = [];
test.after(async () => { for (const d of opened) await d.close(); if (template) await (await template).close(); });
async function freshDb() {
  template ??= (async () => {
    const db = new PGlite();
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      grant usage on schema public to anon, authenticated;`);
    for (const f of readdirSync("supabase/migrations").sort()) await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
    return db;
  })();
  const db = await (await template).clone();
  opened.push(db);
  return db;
}

test("every row survives the trip: app row -> database -> web service form -> app row, with the same fingerprint", async () => {
  const store = cleanStore(migrateLegacy({ exercises: { "leg-press": { name: "Leg Press", pins: [10, 20], notes: "Seat 4", heavy: { warmup: { weight: 40, reps: 10 }, working: { weight: 100.5, reps: 5, sets: 4 } } } } }));
  store.people.awp.gyms.main.machines["pull-up"] = { notes: "Neutral grip", pbWeight: 12.5, pbReps: 4 };
  const sets = [
    makeSet({ exerciseId: "leg-press", weight: 100.5, reps: 8, mode: "heavy", gymId: "main", unit: "lb", now: new Date("2026-11-01T10:00:00.123Z") }),
    makeSet({ exerciseId: "custom-x", minutes: 12, gymId: "main", now: new Date("2026-11-04T09:00:00Z") }),
  ];
  const v4 = migrateToV4({ store, sets }).v4;
  const db = await freshDb();
  await loadTables(db, v4);
  let checked = 0;
  for (const table of SYNC_TABLES) {
    const back = (await db.query(`select to_jsonb(t) as j from public."${table}" t`)).rows.map((r) => r.j);   // the form PostgREST sends
    const want = new Map(v4.tables[table].map((r) => [rowKey(table, r), hashRow(r)]));
    assert.equal(back.length, want.size, table);
    for (const j of back) {
      const row = fromDbRow(table, j);
      assert.equal(hashRow(row), want.get(rowKey(table, row)), table + " " + rowKey(table, row));
      checked++;
    }
  }
  assert.ok(checked > 80);
});

test("toDbRow leaves out blanks, fills what the database needs and uses snake_case", () => {
  assert.deepEqual(toDbRow("personal_setup", { personId: "awp", gymId: "main", exerciseId: "x", dayType: null, notes: "n" }),
    { person_id: "awp", gym_id: "main", exercise_id: "x", day_type: "none", notes: "n" });
  assert.deepEqual(fromDbRow("logged_set", { id: "s", seq: "3", person_id: "awp", exercise_id: "x", gym_id: "main", time: "2026-11-02T10:00:00+00:00", weight: 5, manual: false, mode: null, updated_at: "z" }),
    { id: "s", seq: 3, personId: "awp", exerciseId: "x", gymId: "main", time: "2026-11-02T10:00:00.000Z", weight: 5 });
  assert.ok(LOAD_ORDER.length === 13);
});

// ---------- Step 84: person and gym rows are a PATCH, with create_gym for a gym that is not online yet ----------
const gymRow = { id: "g-abc12345", name: "Hotel", units: { stack: "lb" }, starterFree: true };
test("a gym that is online is saved with one PATCH by its id, all other columns sent (blank ones as null)", async () => {
  const { remote, calls } = make(() => json(200, [{ id: "g-abc12345" }]));
  const r = await remote.push([up("gym", gymRow)]);
  assert.deepEqual(r.done, [rowKey("gym", gymRow)]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "PATCH");
  assert.ok(calls[0].url.endsWith("/rest/v1/gym?id=eq.g-abc12345"));
  assert.equal(calls[0].headers.Prefer, "return=representation");
  assert.deepEqual(calls[0].body, { name: "Hotel", units: { stack: "lb" }, list_default: null, starter_free: true, starter_abs: null, starter_cardio: null, pull_ups_moved: null, outdoors: null });
  assert.equal(calls[0].headers.Authorization, "Bearer user-token");
});

test("a gym that is not online yet is made with create_gym, then PATCHed so every column is set", async () => {
  let made = false;
  const { remote, calls } = make((c) => {
    if (c.url.endsWith("rpc/create_gym")) { made = true; return json(204); }
    return json(200, made ? [{ id: "g-abc12345" }] : []);
  });
  const r = await remote.push([up("gym", gymRow)]);
  assert.deepEqual(r.done, [rowKey("gym", gymRow)]);
  assert.deepEqual(calls.map((c) => c.method + " " + c.url.split("/rest/v1/")[1].split("?")[0]), ["PATCH gym", "POST rpc/create_gym", "PATCH gym"]);
  assert.deepEqual(calls[1].body, { g: "g-abc12345", n: "Hotel" });
  assert.equal(calls[2].body.units.stack, "lb");
});

test("create_gym refused (a gym id that is someone else's) is reported by code and message only, and nothing else is sent for it", async () => {
  const { remote, calls } = make((c) => (c.url.endsWith("rpc/create_gym") ? json(400, { code: "P0001", message: "That gym id is taken" }) : json(200, [])));
  const r = await remote.push([up("gym", { ...gymRow, name: "secret hotel" }), up("gym_member", { personId: "awp", gymId: "main", role: "owner", status: "active", offTypes: [] })]);
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].key, rowKey("gym", gymRow));
  assert.match(r.failed[0].error, /400 P0001 That gym id is taken/);
  assert.ok(!r.failed[0].error.includes("secret"));
  assert.equal(calls.filter((c) => c.method === "PATCH").length, 1);
  assert.equal(r.done.length, 1);                                    // the rows after it still go
});

test("a person is saved with a PATCH by id; if no row answers it is reported, never created", async () => {
  const person = { id: "awp", name: "Awp", defaults: { heavy: { reps: 5 } } };
  const ok = make(() => json(200, [{ id: "awp" }]));
  assert.deepEqual((await ok.remote.push([up("person", person)])).done, [rowKey("person", person)]);
  assert.ok(ok.calls[0].url.endsWith("/rest/v1/person?id=eq.awp"));
  assert.deepEqual(ok.calls[0].body, { name: "Awp", defaults: { heavy: { reps: 5 } }, superset: null });
  const none = make(() => json(200, []));
  const r = await none.remote.push([up("person", person)]);
  assert.equal(none.calls.length, 1);
  assert.equal(r.done.length, 0);
  assert.match(r.failed[0].error, /not online/);
});

test("gym and person rows are never batched, and a refused PATCH is reported without its data", async () => {
  const { remote, calls } = make((c) => (c.url.includes("id=eq.bad") ? json(403, { code: "42501", message: "denied" }) : json(200, [{}])));
  const rows = ["a", "bad", "c"].map((id) => up("gym", { id, name: "secret " + id }));
  const r = await remote.push(rows);
  assert.equal(calls.length, 3);
  assert.deepEqual(r.done, [rows[0].key, rows[2].key]);
  assert.match(r.failed[0].error, /403 42501 denied/);
  assert.ok(!r.failed[0].error.includes("secret"));
});

// Step 85: single-leg reps go to the database and come back
test("a logged set sends its single-leg reps, and an ordinary set sends none", async () => {
  const { remote, calls } = make(() => json(201));
  const leg = { id: "awp:t:leg-press", personId: "awp", exerciseId: "leg-press", gymId: "main", time: "2026-11-25T11:59:00.000Z", weight: 85, reps: 22, repsLeft: 12, repsRight: 10, unit: "lb" };
  const two = { ...leg, id: "awp:u:leg-press", repsLeft: undefined, repsRight: undefined };
  await remote.push([up("logged_set", leg), up("logged_set", two)]);
  assert.match(calls[0].url, /columns=[^&]*reps,reps_left,reps_right,/);
  assert.deepEqual([calls[0].body[0].reps, calls[0].body[0].reps_left, calls[0].body[0].reps_right], [22, 12, 10]);
  assert.equal("reps_left" in calls[0].body[1], false);
});
