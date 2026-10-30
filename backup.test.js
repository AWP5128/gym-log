import test from "node:test";
import assert from "node:assert/strict";
import {
  BACKUP_TYPE, makeBackup, backupFileName, parseBackup, fileKind, dataSummary, describeData, backupAge,
} from "./backup.js";
import { emptyStore, migrateLegacy, exportMachines } from "./store.js";

const when = (y, m, d, h = 12) => new Date(y, m - 1, d, h, 0, 0);
const setAt = (id, date) => ({ exerciseId: id, weight: 100, reps: 5, time: date.toISOString() });

test("a backup can be written and read back", () => {
  const store = migrateLegacy({ exercises: { "leg-press": { name: "Leg Press", pins: [10, 20], notes: "Seat 4" } } });
  const sets = [setAt("leg-press", when(2026, 10, 29))];
  const r = parseBackup(JSON.stringify(makeBackup({ store, sets }, when(2026, 10, 30))));
  assert.equal(r.error, "");
  assert.equal(r.dropped, 0);
  assert.deepEqual(r.backup.sets, sets);
  assert.deepEqual(r.backup.store.gyms.main.machines["leg-press"].pins, [10, 20]);
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
  const text = JSON.stringify({
    type: BACKUP_TYPE, version: 1, store: emptyStore(),
    sets: [good, { exerciseId: 1 }, null, { exerciseId: "x", time: "not a date" }],
  });
  const r = parseBackup(text);
  assert.equal(r.error, "");
  assert.deepEqual(r.backup.sets, [good]);
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

test("dataSummary counts sets, days, machines and stacks", () => {
  const store = emptyStore();
  store.gyms.main.machines = { a: { name: "A", pins: [10, 20] }, b: { name: "B" }, c: { pins: [] } };
  const sets = [setAt("a", when(2026, 10, 28, 9)), setAt("a", when(2026, 10, 28, 10)), setAt("b", when(2026, 10, 29))];
  assert.deepEqual(dataSummary(store, sets), { sets: 3, days: 2, machines: 3, stacks: 1 });
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