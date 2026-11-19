import { personalOf, defaultsOf } from "./store.js";

// Reps and sets used for every machine that has none of its own.
// Used until you change them on the Set up screen.
export const BUILT_IN_DEFAULTS = { repsHeavy: 5, setsHeavy: 4, repsVolume: 10, setsVolume: 4 };
export const DEFAULT_WARMUP_REPS = 10;

// A saved number that is above zero, otherwise null.
const positive = (v) => (Number.isFinite(v) && v > 0 ? v : null);

// ---------- Reads straight from the store ----------
// personId and gymId say whose settings, and where. The reps and sets a machine has none of its own are filled in from the
// every-machine defaults, and those from the built-in ones. Names like startHeavy and repsVolume are what the screens use.
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
