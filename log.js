import { BUILT_IN_DEFAULTS } from "./defaults.js";
import { DEFAULT_GYM } from "./store.js";
import { convert, round2 } from "./gym.js";

const last = (list) => list[list.length - 1];
const day = (date) => new Date(date).toDateString();

// A logged set. Weight exercises store weight and reps; timed ones store minutes. A set also records
// the gym it was done at and the unit of its weight, so that bests can be told apart by gym and
// compared between kg and lb. Sets saved before gyms existed have neither: they count as the first
// gym's, in the unit of the exercise.
export function makeSet({ exerciseId, weight = 0, reps = 0, minutes, mode, gymId, unit, now = new Date() }) {
  return {
    exerciseId,
    time: now.toISOString(),
    ...(minutes !== undefined ? { minutes } : { weight, reps, ...(unit ? { unit } : {}) }),
    ...(mode ? { mode } : {}),
    ...(gymId ? { gymId } : {}),
  };
}

export const setsForExercise = (allSets, exerciseId) => allSets.filter((s) => s.exerciseId === exerciseId);

// The gym a set was done at (sets with no gym are the first gym's).
export const setGym = (set) => set.gymId ?? DEFAULT_GYM;

// Only the sets done at one gym.
export const setsForGym = (allSets, gymId) => allSets.filter((s) => setGym(s) === gymId);

// Whether an exercise has any logged set at a gym. The Gym screens use it to decide whether a unit
// change is safe: saved weights and "last weight" defaults carry no unit, so a machine with history
// keeps its unit.
export const hasHistory = (allSets, exerciseId, gymId) =>
  allSets.some((s) => s.exerciseId === exerciseId && setGym(s) === gymId);

// The ids of every exercise that has a logged set at a gym, in one pass (for a whole equipment list).
export const idsWithHistory = (allSets, gymId) =>
  new Set(allSets.filter((s) => setGym(s) === gymId).map((s) => s.exerciseId));

// Stamps sets that have no gym (and no unit, when unitOf is given) with the first gym's details.
// unitOf turns an exercise id into the unit its weights were logged in. Sets already stamped are left alone.
export const tagSets = (allSets, gymId = DEFAULT_GYM, unitOf = null) =>
  allSets.map((s) => {
    const unit = !s.unit && s.weight !== undefined && unitOf ? unitOf(s.exerciseId) : null;
    return s.gymId && !unit ? s : { ...s, gymId: s.gymId ?? gymId, ...(unit ? { unit } : {}) };
  });

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

// Returns a new list with the most recent set of this exercise removed. With a gym, only sets done
// at that gym are considered.
export function removeLastSet(allSets, exerciseId, gymId) {
  let index = -1;
  allSets.forEach((s, i) => {
    if (s.exerciseId === exerciseId && (gymId === undefined || setGym(s) === gymId)) index = i;
  });
  return index === -1 ? allSets : allSets.filter((_, i) => i !== index);
}

// Personal best: the heaviest weight, and for the same weight the most reps.
export const beats = (set, best) =>
  !best || set.weight > best.weight || (set.weight === best.weight && set.reps > best.reps);

// Best of everything logged plus an optional typed-in best, or null if none.
// Options: gymId looks only at sets done at that gym; unit gives the result in that unit, converting
// sets that were logged in the other one (a set with no unit is taken to be in this unit already).
export function bestSet(allSets, exerciseId, manual = null, { gymId, unit } = {}) {
  let best = manual ? { weight: manual.weight, reps: manual.reps ?? 0 } : null;
  for (const s of setsForExercise(allSets, exerciseId)) {
    if (s.weight === undefined) continue;
    if (gymId !== undefined && setGym(s) !== gymId) continue;
    const weight = unit && s.unit && s.unit !== unit ? round2(convert(s.weight, s.unit, unit)) : s.weight;
    if (beats({ weight, reps: s.reps }, best)) best = { weight, reps: s.reps };
  }
  return best;
}

// True when a new set beats an existing best (the very first set never counts). Takes the same
// options as bestSet.
export function isNewPb(allSets, exerciseId, manual, newSet, options = {}) {
  const before = bestSet(allSets, exerciseId, manual, options);
  return before !== null && beats(newSet, before);
}

// Machines keep a best for each gym as well as a best ever; free weights have the best ever only.
export const GYM_SPECIFIC_TYPES = ["stack", "plate"];
const typeOf = (exercise) => exercise.type ?? (exercise.unit === "lb" ? "stack" : "barbell");

// The two personal bests for an exercise, both in the exercise's own unit: { gym, ever }. gym is the
// best at gymId (null for free weights, which have none); ever is the best across all gyms, with
// weights logged in the other unit converted. A typed-in best (manual) counts at both levels.
export function personalBests(allSets, exercise, gymId, manual = null) {
  const unit = exercise.unit;
  return {
    gym: GYM_SPECIFIC_TYPES.includes(typeOf(exercise)) ? bestSet(allSets, exercise.id, manual, { gymId, unit }) : null,
    ever: bestSet(allSets, exercise.id, manual, { unit }),
  };
}

// True for exercises that keep a best for each gym as well as a best ever (machines); false for free weights.
export const hasGymBest = (exercise) => GYM_SPECIFIC_TYPES.includes(typeOf(exercise));

// A best as text, pounds first and kilos in brackets: "100 lb (45.4 kg) x 8". Converted figures and pounds
// are shown to one decimal place ("132.3 lb", not "132.28 lb"); a best held in kilos keeps its own figure
// (1.25 kg stays 1.25). With no weight (body weight only) it reads "Body weight x 12", and with no reps
// recorded the "x" part is left off. No best at all gives "none yet". unit is the unit the best is held in.
const oneDp = (n) => Math.round(n * 10) / 10;
export function describeBest(best, unit) {
  if (!best) return "none yet";
  const lb = oneDp(unit === "lb" ? best.weight : convert(best.weight, "kg", "lb"));
  const kg = unit === "kg" ? best.weight : oneDp(convert(best.weight, "lb", "kg"));
  const what = best.weight === 0 ? "Body weight" : lb + " lb (" + kg + " kg)";
  return best.reps > 0 ? what + " x " + best.reps : what;
}

// The caption over the main weight list on the exercise card: "Stack" for a weight stack machine,
// "Weight" for everything else (barbells, plate machines, dumbbells). A list of extras sits beside it.
export const weightCaption = (exercise) => (typeOf(exercise) === "stack" ? "Stack" : "Weight");

// Which personal best a new set breaks, given the bests from before it was logged ({ gym, ever } from
// personalBests): "ever" (it beats the best ever, so it beats the gym's too), "gym" (only the gym's best),
// or null. The very first set at a level never counts, as with isNewPb.
export function newBestLevel(before, set) {
  if (before.ever !== null && beats(set, before.ever)) return "ever";
  if (before.gym !== null && beats(set, before.gym)) return "gym";
  return null;
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