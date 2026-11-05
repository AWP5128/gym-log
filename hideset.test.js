import test from "node:test";
import assert from "node:assert/strict";
import {
  hideWeightSet, restoreWeightSet, isSetHidden, hiddenSetIds, visibleEntries, hiddenEntries, exerciseList, hideItem,
  checkName, setWeightSetUnit, weightSetUsers, makeWeightSet,
} from "./gym.js";
import { emptyStore, cleanStore } from "./store.js";

const gymOf = () => structuredClone(emptyStore().gyms.main);

test("hiding the dumbbells hides every exercise that uses them, and restoring brings them back", () => {
  const g = gymOf();
  const users = weightSetUsers(g, "dumbbells");
  assert.ok(users.length > 5);
  const h = hideWeightSet(g, "dumbbells");
  assert.equal(isSetHidden(h, "dumbbells"), true);
  assert.deepEqual(hiddenSetIds(h), ["dumbbells"]);
  for (const id of users) {
    assert.equal(visibleEntries(h).some(([k]) => k === id), false);
    assert.equal(exerciseList(h).some((e) => e.id === id), false);
    assert.equal(hiddenEntries(h).some(([k]) => k === id), false);   // they come back with the set
    assert.equal(h.equipment[id], g.equipment[id]);                  // nothing about the exercises changed
  }
  assert.ok(visibleEntries(h).some(([, i]) => i.type === "stack"));  // other equipment is untouched
  const r = restoreWeightSet(h, "dumbbells");
  assert.equal(isSetHidden(r, "dumbbells"), false);
  assert.equal(r.weightSets.dumbbells.hidden, undefined);
  for (const id of users) assert.ok(exerciseList(r).some((e) => e.id === id));
});

test("an exercise hidden on its own stays hidden after its set is hidden and restored", () => {
  const g = gymOf();
  const [one] = weightSetUsers(g, "barbell");
  const h = hideItem(g, one);
  const r = restoreWeightSet(hideWeightSet(h, "barbell"), "barbell");
  assert.equal(hiddenEntries(r).some(([k]) => k === one), true);
  assert.equal(exerciseList(r).some((e) => e.id === one), false);
});

test("a hidden set stays hidden through a unit change and through cleaning the store", () => {
  const g = hideWeightSet(gymOf(), "barbell");
  const other = g.weightSets.barbell.unit === "kg" ? "lb" : "kg";
  const r = setWeightSetUnit(g, "barbell", other);
  assert.equal(r.ok, true);
  assert.equal(isSetHidden(r.gym, "barbell"), true);
  assert.equal(makeWeightSet({ type: "barbell", hidden: true }).hidden, true);
  assert.equal(makeWeightSet({ type: "barbell", hidden: false }).hidden, undefined);
  const s = emptyStore();
  s.gyms.main = g;
  assert.equal(isSetHidden(cleanStore(JSON.parse(JSON.stringify(s))).gyms.main, "barbell"), true);
});

test("a name used by an exercise in a hidden set counts as hidden, not in use", () => {
  const g = gymOf();
  const [one] = weightSetUsers(g, "dumbbells");
  const name = g.equipment[one].name;
  assert.equal(checkName(g, name).reason, "duplicate");
  assert.equal(checkName(hideWeightSet(g, "dumbbells"), name).reason, "hidden");
});
