export function makeSet({ exerciseId, weight, reps, now = new Date() }) {
  return { exerciseId, weight, reps, time: now.toISOString() };
}

export function stepWeight(weight, step, direction) {
  const next = weight + step * direction;
  return Math.max(0, Math.round(next * 100) / 100);
}

export function setsForExercise(allSets, exerciseId) {
  return allSets.filter((s) => s.exerciseId === exerciseId);
}

export function todaysSets(allSets, exerciseId, now = new Date()) {
  return setsForExercise(allSets, exerciseId).filter(
    (s) => new Date(s.time).toDateString() === now.toDateString()
  );
}

// Starting weight: last logged set, else the machine's default, else its lowest weight.
export function defaultsFor(exercise, allSets) {
  const history = setsForExercise(allSets, exercise.id);
  if (history.length === 0) {
    return {
      weight: exercise.defaultWeight ?? exercise.min ?? exercise.step ?? 0,
      reps: 5,
    };
  }
  const last = history[history.length - 1];
  return { weight: last.weight, reps: last.reps };
}

// The list of weights offered for an exercise, always including the current one.
export function weightOptions(exercise, current) {
  const min = exercise.min ?? exercise.step;
  const max = exercise.max ?? (exercise.unit === "kg" ? 200 : 500);
  const options = [];
  for (let w = min; w <= max; w = Math.round((w + exercise.step) * 100) / 100) {
    options.push(w);
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