// Step 27a: logged sets are saved inside the version 4 tables.
import test from "node:test";
import assert from "node:assert/strict";
import { emptyStore } from "./store.js";
import { toStoreV4, readStore, readSets } from "./schema4.js";
import { makeBackup, parseBackup, BACKUP_TYPE, BACKUP_VERSION } from "./backup.js";

const set = (exerciseId, time, weight, reps, extra = {}) => ({ exerciseId, time, weight, reps, unit: "lb", gymId: "main", mode: "heavy", ...extra });
const sets = [
  set("leg-press", "2026-11-02T10:00:00.000Z", 200, 5),
  set("leg-press", "2026-11-02T10:03:00.000Z", 210, 5),
  set("pull-up", "2026-11-05T09:00:00.000Z", 0, 8),
];

test("sets saved in the tables read back the same, in order", () => {
  const v4 = JSON.parse(JSON.stringify(toStoreV4(emptyStore(), sets)));
  assert.equal(v4.setsInTables, true);
  assert.ok(v4.tables.logged_set.length >= 3 && v4.tables.workout.length === 2);
  assert.deepEqual(readSets(v4), sets);
});

test("no sets yet is an empty list, not 'not moved'", () => {
  assert.deepEqual(readSets(toStoreV4(emptyStore(), [])), []);
});

test("readSets is null for data saved before the move", () => {
  assert.equal(readSets(null), null);
  assert.equal(readSets(emptyStore()), null);
  const { setsInTables, ...old } = toStoreV4(emptyStore(), sets);
  assert.equal(readSets(old), null);
});

test("the store reads back unchanged when sets are inside", () => {
  assert.deepEqual(readStore(toStoreV4(emptyStore(), sets)), readStore(toStoreV4(emptyStore(), [])));
});

test("backup version 3 holds the sets in the tables and reads back", () => {
  const b = makeBackup({ store: emptyStore(), sets });
  assert.equal(b.version, 3);
  assert.equal(BACKUP_VERSION, 3);
  assert.equal(b.sets, undefined);
  const r = parseBackup(JSON.stringify(b));
  assert.equal(r.error, "");
  assert.deepEqual(r.backup.sets, sets);
  assert.equal(r.dropped, 0);
});

test("version 2 backups (flat sets list) are still read", () => {
  const old = { type: BACKUP_TYPE, version: 2, createdAt: "2026-11-09T10:00:00.000Z", store: toStoreV4(emptyStore(), []), sets };
  delete old.store.setsInTables;
  const r = parseBackup(JSON.stringify(old));
  assert.equal(r.error, "");
  assert.deepEqual(r.backup.sets, sets);
});
