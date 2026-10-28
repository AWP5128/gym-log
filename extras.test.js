import { test } from "node:test";
import assert from "node:assert/strict";
import { exercises } from "./exercises.js";
import {
  EXTRA_WEIGHTS, extraOptions, hasExtras, totalWeight, splitWeight, savedSplit, splitFor,
} from "./extras.js";

const byId = (id) => exercises.find((e) => e.id === id);
const legPress = byId("leg-press");   // lb machine, step 10
const deadlift = byId("deadlift");    // kg free weight

test("lb machines offer extras from 2.5 to 20 lb in 2.5 steps", () => {
  assert.deepEqual(EXTRA_WEIGHTS, [2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20]);
  assert.deepEqual(extraOptions(legPress), EXTRA_WEIGHTS);
  assert.equal(hasExtras(legPress), true);
});

test("free weights, kg exercises and timed exercises have no extras", () => {
  assert.deepEqual(extraOptions(deadlift), []);
  assert.deepEqual(extraOptions(byId("farmers-hold")), []);
  assert.equal(hasExtras(byId("pull-up")), false);
  assert.equal(hasExtras({ unit: "lb", kind: "time" }), false);
});

test("an exercise can list its own extras", () => {
  assert.deepEqual(extraOptions({ unit: "lb", extras: [5, 10] }), [5, 10]);
  assert.deepEqual(extraOptions({ unit: "lb", extras: [] }), []);
});

test("total is the pin plus the extra", () => {
  assert.equal(totalWeight(110, 5), 115);
  assert.equal(totalWeight(100, 7.5), 107.5);
  assert.equal(totalWeight(110), 110);
});

test("splitWeight uses the highest pin that leaves a valid extra", () => {
  assert.deepEqual(splitWeight(legPress, 115), { pin: 110, extra: 5 });
  assert.deepEqual(splitWeight(legPress, 110), { pin: 110, extra: 0 });
  assert.deepEqual(splitWeight(legPress, 107.5), { pin: 100, extra: 7.5 });
  assert.deepEqual(splitWeight(legPress, 125), { pin: 120, extra: 5 });
  assert.deepEqual(splitWeight(legPress, 10), { pin: 10, extra: 0 });
});

test("splitWeight keeps an odd total whole, with no extra", () => {
  assert.deepEqual(splitWeight(legPress, 112.3), { pin: 112.3, extra: 0 });
  assert.deepEqual(splitWeight(legPress, 5), { pin: 5, extra: 0 });
});

test("splitWeight on an exercise with no extras only matches the stack", () => {
  assert.deepEqual(splitWeight(deadlift, 100), { pin: 100, extra: 0 });
  assert.deepEqual(splitWeight(deadlift, 101), { pin: 101, extra: 0 });
});

test("splitting then totalling gives the original total for every 2.5 lb step", () => {
  for (let w = 10; w <= 300; w += 2.5) {
    const s = splitWeight(legPress, w);
    assert.equal(totalWeight(s.pin, s.extra), w, "total " + w);
  }
});

test("savedSplit returns the pin and extra saved in Set up", () => {
  const settings = { exercises: { "leg-press": { workHeavyExtra: 99, workExtraHeavy: 20 } } };
  assert.deepEqual(savedSplit(settings, legPress, "work", "Heavy", 110), { pin: 90, extra: 20 });
});

test("savedSplit ignores missing, zero, invalid or too large extras", () => {
  const make = (extra) => ({ exercises: { "leg-press": { workExtraHeavy: extra } } });
  assert.equal(savedSplit({}, legPress, "work", "Heavy", 110), null);
  assert.equal(savedSplit(make(null), legPress, "work", "Heavy", 110), null);
  assert.equal(savedSplit(make(0), legPress, "work", "Heavy", 110), null);
  assert.equal(savedSplit(make(3), legPress, "work", "Heavy", 110), null);
  assert.equal(savedSplit(make(20), legPress, "work", "Heavy", 15), null);
  assert.equal(savedSplit(make(20), deadlift, "work", "Heavy", 110), null);
});

test("splitFor prefers the saved split when the total is the warm-up or working weight", () => {
  const settings = { exercises: { "leg-press": { workExtraHeavy: 20, startExtraHeavy: 5 } } };
  const cfg = { startHeavy: 55, workHeavy: 110 };
  assert.deepEqual(splitFor(settings, legPress, 110, cfg, "Heavy"), { pin: 90, extra: 20 });
  assert.deepEqual(splitFor(settings, legPress, 55, cfg, "Heavy"), { pin: 50, extra: 5 });
});

test("splitFor falls back to the highest-pin split for any other total", () => {
  const settings = { exercises: { "leg-press": { workExtraHeavy: 20 } } };
  const cfg = { startHeavy: null, workHeavy: 110 };
  assert.deepEqual(splitFor(settings, legPress, 120, cfg, "Heavy"), { pin: 120, extra: 0 });
  assert.deepEqual(splitFor(settings, legPress, 115, cfg, "Heavy"), { pin: 110, extra: 5 });
});

test("splitFor uses the day type's own saved extra", () => {
  const settings = { exercises: { "leg-press": { workExtraHeavy: 20 } } };
  const cfg = { workHeavy: 110, workVolume: 110 };
  assert.deepEqual(splitFor(settings, legPress, 110, cfg, "Volume"), { pin: 110, extra: 0 });
  assert.deepEqual(splitFor(settings, legPress, 110, cfg, "Heavy"), { pin: 90, extra: 20 });
});