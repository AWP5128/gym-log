// Extra weights: small plates added on top of the pin on a weight stack.
// The weight lifted is the pin plus the extra. Only the total is saved with each set.
import { weightOptions } from "./log.js";

// Every lb machine offers these (2.5 lb steps up to 20 lb).
export const EXTRA_WEIGHTS = [2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20];

export const round2 = (n) => Math.round(n * 100) / 100;

// The extras an exercise offers, or an empty list when it has none.
// Machines in lb have them. Free weights (kg here) do not. An exercise can also list its own: extras: [...].
export function extraOptions(exercise) {
  if (Array.isArray(exercise.extras)) return exercise.extras;
  return exercise.unit === "lb" && exercise.kind !== "time" ? EXTRA_WEIGHTS : [];
}

export function hasExtras(exercise) {
  return extraOptions(exercise).length > 0;
}

export function totalWeight(pin, extra = 0) {
  return round2(pin + extra);
}

// Splits a total back into pin and extra: the highest pin on the stack that leaves a valid extra.
// A total that cannot be made that way (an odd old weight) stays whole on the pin list, with no extra.
export function splitWeight(exercise, total) {
  const extras = [0, ...extraOptions(exercise)];
  const pins = weightOptions(exercise).filter((w) => w <= total).reverse();
  for (const pin of pins) {
    const extra = round2(total - pin);
    if (extras.includes(extra)) return { pin, extra };
  }
  return { pin: total, extra: 0 };
}

// The pin and extra saved on the Set up screen for a machine's warm-up or working weight, or null.
// kind is "start" or "work", key is "Heavy" or "Volume", total is that weight.
export function savedSplit(settings, exercise, kind, key, total) {
  const saved = (settings.exercises || {})[exercise.id] || {};
  const extra = saved[kind + "Extra" + key];
  if (!Number.isFinite(extra) || extra <= 0) return null;
  if (total === null || total === undefined || extra > total) return null;
  if (!extraOptions(exercise).includes(extra)) return null;
  return { pin: round2(total - extra), extra };
}

// Which pin and extra to show for a total. If the total is the machine's warm-up or working weight and
// a split was saved for it on the Set up screen, use that. Otherwise use the highest-pin split.
export function splitFor(settings, exercise, total, cfg, key) {
  for (const kind of ["start", "work"]) {
    if (cfg[kind + key] === total) {
      const s = savedSplit(settings, exercise, kind, key, total);
      if (s) return s;
    }
  }
  return splitWeight(exercise, total);
}