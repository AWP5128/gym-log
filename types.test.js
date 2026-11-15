import test from "node:test";
import assert from "node:assert/strict";
import { TYPES, typeInfoOf, unitsFor, setIdFor, WEIGHT_SET_TYPES, LIST_KINDS, listKindOf, extraList, mainStep, DISTANCE_UNITS, UNITS } from "./gym.js";
import { GYM_SPECIFIC_TYPES, weightCaption, hasGymBest } from "./log.js";

// The type table drives these; the expected values are what the code did before the table existed.
test("the type table gives the same answers the scattered checks used to", () => {
  assert.deepEqual(WEIGHT_SET_TYPES, ["dumbbell", "barbell"]);
  assert.equal(setIdFor("dumbbell"), "dumbbells");
  assert.equal(setIdFor("barbell"), "barbell");
  assert.equal(setIdFor("stack"), null);
  assert.deepEqual(GYM_SPECIFIC_TYPES, ["stack", "plate"]);
  assert.equal(unitsFor("cardio"), DISTANCE_UNITS);
  assert.equal(unitsFor("stack"), UNITS);
  assert.deepEqual(LIST_KINDS.map((k) => [k.id, k.types]), [
    ["machines", ["stack", "plate", "cardio"]], ["dumbbells", ["dumbbell"]], ["barbell", ["barbell"]], ["bodyweight", ["bodyweight"]],
  ]);
  assert.equal(listKindOf({ type: "cardio" }), "machines");
  assert.equal(weightCaption({ type: "stack", unit: "lb" }), "Stack");
  assert.equal(weightCaption({ type: "plate", unit: "kg" }), "Weight");
  assert.equal(hasGymBest({ type: "plate", unit: "kg" }), true);
  assert.equal(hasGymBest({ type: "cardio" }), false);
  assert.deepEqual(extraList("plate", "kg"), [2.5, 5, 7.5]);
  assert.equal(mainStep("barbell", "lb"), 10);
  assert.equal(mainStep("stack", "lb"), null);
});

test("every type has a label and a list kind", () => {
  for (const t of TYPES) {
    assert.ok(t.label);
    assert.ok(LIST_KINDS.some((k) => k.id === t.kind), t.id);
    assert.equal(typeInfoOf(t.id), t);
  }
});
