import { BUILT_IN_DEFAULTS } from "./defaults.js";

const last = (list) => list[list.length - 1];
const day = (date) => new Date(date).toDateString();

// A logged set. Weight exercises store weight and reps; timed ones store minutes.
export function makeSet({ exerciseId, weight = 0, reps = 0, minutes, mode, now = new Date() }) {
  return {
    exerciseId,
    time: now.toISOString(),
    ...(minutes !== undefined ? { minutes } : { weight, reps }),
    ...(mode ? { mode } : {}),
  };
}

export const setsForExercise = (allSets, exerciseId) => allSets.filter((s) => s.exerciseId === exerciseId);

export const todaysSets = (allSets, exerciseId, now = new Date()) =>
  setsForExercise(allSets, exerciseId).filter((s) => day(s.time) === day(now));

// Starting weight and reps for the next set of an exercise.
// cfg is the exercise's saved settings, mode is "heavy" or "volume".
// Order: continue from today's sets (switching from the warm-up to the working
// weight), else the start weight, else the working weight, else the last weight
// ever logged, else the lowest weight on the list.
export function defaultsFor(exercise, allSets, cfg = {}, mode = "heavy", now = new Date()) {
  const cap = mode === "volume" ? "Volume" : "Heavy";
  const start = cfg["start" + cap] ?? null;
  const work = cfg["work" + cap] ?? null;
  const reps = cfg["reps" + cap] ?? BUILT_IN_DEFAULTS["reps" + cap];

  const today = todaysSets(allSets, exercise.id, now);
  if (today.length > 0) {
    const prev = last(today);
    const onlyWarmup = today.length === 1 && start !== null && work !== null && prev.weight === start;
    return onlyWarmup ? { weight: work, reps } : { weight: prev.weight, reps: prev.reps };
  }
  if (start !== null) return { weight: start, reps };
  if (work !== null) return { weight: work, reps };

  const history = setsForExercise(allSets, exercise.id);
  if (history.length > 0) return { weight: last(history).weight, reps };
  return { weight: exercise.min ?? exercise.step ?? 0, reps };
}

// Starting minutes for a timed exercise: the last time you did it, else 10.
export function minutesDefault(exercise, allSets) {
  const history = setsForExercise(allSets, exercise.id).filter((s) => s.minutes !== undefined);
  return history.length > 0 ? last(history).minutes : 10;
}

// The list of weights offered for an exercise, always including the current one.
// A machine with a saved stack (Machine setup) offers exactly those weights.
export function weightOptions(exercise, current) {
  let options = [];
  if (Array.isArray(exercise.pins) && exercise.pins.length > 0) {
    options = [...exercise.pins];
  } else {
    const max = exercise.max ?? (exercise.unit === "kg" ? 200 : 500);
    for (let w = exercise.min ?? exercise.step; w <= max; w = Math.round((w + exercise.step) * 100) / 100) {
      options.push(w);
    }
  }
  if (current !== undefined && !options.includes(current)) {
    options.push(current);
    options.sort((a, b) => a - b);
  }
  return options;
}

// Returns a new list with the most recent set of this exercise removed.
export function removeLastSet(allSets, exerciseId) {
  const index = allSets.map((s) => s.exerciseId).lastIndexOf(exerciseId);
  return index === -1 ? allSets : allSets.filter((_, i) => i !== index);
}

// Personal best: the heaviest weight, and for the same weight the most reps.
export const beats = (set, best) =>
  !best || set.weight > best.weight || (set.weight === best.weight && set.reps > best.reps);

// Best of everything logged plus an optional typed-in best, or null if none.
export function bestSet(allSets, exerciseId, manual = null) {
  let best = manual ? { weight: manual.weight, reps: manual.reps ?? 0 } : null;
  for (const s of setsForExercise(allSets, exerciseId)) {
    if (s.weight !== undefined && beats(s, best)) best = { weight: s.weight, reps: s.reps };
  }
  return best;
}

// True when a new set beats an existing best (the very first set never counts).
export function isNewPb(allSets, exerciseId, manual, newSet) {
  const before = bestSet(allSets, exerciseId, manual);
  return before !== null && beats(newSet, before);
}

export const formatSet = (exercise, set) =>
  set.minutes !== undefined ? set.minutes + " min" : set.weight + " " + exercise.unit + " x " + set.reps;

// "Done today" markers: a list of { exerciseId, date }, one per finished exercise.
export const isDoneToday = (done, exerciseId, now = new Date()) =>
  done.some((d) => d.exerciseId === exerciseId && d.date === now.toDateString());

// Adds a marker and drops markers from earlier days.
export function markDone(done, exerciseId, now = new Date()) {
  const date = now.toDateString();
  return [...done.filter((d) => d.date === date && d.exerciseId !== exerciseId), { exerciseId, date }];
}

export const unmarkDone = (done, exerciseId, now = new Date()) =>
  done.filter((d) => !(d.exerciseId === exerciseId && d.date === now.toDateString()));