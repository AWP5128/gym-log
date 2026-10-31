// Stack weights for a weight-stack machine, built from a few boxes filled in at the gym.
// Example: lowest 10, step 10, from 100 the step becomes 15, top 160
// gives 10, 20 ... 100, 115, 130, 145, 160.
// (Messages keep the older word "pin" for a stack weight; change them here if you want "stack".)
import { round2 } from "./extras.js";

// The steps offered in the step lists. Add a number here if a machine ever needs another.
export const STEP_CHOICES = [5, 10, 15, 20];
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

// A short description such as "10 to 100 by 10, 100 to 160 by 15 (14 pins)".
export function describePins(pins) {
  if (!pins || pins.length === 0) return "Not set up";
  if (pins.length === 1) return pins[0] + " only (1 pin)";
  const parts = [];
  let start = pins[0];
  let step = round2(pins[1] - pins[0]);
  const close = (end) => parts.push(start + " to " + end + " by " + step);
  for (let i = 2; i < pins.length; i++) {
    const s = round2(pins[i] - pins[i - 1]);
    if (s !== step) {
      close(pins[i - 1]);
      start = pins[i - 1];
      step = s;
    }
  }
  close(pins[pins.length - 1]);
  return parts.join(", ") + " (" + pins.length + " pins)";
}