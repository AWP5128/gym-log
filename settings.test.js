import { test } from "node:test";
import assert from "node:assert/strict";
import { toNumber, manualPb, addCustomExercise, removeCustomExercise } from "./settings.js";

// The exercises you added are kept as a list: { custom: [...] }.
const none = () => ({ custom: [] });
const add = (s, name, unit = "lb", group = "abs", step = 10) => addCustomExercise(s, { name, group, unit, step });

test("toNumber handles blanks, commas and junk", () => {
  const expected = [["", null], ["  ", null], ["abc", null], ["-5", null], ["100", 100], ["2,5", 2.5], ["0", 0], [null, null], [undefined, null]];
  for (const [text, number] of expected) assert.equal(toNumber(text), number, JSON.stringify(text));
});

test("manualPb is null until a weight is typed", () => {
  assert.equal(manualPb({ pbWeight: null, pbReps: null }), null);
  assert.deepEqual(manualPb({ pbWeight: 150, pbReps: 3 }), { weight: 150, reps: 3 });
  assert.deepEqual(manualPb({ pbWeight: 150, pbReps: null }), { weight: 150, reps: 0 });
  assert.deepEqual(manualPb({ pbWeight: 0, pbReps: 5 }), { weight: 0, reps: 5 });
});

test("addCustomExercise adds a weight exercise", () => {
  const added = add(none(), "Ab Crunch Machine").custom[0];
  assert.equal(added.name, "Ab Crunch Machine");
  assert.equal(added.group, "abs");
  assert.equal(added.kind, "weights");
  assert.equal(added.unit, "lb");
  assert.equal(added.step, 10);
  assert.equal(added.common, true);
  assert.equal(added.custom, true);
  assert.equal(added.id, "custom-ab-crunch-machine");
});

test("addCustomExercise trims the name, and picks the unit and step", () => {
  assert.equal(add(none(), "  Face Pull  ").custom[0].name, "Face Pull");
  const kg = add(none(), "Curl", "kg", "arms", 0).custom[0];
  assert.deepEqual([kg.unit, kg.step], ["kg", 2.5]);   // no step given: 2.5 for kg
  const lb = add(none(), "Curl", "stone", "arms", -3).custom[0];
  assert.deepEqual([lb.unit, lb.step], ["lb", 10]);   // any other unit is pounds; no step given: 10
  assert.equal(add(none(), "Curl", "lb", "arms", 5).custom[0].step, 5);
});

test("addCustomExercise adds a timed exercise measured in minutes", () => {
  const added = add(none(), "Treadmill", "min", "cardio", 10).custom[0];
  assert.equal(added.kind, "time");
  assert.equal(added.unit, "min");
  assert.equal(added.step, 1);
});

test("addCustomExercise gives duplicate names different ids, and leaves the old list unchanged", () => {
  const first = add(none(), "Plank", "min");
  const second = add(first, "Plank", "min");
  assert.deepEqual(second.custom.map((e) => e.id), ["custom-plank", "custom-plank-2"]);
  assert.equal(first.custom.length, 1);
});

test("addCustomExercise ignores a blank name, and keeps the other fields of what it is given", () => {
  assert.equal(add(none(), "   ").custom.length, 0);
  assert.equal(add(none(), undefined).custom.length, 0);
  assert.equal(addCustomExercise({ custom: [], other: 1 }, { name: "X" }).other, 1);
});

test("removeCustomExercise removes only that exercise", () => {
  let s = add(add(none(), "A"), "B");
  s = removeCustomExercise(s, s.custom[0].id);
  assert.deepEqual(s.custom.map((e) => e.name), ["B"]);
  assert.equal(removeCustomExercise(s, "nothing-here").custom.length, 1);
});
