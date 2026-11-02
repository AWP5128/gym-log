import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_UNITS, extraList, mainStep, stepChoices, makeItem, uniqueId, newGym, starterEquipment, withMachineData,
  addItem, updateItem, removeItem, setDefaultUnit, copyEquipment, toExercise, exerciseList, convert, formatBoth,
} from "./gym.js";

const builtIn = [
  { id: "leg-press", name: "Leg Press Machine", group: "legs", common: true, unit: "lb", step: 10 },
  { id: "quad-extension", name: "Quad Extension Machine", group: "legs", common: false, unit: "lb", step: 10 },
  { id: "deadlift", name: "Deadlift (barbell)", group: "legs", common: true, unit: "kg", step: 2.5 },
  { id: "pull-up", name: "Pull-ups (neutral grip)", group: "legs", common: true, unit: "kg", step: 2.5, min: 0 },
  { id: "farmers-hold", name: "Farmers Hold (dumbbells)", group: "arms", common: false, unit: "kg", step: 2.5 },
  { id: "treadmill", name: "Treadmill", group: "cardio", common: true, unit: "min", step: 1, kind: "time" },
];

test("extras: stack lb 2.5 to 20, stack kg 1.25 to 10, barbell and plate between the main steps", () => {
  assert.deepEqual(extraList("stack", "lb"), [2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20]);
  assert.deepEqual(extraList("stack", "kg"), [1.25, 2.5, 3.75, 5, 6.25, 7.5, 8.75, 10]);
  assert.deepEqual(extraList("barbell", "kg"), [2.5, 5, 7.5]);
  assert.deepEqual(extraList("plate", "lb"), [5, 10, 15]);
  assert.deepEqual(extraList("dumbbell", "kg"), []);
  assert.deepEqual(extraList("bodyweight", "lb"), []);
});

test("main step is 10 kg or 20 lb for barbells and plate machines only", () => {
  assert.equal(mainStep("barbell", "kg"), 10);
  assert.equal(mainStep("plate", "lb"), 20);
  assert.equal(mainStep("stack", "lb"), null);
  assert.deepEqual(stepChoices("lb"), [5, 10, 15, 20]);
  assert.ok(stepChoices("kg").length > 0);
});

test("makeItem fills in missing fields and drops unknown ones", () => {
  const item = makeItem({ name: "  Leg Press ", group: "legs", extra: "junk" });
  assert.deepEqual(item, { name: "Leg Press", group: "legs", type: "stack", unit: "lb", step: 10, common: true });
  assert.equal(makeItem({ name: "x", type: "nonsense" }).type, "stack");
  assert.equal(makeItem({ name: "x", type: "dumbbell", unit: "bad" }).unit, "kg");
  assert.deepEqual(makeItem({ name: "x", pins: [10, "a", 20] }).pins, [10, 20]);
  assert.equal(makeItem({ name: "x", pins: [] }).pins, undefined);
  assert.equal(makeItem({ name: "x", min: 0 }).min, 0);
  assert.equal(makeItem({ name: "x", common: false }).common, false);
});

test("uniqueId makes a slug and avoids taken ids", () => {
  assert.equal(uniqueId("Leg Press", []), "leg-press");
  assert.equal(uniqueId("Leg Press", ["leg-press"]), "leg-press-2");
  assert.equal(uniqueId("Leg Press", ["leg-press", "leg-press-2"]), "leg-press-3");
  assert.equal(uniqueId("!!!", []), "item");
});

test("newGym has default units per type and can override them", () => {
  const g = newGym("  Home ");
  assert.equal(g.name, "Home");
  assert.deepEqual(g.units, DEFAULT_UNITS);
  assert.equal(newGym("").name, "My gym");
  assert.equal(newGym("A", { dumbbell: "lb" }).units.dumbbell, "lb");
  assert.equal(newGym("A", { dumbbell: "lb" }).units.stack, "lb");
});

test("starterEquipment turns the built-in list into typed items and skips timed ones", () => {
  const eq = starterEquipment(builtIn);
  assert.equal(eq["leg-press"].type, "stack");
  assert.equal(eq["leg-press"].unit, "lb");
  assert.equal(eq["quad-extension"].common, false);
  assert.equal(eq.deadlift.type, "barbell");
  assert.equal(eq.deadlift.unit, "kg");
  assert.equal(eq.deadlift.step, 10);
  assert.equal(eq["farmers-hold"].step, 2.5);
  assert.equal(eq["farmers-hold"].type, "dumbbell");
  assert.equal(eq["pull-up"].type, "bodyweight");
  assert.equal(eq["pull-up"].min, 0);
  assert.equal(eq.treadmill, undefined);
  assert.equal(Object.keys(eq).length, 5);
});

test("withMachineData lays the old shared machine data over the items", () => {
  const eq = starterEquipment(builtIn);
  const spec = { low: 10, step: 10, top: 30, changes: [] };
  const out = withMachineData(eq, {
    "leg-press": { name: "Leg Press", step: 15, pins: [10, 20, 30], stackSpec: spec },
    unknown: { name: "Nope", pins: [1] },
  });
  assert.equal(out["leg-press"].name, "Leg Press");
  assert.equal(out["leg-press"].step, 15);
  assert.deepEqual(out["leg-press"].pins, [10, 20, 30]);
  assert.deepEqual(out["leg-press"].stackSpec, spec);
  assert.equal(out.unknown, undefined);
  assert.equal(out.deadlift.name, "Deadlift (barbell)");
  assert.equal(eq["leg-press"].name, "Leg Press Machine");
});

test("addItem uses the gym's unit for the type and makes a unique id", () => {
  let g = newGym("Gym", { dumbbell: "lb" });
  let r = addItem(g, { name: "Dumbbells", group: "arms", type: "dumbbell" });
  assert.equal(r.id, "dumbbells");
  assert.equal(r.gym.equipment.dumbbells.unit, "lb");
  g = r.gym;
  r = addItem(g, { name: "Dumbbells", group: "arms", type: "dumbbell", unit: "kg" });
  assert.equal(r.id, "dumbbells-2");
  assert.equal(r.gym.equipment["dumbbells-2"].unit, "kg");
  assert.equal(Object.keys(g.equipment).length, 1);
  const blank = addItem(g, { name: "   ", group: "arms" });
  assert.equal(blank.id, null);
  assert.equal(blank.gym, g);
});

test("updateItem renames, clears a stack and resets the weights when the unit changes", () => {
  const g = newGym("Gym", {}, { lp: makeItem({ name: "Leg Press", group: "legs", pins: [10, 20], stackSpec: { low: 10 } }) });
  assert.equal(updateItem(g, "lp", { name: "Leg Press 2" }).equipment.lp.name, "Leg Press 2");
  assert.equal(updateItem(g, "lp", { name: "  " }).equipment.lp.name, "Leg Press");
  const cleared = updateItem(g, "lp", { pins: null, stackSpec: null });
  assert.equal(cleared.equipment.lp.pins, undefined);
  assert.equal(cleared.equipment.lp.stackSpec, undefined);
  const kg = updateItem(g, "lp", { unit: "kg" });
  assert.equal(kg.equipment.lp.unit, "kg");
  assert.equal(kg.equipment.lp.pins, undefined);
  assert.equal(kg.equipment.lp.step, 5);
  assert.equal(updateItem(g, "lp", { unit: "lb" }).equipment.lp.pins.length, 2);
  assert.equal(updateItem(g, "missing", { name: "x" }), g);
  assert.deepEqual(g.equipment.lp.pins, [10, 20]);
});

test("removeItem and setDefaultUnit", () => {
  const g = newGym("Gym", {}, { a: makeItem({ name: "A" }), b: makeItem({ name: "B" }) });
  assert.deepEqual(Object.keys(removeItem(g, "a").equipment), ["b"]);
  assert.equal(Object.keys(g.equipment).length, 2);
  const g2 = setDefaultUnit(g, "stack", "kg");
  assert.equal(g2.units.stack, "kg");
  assert.equal(g2.equipment.a.unit, "lb");
  assert.equal(setDefaultUnit(g, "stack", "stone"), g);
  assert.equal(setDefaultUnit(g, "nonsense", "kg"), g);
});

test("copyEquipment copies the chosen items, skips existing ones and keeps ids", () => {
  const from = newGym("A", {}, starterEquipment(builtIn));
  from.equipment["leg-press"].pins = [10, 20, 30];
  const to = newGym("B", {}, { deadlift: makeItem({ name: "My deadlift", type: "barbell" }) });
  const r = copyEquipment(from, ["leg-press", "deadlift", "nope"], to);
  assert.equal(r.copied, 1);
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.gym.equipment["leg-press"].pins, [10, 20, 30]);
  assert.equal(r.gym.equipment.deadlift.name, "My deadlift");
  r.gym.equipment["leg-press"].pins.push(99);
  assert.deepEqual(from.equipment["leg-press"].pins, [10, 20, 30]);
  assert.equal(to.equipment["leg-press"], undefined);
  const over = copyEquipment(from, ["deadlift"], to, { overwrite: true });
  assert.equal(over.copied, 1);
  assert.equal(over.gym.equipment.deadlift.name, "Deadlift (barbell)");
});

test("toExercise gives the shape the exercise code uses", () => {
  const eq = starterEquipment(builtIn);
  const stack = toExercise("leg-press", eq["leg-press"]);
  assert.equal(stack.id, "leg-press");
  assert.equal(stack.warmup, true);
  assert.deepEqual(stack.extras, extraList("stack", "lb"));
  assert.equal(stack.unit, "lb");
  const bar = toExercise("deadlift", eq.deadlift);
  assert.equal(bar.warmup, false);
  assert.deepEqual(bar.extras, [2.5, 5, 7.5]);
  assert.deepEqual(toExercise("pull-up", eq["pull-up"]).extras, []);
  assert.equal(toExercise("pull-up", eq["pull-up"]).min, 0);
  const list = exerciseList(newGym("G", {}, eq));
  assert.equal(list.length, 5);
  assert.equal(list[0].id, "leg-press");
  assert.deepEqual(exerciseList({ name: "x" }), []);
});

test("convert and formatBoth", () => {
  assert.equal(convert(100, "lb", "lb"), 100);
  assert.ok(Math.abs(convert(100, "lb", "kg") - 45.359237) < 1e-9);
  assert.ok(Math.abs(convert(100, "kg", "lb") - 220.4622622) < 1e-6);
  assert.equal(formatBoth(100, "lb"), "100 lb (45.4 kg)");
  assert.equal(formatBoth(100, "lb", "kg"), "45.4 kg (100 lb)");
  assert.equal(formatBoth(100, "kg"), "100 kg (220.5 lb)");
  assert.equal(formatBoth(62.5, "kg", "lb"), "137.8 lb (62.5 kg)");
});