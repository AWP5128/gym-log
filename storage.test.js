import test from "node:test";
import assert from "node:assert/strict";
import { KEY, OLD_KEYS, load, save, loadList, removeOldKeys } from "./storage.js";

// A stand-in for the phone's storage.
function useFakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) },
  });
  return data;
}

test("the storage names never change", () => {
  assert.deepEqual(KEY, {
    session: "gymlog.session",
    done: "gymlog.done",
    workout: "gymlog.workout",
    store: "gymlog.store",
    lastBackup: "gymlog.lastBackup",
    beforeRestore: "gymlog.beforeRestore",
    sync: "gymlog.sync",
    unreadable: "gymlog.unreadable",
  });
});

test("save then load gives back the same value", () => {
  useFakeStorage();
  save(KEY.session, { type: "legs", mode: "heavy" });
  assert.deepEqual(load(KEY.session, null), { type: "legs", mode: "heavy" });
});

test("the safety copy is kept apart from the store", () => {
  useFakeStorage();
  save(KEY.store, { version: 3 });
  save(KEY.beforeRestore, { version: 3 });
  assert.deepEqual(load(KEY.store, null), { version: 3 });
  assert.deepEqual(load(KEY.beforeRestore, null), { version: 3 });
});

test("load gives the fallback when nothing is saved or the data is damaged", () => {
  useFakeStorage({ [KEY.session]: "{not json" });
  assert.equal(load(KEY.workout, "none"), "none");
  assert.equal(load(KEY.session, "broken"), "broken");
});

test("loadList always gives a list", () => {
  useFakeStorage({ [KEY.session]: '{"a":1}', [KEY.done]: "[1,2]" });
  assert.deepEqual(loadList(KEY.session), []);
  assert.deepEqual(loadList(KEY.done), [1, 2]);
  assert.deepEqual(loadList(KEY.workout), []);
});

test("save does not throw when storage is unavailable", () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); } },
  });
  assert.doesNotThrow(() => save(KEY.done, []));
  assert.deepEqual(loadList(KEY.done), []);
  assert.doesNotThrow(() => removeOldKeys());
});

test("removeOldKeys removes only the old names", () => {
  const data = useFakeStorage({
    "gymlog.sets": "[1]", "gymlog.settings": "{}", "gymlog.beforeGyms": "{}", "gymlog.beforeV4": "{}", "gymlog.beforeStageC": "{}",
    [KEY.store]: "{}", [KEY.beforeRestore]: "{}", [KEY.lastBackup]: "x", [KEY.unreadable]: "{}", [KEY.sync]: "{}",
  });
  assert.deepEqual(OLD_KEYS, ["gymlog.sets", "gymlog.settings", "gymlog.beforeGyms", "gymlog.beforeV4", "gymlog.beforeStageC"]);
  removeOldKeys();
  assert.deepEqual([...data.keys()].sort(), [KEY.beforeRestore, KEY.lastBackup, KEY.store, KEY.sync, KEY.unreadable].sort());
});