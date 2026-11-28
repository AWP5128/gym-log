// Reports: figures per day, week (Monday to Sunday), month, quarter and year, worked out from the saved tables.
// Pure (no browser calls) so it can be tested. Nothing is stored: everything is calculated each time.
//
// What is counted (Awp, 28 Nov):
//   activities    one per type per day (legs on a day is 1 however many exercises); types legs, arms, abs, cardio, golf, walking
//   total weight  weight x reps of every logged weight set; a single limb set is weight x (left + right reps), which is its total reps;
//                 body weight with nothing added adds 0; cardio and typed-in best sets are left out. kg and lb sets add up in kg.
//   split         by session (legs, arms, abs: the session the set was logged in) and by muscle (superset.js muscleOf)
//   heart rate    seconds in each zone from the watch (garmin_activity), by the UK day the activity started, plus time below zone 1
//                 (duration minus the five zone seconds), in total and for each kind of activity

import { convert } from "./gym.js";
import { muscleOf, muscleLabel } from "./superset.js";
import { typeName } from "./garmin.js";

export const ACTIVITY_TYPES = [["legs", "Legs"], ["arms", "Arms"], ["abs", "Abs"], ["cardio", "Cardio"], ["golf", "Golf"], ["walking", "Walking"]];
const SESSIONS = [["legs", "Legs"], ["arms", "Arms"], ["abs", "Abs"]];
export const PERIOD_LABEL = { day: "Day", week: "Week", month: "Month", quarter: "Quarter", year: "Year" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_MS = 86400000;
const utc = (date) => { const [y, m, d] = date.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// The day in the UK, as YYYY-MM-DD.
const ukDay = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
// The day on this device, as a workout row's date is made.
const localDay = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); };

// The key of the period a day (YYYY-MM-DD) falls in. A week's key is its Monday.
export function periodKey(date, period) {
  if (period === "day") return date;
  if (period === "week") return isoDay(utc(date) - ((new Date(utc(date)).getUTCDay() + 6) % 7) * DAY_MS);
  if (period === "month") return date.slice(0, 7);
  if (period === "quarter") return date.slice(0, 4) + "-Q" + (Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1);
  return date.slice(0, 4);
}

// A period's name on screen: "Sat 28 Nov", "23-29 Nov", "Nov 2026", "Q4 2026", "2026".
export function periodLabel(key, period) {
  const text = (ms) => { const d = new Date(ms); return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()]; };
  if (period === "day") return DAYS[new Date(utc(key)).getUTCDay()] + " " + text(utc(key));
  if (period === "week") {
    const a = utc(key), b = a + 6 * DAY_MS;
    return new Date(a).getUTCMonth() === new Date(b).getUTCMonth() ? new Date(a).getUTCDate() + "-" + text(b) : text(a) + " - " + text(b);
  }
  if (period === "month") return MONTHS[Number(key.slice(5, 7)) - 1] + " " + key.slice(0, 4);
  if (period === "quarter") return key.slice(5) + " " + key.slice(0, 4);
  return key;
}

const add = (obj, k, n) => { obj[k] = (obj[k] ?? 0) + n; };

// One entry for every period that has anything in it, newest first:
// { key, label, activities: [[id, label, count]], weightKg, sets, bySession: [[id, label, kg]], byMuscle: [[label, kg]],
//   zones: null | { durationS, secs: [z1..z5], below, byType: [{ name, durationS, secs, below }] } }
export function buildReport(db, period) {
  const t = db.tables;
  const workoutDate = new Map(t.workout.map((w) => [w.id, w.date]));
  const wtype = new Map(t.workout_type.map((r) => [r.id, { type: r.exerciseTypeId, date: workoutDate.get(r.workoutId) }]));
  const wexercise = new Map(t.workout_exercise.map((r) => [r.id, wtype.get(r.workoutTypeId)]));
  const equipment = new Map();
  for (const r of t.gym_equipment) if (r.exerciseId !== null && r.exerciseId !== undefined) equipment.set(r.gymId + "\u0000" + r.exerciseId, r);
  const names = new Map(t.exercise.map((e) => [e.id, e.name]));

  const rows = new Map();
  const at = (date) => {
    const key = periodKey(date, period);
    if (!rows.has(key)) rows.set(key, { key, label: periodLabel(key, period), act: {}, weightKg: 0, sets: 0, ses: {}, mus: {}, zone: {} });
    return rows.get(key);
  };

  const seen = new Set();
  for (const wt of wtype.values()) {
    if (!wt.date || !wt.type || seen.has(wt.date + "|" + wt.type)) continue;
    seen.add(wt.date + "|" + wt.type);
    add(at(wt.date).act, wt.type, 1);
  }

  for (const s of t.logged_set) {
    if (s.manual || !Number.isFinite(s.weight) || !Number.isFinite(s.reps)) continue;
    const link = wexercise.get(s.workoutExerciseId);
    const eq = equipment.get(s.gymId + "\u0000" + s.exerciseId);
    const kg = convert(s.weight, s.unit ?? eq?.unit ?? "kg", "kg") * s.reps;
    const r = at(link?.date ?? localDay(s.time));
    r.weightKg += kg;
    r.sets += 1;
    add(r.ses, link?.type ?? eq?.exerciseTypeId ?? "other", kg);
    add(r.mus, muscleLabel(muscleOf({ id: s.exerciseId, name: eq?.name ?? names.get(s.exerciseId), muscle: eq?.muscle })) || "Other", kg);
  }

  for (const g of t.garmin_activity) {
    if (!g.start) continue;
    const secs = [1, 2, 3, 4, 5].map((i) => g["zone" + i + "S"]);
    const dur = Number.isFinite(g.durationS) ? g.durationS : 0;
    const z = at(ukDay(g.start)).zone;
    const b = (z[g.activityType] ??= { name: typeName(g.activityType), durationS: 0, secs: [0, 0, 0, 0, 0], below: 0 });
    b.durationS += dur;
    secs.forEach((v, i) => { if (Number.isFinite(v)) b.secs[i] += v; });
    if (secs.some(Number.isFinite)) b.below += Math.max(0, dur - secs.reduce((n, v) => n + (Number.isFinite(v) ? v : 0), 0));
  }

  return [...rows.values()].sort((a, b) => (a.key < b.key ? 1 : -1)).map((r) => {
    const types = Object.values(r.zone).sort((a, b) => b.durationS - a.durationS);
    return {
      key: r.key, label: r.label,
      activities: ACTIVITY_TYPES.filter(([id]) => r.act[id]).map(([id, label]) => [id, label, r.act[id]]),
      weightKg: r.weightKg, sets: r.sets,
      bySession: SESSIONS.filter(([id]) => r.ses[id] > 0).map(([id, label]) => [id, label, r.ses[id]]),
      byMuscle: Object.entries(r.mus).filter(([, kg]) => kg > 0).sort((a, b) => b[1] - a[1]),
      zones: types.length ? {
        durationS: types.reduce((n, x) => n + x.durationS, 0),
        secs: [0, 1, 2, 3, 4].map((i) => types.reduce((n, x) => n + x.secs[i], 0)),
        below: types.reduce((n, x) => n + x.below, 0),
        byType: types,
      } : null,
    };
  });
}

// The periods worth offering: day, week and month always; quarter once the data covers more than one month, year once
// it covers more than one quarter (Awp: not needed with one month of data).
export function availablePeriods(db) {
  const list = ["day", "week", "month"];
  if (buildReport(db, "month").length > 1) {
    list.push("quarter");
    if (buildReport(db, "quarter").length > 1) list.push("year");
  }
  return list;
}

// ---------- Text ----------
const LB_PER_KG = 1 / 0.45359237;
const num = (n) => Math.round(n).toLocaleString("en-GB");
// Pounds first and kilos in brackets, as the bests: "12,340 lb (5,597 kg)".
export const weightText = (kg) => num(kg * LB_PER_KG) + " lb (" + num(kg) + " kg)";
// "54 min", or "1h 05m" from an hour up.
export const lengthText = (s) => (s >= 3600 ? Math.floor(s / 3600) + "h " + String(Math.round((s % 3600) / 60)).padStart(2, "0") + "m" : Math.round(s / 60) + " min");
// Minutes in each zone: "Z1 4 · Z2 12 · Z3 20 · Z4 15 · Z5 3".
export const zoneText = (secs) => secs.map((s, i) => "Z" + (i + 1) + " " + Math.round(s / 60)).join(" · ");
