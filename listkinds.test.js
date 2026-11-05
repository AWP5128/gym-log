import test from "node:test";
import assert from "node:assert/strict";
import {
  LIST_KINDS, listKindOf, listDefaultOf, setListDefault, kindCounts, chooseListKind, exerciseList, hideWeightSet,
} from "./gym.js";
import { emptyStore, cleanStore } from "./store.js";

test("each type belongs to one kind of list, and an untyped exercise counts as a machine", () => {
  assert.deepEqual(LIST_KINDS.map((k) => k.id), ["machines", "dumbbells", "barbell", "bodyweight"]);
  assert.equal(listKindOf({ type: "stack" }), "machines");
  assert.equal(listKindOf({ type: "plate" }), "machines");
  assert.equal(listKindOf({ type: "dumbbell" }), "dumbbells");
  assert.equal(listKindOf({ type: "barbell" }), "barbell");
  assert.equal(listKindOf({ type: "bodyweight" }), "bodyweight");
  assert.equal(listKindOf({}), "machines");
});

test("the gym's default list kind starts as machines, can be changed, and ignores unknown kinds", () => {
  const g = emptyStore().gyms.main;
  assert.equal(listDefaultOf(g), "machines");
  const d = setListDefault(g, "dumbbells");
  assert.equal(listDefaultOf(d), "dumbbells");
  assert.equal(setListDefault(d, "nonsense"), d);
  assert.equal(listDefaultOf({ listDefault: "rubbish" }), "machines");
  const s = emptyStore();
  s.gyms.main = d;
  assert.equal(listDefaultOf(cleanStore(JSON.parse(JSON.stringify(s))).gyms.main), "dumbbells");
});

test("kindCounts counts the exercises of the gym by kind", () => {
  const g = emptyStore().gyms.main;
  const c = kindCounts(exerciseList(g));
  assert.ok(c.machines > 5 && c.dumbbells > 5 && c.barbell > 3 && c.bodyweight >= 1);
  assert.equal(c.machines + c.dumbbells + c.barbell + c.bodyweight, exerciseList(g).length);
  const h = kindCounts(exerciseList(hideWeightSet(g, "dumbbells")));
  assert.equal(h.dumbbells, 0);
  assert.equal(h.machines, c.machines);
});

test("chooseListKind uses what was picked, then the default, then what is left", () => {
  const present = ["machines", "dumbbells", "barbell"];
  const open = { machines: 4, dumbbells: 2, barbell: 0, bodyweight: 0 };
  assert.equal(chooseListKind(present, open, "dumbbells", "machines"), "dumbbells");
  assert.equal(chooseListKind(present, open, null, "dumbbells"), "dumbbells");
  assert.equal(chooseListKind(present, open, null, "barbell"), "machines");           // nothing left in barbells
  assert.equal(chooseListKind(["dumbbells", "barbell"], open, null, "machines"), "dumbbells");   // gym has no machines here
  assert.equal(chooseListKind(present, { machines: 0, dumbbells: 0, barbell: 0, bodyweight: 0 }, null, "barbell"), "barbell");
  assert.equal(chooseListKind([], open, null, null), "machines");
});
