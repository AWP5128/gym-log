// Pin weights for a weight-stack machine, built from a few boxes filled in at the gym.
// Example: lowest 10, step 10, from 100 the step becomes 15, top 160
// gives 10, 20 ... 100, 115, 130, 145, 160.
import { round2 } from "./extras.js";

// The steps offered in the step lists. Add a number here if a machine ever needs another.
export const STEP_CHOICES = [5, 10, 15, 20];
export const MAX_PINS = 60;

// spec is { low, step, top, changes: [{ at, step }, ...] }. A change row with both boxes
// empty is ignored. Returns { pins, error, note }; pins is empty when there is an error.
export function buildPins(spec) {
  const { low, step, top } = spec;
  if (!(low > 0)) return { pins: [], error: "Enter the lowest pin.", note: "" };
  if (!(step > 0)) return { pins: [], error: "Choose the first step.", note: "" };
  if (!(top >= low)) return { pins: [], error: "The top pin must be at least the lowest pin.", note: "" };

  const changes = [];
  for (const c of spec.changes || []) {
    if (c.at == null && c.step == null) continue;
    if (c.at == null || c.step == null) {
      return { pins: [], error: "A step change needs both a weight and a new step.", note: "" };
    }
    if (!(c.at > low && c.at <= top)) {
      return { pins: [], error: "A step change must be above the lowest pin and not above the top pin.", note: "" };
    }
    changes.push(c);
  }
  changes.sort((a, b) => a.at - b.at);

  const pins = [low];
  let w = low;
  while (pins.length < MAX_PINS) {
    let s = step;
    for (const c of changes) if (c.at <= w) s = c.step;
    w = round2(w + s);
    if (w > top) break;
    pins.push(w);
  }
  const last = pins[pins.length - 1];
  const note = last === top ? "" : "The steps do not land exactly on " + top + ". The last pin is " + last + ".";
  return { pins, error: "", note };
}

// A new list with one pin added (kept in order, no duplicates).
export function addPin(pins, weight) {
  if (!(weight > 0) || pins.includes(weight)) return pins;
  return [...pins, weight].sort((a, b) => a - b);
}

export function removePin(pins, weight) {
  return pins.filter((p) => p !== weight);
}

export function hasPins(exercise) {
  return Array.isArray(exercise.pins) && exercise.pins.length > 0;
}

// A short description such as "10 to 100 by 10, 100 to 160 by 15 (14 pins)".
export function describePins(pins) {
  if (!pins || pins.length === 0) return "Not set up";
  if (pins.length === 1) return pins[0] + " only (1 pin)";
  const parts = [];
  let start = pins[0];
  let step = round2(pins[1] - pins[0]);
  for (let i = 2; i < pins.length; i++) {
    const s = round2(pins[i] - pins[i - 1]);
    if (s !== step) {
      parts.push(start + " to " + pins[i - 1] + " by " + step);
      start = pins[i - 1];
      step = s;
    }
  }
  parts.push(start + " to " + pins[pins.length - 1] + " by " + step);
  return parts.join(", ") + " (" + pins.length + " pins)";
}