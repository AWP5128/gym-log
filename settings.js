// Settings are stored per exercise. Blank fields are null.
// Each day type (Heavy, Volume) has start, work, reps and sets fields, e.g. startHeavy, workVolume.
const DAY_TYPES = ["Heavy", "Volume"];
export const CONFIG_FIELDS = [
  ...DAY_TYPES.flatMap((d) => ["start", "work", "reps", "sets"].map((f) => f + d)),
  "pbWeight", "pbReps",
];

// What is saved for one exercise (nothing yet gives an empty object).
const saved = (settings, id) => (settings.exercises || {})[id] || {};

export function emptySettings() {
  return { exercises: {}, custom: [], defaults: {} };
}

// Text from an input box to a number. Blank or invalid gives null.
export function toNumber(text) {
  const t = String(text ?? "").trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Built-in exercises plus ones you added, with any name, step or stack you changed.
export function allExercises(builtIn, settings) {
  return [...builtIn, ...(settings.custom || [])].map((e) => {
    const o = saved(settings, e.id);
    return {
      ...e,
      name: o.name || e.name,
      step: o.step > 0 ? o.step : e.step,
      ...(Array.isArray(o.pins) && o.pins.length > 0 ? { pins: o.pins } : {}),
    };
  });
}

// The saved defaults for one exercise, with null for anything not set.
export function configFor(settings, id) {
  const c = saved(settings, id);
  const out = { notes: typeof c.notes === "string" ? c.notes : "" };
  for (const f of CONFIG_FIELDS) out[f] = Number.isFinite(c[f]) ? c[f] : null;
  return out;
}

// A personal best typed in by hand (e.g. from before using the app).
export function manualPb(cfg) {
  if (cfg.pbWeight === null) return null;
  return { weight: cfg.pbWeight, reps: cfg.pbReps ?? 0 };
}

export function updateExercise(settings, id, patch) {
  return {
    ...settings,
    exercises: { ...(settings.exercises || {}), [id]: { ...saved(settings, id), ...patch } },
  };
}

export function addCustomExercise(settings, { name, group, unit, step }) {
  const clean = String(name || "").trim();
  if (!clean) return settings;
  const base = "custom-" + clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const taken = new Set((settings.custom || []).map((e) => e.id));
  let id = base;
  let n = 2;
  while (taken.has(id)) id = base + "-" + n++;
  const isTime = unit === "min";
  const exercise = {
    id,
    name: clean,
    group,
    common: true,
    unit: isTime ? "min" : unit === "kg" ? "kg" : "lb",
    step: isTime ? 1 : step > 0 ? step : unit === "kg" ? 2.5 : 10,
    kind: isTime ? "time" : "weights",
    custom: true,
  };
  return { ...settings, custom: [...(settings.custom || []), exercise] };
}

export function removeCustomExercise(settings, id) {
  return {
    ...settings,
    custom: (settings.custom || []).filter((e) => e.id !== id),
  };
}