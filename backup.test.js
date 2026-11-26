import test from "node:test";
import assert from "node:assert/strict";
import {
  BACKUP_TYPE, BACKUP_VERSION, makeBackup, backupFileName, parseBackup, fileKind, dataSummary, describeData, backupAge,
} from "./backup.js";
import { emptyStore, migrateLegacy, exportMachines } from "./store.js";
import { makeItem } from "./gym.js";

const when = (y, m, d, h = 12) => new Date(y, m - 1, d, h, 0, 0);
const setAt = (id, date) => ({ exerciseId: id, weight: 100, reps: 5, time: date.toISOString() });

test("a backup can be written and read back", () => {
  const store = migrateLegacy({ exercises: { "leg-press": { name: "Leg Press", pins: [10, 20], notes: "Seat 4" } } });
  const sets = [{ ...setAt("leg-press", when(2026, 10, 29)), gymId: "main" }];   // the app tags every set with its gym
  const r = parseBackup(JSON.stringify(makeBackup({ store, sets }, when(2026, 10, 30))));
  assert.equal(r.error, "");
  assert.equal(r.dropped, 0);
  assert.deepEqual(r.backup.sets, sets);
  assert.deepEqual(r.backup.store.gyms.main.equipment["leg-press"].pins, [10, 20]);
  assert.equal(r.backup.store.people.awp.gyms.main.machines["leg-press"].notes, "Seat 4");
  assert.equal(r.backup.createdAt, when(2026, 10, 30).toISOString());
});

test("parseBackup rejects files that are not usable backups", () => {
  assert.ok(parseBackup("nope").error);
  assert.equal(parseBackup("nope").backup, null);
  assert.ok(parseBackup('{"type":"other"}').error);
  assert.ok(parseBackup(JSON.stringify({ type: BACKUP_TYPE, version: 1, store: { version: 1 }, sets: [] })).error);
  assert.ok(parseBackup(JSON.stringify({ type: BACKUP_TYPE, version: 99, store: emptyStore(), sets: [] })).error);
});

test("parseBackup leaves out damaged sets and counts them", () => {
  const good = setAt("leg-press", when(2026, 10, 29));
  const file = makeBackup({ store: emptyStore(), sets: [good] });
  const row = file.store.tables.logged_set[0];
  file.store.tables.logged_set.push({ ...row, id: "bad1", exerciseId: 1 }, { ...row, id: "bad2", time: "not a date" }, { ...row, id: "bad3", time: 5 });
  const r = parseBackup(JSON.stringify(file));
  assert.equal(r.error, "");
  assert.deepEqual(r.backup.sets.map((x) => x.exerciseId + x.time), [good.exerciseId + good.time]);
  assert.equal(r.dropped, 3);
});

test("fileKind tells the two file types apart", () => {
  assert.equal(fileKind(JSON.stringify(makeBackup({ store: emptyStore(), sets: [] }))), "backup");
  assert.equal(fileKind(exportMachines(emptyStore(), "main")), "machines");
  assert.equal(fileKind('{"type":"other"}'), null);
  assert.equal(fileKind("nope"), null);
});

test("backupFileName uses the local date", () => {
  assert.equal(backupFileName("backup", when(2026, 10, 30)), "gym-log-backup-2026-10-30.json");
  assert.equal(backupFileName("machines", when(2026, 1, 5)), "gym-log-machines-2026-01-05.json");
});

test("dataSummary counts sets, days, stack machines and stacks", () => {
  const store = emptyStore();
  store.gyms.main.equipment = {
    a: makeItem({ name: "A", type: "stack", pins: [10, 20] }),
    b: makeItem({ name: "B", type: "stack" }),
    c: makeItem({ name: "C", type: "stack", pins: [] }),
    d: makeItem({ name: "Bar", type: "barbell", pins: [20, 30] }),
    e: makeItem({ name: "Dumbbells", type: "dumbbell" }),
  };
  const sets = [setAt("a", when(2026, 10, 28, 9)), setAt("a", when(2026, 10, 28, 10)), setAt("b", when(2026, 10, 29))];
  assert.deepEqual(dataSummary(store, sets), { sets: 3, days: 2, machines: 3, stacks: 1 });
});

test("dataSummary adds up the stack machines in every gym", () => {
  const store = emptyStore();
  store.gyms.main.equipment = { a: makeItem({ name: "A", type: "stack", pins: [10] }) };
  store.gyms.home = { name: "Home", equipment: { a: makeItem({ name: "A", type: "stack" }), b: makeItem({ name: "B", type: "plate" }) } };
  assert.deepEqual(dataSummary(store, []), { sets: 0, days: 0, machines: 2, stacks: 1 });
});

test("describeData reads naturally", () => {
  assert.equal(describeData({ sets: 3, days: 2, machines: 3, stacks: 1 }), "3 logged sets over 2 days, 3 machines (1 with a stack)");
  assert.equal(describeData({ sets: 1, days: 1, machines: 1, stacks: 1 }), "1 logged set over 1 day, 1 machine (1 with a stack)");
  assert.equal(describeData({ sets: 0, days: 0, machines: 0, stacks: 0 }), "0 logged sets, 0 machines (0 with a stack)");
});

test("backupAge says how long ago and when a new backup is due", () => {
  const now = when(2026, 10, 30, 16);
  assert.deepEqual(backupAge(null, now), { days: null, text: "never", stale: true });
  assert.equal(backupAge("garbage", now).text, "never");
  assert.deepEqual(backupAge(when(2026, 10, 30, 9).toISOString(), now), { days: 0, text: "today", stale: false });
  assert.deepEqual(backupAge(when(2026, 10, 29, 23).toISOString(), now), { days: 1, text: "yesterday", stale: false });
  assert.deepEqual(backupAge(when(2026, 10, 27).toISOString(), now), { days: 3, text: "3 days ago", stale: false });
  assert.deepEqual(backupAge(when(2026, 10, 23).toISOString(), now), { days: 7, text: "7 days ago", stale: true });
});

test("dataSummary counts machines and stacks, and copes with no store", () => {
  const s = { gyms: { main: { name: "My gym", equipment: { a: { type: "stack", pins: [10, 20] }, b: { type: "stack" }, c: { type: "dumbbell" } } } } };
  assert.deepEqual(dataSummary(s, []), { sets: 0, days: 0, machines: 2, stacks: 1 });
  assert.deepEqual(dataSummary(null, []), { sets: 0, days: 0, machines: 0, stacks: 0 });
});

// Step 83: a backup holds the saved tables as they are. Garmin rows, the Outdoors place and the golf and walk workouts cannot be
// written from the nested store and sets, so a backup made that way lost them (and a restore wiped them from the phone).
test("a backup of the saved tables keeps Garmin rows and the golf and walk workouts, and a restore gives them back", async () => {
  const { openDb, rowsOf } = await import("./db.js");
  const { toStoreV4 } = await import("./schema4.js");
  const { matchActivities, importActivities } = await import("./garmin.js");
  let db = openDb(toStoreV4(emptyStore(), [{ ...setAt("leg-press", when(2026, 10, 20)), gymId: "main", unit: "lb", mode: "heavy" }]));
  const acts = [
    { id: "g1", type: "golf", start: "2026-11-10T09:00:00.000Z", durationS: 14400, distanceM: 6000, avgHr: 90, zones: [1, 2, 3, 4, 5] },
    { id: "e1", type: "elliptical", start: "2026-11-11T09:00:00.000Z", durationS: 1200, distanceM: 2500 },
  ];
  db = importActivities(db, db.currentPerson, matchActivities(acts, db, db.currentPerson));
  const counts = (d) => ({ garmin: rowsOf(d, "garmin_activity").length, workouts: rowsOf(d, "workout").length, outdoors: rowsOf(d, "gym").filter((g) => g.outdoors).length });
  assert.deepEqual(counts(db), { garmin: 2, workouts: 2, outdoors: 1 });
  const file = JSON.stringify(makeBackup({ db }, when(2026, 10, 26)));
  const r = parseBackup(file);
  assert.equal(r.error, "");
  assert.deepEqual(r.backup.db, db);                      // restoring this gives back every table exactly
  assert.deepEqual(counts(openDb(r.backup.db)), { garmin: 2, workouts: 2, outdoors: 1 });
  assert.equal(r.backup.sets.length, 1);                  // the screens' list of sets is still read
  assert.equal(r.backup.store.gyms.main.name, db.tables.gym.find((g) => g.id === "main").name);
  // the old way (nested store and sets) cannot carry them: this is why the app now passes the tables
  const old = parseBackup(JSON.stringify(makeBackup({ store: r.backup.store, sets: r.backup.sets })));
  assert.deepEqual(counts(openDb(old.backup.db)), { garmin: 0, workouts: 1, outdoors: 0 });
  assert.equal(parseBackup(JSON.stringify({ type: BACKUP_TYPE, version: BACKUP_VERSION, store: { junk: 1 } })).error !== "", true);
});
