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
    up("gym", { id: "main", name: "Main", units: {} }), up("gym", { id: "hotel", name: "Hotel" }),
    up("gym_member", { personId: "awp", gymId: "main", role: "owner", status: "active", offTypes: [] }),
  ];
  const r = await remote.push(changes);
  assert.deepEqual(r.done, changes.map((c) => c.key));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /^https:\/\/x\.supabase\.co\/rest\/v1\/gym\?on_conflict=id&columns=id,name,units,/);
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
  const rows = ["a", "bad", "c"].map((id) => up("gym", { id, name: "secret " + id }));
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
  assert.ok(LOAD_ORDER.length === 12);
});
