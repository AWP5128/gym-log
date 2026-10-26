import { configFor } from "./settings.js";

// Reps and sets used for every machine that has none of its own.
// Used until you change them on the Set up screen.
export const BUILT_IN_DEFAULTS = { repsHeavy: 5, setsHeavy: 4, repsVolume: 10, setsVolume: 4 };
const FIELDS = Object.keys(BUILT_IN_DEFAULTS);

// The reps and sets in force for every machine, from your saved choices or the built-in ones.
export function globalDefaults(settings) {
  const g = settings.defaults || {};
  const out = {};
  for (const f of FIELDS) {
    out[f] = Number.isFinite(g[f]) && g[f] > 0 ? g[f] : BUILT_IN_DEFAULTS[f];
  }
  return out;
}

export function updateGlobalDefaults(settings, patch) {
  return { ...settings, defaults: { ...(settings.defaults || {}), ...patch } };
}

// A machine's own settings, with its reps and sets filled in from the
// every-machine defaults wherever the machine has none of its own.
export function effectiveConfig(settings, id) {
  const cfg = configFor(settings, id);
  const g = globalDefaults(settings);
  for (const f of FIELDS) cfg[f] = cfg[f] ?? g[f];
  return cfg;
}