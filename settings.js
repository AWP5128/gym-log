// Settings are stored per exercise. Blank fields are null.
// Heavy/Volume fields: startHeavy, workHeavy, repsHeavy, startVolume, workVolume, repsVolume.
export const CONFIG_FIELDS = [
  "startHeavy", "workHeavy", "repsHeavy", "setsHeavy",
  "startVolume", "workVolume", "repsVolume", "setsVolume",
  "pbWeight", "pbReps",
];

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

// Built-in exercises plus ones you added, with any name or step you changed.
export function allExercises(builtIn, settings) {
  const overrides = settings.exercises || {};
  return [...builtIn, ...(settings.custom || [])].map((e) => {
    const o = overrides[e.id] || {};
    return {
      ...e,
      name: o.name || e.name,
      step: o.step > 0 ? o.step : e.step,
    };
  });
}

// The saved defaults for one exercise, with null for anything not set.
export function configFor(settings, id) {
  const c = (settings.exercises || {})[id] || {};
  const out = { notes: typeof c.notes === "string" ? c.notes : "" };
  for (const f of CONFIG_FIELDS) out[f] = Number.isFinite(c[f]) ? c[f] : null;
  return out;
}

// A personal best typed in on the Settings screen (e.g. from before using the app).
export function manualPb(cfg) {
  if (cfg.pbWeight === null) return null;
  return { weight: cfg.pbWeight, reps: cfg.pbReps ?? 0 };
}

export function updateExercise(settings, id, patch) {
  const current = (settings.exercises || {})[id] || {};
  return {
    ...settings,
    exercises: { ...(settings.exercises || {}), [id]: { ...current, ...patch } },
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