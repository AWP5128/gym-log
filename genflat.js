// Test helper (not loaded by the app): repeatable random flat settings for the bridge and personal-settings tests.
// Used by bridge.test.js and personal.test.js.
// A small repeatable random generator (the same numbers every run).
export function rng(seed) {
  let x = seed >>> 0;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
}
export const STACKS = ["hip-abduction", "hip-adduction", "calf-press", "leg-press", "squat-machine", "quad-extension"];
export const MODES = ["Heavy", "Volume"];
export const WHOLE = ["warmReps", "reps", "sets"];
export const WEIGHT = ["start", "work"];

// A random flat settings object that is already "clean": only finite numbers, no blanks, names that differ
// from the built-in ones, so that converting to the store and back must give back exactly the same object.
export function randomFlat(rand) {
  const pick = (n) => Math.floor(rand() * n);
  const exercises = {};
  for (const id of STACKS) {
    if (rand() < 0.35) continue;
    const c = {};
    if (rand() < 0.4) c.name = "Mine " + id + " " + pick(100);
    if (rand() < 0.4) c.step = 12.5 + pick(5);
    if (rand() < 0.5) {
      const n = 2 + pick(5);
      c.pins = Array.from({ length: n }, (_, i) => 10 * (i + 1) + pick(3));
      if (rand() < 0.5) c.stackSpec = { low: c.pins[0], step: 10, top: c.pins[n - 1], changes: rand() < 0.5 ? [] : [{ at: c.pins[1], step: 15 }] };
    }
    if (rand() < 0.5) c.notes = "Seat " + pick(9);
    if (rand() < 0.3) { c.pbWeight = 100 + pick(100); if (rand() < 0.6) c.pbReps = 1 + pick(8); }
    for (const m of MODES) {
      for (const f of WEIGHT) if (rand() < 0.4) c[f + m] = 5 * pick(40);
      for (const f of WEIGHT) if (rand() < 0.2) c[f + "Extra" + m] = 2.5 * (1 + pick(8));
      for (const f of WHOLE) if (rand() < 0.4) c[f + m] = 1 + pick(15);
    }
    if (Object.keys(c).length > 0) exercises[id] = c;
  }
  const defaults = {};
  for (const m of MODES) for (const f of ["reps", "sets", "warmReps"]) if (rand() < 0.3) defaults[f + m] = 1 + pick(12);
  return { exercises, custom: [], defaults };
}
