// Step 78: matching Garmin watch activities to the logged workouts, and saving them. Pure (no browser, no files): it takes the
// activities from the export file and the saved db, and gives back what it found and the new db. Nothing here is guessed:
// a match that is not clear is reported as "near" or "ambiguous" so the person decides.
//
// An activity: { id, type, name, start (ISO, UTC), durationS, distanceM, avgHr, maxHr, calories, zones: [z1..z5 seconds] }
// MASTER RULE: the gym app is master for times, distance and watts and the watch is master for heart rate. A matched activity
// is saved as a garmin_activity row (the watch's own readings) linked to the workout; the workout rows are never changed.
// Only golf and walks, which have no logged workout, get workout rows, with the watch's times and distance.
import { rowsOf, putRow, putRows } from "./db.js";
import { exerciseTables, OUTDOOR_TYPES } from "./schema4.js";
import { newGymId, cryptoRandom } from "./gym.js";

export const NEAR_MS = 30 * 60 * 1000;          // typed in afterwards: the nearest window within half an hour is offered
const SAME_MS = 60 * 60 * 1000;                 // two identical readings this close are one activity recorded twice
const MACHINE = { elliptical: "cross-trainer", indoor_cycling: "stationary-bike", indoor_rowing: "rowing-machine" };
const OUTDOOR = new Set(OUTDOOR_TYPES.map((o) => o.id));
const STRENGTH = new Set(["legs", "arms", "abs"]);

const ms = (iso) => Date.parse(iso);
const endMs = (a) => ms(a.start) + (a.durationS ?? 0) * 1000;
const iso = (t) => new Date(t).toISOString();
const finite = (v) => (Number.isFinite(v) ? v : undefined);
// the day in the UK (a round that starts at 00:30 summer time belongs to that day, not the UTC one)
const ukDate = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));

// Drops an activity that came twice: the same id, or the same readings (type, length, highest rate, seconds in every zone)
// within an hour, as when a session was saved on the watch twice. The earlier start is kept.
export function dedupe(acts) {
  const sorted = [...acts].sort((a, b) => ms(a.start) - ms(b.start));
  const kept = [];
  const dropped = [];
  const ids = new Set();
  for (const a of sorted) {
    const id = String(a.id ?? a.start);
    const twin = kept.find((k) => k.type === a.type && k.durationS === a.durationS && k.maxHr === a.maxHr
      && (k.zones ?? []).join() === (a.zones ?? []).join() && ms(a.start) - ms(k.start) <= SAME_MS);
    if (ids.has(id) || twin) { dropped.push(a); continue; }
    ids.add(id);
    kept.push(a);
  }
  return { kept, dropped };
}

const span = (start, end) => ({ s: ms(start), e: ms(end ?? start) });
// how the watch's [s, e] sits against a window: the overlap in ms (positive), else minus the gap
const closeness = (a, w) => Math.min(endMs(a), w.e) - Math.max(ms(a.start), w.s);

// Of some windows ({ ..., s, e }) the ones the activity overlaps; failing that the nearest within NEAR_MS.
function pick(a, wins) {
  const over = wins.filter((w) => closeness(a, w) > 0);
  if (over.length) return { how: "match", wins: over };
  const near = wins.map((w) => ({ w, gap: -closeness(a, w) })).filter((x) => x.gap <= NEAR_MS).sort((x, y) => x.gap - y.gap);
  if (!near.length) return { how: "none", wins: [] };
  const best = near.filter((x) => x.gap - near[0].gap < 60000).map((x) => x.w);        // ties within a minute are all kept
  return { how: "near", wins: best };
}

// What each activity matches. Returns [{ act, status, workoutId?, workoutTypeId?, workoutExerciseId?, note }].
// status: "have" (already saved), "match", "near" (offered, needs a yes), "ambiguous" (no link made), "create" (golf or a walk
// with no workout yet: rows will be made), "none" (kept on its own, no workout).
export function matchActivities(acts, db, personId) {
  const t = db.tables;
  const workouts = new Map(rowsOf(db, "workout").filter((w) => w.personId === personId).map((w) => [w.id, w]));
  const parts = rowsOf(db, "workout_type").filter((x) => workouts.has(x.workoutId) && x.start).map((x) => ({ ...x, ...span(x.start, x.end) }));
  const exs = rowsOf(db, "workout_exercise").map((x) => {
    const p = parts.find((q) => q.id === x.workoutTypeId);
    return p && x.start ? { ...x, workoutId: p.workoutId, ...span(x.start, x.end) } : null;
  }).filter(Boolean);
  const have = new Set(rowsOf(db, "garmin_activity").filter((g) => g.personId === personId).map((g) => g.garminId));

  const out = acts.map((act) => {
    const r = { act, status: "none", note: "" };
    if (have.has(String(act.id ?? act.start))) return { ...r, status: "have", note: "already saved" };
    let found;
    if (act.type === "strength_training") {
      found = pick(act, parts.filter((p) => STRENGTH.has(p.exerciseTypeId)));
      const workoutIds = [...new Set(found.wins.map((w) => w.workoutId))];
      if (workoutIds.length > 1) return { ...r, status: "ambiguous", note: "could be more than one day or gym", candidates: workoutIds };
      if (!workoutIds.length) return { ...r, note: "no workout near this time" };
      return { ...r, status: found.how, workoutId: workoutIds[0], workoutTypeId: found.wins.length === 1 ? found.wins[0].id : undefined,
        note: found.wins.length > 1 ? "covers " + found.wins.length + " parts of one workout" : "" };
    }
    if (MACHINE[act.type]) {
      found = pick(act, exs.filter((x) => x.exerciseId === MACHINE[act.type]));
      if (found.wins.length > 1) return { ...r, status: "ambiguous", note: "more than one entry fits", candidates: found.wins.map((w) => w.id) };
      if (!found.wins.length) return { ...r, note: "no " + MACHINE[act.type] + " entry near this time" };
      const w = found.wins[0];
      return { ...r, status: found.how, workoutId: w.workoutId, workoutTypeId: w.workoutTypeId, workoutExerciseId: w.id };
    }
    if (OUTDOOR.has(act.type)) {
      found = pick(act, parts.filter((p) => p.exerciseTypeId === act.type));
      if (found.wins.length > 1) return { ...r, status: "ambiguous", note: "more than one entry fits", candidates: found.wins.map((w) => w.id) };
      if (found.wins.length) {
        const w = found.wins[0];
        return { ...r, status: found.how, workoutId: w.workoutId, workoutTypeId: w.id };
      }
      return { ...r, status: "create", note: "a new " + act.type + " workout" };
    }
    return { ...r, note: "kept on its own (" + act.type + ")" };
  });

  // two activities that both claim one part or one cardio entry cannot both be right: no link, the person decides
  const claims = new Map();
  // (a cardio entry is claimed by its machine, not by the cardio part, which holds several machines; anything else by its part)
  for (const p of out) { const k = p.workoutExerciseId ?? p.workoutTypeId; if (k && ["match", "near"].includes(p.status)) claims.set(k, [...(claims.get(k) ?? []), p]); }
  for (const list of claims.values()) {
    if (list.length < 2) continue;
    for (const p of list) Object.assign(p, { status: "ambiguous", note: "another activity fits the same entry", candidates: [p.workoutId], workoutId: undefined, workoutTypeId: undefined, workoutExerciseId: undefined });
  }
  return out;
}

export const summarise = (proposals) => proposals.reduce((n, p) => ({ ...n, [p.status]: (n[p.status] ?? 0) + 1 }), {});

// The garmin_activity row for an activity (the watch's own readings, as recorded) with the links it was given.
export const garminRow = (personId, p) => {
  const a = p.act;
  const z = a.zones ?? [];
  const row = {
    id: personId + ":garmin:" + String(a.id ?? a.start), personId, garminId: String(a.id ?? a.start), activityType: a.type, name: a.name,
    start: iso(ms(a.start)), end: iso(endMs(a)), durationS: finite(a.durationS), distanceM: finite(a.distanceM), avgHr: finite(a.avgHr),
    maxHr: finite(a.maxHr), calories: finite(a.calories),
    zone1S: finite(z[0]), zone2S: finite(z[1]), zone3S: finite(z[2]), zone4S: finite(z[3]), zone5S: finite(z[4]),
    workoutId: p.workoutId, workoutTypeId: p.workoutTypeId, workoutExerciseId: p.workoutExerciseId,
  };
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined && v !== null));
};

// Saves the accepted proposals: a garmin_activity row for each, and for a "create" the workout rows of a golf round or a walk
// at the one Outdoors place (made, with its membership, the first time). `proposals` is what matchActivities gave, after the
// person has said yes or no to each (leave out the ones they refused; set workoutId and the other links to undefined to keep one
// on its own). "have" is skipped, so importing the same file twice changes nothing. Workout rows of matched activities are never touched.
export function importActivities(db0, personId, proposals, { random = cryptoRandom } = {}) {
  let db = db0;
  for (const p of proposals) {
    if (p.status === "have") continue;
    let links = p;
    if (p.status === "create") {
      const made = outdoorRows(db, personId, p.act, random);
      db = made.db;
      links = { ...p, ...made.links };
    }
    db = putRow(db, "garmin_activity", garminRow(personId, links));
  }
  const { exercise, exercise_type } = exerciseTables(db.tables);
  return { ...db, tables: { ...db.tables, exercise, exercise_type } };
}

function outdoorRows(db0, personId, a, random) {
  let db = db0;
  let gym = rowsOf(db, "gym").find((g) => g.outdoors);
  if (!gym) {
    gym = { id: newGymId(new Set(rowsOf(db, "gym").map((g) => g.id)), random), name: "Outdoors", units: {}, outdoors: true };
    db = putRow(db, "gym", gym);
  }
  if (!rowsOf(db, "gym_member").some((m) => m.personId === personId && m.gymId === gym.id)) {
    db = putRow(db, "gym_member", { personId, gymId: gym.id, role: "owner", status: "active", offTypes: [] });
  }
  const start = iso(ms(a.start));
  const end = iso(endMs(a));
  const date = ukDate(ms(a.start));
  const wid = personId + ":" + gym.id + ":" + date;
  const wtid = wid + ":" + a.type;
  const weid = wtid + ":" + a.type;
  const widen = (row) => ({ ...row, start: row?.start && row.start < start ? row.start : start, end: row?.end && row.end > end ? row.end : end });
  const w = rowsOf(db, "workout").find((x) => x.id === wid);
  db = putRow(db, "workout", { ...(w ?? { id: wid, personId, gymId: gym.id, date }), ...widen(w) });
  const wt = rowsOf(db, "workout_type").find((x) => x.id === wtid);
  db = putRow(db, "workout_type", { ...(wt ?? { id: wtid, workoutId: wid, exerciseTypeId: a.type }), ...widen(wt) });
  const we = rowsOf(db, "workout_exercise").find((x) => x.id === weid);
  const distance = (we?.distance ?? 0) + (finite(a.distanceM) ?? 0);
  db = putRow(db, "workout_exercise", {
    ...(we ?? { id: weid, workoutTypeId: wtid, exerciseId: a.type }), ...widen(we), ...(distance > 0 ? { distance } : {}),
  });
  return { db, links: { workoutId: wid, workoutTypeId: wtid, workoutExerciseId: weid } };
}

// ---------- The confirm list (Backup > Import Garmin file) ----------
// One row per activity: what it is, what it matched, and what will happen to it; a tap on the row steps through the choices.
//   link = save it linked to the workout; alone = save it with no workout; create = make the golf or walk workout; skip = leave it out.
const CHOICES = { match: ["link", "skip"], near: ["link", "alone", "skip"], ambiguous: ["alone", "skip"], create: ["create", "skip"], none: ["alone", "skip"], have: ["skip"] };
export const CHOICE_LABEL = { link: "Link", alone: "On its own", create: "Make workout", skip: "Skip" };
export const defaultChoice = (p) => CHOICES[p.status][0];
export const nextChoice = (p, c) => { const l = CHOICES[p.status]; return l[(l.indexOf(c) + 1) % l.length]; };
export const canChange = (p) => CHOICES[p.status].length > 1;

const NAMES = { strength_training: "Strength", elliptical: "Elliptical", indoor_cycling: "Bike", golf: "Golf", walking: "Walk", indoor_rowing: "Rower" };
export const typeName = (t) => NAMES[t] ?? t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, " ");
const pretty = (id) => id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, " ");
const parts = (iso, opts) => Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hourCycle: "h23", ...opts }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
const dayText = (iso) => { const p = parts(iso, { day: "numeric", month: "short" }); return p.day + " " + p.month; };
export const whenText = (iso) => { const p = parts(iso, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); return `${p.weekday} ${p.day} ${p.month} ${p.hour}:${p.minute}`; };
const lengthText = (s) => (s >= 3600 ? Math.floor(s / 3600) + "h " + String(Math.round((s % 3600) / 60)).padStart(2, "0") + "m" : Math.round(s / 60) + "m");

// { title, detail } for one proposal: the activity, and where it goes.
export function describe(p, db) {
  const a = p.act;
  const title = [whenText(a.start), typeName(a.type), a.durationS ? lengthText(a.durationS) : "", a.distanceM > 0 ? (a.distanceM / 1000).toFixed(1) + " km" : ""].filter(Boolean).join(" · ");
  const w = p.workoutId ? rowsOf(db, "workout").find((x) => x.id === p.workoutId) : null;
  const what = p.workoutExerciseId ? pretty(rowsOf(db, "workout_exercise").find((x) => x.id === p.workoutExerciseId)?.exerciseId ?? "workout")
    : p.workoutTypeId ? pretty(rowsOf(db, "workout_type").find((x) => x.id === p.workoutTypeId)?.exerciseTypeId ?? "workout") : "workout";
  const target = what + (w ? " on " + dayText(w.date + "T12:00:00Z") : "");
  const detail = {
    have: "Already saved", match: "Matches " + target, near: "Close match: " + target + ". Check it", create: "A new " + typeName(a.type).toLowerCase() + " workout",
    ambiguous: "Could fit more than one workout" + (p.note ? " (" + p.note + ")" : ""), none: p.note || "No workout found",
  }[p.status];
  return { title, detail: p.status === "match" && p.note ? detail + " (" + p.note + ")" : detail };
}

// The proposals the person accepted, ready for importActivities: "alone" drops the links, "skip" leaves the activity out.
export const accepted = (rows) => rows.filter((r) => r.choice !== "skip" && r.p.status !== "have").map((r) =>
  r.choice === "alone" ? { ...r.p, status: "none", workoutId: undefined, workoutTypeId: undefined, workoutExerciseId: undefined } : r.p);
