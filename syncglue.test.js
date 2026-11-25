// Step 29d, changed in step 82: the app's data and the sync engine together: two phones with real saved tables settle on the same data.
// A phone is { db, sets, state }: db is the saved v4 object (every table), sets the list the screens keep.
import test from "node:test";
import assert from "node:assert/strict";
import { runSync } from "./syncglue.js";
import { emptySync, syncRow, rowKey, hashRow, SYNC_TABLES } from "./sync.js";
import { toStoreV4, readSets } from "./schema4.js";
import { openDb, putSets, putPerson, personOf, rowsOf, rowOf } from "./db.js";
import { matchActivities, importActivities } from "./garmin.js";
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
const phone = (store, sets = []) => { const db = openDb(toStoreV4(store, sets)); return { db, sets: readSets(db), state: emptySync() }; };
const logSet = (p, ...more) => { p.sets = [...p.sets, ...more]; p.db = putSets(p.db, p.sets); };
async function round(p, server) {
  server.remote.down = server.down;
  const r = await runSync({ db: p.db, state: p.state, remote: server.remote });
  p.db = r.db; p.state = r.state;
  if (r.sets) p.sets = r.sets;
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
  const m = {};
  for (const table of SYNC_TABLES) for (const r of p.db.tables[table]) { const x = syncRow(table, r); m[rowKey(table, x)] = hashRow(x); }
  return m;
};

// config.js is public. Sync stays off until step 30b-3, and only the project address and the PUBLISHABLE key may be in it
// (empty is fine too). A secret key, a legacy JWT key ("eyJ...") or anything else is refused.
test("sync is off, and config.js holds only a project address and a publishable key", () => {
  assert.equal(SYNC.enabled, false);
  assert.match(SYNC.url, /^(https:\/\/[a-z0-9]+\.supabase\.co)?$/);
  assert.match(SYNC.key, /^(sb_publishable_[A-Za-z0-9_-]+)?$/);
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
  logSet(a, set("leg-press", "2026-11-05T10:00:00Z"));
  await settle(a, b, server);
  assert.equal(b.sets.length, 2);
  a.sets = removeLastSet(a.sets, "leg-press", "main");
  a.db = putSets(a.db, a.sets);
  await settle(a, b, server);
  assert.equal(a.sets.length, 1);
  assert.equal(b.sets.length, 1);
});

test("a setup change on one phone reaches the other", async () => {
  const server = fakeServer();
  const a = phone(store0()); const b = phone(store0());
  await settle(a, b, server);
  const mine = personOf(a.db, "awp");
  mine.gyms.main.machines["leg-press"] = { ...mine.gyms.main.machines["leg-press"], notes: "Seat 9" };
  a.db = putPerson(a.db, "awp", mine);
  await settle(a, b, server);
  assert.equal(personOf(b.db, "awp").gyms.main.machines["leg-press"].notes, "Seat 9");
});

test("with no signal nothing changes and nothing is lost", async () => {
  const server = fakeServer();
  const a = phone(store0(), [set("leg-press", "2026-11-01T10:00:00Z")]);
  server.down = true;
  const db = a.db; const sets = a.sets;
  const r = await round(a, server);
  assert.equal(r.offline, true);
  assert.equal(a.db, db);
  assert.equal(a.sets, sets);
  assert.ok(Object.keys(a.state.queue).length > 50);
  server.down = false;
  await round(a, server);
  assert.equal(Object.keys(a.state.queue).length, 0);
  assert.ok(server.rows.size > 50);
});

test("data that cannot be converted is left alone and the old state is kept", async () => {
  const state = emptySync();
  const r = await runSync({ db: "junk", state, remote: fakeServer().remote });
  assert.equal(r.changed, false);
  assert.equal(r.state, state);
  assert.match(r.report.error, /could not be converted/);
});

// Step 82: the nested store cannot hold these, so the old way of syncing (rebuilding the tables from the store) would have lost them.
test("garmin_activity rows, the Outdoors gym and the golf and walk workouts survive a sync round that pulls", async () => {
  const server = fakeServer();
  const a = phone(store0(), [set("leg-press", "2026-11-01T10:00:00Z")]);
  const b = phone(store0());
  const acts = [
    { id: "g1", type: "golf", start: "2026-11-10T09:00:00Z", durationS: 14400, distanceM: 6000, avgHr: 100, zones: [100, 200, 300, 400, 500] },
    { id: "w1", type: "walking", start: "2026-11-12T08:00:00Z", durationS: 3600, distanceM: 4000 },
  ];
  const pid = b.db.currentPerson;
  b.db = importActivities(b.db, pid, matchActivities(acts, b.db, pid));
  const mine = { garmin: rowsOf(b.db, "garmin_activity").length, outdoors: rowsOf(b.db, "gym").filter((g) => g.outdoors).length, workouts: rowsOf(b.db, "workout").length };
  assert.deepEqual(mine, { garmin: 2, outdoors: 1, workouts: 2 });
  await settle(a, b, server);                    // b sends them; a pulls them; b also pulls a's set
  for (const p of [a, b]) {
    assert.equal(rowsOf(p.db, "garmin_activity").length, 2);
    assert.equal(rowsOf(p.db, "gym").filter((g) => g.outdoors).length, 1);
    assert.equal(rowsOf(p.db, "workout").filter((w) => w.date === "2026-11-10" || w.date === "2026-11-12").length, 2);
    assert.equal(rowOf(p.db, "garmin_activity", { id: pid + ":garmin:g1" }).zone3S, 300);
  }
  assert.equal(b.sets.length, 1);                // b really pulled something, so its db was merged
  assert.deepEqual(fingerprint(a), fingerprint(b));
});

test("a round that pulls keeps every table of the db, and one that pulls nothing hands back the same db", async () => {
  const server = fakeServer();
  const a = phone(store0(), [set("leg-press", "2026-11-01T10:00:00Z")]);
  const before = a.db;
  const r = await runSync({ db: a.db, state: a.state, remote: server.remote });
  assert.equal(r.changed, false);
  assert.equal(r.db, before);
  assert.equal(r.sets, null);
  const b = phone(emptyStore());
  const rb = await runSync({ db: b.db, state: b.state, remote: server.remote });
  assert.equal(rb.changed, true);
  assert.deepEqual(Object.keys(rb.db.tables), Object.keys(b.db.tables));
  assert.equal(rb.db.setsInTables, true);
  assert.equal(rb.sets.length, 1);
});
