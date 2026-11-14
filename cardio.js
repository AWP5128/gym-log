// Cardio machines (cross trainer, bike, rowing machine): one entry per machine per day with the time, the distance and
// (optionally) the average watts. Pure (no browser calls) so it can be tested.
//
// A cardio entry is a logged set { exerciseId, time, start, end, minutes, distance, watts?, gymId } where
//   time     when it was logged (the End button)
//   start    when the session started: the machine's clock first started, unless the user overrode it
//   minutes  the DURATION in minutes (seconds are a fraction: 32 min 20 s is 32.3333): the machine's clock when End was
//            pressed, unless the user typed one
//   end      start + duration, worked out and stored (never typed)
//   distance METRES, whatever unit the machine shows (km, mi or m), so changing a machine's unit never touches history
//   watts    average watts, left out when it was not noted
// Speed is worked out (km/h from distance and time) and is what the personal best is judged on, with watts. Bests are
// kept per machine and never compared between machines. Like the weight machines there are two levels: the best at
// this gym and the best ever.
import { setGym, setsForExercise } from "./log.js";

export const METRES_PER_MILE = 1609.344;
const KM_PER_MILE = METRES_PER_MILE / 1000;

const round = (n, dp) => Math.round(n * 10 ** dp) / 10 ** dp;

export const isCardio = (exercise) => exercise?.type === "cardio";
export const isCardioSet = (s) => s.minutes !== undefined && s.weight === undefined;

// ---------- Distance ----------
// A distance typed in km, mi or m, as metres (to a tenth of a metre).
export function toMetres(value, unit) {
  const m = unit === "km" ? value * 1000 : unit === "mi" ? value * METRES_PER_MILE : value;
  return round(m, 1);
}
// Metres as a number in the unit (2 decimal places for km and mi, whole metres for m).
export function fromMetres(metres, unit) {
  if (unit === "km") return round(metres / 1000, 2);
  if (unit === "mi") return round(metres / METRES_PER_MILE, 2);
  return Math.round(metres);
}
const two = (n) => n.toFixed(2);

// "12.50 km (7.77 mi)", kilometres first; the rowing machine shows "2000 m".
export function describeDistance(metres, unit) {
  if (!Number.isFinite(metres)) return "";
  if (unit === "m") return Math.round(metres) + " m";
  return two(metres / 1000) + " km (" + two(metres / METRES_PER_MILE) + " mi)";
}

// ---------- Time ----------
// Minutes and seconds typed in two boxes -> minutes (a blank box counts as 0). null when there is no time.
export function makeMinutes(min, sec) {
  const m = Number.isFinite(min) && min > 0 ? Math.floor(min) : 0;
  const s = Number.isFinite(sec) && sec > 0 ? Math.min(Math.floor(sec), 59) : 0;
  return m + s > 0 ? round(m + s / 60, 4) : null;
}
// Minutes -> { min, sec } for the two boxes.
export function splitMinutes(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return { min: 0, sec: 0 };
  const total = Math.round(minutes * 60);
  return { min: Math.floor(total / 60), sec: total % 60 };
}
// "30 min" or "32 min 20 s".
export function describeTime(minutes) {
  const { min, sec } = splitMinutes(minutes);
  return sec === 0 ? min + " min" : min === 0 ? sec + " s" : min + " min " + sec + " s";
}

// ---------- Start, duration and end ----------
const pad2 = (n) => String(n).padStart(2, "0");
// "07:05" for the Start box (local time).
export const clockText = (date) => pad2(date.getHours()) + ":" + pad2(date.getMinutes());
// "07:05" from the Start box as today's date at that time, or null when it is not a time. A time later than now
// means the session began before midnight, so it is yesterday's.
export function startFromText(text, now = new Date()) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? "").trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(m[1]), Number(m[2]));
  return d.getTime() > now.getTime() ? new Date(d.getTime() - 86400000) : d;
}
// end = start + duration
export const endOf = (start, minutes) => new Date(start.getTime() + Math.round(minutes * 60000));

// The duration of a session: what the user typed in the Minutes and Seconds boxes, otherwise the machine's clock
// (milliseconds). null when there is neither (under a second on the clock and nothing typed).
export function chooseDuration(min, sec, timerMs) {
  const typed = makeMinutes(min, sec);
  if (typed !== null) return { minutes: typed, source: "typed" };
  const secs = Math.round((timerMs || 0) / 1000);
  return secs > 0 ? { minutes: round(secs / 60, 4), source: "timer" } : null;
}

// The start of a session as a Date: the Start box if the user changed it (text; null when it is not a time),
// otherwise when the machine's clock first started (milliseconds), otherwise the duration before now.
export function chooseStart({ text, timerStart, minutes, now = new Date() }) {
  if (text !== undefined) return startFromText(text, now);
  if (Number.isFinite(timerStart)) return new Date(timerStart);
  return new Date(now.getTime() - Math.round(minutes * 60000));
}

// ---------- Speed ----------
// km/h from a distance in metres and a time in minutes, or null when either is missing.
export function speedKmh(metres, minutes) {
  if (!(metres > 0) || !(minutes > 0)) return null;
  return round(metres / 1000 / (minutes / 60), 4);
}
export const setSpeed = (s) => speedKmh(s.distance, s.minutes);
// "24.10 km/h (14.98 mph)"
export const describeSpeed = (kmh) => two(kmh) + " km/h (" + two(kmh / KM_PER_MILE) + " mph)";
export const describeWatts = (w) => Math.round(w) + " W";

// ---------- Entries ----------
// A cardio entry. distance is typed in the machine's unit and may be left out (then there is no speed or best);
// watts is optional (blank or 0 leaves it out).
export function makeCardioSet({ exerciseId, minutes, distance, unit, watts, gymId, start, now = new Date() }) {
  const from = start ?? new Date(now.getTime() - Math.round(minutes * 60000));
  return {
    exerciseId,
    time: now.toISOString(),
    start: from.toISOString(),
    end: endOf(from, minutes).toISOString(),
    minutes,
    ...(Number.isFinite(distance) && distance > 0 ? { distance: toMetres(distance, unit) } : {}),   // may be left out
    ...(Number.isFinite(watts) && watts > 0 ? { watts: Math.round(watts) } : {}),
    ...(gymId ? { gymId } : {}),
  };
}

// The entries logged for a machine today, newest last.
export const todaysEntries = (allSets, exerciseId, now = new Date()) =>
  setsForExercise(allSets, exerciseId).filter((s) => isCardioSet(s) && new Date(s.time).toDateString() === now.toDateString());

// One line for a logged entry: "07:10-07:42 · 32 min 20 s · 12.50 km (7.77 mi) · 23.20 km/h (14.42 mph) · 150 W".
export function describeEntry(s, unit) {
  const speed = setSpeed(s);
  const span = s.start && s.end ? clockText(new Date(s.start)) + "-" + clockText(new Date(s.end)) : "";
  return [span, describeTime(s.minutes), s.distance > 0 ? describeDistance(s.distance, unit) : "", speed !== null ? describeSpeed(speed) : "", s.watts > 0 ? describeWatts(s.watts) : ""]
    .filter(Boolean).join(" · ");
}

// What an entry would be as typed (for putting an undone entry back in the boxes).
export const entryBoxes = (s, unit) => ({
  ...splitMinutes(s.minutes), distance: s.distance > 0 ? fromMetres(s.distance, unit) : "", watts: s.watts > 0 ? s.watts : "",
  ...(s.start ? { startText: clockText(new Date(s.start)) } : {}),
});

// ---------- Personal bests ----------
// The best speed (km/h) and best watts in a list of entries; null where there is none.
function bestOf(list) {
  let speed = null;
  let watts = null;
  for (const s of list) {
    if (!isCardioSet(s)) continue;
    const v = setSpeed(s);
    if (v !== null && (speed === null || v > speed)) speed = v;
    if (s.watts > 0 && (watts === null || s.watts > watts)) watts = s.watts;
  }
  return { speed, watts };
}

// The bests for one machine: { gym, ever } each { speed, watts }. gym is the best at gymId, ever is the best at any gym.
export function cardioBests(allSets, exerciseId, gymId) {
  const mine = setsForExercise(allSets, exerciseId);
  return { gym: bestOf(mine.filter((s) => setGym(s) === gymId)), ever: bestOf(mine) };
}

// Which bests a new entry breaks, given the bests from before it was logged: { speed, watts }, each "ever" (beats the
// best ever, so it beats the gym's too), "gym" (only the gym's best) or null. The very first entry at a level never
// counts, and watts only count when watts were entered.
export function newCardioBests(before, entry) {
  const level = (value, ever, gym) => {
    if (value === null || value === undefined) return null;
    if (ever !== null && value > ever) return "ever";
    if (gym !== null && value > gym) return "gym";
    return null;
  };
  return {
    speed: level(setSpeed(entry), before.ever.speed, before.gym.speed),
    watts: level(entry.watts > 0 ? entry.watts : null, before.ever.watts, before.gym.watts),
  };
}

// The best lines for the card: [[label, text], ...]. Watts are left out for a machine that does not record them.
export function bestLines(b, showWatts = true) {
  const lines = [];
  const add = (what, gym, ever, fmt) => {
    if (ever === null) return;
    if (gym === ever) lines.push(["Best " + what + " here and ever", fmt(ever)]);
    else {
      if (gym !== null) lines.push(["Best " + what + " here", fmt(gym)]);
      lines.push(["Best " + what + " ever", fmt(ever)]);
    }
  };
  add("speed", b.gym.speed, b.ever.speed, describeSpeed);
  if (showWatts) add("watts", b.gym.watts, b.ever.watts, describeWatts);
  return lines;
}

// The "New best" lines shown after logging: ["New best speed ever", "New best watts here"].
export function newBestLines(levels) {
  const out = [];
  if (levels?.speed) out.push("New best speed " + (levels.speed === "ever" ? "ever" : "here"));
  if (levels?.watts) out.push("New best watts " + (levels.watts === "ever" ? "ever" : "here"));
  return out;
}
