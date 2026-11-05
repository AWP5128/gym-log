import test from "node:test";
import assert from "node:assert/strict";
import { editItem, exerciseList, weightSetUsers } from "./gym.js";
import { emptyStore } from "./store.js";

const gymOf = () => structuredClone(emptyStore().gyms.main);
const none = new Set();

test("editItem renames and changes the session, and refuses a blank or duplicate name", () => {
  const g = gymOf();
  const r = editItem(g, "leg-press", { name: "  Leg Press 45  ", group: "abs" });
  assert.equal(r.ok, true);
  assert.equal(r.gym.equipment["leg-press"].name, "Leg Press 45");
  assert.equal(r.gym.equipment["leg-press"].group, "abs");
  assert.equal(editItem(g, "leg-press", { name: "   " }).reason, "blank");
  const other = g.equipment["pull-up"].name;
  const d = editItem(g, "leg-press", { name: other.toUpperCase() });
  assert.equal(d.reason, "duplicate");
  assert.equal(d.existing, "pull-up");
  assert.equal(editItem(g, "nope", { name: "x" }).reason, "missing");
});

test("editItem changes the unit of a machine only when it has no history", () => {
  const g = gymOf();
  const r = editItem(g, "leg-press", { unit: "kg" }, none);
  assert.equal(r.ok, true);
  assert.equal(r.gym.equipment["leg-press"].unit, "kg");
  assert.equal(r.gym.equipment["leg-press"].pins, undefined);
  const h = editItem(g, "leg-press", { unit: "kg" }, new Set(["leg-press"]));
  assert.equal(h.ok, false);
  assert.equal(h.reason, "history");
  assert.equal(h.gym, g);
  // a rename is still fine when there is history
  assert.equal(editItem(g, "leg-press", { name: "Leg Press B" }, new Set(["leg-press"])).ok, true);
});

test("editItem moves an exercise onto a weight set when its type becomes dumbbell, and off it again", () => {
  const g = gymOf();
  const r = editItem(g, "leg-press", { type: "dumbbell" }, none);
  assert.equal(r.ok, true);
  const it = r.gym.equipment["leg-press"];
  assert.equal(it.type, "dumbbell");
  assert.equal(it.weightSet, "dumbbells");
  assert.equal(it.unit, r.gym.weightSets.dumbbells.unit);
  assert.ok(weightSetUsers(r.gym, "dumbbells").includes("leg-press"));
  const ex = exerciseList(r.gym).find((e) => e.id === "leg-press");
  assert.deepEqual(ex.pins, r.gym.weightSets.dumbbells.pins);
  const back = editItem(r.gym, "leg-press", { type: "stack" }, none);
  assert.equal(back.gym.equipment["leg-press"].weightSet, undefined);
  assert.equal(back.gym.equipment["leg-press"].type, "stack");
  assert.equal(editItem(g, "leg-press", { type: "barbell" }, new Set(["leg-press"])).reason, "history");
});

test("editItem relinks an unlinked dumbbell exercise to the gym's set and follows the set's unit", () => {
  const g = gymOf();
  const id = Object.keys(g.equipment).find((k) => g.equipment[k].type === "dumbbell");
  const set = g.weightSets.dumbbells;
  const other = set.unit === "kg" ? "lb" : "kg";
  g.equipment[id] = { ...g.equipment[id], unit: other, weightSet: undefined };
  delete g.equipment[id].weightSet;
  const r = editItem(g, id, { useSet: true }, none);
  assert.equal(r.gym.equipment[id].weightSet, "dumbbells");
  assert.equal(r.gym.equipment[id].unit, set.unit);
  assert.equal(editItem(g, id, { useSet: true }, new Set([id])).reason, "history");
});
