import test from "node:test";
import assert from "node:assert/strict";
import { KEY, load, save, loadList } from "./storage.js";

// A stand-in for the phone's storage.
function useFakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) },
  });
  return data;
}

test("the storage names never change", () => {
  assert.deepEqual(KEY, {
    sets: "gymlog.sets",
    session: "gymlog.session",
    settings: "gymlog.settings",
    done: "gymlog.done",
    workout: "gymlog.workout",
    store: "gymlog.store",
    lastBackup: "gymlog.lastBackup",
    beforeRestore: "gymlog.beforeRestore",
  });
});

test("save then load gives back the same value", () => {
  useFakeStorage();
  save(KEY.session, { type: "legs", mode: "heavy" });
  assert.deepEqual(load(KEY.session, null), { type: "legs", mode: "heavy" });
});

test("load gives the fallback when nothing is saved or the data is damaged", () => {
  useFakeStorage({ [KEY.session]: "{not json" });
  assert.equal(load(KEY.sets, "none"), "none");
  assert.equal(load(KEY.session, "broken"), "broken");
});

test("loadList always gives a list", () => {
  useFakeStorage({ [KEY.sets]: '{"a":1}', [KEY.done]: "[1,2]" });
  assert.deepEqual(loadList(KEY.sets), []);
  assert.deepEqual(loadList(KEY.done), [1, 2]);
  assert.deepEqual(loadList(KEY.workout), []);
});

test("save does not throw when storage is unavailable", () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); } },
  });
  assert.doesNotThrow(() => save(KEY.sets, []));
  assert.deepEqual(loadList(KEY.sets), []);
});