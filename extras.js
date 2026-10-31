// Extra weights: small plates added on top of the stack weight on a weight stack.
// The weight lifted is the stack weight plus the extra. Only the total is saved with each set.
import { weightOptions } from "./log.js";

// Every lb machine offers these (2.5 lb steps up to 20 lb).
export const EXTRA_WEIGHTS = [2.5, 5, 7.5, 10, 12.5, 15, 17.5, 20];

export const round2 = (n) => Math.round(n * 100) / 100;

// The extras an exercise offers, or an empty list when it has none.
// Machines in lb have them. Free weights (kg here) do not. An exercise can also list its own: extras: [...].
export const extraOptions = (exercise) =>
  Array.isArray(exercise.extras)
    ? exercise.extras
    : exercise.unit === "lb" && exercise.kind !== "time" ? EXTRA_WEIGHTS : [];

export const hasExtras = (exercise) => extraOptions(exercise).length > 0;

// The result calls the stack weight "pin" (the older word for it).
export const totalWeight = (pin, extra = 0) => round2(pin + extra);

// Splits a total back into stack weight and extra: the highest stack weight that leaves a valid extra.
// A total that cannot be made that way (an odd old weight) stays whole on the stack, with no extra.
export function splitWeight(exercise, total) {
  const extras = [0, ...extraOptions(exercise)];
  const pins = weightOptions(exercise).filter((w) => w <= total).reverse();
  for (const pin of pins) {
    const extra = round2(total - pin);
    if (extras.includes(extra)) return { pin, extra };
  }
  return { pin: total, extra: 0 };
}

// The extra saved on the Set up screen for a machine's warm-up or working weight (kind is "start"
// or "work", key is "Heavy" or "Volume"), or undefined.
export const savedExtra = (settings, id, kind, key) =>
  ((settings.exercises || {})[id] || {})[kind + "Extra" + key];

// The stack weight and extra saved on the Set up screen for that weight, or null.
export function savedSplit(settings, exercise, kind, key, total) {
  const extra = savedExtra(settings, exercise.id, kind, key);
  const usable =
    Number.isFinite(extra) && extra > 0 && total != null && !(extra > total) && extraOptions(exercise).includes(extra);
  return usable ? { pin: round2(total - extra), extra } : null;
}

// Which stack weight and extra to show for a total. If the total is the machine's warm-up or working
// weight and a split was saved for it on the Set up screen, use that. Otherwise use the highest split.
export function splitFor(settings, exercise, total, cfg, key) {
  for (const kind of ["start", "work"]) {
    const s = cfg[kind + key] === total && savedSplit(settings, exercise, kind, key, total);
    if (s) return s;
  }
  return splitWeight(exercise, total);
}