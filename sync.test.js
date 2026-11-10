// Step 29a: the sync engine, against a small in-memory stand-in for the server.
import test from "node:test";
import assert from "node:assert/strict";
import { emptySync, syncOnce, detectChanges, orderChanges, rowKey, pkOfKey, tableOfKey, hashRow, SYNC_TABLES } from "./sync.js";
import { migrateToV4, toStoreV4 } from "./schema4.js";
import { migrateLegacy, cleanStore } from "./store.js";
import { makeSet } from "./log.js";

// The server: stamps each change with its own clock (the last to arrive wins) and remembers deletes.
function fakeServer() {
  let clock = 0;
  const rows = new Map();     // key -> { table, row, at }
  const gone = new Map();     // key -> at
  const api = {
    rows, down: false, pushes: 0,
    remote: {
      async push(changes) {
        if (api.down) throw new Error("no signal");
        api.pushes++;
        const done = [];
        for (const c of changes) {
          clock++;
          if (c.op === "delete") { rows.delete(c.key); gone.set(c.key, clock); }
          else { rows.set(c.key, { table: c.table, row: c.row, at: clock }); gone.delete(c.key); }
          done.push(c.key);
        }
        return { done, failed: [] };
      },
      async pull(cursor) {
        if (api.down) throw new Error("no signal");
        const since = cursor ?? 0;
        return {
          rows: [...rows.values()].filter((r) => r.at >= since).map(({ table, row }) => ({ table, row })),
          deletes: [...gone].filter(([, at]) => at >= since).map(([key]) => ({ key })),
          cursor: clock,
        };
      },
    },
  };
  return api;
}

const person = () => cleanStore(migrateLegacy({ exercises: { "leg-press": { name: "Leg Press", pins: [10, 20], notes: "Seat 4", heavy: { warmup: { weight: 40, reps: 10 }, working: { weight: 100, reps: 5, sets: 4 } } } } }));
const set = (id, iso, extra = {}) => makeSet({ exerciseId: id, weight: 100, reps: 5, mode: "heavy", gymId: "main", unit: "lb", now: new Date(iso), ...extra });
const tablesOf = (sets = []) => structuredClone(migrateToV4({ store: person(), sets }).v4.tables);
const phone = (tables = tablesOf([])) => ({ tables, state: emptySync() });
async function sync(p, server) { const r = await syncOnce({ tables: p.tables, state: p.state, remote: server.remote }); p.tables = r.tables; p.state = r.state; return r.report; }
const same = (a, b) => { for (const t of SYNC_TABLES) assert.deepEqual([...(a[t] ?? [])].map((r) => rowKey(t, r)).sort(), [...(b[t] ?? [])].map((r) => rowKey(t, r)).sort(), t); };

test("keys, hashes and ordering", () => {
  const k = rowKey("personal_setup", { personId: "awp", gymId: "main", exerciseId: "leg-press", dayType: null });
  assert.equal(tableOfKey(k), "personal_setup");
  assert.deepEqual(pkOfKey(k), ["awp", "main", "leg-press", "none"]);
  assert.equal(hashRow({ a: 1, b: null }), hashRow({ b: undefined, a: 1 }));
  assert.notEqual(hashRow({ a: 1 }), hashRow({ a: 2 }));
  const o = orderChanges([{ table: "logged_set", op: "upsert" }, { table: "gym", op: "upsert" }, { table: "gym", op: "delete" }, { table: "logged_set", op: "delete" }]);
  assert.deepEqual(o.map((c) => c.table + ":" + c.op), ["logged_set:delete", "gym:delete", "gym:upsert", "logged_set:upsert"]);
});

test("a phone with data and an empty server pushes everything once", async () => {
  const server = fakeServer();
  const a = phone(tablesOf([set("leg-press", "2026-11-01T10:00:00Z")]));
  const r = await sync(a, server);
  assert.ok(r.pushed > 50 && r.failed.length === 0 && !r.offline);
  assert.ok(server.rows.size === r.pushed);
  const again = await sync(a, server);
  assert.equal(again.queued, 0);
  assert.equal(again.pushed, 0);
});

test("a second, empty phone receives everything", async () => {
  const server = fakeServer();
  const a = phone(tablesOf([set("leg-press", "2026-11-01T10:00:00Z")]));
  await sync(a, server);
  const b = phone({});
  const r = await sync(b, server);
  assert.ok(r.pulled > 50);
  same(a.tables, b.tables);
  assert.equal((await sync(b, server)).queued, 0);
});

test("a change on one phone reaches the other", async () => {
  const server = fakeServer();
  const a = phone(); const b = phone({});
  await sync(a, server); await sync(b, server);
  a.tables.personal_setup[0] = { ...a.tables.personal_setup[0], notes: "Seat 7" };
  const r = await sync(a, server);
  assert.equal(r.pushed, 1);
  await sync(b, server);
  assert.equal(b.tables.personal_setup[0].notes, "Seat 7");
});

test("two phones change the same row: the last to arrive wins, and both end up the same", async () => {
  const server = fakeServer();
  const a = phone(); const b = phone({});
  await sync(a, server); await sync(b, server);
  a.tables.personal_setup[0] = { ...a.tables.personal_setup[0], notes: "from A" };
  b.tables.personal_setup[0] = { ...b.tables.personal_setup[0], notes: "from B" };
  await sync(a, server);
  await sync(b, server);      // B arrives last
  await sync(a, server);
  assert.equal(a.tables.personal_setup[0].notes, "from B");
  assert.equal(b.tables.personal_setup[0].notes, "from B");
  assert.equal([...server.rows.values()].find((r) => r.table === "personal_setup").row.notes, "from B");
});

test("a change still waiting is not overwritten by what is pulled, and wins when it is pushed", async () => {
  const server = fakeServer();
  const a = phone(); const b = phone({});
  await sync(a, server); await sync(b, server);
  a.tables.personal_setup[0] = { ...a.tables.personal_setup[0], notes: "from A" };
  await sync(a, server);
  b.tables.personal_setup[0] = { ...b.tables.personal_setup[0], notes: "from B" };
  const realPush = server.remote.push;
  server.remote.push = async (changes) => ({ done: [], failed: changes.map((c) => ({ key: c.key, error: "refused" })) });   // the push is refused, the pull works
  const r = await sync(b, server);
  assert.equal(r.failed.length, 1);
  assert.equal(r.skipped, 1);
  assert.equal(b.tables.personal_setup[0].notes, "from B");               // A's version did not replace it
  assert.equal(Object.keys(b.state.queue).length, 1);                     // and it is still waiting
  server.remote.push = realPush;
  await sync(b, server);
  assert.equal(Object.keys(b.state.queue).length, 0);
  assert.equal([...server.rows.values()].find((x) => x.table === "personal_setup").row.notes, "from B");
});

test("offline loses nothing: the queue is kept and pushed later", async () => {
  const server = fakeServer();
  const a = phone();
  server.down = true;
  const r1 = await sync(a, server);
  assert.equal(r1.offline, true);
  assert.ok(Object.keys(a.state.queue).length > 50);
  server.down = false;
  const r2 = await sync(a, server);
  assert.equal(Object.keys(a.state.queue).length, 0);
  assert.equal(server.rows.size, r2.pushed);
});

test("sets logged on two phones both survive; an undo is passed on", async () => {
  const server = fakeServer();
  const a = phone(); const b = phone({});
  await sync(a, server); await sync(b, server);
  a.tables = tablesOf([set("leg-press", "2026-11-05T10:00:00Z")]); await sync(a, server);
  const tb = migrateToV4({ store: person(), sets: [set("leg-press", "2026-11-05T10:03:00Z")] }).v4.tables;   // B logs a different set the same day
  b.tables = { ...b.tables, ...Object.fromEntries(["workout", "workout_type", "workout_exercise", "logged_set"].map((t) => [t, tb[t]])) };
  await sync(b, server); await sync(a, server); await sync(b, server);
  const ids = (p) => p.tables.logged_set.filter((s) => s.time).map((s) => s.id).sort();
  assert.equal(ids(a).length, 2);
  assert.deepEqual(ids(a), ids(b));
  assert.equal([...server.rows.values()].filter((r) => r.table === "logged_set" && r.row.time).length, 2);
  // undo on A: the set disappears from A, then from the server, then from B
  const before = [...server.rows.values()].filter((r) => r.table === "logged_set").length;
  const victim = a.tables.logged_set.find((s) => s.time);
  a.tables = { ...a.tables, logged_set: a.tables.logged_set.filter((s) => s !== victim) };
  const r = await sync(a, server);
  assert.ok(r.pushed >= 1);
  assert.equal([...server.rows.values()].filter((x) => x.table === "logged_set").length, before - 1);
  await sync(b, server);
  assert.ok(!b.tables.logged_set.some((s) => s.id === victim.id));
});

test("an exercise row is only ever added, never changed or deleted by a phone", () => {
  const t = tablesOf();
  const first = detectChanges({}, t);
  assert.ok(first.changes.some((c) => c.table === "exercise"));
  const edited = structuredClone(t);
  edited.exercise[0] = { ...edited.exercise[0], name: "Renamed" };
  assert.equal(detectChanges(first.snapshot, edited).changes.length, 0);
  edited.exercise.shift();
  assert.equal(detectChanges(first.snapshot, edited).changes.length, 0);
});

test("the fixed type lists are never synced", () => {
  const { changes } = detectChanges({}, tablesOf());
  assert.ok(!changes.some((c) => c.table === "equipment_type" || c.table === "exercise_type"));
});

test("set ids stay the same when the list changes, and differ for the same moment on different exercises", () => {
  const a = set("leg-press", "2026-11-05T10:00:00Z"); const b = set("pull-up", "2026-11-05T10:00:00Z"); const c = set("leg-press", "2026-11-05T10:05:00Z");
  const ids = (list) => migrateToV4({ store: person(), sets: list }).v4.tables.logged_set.filter((s) => s.time).map((s) => s.id);
  const all = ids([a, b, c]);
  assert.equal(new Set(all).size, 3);
  assert.deepEqual(ids([a, c]).filter((x) => all.includes(x)).length, 2);       // removing b leaves a's and c's ids alone
  assert.equal(new Set(ids([a, a])).size, 2);                                    // two identical taps are still two sets
});
