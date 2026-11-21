// Stack weights for a weight-stack machine, built from a few boxes filled in at the gym.
// Example: lowest 10, step 10, from 100 the step becomes 15, top 160
// gives 10, 20 ... 100, 115, 130, 145, 160.
// (Messages keep the older word "pin" for a stack weight; change them here if you want "stack".)
import { round2 } from "./extras.js";

export const MAX_PINS = 60;

const fail = (error) => ({ pins: [], error, note: "" });

// spec is { low, step, top, changes: [{ at, step }, ...] }. A change row with both boxes
// empty is ignored. Returns { pins, error, note }; pins is empty when there is an error.
export function buildPins(spec) {
  const { low, step, top } = spec;
  if (!(low > 0)) return fail("Enter the lowest pin.");
  if (!(step > 0)) return fail("Choose the first step.");
  if (!(top >= low)) return fail("The top pin must be at least the lowest pin.");

  const changes = [];
  for (const c of spec.changes || []) {
    if (c.at == null && c.step == null) continue;
    if (c.at == null || c.step == null) return fail("A step change needs both a weight and a new step.");
    if (!(c.at > low && c.at <= top)) {
      return fail("A step change must be above the lowest pin and not above the top pin.");
    }
    changes.push(c);
  }
  changes.sort((a, b) => a.at - b.at);

  const pins = [low];
  for (let w = low; pins.length < MAX_PINS; ) {
    // The step in force at this weight: the latest change that has been reached.
    w = round2(w + changes.reduce((s, c) => (c.at <= w ? c.step : s), step));
    if (w > top) break;
    pins.push(w);
  }
  const last = pins[pins.length - 1];
  const note = last === top ? "" : "The steps do not land exactly on " + top + ". The last pin is " + last + ".";
  return { pins, error: "", note };
}

// A new list with one weight added (kept in order, no duplicates).
export const addPin = (pins, weight) =>
  !(weight > 0) || pins.includes(weight) ? pins : [...pins, weight].sort((a, b) => a - b);

export const removePin = (pins, weight) => pins.filter((p) => p !== weight);

export const hasPins = (exercise) => Array.isArray(exercise.pins) && exercise.pins.length > 0;
