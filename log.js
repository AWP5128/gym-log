// A logged set. Weight exercises store weight and reps; timed ones store minutes.
export function makeSet({ exerciseId, weight = 0, reps = 0, minutes, mode, now = new Date() }) {
  const s = { exerciseId, time: now.toISOString() };
  if (minutes !== undefined) {
    s.minutes = minutes;
  } else {
    s.weight = weight;
    s.reps = reps;
  }
  if (mode) s.mode = mode;
  return s;
}

export function setsForExercise(allSets, exerciseId) {
  return allSets.filter((s) => s.exerciseId === exerciseId);
}

export function todaysSets(allSets, exerciseId, now = new Date()) {
  return setsForExercise(allSets, exerciseId).filter(
    (s) => new Date(s.time).toDateString() === now.toDateString()
  );
}

// Starting weight and reps for the next set of an exercise.
// cfg is the exercise's saved settings, mode is "heavy" or "volume".
// Order: continue from today's sets (switching from the warm-up to the working
// weight), else the start weight, else the working weight, else the last weight
// ever logged, else the lowest weight on the list.
export function defaultsFor(exercise, allSets, cfg = {}, mode = "heavy", now = new Date()) {
  const cap = mode === "volume" ? "Volume" : "Heavy";
  const start = cfg["start" + cap] ?? null;
  const work = cfg["work" + cap] ?? null;
  const reps = cfg["reps" + cap] ?? (mode === "volume" ? 10 : 5);

  const today = todaysSets(allSets, exercise.id, now);
  if (today.length > 0) {
    const last = today[today.length - 1];
    if (today.length === 1 && start !== null && work !== null && last.weight === start) {
      return { weight: work, reps };
    }
    return { weight: last.weight, reps: last.reps };
  }
  if (start !== null) return { weight: start, reps };
  if (work !== null) return { weight: work, reps };

  const history = setsForExercise(allSets, exercise.id);
  if (history.length > 0) {
    return { weight: history[history.length - 1].weight, reps };
  }
  return { weight: exercise.min ?? exercise.step ?? 0, reps };
}

// Starting minutes for a timed exercise: the last time you did it, else 10.
export function minutesDefault(exercise, allSets) {
  const history = setsForExercise(allSets, exercise.id).filter((s) => s.minutes !== undefined);
  return history.length > 0 ? history[history.length - 1].minutes : 10;
}

// The list of weights offered for an exercise, always including the current one.
// The list of weights offered for an exercise, always including the current one.
// A machine with a saved pin list (Machine setup) offers exactly those pins.
export function weightOptions(exercise, current) {
  let options = [];
  if (Array.isArray(exercise.pins) && exercise.pins.length > 0) {
    options = [...exercise.pins];
  } else {
    const min = exercise.min ?? exercise.step;
    const max = exercise.max ?? (exercise.unit === "kg" ? 200 : 500);
    for (let w = min; w <= max; w = Math.round((w + exercise.step) * 100) / 100) {
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
  if (index === -1) return allSets;
  return allSets.filter((_, i) => i !== index);
}

// Personal best: the heaviest weight, and for the same weight the most reps.
export function beats(set, best) {
  if (!best) return true;
  return set.weight > best.weight || (set.weight === best.weight && set.reps > best.reps);
}

// Best of everything logged plus an optional typed-in best, or null if none.
export function bestSet(allSets, exerciseId, manual = null) {
  let best = manual ? { weight: manual.weight, reps: manual.reps ?? 0 } : null;
  for (const s of setsForExercise(allSets, exerciseId)) {
    if (s.weight === undefined) continue;
    if (beats(s, best)) best = { weight: s.weight, reps: s.reps };
  }
  return best;
}

// True when a new set beats an existing best (the very first set never counts).
export function isNewPb(allSets, exerciseId, manual, newSet) {
  const before = bestSet(allSets, exerciseId, manual);
  return before !== null && beats(newSet, before);
}

export function formatSet(exercise, set) {
  if (set.minutes !== undefined) return set.minutes + " min";
  return set.weight + " " + exercise.unit + " x " + set.reps;
}

// "Done today" markers: a list of { exerciseId, date }, one per finished exercise.
export function isDoneToday(done, exerciseId, now = new Date()) {
  return done.some((d) => d.exerciseId === exerciseId && d.date === now.toDateString());
}

// Adds a marker and drops markers from earlier days.
export function markDone(done, exerciseId, now = new Date()) {
  const today = now.toDateString();
  const kept = done.filter((d) => d.date === today && d.exerciseId !== exerciseId);
  return [...kept, { exerciseId, date: today }];
}

export function unmarkDone(done, exerciseId, now = new Date()) {
  const today = now.toDateString();
  return done.filter((d) => !(d.exerciseId === exerciseId && d.date === today));
}