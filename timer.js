// Workout and machine timers.
//
// A workout is { start, end, machines } with times in milliseconds (Date.now()).
// end is null while the workout is running. machines holds one entry per exercise:
// { ms, since } where ms is the time already counted and since is the moment the
// machine's clock was last started (null when it is paused).
// Elapsed times are worked out from the clock, so they stay right when the phone sleeps.

const isNum = Number.isFinite;

// 75 seconds gives "1:15". Minutes keep counting past 59, so 75 minutes gives "75:00".
export function formatTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
}

export const startWorkout = (now = Date.now()) => ({ start: now, end: null, machines: {} });

export const isRunning = (workout) => !!workout && workout.end === null;

export const workoutElapsed = (workout, now = Date.now()) =>
  workout ? (workout.end ?? now) - workout.start : 0;

export function machineElapsed(workout, exerciseId, now = Date.now()) {
  const m = workout && workout.machines[exerciseId];
  return m ? m.ms + (m.since !== null ? now - m.since : 0) : 0;
}

// Returns a new workout in which exactly the machines in ids are running.
// Machines that were running and are not in ids are paused, keeping their time.
export function runMachines(workout, ids, now = Date.now()) {
  const machines = {};
  for (const [id, m] of Object.entries(workout.machines)) {
    machines[id] = m.since !== null && !ids.includes(id) ? { ms: m.ms + (now - m.since), since: null } : { ...m };
  }
  for (const id of ids) {
    const m = machines[id] || { ms: 0, since: null };
    machines[id] = m.since === null ? { ms: m.ms, since: now } : m;
  }
  return { ...workout, machines };
}

// Stops every machine and marks the workout as finished.
export const endWorkout = (workout, now = Date.now()) => ({ ...runMachines(workout, [], now), end: now });

// A workout read back from storage: tidied up, or null if it is missing, damaged,
// or from an earlier day (so a forgotten workout does not carry over).
export function cleanWorkout(raw, now = Date.now()) {
  if (!raw || typeof raw !== "object" || !isNum(raw.start)) return null;
  if (new Date(raw.start).toDateString() !== new Date(now).toDateString()) return null;
  const stored = raw.machines && typeof raw.machines === "object" ? raw.machines : {};
  const machines = Object.fromEntries(
    Object.entries(stored).map(([id, m]) => [
      id,
      { ms: isNum(m?.ms) && m.ms > 0 ? m.ms : 0, since: isNum(m?.since) ? m.since : null },
    ])
  );
  return { start: raw.start, end: isNum(raw.end) ? raw.end : null, machines };
}