import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPins, addPin, removePin, describePins, hasPins } from "./stacks.js";
import { weightOptions } from "./log.js";
import { allExercises } from "./settings.js";

const build = (low, step, top, changes = []) => buildPins({ low, step, top, changes });

test("buildPins: a single step", () => {
  const r = build(10, 10, 100);
  assert.equal(r.error, "");
  assert.deepEqual(r.pins, [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
});

test("buildPins: step goes from 10 to 15", () => {
  const r = build(10, 10, 160, [{ at: 100, step: 15 }, { at: null, step: null }]);
  assert.equal(r.pins.length, 14);
  assert.deepEqual(r.pins.slice(-5), [100, 115, 130, 145, 160]);
  assert.equal(r.note, "");
});

test("buildPins: step goes from 15 to 10", () => {
  assert.deepEqual(build(15, 15, 100, [{ at: 60, step: 10 }]).pins, [15, 30, 45, 60, 70, 80, 90, 100]);
});

test("buildPins: reports a note when the top is not reached", () => {
  const r = build(10, 10, 105);
  assert.equal(r.pins.at(-1), 100);
  assert.notEqual(r.note, "");
});

test("buildPins: reports errors", () => {
  const bad = [
    build(null, 10, 100),
    build(10, null, 100),
    build(50, 10, 20),
    build(10, 10, 100, [{ at: 50, step: null }]),
    build(10, 10, 100, [{ at: 200, step: 15 }]),
  ];
  for (const r of bad) {
    assert.notEqual(r.error, "");
    assert.deepEqual(r.pins, []);
  }
});

test("addPin and removePin keep the list in order", () => {
  assert.deepEqual(addPin([10, 20, 40], 30), [10, 20, 30, 40]);
  assert.deepEqual(addPin([10, 20], 20), [10, 20]);
  assert.deepEqual(addPin([10, 20], 0), [10, 20]);
  assert.deepEqual(removePin([10, 20, 30], 20), [10, 30]);
  const original = [10, 20];
  addPin(original, 15);
  assert.deepEqual(original, [10, 20]);
});

test("describePins summarises the steps", () => {
  assert.equal(describePins([]), "Not set up");
  assert.equal(describePins([5]), "5 only (1 pin)");
  assert.equal(describePins([10, 20, 30, 45, 60]), "10 to 30 by 10, 30 to 60 by 15 (5 pins)");
});

test("weightOptions uses a saved pin list", () => {
  const e = { unit: "lb", step: 10, pins: [10, 20, 35] };
  assert.deepEqual(weightOptions(e), [10, 20, 35]);
  assert.deepEqual(weightOptions(e, 25), [10, 20, 25, 35]);
});

test("allExercises adds saved pins only where they exist", () => {
  const builtIn = ["a", "b"].map((id) => ({ id, name: id.toUpperCase(), group: "legs", unit: "lb", step: 10 }));
  const out = allExercises(builtIn, { exercises: { a: { pins: [10, 25] } }, custom: [] });
  assert.deepEqual(out[0].pins, [10, 25]);
  assert.equal("pins" in out[1], false);
  assert.deepEqual(out.map(hasPins), [true, false]);
});