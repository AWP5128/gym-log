import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptySettings, toNumber, allExercises, configFor, manualPb,
  updateExercise, addCustomExercise, removeCustomExercise,
} from "./settings.js";

const LEG_PRESS = "leg-press";
const builtIn = [
  { id: LEG_PRESS, name: "Leg Press Machine", group: "legs", common: true, unit: "lb", step: 10 },
];

// Shortcuts: settings after saving a patch for the leg press, and its saved config.
const withLegPress = (patch, s = emptySettings()) => updateExercise(s, LEG_PRESS, patch);
const cfgOf = (s) => configFor(s, LEG_PRESS);
const addCustom = (s, name, unit = "lb", group = "abs") => addCustomExercise(s, { name, group, unit, step: 10 });

test("toNumber handles blanks, commas and junk", () => {
  const expected = [["", null], ["  ", null], ["abc", null], ["-5", null], ["100", 100], ["2,5", 2.5], ["0", 0]];
  for (const [text, number] of expected) assert.equal(toNumber(text), number, JSON.stringify(text));
});

test("configFor returns nulls and empty notes when nothing is saved", () => {
  const cfg = cfgOf(emptySettings());
  assert.equal(cfg.startHeavy, null);
  assert.equal(cfg.workVolume, null);
  assert.equal(cfg.pbWeight, null);
  assert.equal(cfg.notes, "");
});

test("updateExercise saves values and keeps the old settings object unchanged", () => {
  const before = emptySettings();
  const after = withLegPress({ workHeavy: 120, notes: "Seat 4" }, before);
  assert.equal(cfgOf(after).workHeavy, 120);
  assert.equal(cfgOf(after).notes, "Seat 4");
  assert.equal(cfgOf(before).workHeavy, null);
});

test("updateExercise merges with earlier values", () => {
  const cfg = cfgOf(withLegPress({ repsHeavy: 5 }, withLegPress({ workHeavy: 120 })));
  assert.equal(cfg.workHeavy, 120);
  assert.equal(cfg.repsHeavy, 5);
});

test("allExercises applies a changed name and step", () => {
  const [e] = allExercises(builtIn, withLegPress({ name: "Leg Press (Technogym)", step: 15 }));
  assert.equal(e.name, "Leg Press (Technogym)");
  assert.equal(e.step, 15);
});

test("allExercises ignores a blank name or step", () => {
  const [e] = allExercises(builtIn, withLegPress({ name: undefined, step: null }));
  assert.equal(e.name, "Leg Press Machine");
  assert.equal(e.step, 10);
});

test("manualPb is null until a weight is typed", () => {
  assert.equal(manualPb(cfgOf(emptySettings())), null);
  assert.deepEqual(manualPb(cfgOf(withLegPress({ pbWeight: 150, pbReps: 3 }))), { weight: 150, reps: 3 });
});

test("addCustomExercise adds a weight exercise", () => {
  const list = allExercises(builtIn, addCustom(emptySettings(), "Ab Crunch Machine"));
  const added = list.find((e) => e.name === "Ab Crunch Machine");
  assert.equal(added.group, "abs");
  assert.equal(added.kind, "weights");
  assert.equal(added.step, 10);
  assert.ok(added.id.startsWith("custom-"));
});

test("addCustomExercise adds a timed exercise measured in minutes", () => {
  const added = addCustom(emptySettings(), "Treadmill", "min", "cardio").custom[0];
  assert.equal(added.kind, "time");
  assert.equal(added.unit, "min");
});

test("addCustomExercise gives duplicate names different ids", () => {
  const s = addCustom(addCustom(emptySettings(), "Plank", "min"), "Plank", "min");
  assert.notEqual(s.custom[0].id, s.custom[1].id);
});

test("addCustomExercise ignores a blank name", () => {
  assert.equal(addCustom(emptySettings(), "   ").custom.length, 0);
});

test("removeCustomExercise removes only that exercise", () => {
  let s = addCustom(addCustom(emptySettings(), "A"), "B");
  s = removeCustomExercise(s, s.custom[0].id);
  assert.deepEqual(s.custom.map((e) => e.name), ["B"]);
});