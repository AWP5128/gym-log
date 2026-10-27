// Workout and machine timers.
//
// A workout is { start, end, machines } with times in milliseconds (Date.now()).
// end is null while the workout is running. machines holds one entry per exercise:
// { ms, since } where ms is the time already counted and since is the moment the
// machine's clock was last started (null when it is paused).
// Elapsed times are worked out from the clock, so they stay right when the phone sleeps.

// 75 seconds gives "1:15". Minutes keep counting past 59, so 75 minutes gives "75:00".
export function formatTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ":" + String(s).padStart(2, "0");
}

export function startWorkout(now = Date.now()) {
  return { start: now, end: null, machines: {} };
}

export function isRunning(workout) {
  return !!workout && workout.end === null;
}

export function workoutElapsed(workout, now = Date.now()) {
  if (!workout) return 0;
  return (workout.end ?? now) - workout.start;
}

export function machineElapsed(workout, exerciseId, now = Date.now()) {
  const m = workout && workout.machines[exerciseId];
  if (!m) return 0;
  return m.ms + (m.since !== null ? now - m.since : 0);
}

// Returns a new workout in which exactly the machines in ids are running.
// Machines that were running and are not in ids are paused, keeping their time.
export function runMachines(workout, ids, now = Date.now()) {
  const machines = {};
  for (const [id, m] of Object.entries(workout.machines)) {
    machines[id] = m.since !== null && !ids.includes(id)
      ? { ms: m.ms + (now - m.since), since: null }
      : { ...m };
  }
  for (const id of ids) {
    const m = machines[id] || { ms: 0, since: null };
    machines[id] = m.since === null ? { ms: m.ms, since: now } : m;
  }
  return { ...workout, machines };
}

// Stops every machine and marks the workout as finished.
export function endWorkout(workout, now = Date.now()) {
  return { ...runMachines(workout, [], now), end: now };
}

// A workout read back from storage: tidied up, or null if it is missing, damaged,
// or from an earlier day (so a forgotten workout does not carry over).
export function cleanWorkout(raw, now = Date.now()) {
  if (!raw || typeof raw !== "object" || !Number.isFinite(raw.start)) return null;
  if (new Date(raw.start).toDateString() !== new Date(now).toDateString()) return null;
  const machines = {};
  const stored = raw.machines && typeof raw.machines === "object" ? raw.machines : {};
  for (const [id, m] of Object.entries(stored)) {
    machines[id] = {
      ms: Number.isFinite(m?.ms) && m.ms > 0 ? m.ms : 0,
      since: Number.isFinite(m?.since) ? m.since : null,
    };
  }
  return { start: raw.start, end: Number.isFinite(raw.end) ? raw.end : null, machines };
}