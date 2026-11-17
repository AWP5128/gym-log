import { configFor } from "./settings.js";
import { personalOf, defaultsOf } from "./store.js";

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

// ---------- The same reads, straight from the store (stage C of the refactor) ----------
// These give exactly what the functions above give for toLegacySettings(store, personId, gymId), without building the flat
// shape. The screens use these; reads.test.js proves they match the flat ones. personId and gymId say whose settings, where.
const DAY = [["Heavy", "heavy"], ["Volume", "volume"]];
const dayOf = (key) => (key === "Heavy" ? "heavy" : "volume");

// A machine's own saved settings in the flat names the screens use (null for anything not set).
export function configOf(store, personId, gymId, id) {
  const s = personalOf(store, personId, gymId, id);
  const out = { notes: s.notes };
  for (const [Cap, mode] of DAY) {
    out["start" + Cap] = s[mode].warmup.weight;
    out["work" + Cap] = s[mode].working.weight;
    out["reps" + Cap] = s[mode].working.reps;
    out["sets" + Cap] = s[mode].working.sets;
  }
  out.pbWeight = s.pbWeight;
  out.pbReps = s.pbReps;
  return out;
}

export function globalDefaultsOf(store, personId) {
  const d = defaultsOf(store, personId);
  const out = {};
  for (const [Cap, mode] of DAY) {
    out["reps" + Cap] = positive(d[mode].reps) ?? BUILT_IN_DEFAULTS["reps" + Cap];
    out["sets" + Cap] = positive(d[mode].sets) ?? BUILT_IN_DEFAULTS["sets" + Cap];
  }
  return out;
}

export function effectiveConfigOf(store, personId, gymId, id) {
  const cfg = configOf(store, personId, gymId, id);
  const g = globalDefaultsOf(store, personId);
  for (const f in g) cfg[f] ??= g[f];
  return cfg;
}

export const ownWarmupRepsOf = (store, personId, gymId, id, key) =>
  positive(personalOf(store, personId, gymId, id)[dayOf(key)].warmup.reps);

export const warmupRepsOf = (store, personId, gymId, id, key) =>
  ownWarmupRepsOf(store, personId, gymId, id, key) ??
  positive(defaultsOf(store, personId)[dayOf(key)].warmupReps) ??
  DEFAULT_WARMUP_REPS;

// The extra saved on the Set up screen for a machine's warm-up ("start") or working ("work") weight, or undefined.
export function savedExtraOf(store, personId, gymId, id, kind, key) {
  const v = personalOf(store, personId, gymId, id)[dayOf(key)][kind === "start" ? "warmup" : "working"].extra;
  return v === null ? undefined : v;
}
