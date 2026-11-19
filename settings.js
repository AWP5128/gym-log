// Small helpers for the settings screens: text from an input box to a number, a personal best typed in by hand,
// and adding or removing an exercise you added (the list is `custom` in the store; see store.js).

// Text from an input box to a number. Blank or invalid gives null.
export function toNumber(text) {
  const t = String(text ?? "").trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// A personal best typed in by hand (e.g. from before using the app).
export function manualPb(cfg) {
  if (cfg.pbWeight === null) return null;
  return { weight: cfg.pbWeight, reps: cfg.pbReps ?? 0 };
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