import { configFor } from "./settings.js";

// Reps and sets used for every machine that has none of its own.
// Used until you change them on the Set up screen.
export const BUILT_IN_DEFAULTS = { repsHeavy: 5, setsHeavy: 4, repsVolume: 10, setsVolume: 4 };
export const DEFAULT_WARMUP_REPS = 10;

// A saved number that is above zero, otherwise null.
const positive = (v) => (Number.isFinite(v) && v > 0 ? v : null);

// The reps and sets in force for every machine, from your saved choices or the built-in ones.
export function globalDefaults(settings) {
  const g = settings.defaults || {};
  return Object.fromEntries(
    Object.entries(BUILT_IN_DEFAULTS).map(([f, builtIn]) => [f, positive(g[f]) ?? builtIn])
  );
}

export function updateGlobalDefaults(settings, patch) {
  return { ...settings, defaults: { ...(settings.defaults || {}), ...patch } };
}

// A machine's own settings, with its reps and sets filled in from the
// every-machine defaults wherever the machine has none of its own.
export function effectiveConfig(settings, id) {
  const cfg = configFor(settings, id);
  const g = globalDefaults(settings);
  for (const f in g) cfg[f] ??= g[f];
  return cfg;
}

// The machine's own warm-up reps for a day type (key is "Heavy" or "Volume"), or null when none is set.
export const ownWarmupReps = (settings, id, key) =>
  positive(((settings.exercises || {})[id] || {})["warmReps" + key]);

// Reps for the warm-up set: the machine's own value, else the every-machine value, else 10.
export const warmupReps = (settings, id, key) =>
  ownWarmupReps(settings, id, key) ??
  positive((settings.defaults || {})["warmReps" + key]) ??
  DEFAULT_WARMUP_REPS;