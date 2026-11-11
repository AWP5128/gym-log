// Step 29d: the app's data and the sync engine together: two phones with real stores settle on the same data.
import test from "node:test";
import assert from "node:assert/strict";
import { runSync } from "./syncglue.js";
import { emptySync, syncRow, rowKey, hashRow, SYNC_TABLES } from "./sync.js";
import { toStoreV4 } from "./schema4.js";
import { emptyStore, migrateLegacy, cleanStore } from "./store.js";
import { makeSet, removeLastSet } from "./log.js";
import { SYNC } from "./config.js";

function fakeServer() {
  let clock = 0;
  const rows = new Map(); const gone = new Map();
  return {
    rows, down: false,
    remote: {
      async push(changes) {
        if (this.down) throw new Error("no signal");
        const done = [];
        for (const c of changes) {
          clock++;
          if (c.op === "delete") { rows.delete(c.key); gone.set(c.key, clock); } else { rows.set(c.key, { table: c.table, row: c.row, at: clock }); gone.delete(c.key); }
          done.push(c.key);
        }
        return { done, failed: [] };
      },
      async pull(cursor) {
        if (this.down) throw new Error("no signal");
        const since = cursor ?? 0;
        return { rows: [...rows.values()].filter((r) => r.at >= since).map(({ table, row }) => ({ table, row })),
          deletes: [...gone].filter(([, at]) => at >= since).map(([key]) => ({ key })), cursor: clock };
      },
    },
  };
}
const set = (id, iso) => makeSet({ exerciseId: id, weight: 100, reps: 5, mode: "heavy", gymId: "main", unit: "lb", now: new Date(iso) });
const store0 = () => cleanStore(migrateLegacy({ exercises: { "leg-press": { name: "Leg Press", pins: [10, 20], notes: "Seat 4" } } }));
const phone = (store, sets = []) => ({ store, sets, state: emptySync() });
async function round(p, server) {
  server.remote.down = server.down;
  const r = await runSync({ store: p.store, sets: p.sets, state: p.state, remote: server.remote });
  p.store = r.store; p.sets = r.sets; p.state = r.state;
  return r.report;
}
// keep going until a full pass over both phones sends and receives nothing
async function settle(a, b, server, max = 8) {
  for (let i = 1; i <= max; i++) {
    const ra = await round(a, server); const rb = await round(b, server);
    if (ra.queued + ra.pushed + ra.pulled + rb.queued + rb.pushed + rb.pulled === 0) return i;
  }
  return Infinity;
}
const fingerprint = (p) => {
  const t = toStoreV4(p.store, p.sets).tables;
  const m = {};
  for (const table of SYNC_TABLES) for (const r of t[table]) { const x = syncRow(table, r); m[rowKey(table, x)] = hashRow(x); }
  return m;
};

test("sync is off in the shipped settings", () => {
  assert.equal(SYNC.enabled, false);
  assert.equal(SYNC.url, "");
  assert.equal(SYNC.key, "");
});

test("a set's list position is not synced", () => {
  assert.equal(hashRow(syncRow("logged_set", { id: "a", seq: 3, weight: 5 })), hashRow(syncRow("logged_set", { id: "a", weight: 5 })));
  assert.deepEqual(syncRow("gym", { id: "main", seq: 1 }), { id: "main", seq: 1 });
});

test("two phones with different data settle on the same data, and then stop sending", async () => {
  const server = fakeServer();
  const a = phone(store0(), [set("leg-press", "2026-11-01T10:00:00Z"), set("pull-up", "2026-11-01T10:20:00Z"), set("leg-press", "2026-11-03T10:00:00Z")]);
  const b = phone(emptyStore(), [set("leg-press", "2026-11-02T09:00:00Z")]);
  const passes = await settle(a, b, server);
  assert.ok(passes <= 5, "settled after " + passes + " passes");
  assert.deepEqual(fingerprint(a), fingerprint(b));
  const times = (p) => p.sets.map((s) => s.time);
  assert.equal(a.sets.length, 4);
  assert.deepEqual(times(a), times(b));
  assert.deepEqual(times(a), [...times(a)].sort());              // in time order whichever phone logged them
});

test("a set logged on one phone arrives on the other, and an undo follows it", async () => {
  const server = fakeServer();
  const a = phone(store0(), [set("leg-press", "2026-11-01T10:00:00Z")]);
  const b = phone(store0());
  await settle(a, b, server);
  a.sets = [...a.sets, set("leg-press", "2026-11-05T10:00:00Z")];
  await settle(a, b, server);
  assert.equal(b.sets.length, 2);
  a.sets = removeLastSet(a.sets, "leg-press", "main");
  await settle(a, b, server);
  assert.equal(a.sets.length, 1);
  assert.equal(b.sets.length, 1);
});

test("a setup change on one phone reaches the other", async () => {
  const server = fakeServer();
  const a = phone(store0()); const b = phone(store0());
  await settle(a, b, server);
  a.store.people.awp.gyms.main.machines["leg-press"] = { ...a.store.people.awp.gyms.main.machines["leg-press"], notes: "Seat 9" };
  await settle(a, b, server);
  assert.equal(b.store.people.awp.gyms.main.machines["leg-press"].notes, "Seat 9");
});

test("with no signal nothing changes and nothing is lost", async () => {
  const server = fakeServer();
  const a = phone(store0(), [set("leg-press", "2026-11-01T10:00:00Z")]);
  server.down = true;
  const store = a.store; const sets = a.sets;
  const r = await round(a, server);
  assert.equal(r.offline, true);
  assert.equal(a.store, store);
  assert.equal(a.sets, sets);
  assert.ok(Object.keys(a.state.queue).length > 50);
  server.down = false;
  await round(a, server);
  assert.equal(Object.keys(a.state.queue).length, 0);
  assert.ok(server.rows.size > 50);
});

test("data that cannot be converted is left alone and the old state is kept", async () => {
  const state = emptySync();
  const r = await runSync({ store: "junk", sets: [], state, remote: fakeServer().remote });
  assert.equal(r.changed, false);
  assert.equal(r.state, state);
  assert.match(r.report.error, /could not be converted/);
});
