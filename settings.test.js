import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptySettings, toNumber, allExercises, configFor, manualPb,
  updateExercise, addCustomExercise, removeCustomExercise,
} from "./settings.js";

const builtIn = [
  { id: "leg-press", name: "Leg Press Machine", group: "legs", common: true, unit: "lb", step: 10 },
];

test("toNumber handles blanks, commas and junk", () => {
  assert.equal(toNumber(""), null);
  assert.equal(toNumber("  "), null);
  assert.equal(toNumber("abc"), null);
  assert.equal(toNumber("-5"), null);
  assert.equal(toNumber("100"), 100);
  assert.equal(toNumber("2,5"), 2.5);
  assert.equal(toNumber("0"), 0);
});

test("configFor returns nulls and empty notes when nothing is saved", () => {
  const cfg = configFor(emptySettings(), "leg-press");
  assert.equal(cfg.startHeavy, null);
  assert.equal(cfg.workVolume, null);
  assert.equal(cfg.pbWeight, null);
  assert.equal(cfg.notes, "");
});

test("updateExercise saves values and keeps the old settings object unchanged", () => {
  const before = emptySettings();
  const after = updateExercise(before, "leg-press", { workHeavy: 120, notes: "Seat 4" });
  assert.equal(configFor(after, "leg-press").workHeavy, 120);
  assert.equal(configFor(after, "leg-press").notes, "Seat 4");
  assert.equal(configFor(before, "leg-press").workHeavy, null);
});

test("updateExercise merges with earlier values", () => {
  let s = updateExercise(emptySettings(), "leg-press", { workHeavy: 120 });
  s = updateExercise(s, "leg-press", { repsHeavy: 5 });
  const cfg = configFor(s, "leg-press");
  assert.equal(cfg.workHeavy, 120);
  assert.equal(cfg.repsHeavy, 5);
});

test("allExercises applies a changed name and step", () => {
  const s = updateExercise(emptySettings(), "leg-press", { name: "Leg Press (Technogym)", step: 15 });
  const [e] = allExercises(builtIn, s);
  assert.equal(e.name, "Leg Press (Technogym)");
  assert.equal(e.step, 15);
});

test("allExercises ignores a blank name or step", () => {
  const s = updateExercise(emptySettings(), "leg-press", { name: undefined, step: null });
  const [e] = allExercises(builtIn, s);
  assert.equal(e.name, "Leg Press Machine");
  assert.equal(e.step, 10);
});

test("manualPb is null until a weight is typed", () => {
  assert.equal(manualPb(configFor(emptySettings(), "leg-press")), null);
  const s = updateExercise(emptySettings(), "leg-press", { pbWeight: 150, pbReps: 3 });
  assert.deepEqual(manualPb(configFor(s, "leg-press")), { weight: 150, reps: 3 });
});

test("addCustomExercise adds a weight exercise", () => {
  const s = addCustomExercise(emptySettings(), { name: "Ab Crunch Machine", group: "abs", unit: "lb", step: 10 });
  const list = allExercises(builtIn, s);
  const added = list.find((e) => e.name === "Ab Crunch Machine");
  assert.equal(added.group, "abs");
  assert.equal(added.kind, "weights");
  assert.equal(added.step, 10);
  assert.ok(added.id.startsWith("custom-"));
});

test("addCustomExercise adds a timed exercise measured in minutes", () => {
  const s = addCustomExercise(emptySettings(), { name: "Treadmill", group: "cardio", unit: "min" });
  const added = s.custom[0];
  assert.equal(added.kind, "time");
  assert.equal(added.unit, "min");
});

test("addCustomExercise gives duplicate names different ids", () => {
  let s = addCustomExercise(emptySettings(), { name: "Plank", group: "abs", unit: "min" });
  s = addCustomExercise(s, { name: "Plank", group: "abs", unit: "min" });
  assert.notEqual(s.custom[0].id, s.custom[1].id);
});

test("addCustomExercise ignores a blank name", () => {
  const s = addCustomExercise(emptySettings(), { name: "   ", group: "abs", unit: "lb" });
  assert.equal(s.custom.length, 0);
});

test("removeCustomExercise removes only that exercise", () => {
  let s = addCustomExercise(emptySettings(), { name: "A", group: "abs", unit: "lb" });
  s = addCustomExercise(s, { name: "B", group: "abs", unit: "lb" });
  s = removeCustomExercise(s, s.custom[0].id);
  assert.deepEqual(s.custom.map((e) => e.name), ["B"]);
});