// Version 4 of the saved data: the twelve tables (see the persistence decisions). Pure (no browser
// calls) so it can be tested. This file only CONVERTS: migrateToV4 turns the version 3 store, the logged
// sets and (when there is no store yet) the old gymlog.settings into version 4, and fromV4 turns version 4
// back into the version 3 shapes so a test can check that nothing was lost. Nothing in the app uses it yet.
//
// v4 = { version: 4, currentGym, defaultGym, currentPerson, tables: { ... } }
//
//   Who and where
//     person          { id, name, defaults, superset? }       defaults = { heavy|volume: { reps, sets, warmupReps } }
//                                                              superset = { pairs: [[a, b]], suitable: [id] }
//     gym             { id, name, units, listDefault?, starterFree?, starterAbs?, starterCardio?, pullUpsMoved?, outdoors? }
//                     outdoors: true on the one shared place for golf rounds and walks; the Gym lists leave it out (no equipment)
//     gym_member      { personId, gymId, role, status, offTypes }   offTypes: equipment types switched off
//     gym_equipment   { gymId, id, exerciseId | null, equipmentTypeId, exerciseTypeId?, name, unit, step?,
//                       common?, min?, pins?, stackSpec?, hidden?, muscle?, uses?, top?, watts? }
//                     one row per gym and exercise; the gym's Dumbbells and Barbell are rows too (id "set:dumbbells",
//                     exerciseId null) and an exercise points to its set with `uses` (the set's id, without "set:")
//   What
//     equipment_type  { id, label }
//     exercise_type   { id, label, dayTypes }                  dayTypes: ["heavy", "volume"] or []
//     exercise        { id, name, exerciseTypeId, alsoUnder, custom? }   one movement, shared by every gym
//   Personal
//     personal_setup  { personId, gymId, exerciseId, dayType, warmup, working, notes?, never? }
//                     never: true on the dayType-null row = this person never uses the exercise at this gym (hidden from their lists)
//                     use: "normal" | "rare" on that row = a choice that differs from the exercise's own default (rare = under Show less common)
//                     a row per person, machine and day type; notes are written on each day-type row;
//                     a machine with notes only has one row with dayType null
//   Training log
//     workout         { id, personId, gymId, date, start, end }        one per person, gym and day; id = "person:gym:date"
//     workout_type    { id, workoutId, exerciseTypeId, dayType, start, end }
//     workout_exercise{ id, workoutTypeId, exerciseId, distance, avgHeartRate, zoneMinutes, watts, level, start, end }
//                     the cardio fields are blank (null) until there is data. A cardio entry is one logged_set (minutes) per
//                     machine per day, and its distance (METRES, whatever unit the machine shows), average watts and its
//                     start and end times (end = start + the duration, which is the logged_set's minutes) sit here
//     logged_set      { id (person:time:exercise), seq, personId, workoutExerciseId, exerciseId, gymId, time, weight, reps, repsLeft, repsRight, minutes, unit, mode }
//                     (reps is the total; repsLeft and repsRight, both or neither, are the reps on each leg of a single-leg set: step 85)
//                     seq is the place in the old flat list. A typed-in best from before the app is a manual
//                     logged_set: { id, personId, gymId, exerciseId, manual: true, weight, reps, time: null }.
//   Garmin (private heart-rate data from the watch, added step 74)
//     garmin_activity { id (person:garmin:activityId), personId, garminId, activityType, name, start, end, durationS, distanceM,
//                       avgHr, maxHr, calories, zone1S..zone5S (seconds in each heart-rate zone), workoutId, workoutTypeId, workoutExerciseId }
//                     the three links are blank until a session is matched to a workout; workoutId is what reports add up by
//
// Not carried over (they are about today, not history): the running workout timer, the done-today list and
// the chosen session. Total weight, bests and times per machine are calculated, never stored.

import { cleanStore, migrateLegacy, DEFAULT_GYM, DEFAULT_PERSON } from "./store.js";
import { exercises as BUILT_IN, sessionTypes } from "./exercises.js";
import { TYPES, STARTER_FREE, STARTER_ABS, STARTER_CARDIO } from "./gym.js";

export const SCHEMA_VERSION = 4;
// The two session types for Garmin activities done outdoors. They are not on the start screen (sessionTypes); they only exist
// as exercise_type rows and as one exercise each, so a golf round or a walk is a workout like any other.
export const OUTDOOR_TYPES = [{ id: "golf", label: "Golf" }, { id: "walking", label: "Walking" }];
export const TABLES = [
  "person", "gym", "gym_member", "gym_equipment", "equipment_type", "exercise_type", "exercise",
  "personal_setup", "workout", "workout_type", "workout_exercise", "logged_set", "garmin_activity",
];

// Exercises that also appear under another session's list (pull-ups are filed under arms and done alongside legs day).
const ALSO_UNDER = { "pull-up": ["legs"] };
const DAY_TYPES = ["heavy", "volume"];
const SET_PREFIX = "set:";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const validSet = (s) =>
  isObj(s) && typeof s.exerciseId === "string" && s.exerciseId !== "" &&
  typeof s.time === "string" && !Number.isNaN(new Date(s.time).getTime());
const ymd = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
};

// What the built-in lists say about an exercise id: its name and session.
const KNOWN = new Map();
for (const e of [...BUILT_IN, ...STARTER_FREE, ...STARTER_ABS, ...STARTER_CARDIO]) KNOWN.set(e.id, { name: e.name, group: e.group });
for (const o of OUTDOOR_TYPES) KNOWN.set(o.id, { name: o.label, group: o.id });

// ---------- Version 3 (+ sets) to version 4 ----------
// input: { store, settings, sets }. store is the saved gymlog.store (or null); settings is the old
// gymlog.settings, used only when there is no store. Returns { ok, v4, report, error }.
// The gym table row for a gym, and the gym_equipment rows for its weight sets (the gym's Dumbbells and Barbell).
// migrateToV4 and db.js both use these, so a gym added through db.js looks exactly like one that was converted.
export const gymRow = (id, g) => clean({
  id, name: g.name, units: g.units, listDefault: g.listDefault, starterFree: g.starterFree, starterAbs: g.starterAbs,
  starterCardio: g.starterCardio, pullUpsMoved: g.pullUpsMoved,
});
export const itemRow = (gymId, id, it) => clean({
  gymId, id, exerciseId: id, equipmentTypeId: it.type, exerciseTypeId: it.group, name: it.name,
  unit: it.unit, step: it.step, common: it.common, min: it.min, pins: it.pins, stackSpec: it.stackSpec,
  hidden: it.hidden, muscle: it.muscle, uses: it.weightSet, watts: it.watts,
});
export const weightSetRows = (gymId, g) => Object.entries(g.weightSets || {}).map(([id, ws]) => clean({
  gymId, id: SET_PREFIX + id, exerciseId: null, equipmentTypeId: ws.type, name: ws.name, unit: ws.unit,
  pins: ws.pins, stackSpec: ws.stackSpec, top: ws.top, hidden: ws.hidden,
}));

// One person's personal_setup rows and typed-in bests (manual logged_set rows) for the gyms in `gymIds`, and the exercise ids they
// mention in the order a conversion meets them. migrateToV4 and db.js both use it.
export function setupRows(personId, p, gymIds) {
  const rows = [];
  const manual = [];
  const ids = [];
  for (const [gymId, pg] of Object.entries(isObj(p.gyms) ? p.gyms : {})) {
    if (!gymIds.has(gymId)) continue;
    // "never used here" marks go on the person's no-day-type row for the exercise (made if there is none yet)
    const neverMap = isObj(pg?.never) ? pg.never : {};
    const useMap = isObj(pg?.use) ? pg.use : {};
    const neverRows = [...new Set([...Object.keys(neverMap).filter((id) => neverMap[id] === true), ...Object.keys(useMap).filter((id) => useMap[id] === "normal" || useMap[id] === "rare")])];
    for (const [exerciseId, m] of Object.entries(isObj(pg?.machines) ? pg.machines : {})) {
      ids.push(exerciseId);
      const dayRows = DAY_TYPES.filter((d) => isObj(m[d]));
      for (const dayType of dayRows) {
        rows.push(clean({
          personId, gymId, exerciseId, dayType, warmup: m[dayType].warmup, working: m[dayType].working,
          notes: m.notes || undefined,
        }));
      }
      if (dayRows.length === 0 && m.notes) rows.push({ personId, gymId, exerciseId, dayType: null, notes: m.notes });
      if (Number.isFinite(m.pbWeight) || Number.isFinite(m.pbReps)) {
        manual.push(clean({
          id: "manual:" + personId + ":" + gymId + ":" + exerciseId, personId, gymId, exerciseId, manual: true,
          weight: Number.isFinite(m.pbWeight) ? m.pbWeight : undefined,
          reps: Number.isFinite(m.pbReps) ? m.pbReps : undefined, time: null, workoutExerciseId: null,
        }));
      }
    }
    for (const exerciseId of neverRows) {
      ids.push(exerciseId);
      const row = rows.find((r) => r.gymId === gymId && r.exerciseId === exerciseId && r.dayType === null);
      const marks = { ...(neverMap[exerciseId] === true ? { never: true } : {}), ...(useMap[exerciseId] === "normal" || useMap[exerciseId] === "rare" ? { use: useMap[exerciseId] } : {}) };
      if (row) Object.assign(row, marks);
      else rows.push({ personId, gymId, exerciseId, dayType: null, ...marks });
    }
  }
  return { rows, manual, ids };
}

// The person table row.
export const personRow = (id, p) => clean({ id, name: p.name, defaults: p.defaults ?? {}, superset: p.superset });

// The workout, workout_type, workout_exercise and logged_set rows for a list of sets (the old flat list the screens keep):
// one workout per person, gym and day; a set that is not valid is left out (but still counts in `seq`, its place in the list).
// groupOf(gymId, exerciseId) says which group an exercise is in at a gym. Also gives, in the order a conversion meets them,
// the exercise ids and the group ids the sets mention. migrateToV4 and db.js both use it.
export function setTables(personId, sets, groupOf) {
  const good = [];
  sets.forEach((s, seq) => { if (validSet(s)) good.push({ s, seq }); });
  const dropped = sets.length - good.length;
  const workouts = new Map();
  const wtypes = new Map();
  const wexes = new Map();
  const loggedSets = [];
  const setIds = new Map();
  const exerciseIds = [];
  const typeIds = [];
  for (const { s, seq } of good) {
    const gymId = s.gymId ?? DEFAULT_GYM;
    exerciseIds.push(s.exerciseId);
    const date = ymd(s.time);
    const wid = personId + ":" + gymId + ":" + date;   // person first: ids stay unique when several people share a database
    let w = workouts.get(wid);
    if (!w) {
      w = { id: wid, personId, gymId, date, start: s.time, end: s.time };
      workouts.set(wid, w);
    }
    if (s.time < w.start) w.start = s.time;
    if (s.time > w.end) w.end = s.time;
    const typeId = groupOf(gymId, s.exerciseId);
    typeIds.push(typeId);
    const wtid = wid + ":" + typeId;
    let wt = wtypes.get(wtid);
    if (!wt) {
      wt = { id: wtid, workoutId: wid, exerciseTypeId: typeId, dayType: s.mode ?? null, start: s.time, end: s.time };
      wtypes.set(wtid, wt);
    }
    if (s.time < wt.start) wt.start = s.time;
    if (s.time > wt.end) wt.end = s.time;
    if (wt.dayType === null && s.mode) wt.dayType = s.mode;
    const weid = wtid + ":" + s.exerciseId;
    if (!wexes.has(weid)) {
      wexes.set(weid, {
        id: weid, workoutTypeId: wtid, exerciseId: s.exerciseId,
        // a cardio entry (one per machine per day) keeps its distance (metres) and watts here; weights have none
        distance: Number.isFinite(s.distance) ? s.distance : null, avgHeartRate: null, zoneMinutes: null,
        watts: Number.isFinite(s.watts) ? s.watts : null, level: null,
        start: typeof s.start === "string" ? s.start : null, end: typeof s.end === "string" ? s.end : null,
      });
    }
    // a set's id comes from who, when and what, so it stays the same however the list changes and differs between phones
    const base = personId + ":" + s.time + ":" + s.exerciseId;
    const dup = setIds.get(base) ?? 0;
    setIds.set(base, dup + 1);
    loggedSets.push(clean({
      id: dup ? base + "#" + dup : base, seq, personId, workoutExerciseId: weid, exerciseId: s.exerciseId, gymId, time: s.time,
      weight: s.weight, reps: s.reps, repsLeft: s.repsLeft, repsRight: s.repsRight, minutes: s.minutes, unit: s.unit, mode: s.mode,
    }));
  }
  return {
    workout: [...workouts.values()], workout_type: [...wtypes.values()], workout_exercise: [...wexes.values()],
    logged_set: loggedSets, exerciseIds, typeIds, dropped,
  };
}

// groupOf(gymId, exerciseId) worked out from the tables: the group of the gym's own item, else the built-in or added exercise's group.
export function groupLookup(t) {
  const own = new Map();
  for (const r of t.gym_equipment) if (r.exerciseId !== null && r.exerciseId !== undefined) own.set(r.gymId + "\u0000" + r.exerciseId, r.exerciseTypeId);
  const customs = new Map(t.exercise.filter((e) => e.custom).map((e) => [e.id, e.custom]));
  return (gymId, exerciseId) => own.get(gymId + "\u0000" + exerciseId) ?? KNOWN.get(exerciseId)?.group ?? customs.get(exerciseId)?.group ?? "unknown";
}

export function migrateToV4({ store = null, settings = null, sets = [] } = {}) {
  const fail = (error) => ({ ok: false, v4: null, report: null, error });
  let v3;
  let source = "store";
  if (store === null || store === undefined) {
    v3 = migrateLegacy(isObj(settings) ? settings : {});
    source = "legacy";
  } else {
    v3 = cleanStore(store);
    if (!v3) return fail("This data was made by a version of the app that cannot be read.");
  }
  if (!Array.isArray(sets)) return fail("The logged sets are not a list.");

  const t = Object.fromEntries(TABLES.map((n) => [n, []]));

  // equipment_type and exercise_type
  for (const x of TYPES) t.equipment_type.push({ id: x.id, label: x.label });
  const typeIds = new Set();
  for (const s of sessionTypes) {
    typeIds.add(s.id);
    t.exercise_type.push({ id: s.id, label: s.label, dayTypes: s.weights ? [...DAY_TYPES] : [] });
  }
  for (const o of OUTDOOR_TYPES) { typeIds.add(o.id); t.exercise_type.push({ id: o.id, label: o.label, dayTypes: [] }); }
  const addType = (id) => {
    if (typeof id !== "string" || typeIds.has(id)) return;
    typeIds.add(id);
    t.exercise_type.push({ id, label: id, dayTypes: [] });
  };

  // person and gym
  const people = Object.entries(v3.people);
  for (const [id, p] of people) {
    t.person.push(personRow(id, p));
  }
  const gymEntries = Object.entries(v3.gyms);
  for (const [id, g] of gymEntries) t.gym.push(gymRow(id, g));

  // gym_member: everyone on this phone owns every gym in the store
  const orphanSetups = [];
  for (const [personId, p] of people) {
    for (const gymId of Object.keys(v3.gyms)) t.gym_member.push({ personId, gymId, role: "owner", status: "active", offTypes: [] });
    for (const gymId of Object.keys(isObj(p.gyms) ? p.gyms : {})) {
      if (!v3.gyms[gymId]) orphanSetups.push(personId + "/" + gymId);
    }
  }

  // gym_equipment, and the ids every exercise row has to cover
  const used = new Map();   // exercise id -> first item seen (for a name and session when nothing built in knows it)
  const note = (id, item) => { if (!used.has(id)) used.set(id, item ?? null); };
  let itemCount = 0;
  for (const [gymId, g] of gymEntries) {
    for (const [id, it] of Object.entries(g.equipment || {})) {
      note(id, it);
      addType(it.group);
      itemCount++;
      t.gym_equipment.push(itemRow(gymId, id, it));
    }
    t.gym_equipment.push(...weightSetRows(gymId, g));
  }
  const customs = new Map(v3.custom.filter((c) => isObj(c) && typeof c.id === "string").map((c, i) => [c.id, { def: c, i }]));
  for (const id of customs.keys()) note(id, null);

  // personal_setup (and manual bests as logged sets)
  let setupCount = 0;
  const gymIds = new Set(Object.keys(v3.gyms));
  for (const [personId, p] of people) {
    const r = setupRows(personId, p, gymIds);
    t.personal_setup.push(...r.rows);
    t.logged_set.push(...r.manual);
    for (const id of r.ids) note(id, null);
    setupCount += r.rows.length;
  }

  // the logged sets: one workout per gym per day
  const groupOf = (gymId, exerciseId) => v3.gyms[gymId]?.equipment?.[exerciseId]?.group
    ?? KNOWN.get(exerciseId)?.group ?? customs.get(exerciseId)?.def.group ?? "unknown";
  const made = setTables(v3.currentPerson, sets, groupOf);
  const dropped = made.dropped;
  const loggedSets = made.logged_set;
  for (const id of made.exerciseIds) note(id, null);
  for (const id of made.typeIds) addType(id);
  t.workout.push(...made.workout);
  t.workout_type.push(...made.workout_type);
  t.workout_exercise.push(...made.workout_exercise);
  t.logged_set.push(...loggedSets);

  // exercise: one row per movement
  for (const [id, firstItem] of used) {
    const known = KNOWN.get(id);
    const custom = customs.get(id);
    const name = known?.name ?? custom?.def.name ?? firstItem?.name ?? id;
    const exerciseTypeId = known?.group ?? custom?.def.group ?? firstItem?.group ?? null;
    addType(exerciseTypeId);
    t.exercise.push(clean({
      id, name, exerciseTypeId, alsoUnder: ALSO_UNDER[id] ?? [],
      custom: custom ? { ...custom.def, customIndex: custom.i } : undefined,
    }));
  }

  const v4 = {
    version: SCHEMA_VERSION,
    currentGym: v3.currentGym,
    defaultGym: v3.defaultGym,
    currentPerson: v3.currentPerson,
    tables: t,
  };
  const report = {
    source, people: t.person.length, gyms: t.gym.length, items: itemCount, setups: setupCount,
    sets: loggedSets.length, dropped, workouts: t.workout.length, orphanSetups,
  };
  return { ok: true, v4, report, error: "" };
}

// All the gym_equipment rows of one gym, in the order a conversion lists them: its items, then its weight sets.
export const equipmentRows = (gymId, g) => [
  ...Object.entries(g.equipment || {}).map(([id, it]) => itemRow(gymId, id, it)),
  ...weightSetRows(gymId, g),
];

// The exercise and exercise_type tables worked out from the other tables of a db (the same rows a conversion makes):
// one exercise row for every exercise used by any gym's equipment, an added exercise, a personal setup or a logged set,
// and a type row for each session type plus any other group in use. Gives { exercise, exercise_type }.
// (An exercise first met only through a typed-in best can come in a different place in the list than a conversion puts it; no screen reads the order.)
export function exerciseTables(t) {
  const types = sessionTypes.map((s) => ({ id: s.id, label: s.label, dayTypes: s.weights ? [...DAY_TYPES] : [] }));
  for (const o of OUTDOOR_TYPES) types.push({ id: o.id, label: o.label, dayTypes: [] });
  const typeIds = new Set(types.map((x) => x.id));
  const addType = (id) => {
    if (typeof id !== "string" || typeIds.has(id)) return;
    typeIds.add(id);
    types.push({ id, label: id, dayTypes: [] });
  };
  const used = new Map();
  const note = (id, item) => { if (!used.has(id)) used.set(id, item ?? null); };
  for (const r of t.gym_equipment) {
    if (r.exerciseId === null || r.exerciseId === undefined) continue;
    note(r.exerciseId, { name: r.name, group: r.exerciseTypeId });
    addType(r.exerciseTypeId);
  }
  const customs = new Map(t.exercise.filter((e) => e.custom).sort((a, b) => a.custom.customIndex - b.custom.customIndex).map((e) => [e.id, e.custom]));
  for (const id of customs.keys()) note(id, null);
  for (const r of t.personal_setup) note(r.exerciseId, null);
  for (const r of t.logged_set) if (r.manual) note(r.exerciseId, null);
  for (const r of t.logged_set) if (!r.manual) note(r.exerciseId, null);
  for (const r of t.workout_type) addType(r.exerciseTypeId);
  for (const r of t.workout_exercise) note(r.exerciseId, null);
  const exercise = [];
  for (const [id, firstItem] of used) {
    const known = KNOWN.get(id);
    const custom = customs.get(id);
    const exerciseTypeId = known?.group ?? custom?.group ?? firstItem?.group ?? null;
    addType(exerciseTypeId);
    exercise.push(clean({
      id, name: known?.name ?? custom?.name ?? firstItem?.name ?? id, exerciseTypeId, alsoUnder: ALSO_UNDER[id] ?? [],
      custom: custom ? { ...custom } : undefined,
    }));
  }
  return { exercise, exercise_type: types };
}

// ---------- Version 4 back to the version 3 shapes (for checking, and for the screens until they move) ----------
// Returns { store, sets }: the version 3 store (as cleanStore gives it) and the flat list of logged sets.
// One gym (the nested form the screens use) from its gym row and the gym_equipment rows of that gym.
export function gymFromRows(t, g) {
  const gym = clean({
    name: g.name, units: g.units, equipment: {}, weightSets: {},
    starterFree: g.starterFree, starterAbs: g.starterAbs, starterCardio: g.starterCardio, pullUpsMoved: g.pullUpsMoved, listDefault: g.listDefault,
  });
  for (const r of t.gym_equipment) {
    if (r.gymId !== g.id) continue;
    if (r.id.startsWith(SET_PREFIX)) {
      gym.weightSets[r.id.slice(SET_PREFIX.length)] = clean({
        name: r.name, type: r.equipmentTypeId, unit: r.unit, pins: r.pins, stackSpec: r.stackSpec, top: r.top, hidden: r.hidden,
      });
    } else {
      gym.equipment[r.exerciseId] = clean({
        name: r.name, group: r.exerciseTypeId, type: r.equipmentTypeId, unit: r.unit, step: r.step, common: r.common,
        min: r.min, pins: r.pins, stackSpec: r.stackSpec, hidden: r.hidden, muscle: r.muscle, weightSet: r.uses, watts: r.watts,
      });
    }
  }
  return gym;
}

// One person (the nested form the screens use) from the person row, the gyms they are a member of, their setups
// and their typed-in bests.
export function personFromRows(t, p) {
  const person = clean({ name: p.name, defaults: p.defaults, gyms: {}, superset: p.superset });
  for (const m of t.gym_member) if (m.personId === p.id) person.gyms[m.gymId] ??= { machines: {} };
  const machine = (r) => person.gyms[r.gymId]?.machines && (person.gyms[r.gymId].machines[r.exerciseId] ??= {});
  for (const r of t.personal_setup) {
    if (r.personId !== p.id) continue;
    if (r.never) { const pg = person.gyms[r.gymId]; if (pg) (pg.never ??= {})[r.exerciseId] = true; }
    if (r.use) { const pg = person.gyms[r.gymId]; if (pg) (pg.use ??= {})[r.exerciseId] = r.use; }
    if (!r.notes && !r.dayType) continue;   // a row that only carries the never mark has no machine settings
    const m = machine(r);
    if (!m) continue;
    if (r.notes && !m.notes) m.notes = r.notes;
    if (r.dayType) m[r.dayType] = { warmup: r.warmup, working: r.working };
  }
  for (const r of t.logged_set) {
    if (!r.manual || r.personId !== p.id) continue;
    const m = machine(r);
    if (!m) continue;
    if (Number.isFinite(r.weight)) m.pbWeight = r.weight;
    if (Number.isFinite(r.reps)) m.pbReps = r.reps;
  }
  return person;
}

// The exercises you added, in the order you added them, from the exercise rows.
export function customFromRows(t) {
  return t.exercise.filter((e) => e.custom).sort((a, b) => a.custom.customIndex - b.custom.customIndex)
    .map((e) => { const { customIndex, ...def } = e.custom; return def; });
}

export function fromV4(v4) {
  const t = v4.tables;
  const gyms = {};
  for (const g of t.gym) gyms[g.id] = gymFromRows(t, g);
  const people = {};
  for (const p of t.person) people[p.id] = personFromRows(t, p);
  const custom = customFromRows(t);
  const store = {
    version: 3,
    currentGym: v4.currentGym,
    defaultGym: v4.defaultGym,
    currentPerson: v4.currentPerson ?? DEFAULT_PERSON,
    custom,
    gyms,
    people,
  };
  const cardio = new Map(t.workout_exercise.map((w) => [w.id, w]));
  const finite = (v) => (Number.isFinite(v) ? v : undefined);
  const sets = t.logged_set.filter((r) => !r.manual).sort((a, b) => a.seq - b.seq)
    .map((r) => clean({
      exerciseId: r.exerciseId, time: r.time, weight: r.weight, reps: r.reps, repsLeft: r.repsLeft, repsRight: r.repsRight, minutes: r.minutes,
      distance: finite(cardio.get(r.workoutExerciseId)?.distance), watts: finite(cardio.get(r.workoutExerciseId)?.watts),
      start: cardio.get(r.workoutExerciseId)?.start ?? undefined, end: cardio.get(r.workoutExerciseId)?.end ?? undefined, unit: r.unit,
      mode: r.mode, gymId: r.gymId,
    }));
  return { store, sets };
}

// ---------- A dry run on real data (step26a) ----------
// Converts the data to version 4 and back, and compares with what was saved. Nothing is written.
// Returns { ok, problems: [text], bytes3, bytes4 }. Never throws.
// JSON text with the keys in order, so two copies that differ only in key order compare equal.
const canon = (v) => JSON.stringify(v, (_, x) => (isObj(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

// A person's empty per-gym container ({ machines: {} }) means nothing; leave it out so two copies compare equal.
export function withoutEmptyGyms(store) {
  const people = Object.fromEntries(Object.entries(store.people || {}).map(([id, p]) => [id, {
    ...p, gyms: Object.fromEntries(Object.entries(p.gyms || {}).filter(([, g]) => Object.keys(g?.machines || {}).length > 0 || Object.keys(g || {}).some((k) => k !== "machines"))),
  }]));
  return { ...store, people };
}

export function checkV4({ store = null, settings = null, sets = [] } = {}) {
  try {
    const r = migrateToV4({ store, settings, sets });
    if (!r.ok) return { ok: false, problems: [r.error], bytes3: 0, bytes4: 0 };
    const back = fromV4(r.v4);
    const before = {
      store: cleanStore(store ?? migrateLegacy(isObj(settings) ? settings : {})),
      sets: sets.filter(validSet),
    };
    const problems = [];
    if (canon(withoutEmptyGyms(back.store)) !== canon(withoutEmptyGyms(before.store))) problems.push("The setup did not come back the same.");
    if (canon(back.sets) !== canon(before.sets))
      problems.push("The logged sets did not come back the same.");
    return {
      ok: problems.length === 0,
      problems,
      bytes3: JSON.stringify(before).length,
      bytes4: JSON.stringify(r.v4).length,
    };
  } catch (e) {
    return { ok: false, problems: ["The check failed: " + (e?.message ?? e)], bytes3: 0, bytes4: 0 };
  }
}

// ---------- Saving and reading the store as version 4 (step26b, sets added in step27a) ----------
// The screens still work on the version 3 shape in memory; what is SAVED under gymlog.store is version 4.
// Since step27a the logged sets are saved inside it too (workout, workout_type, workout_exercise, logged_set);
// setsInTables marks that, so "no sets yet" is not mistaken for "sets not moved yet".
// toStoreV4(store, sets) -> the version 4 object to save, or null when the conversion fails (then save the store as it is).
export function toStoreV4(store, sets = []) {
  try {
    const r = migrateToV4({ store, sets });
    return r.ok ? { ...r.v4, setsInTables: true } : null;
  } catch { return null; }
}

// readStore(raw) -> the version 3 store the screens use, from saved version 4, 3 or 2 data; null when unreadable.
export function readStore(raw) {
  try {
    if (isObj(raw) && raw.version === SCHEMA_VERSION && isObj(raw.tables)) return cleanStore(fromV4(raw).store);
    return cleanStore(raw);
  } catch { return null; }
}

// readSets(raw) -> the flat list of logged sets from saved version 4 data, or null when the sets are not
// in the tables yet (then they are still in the old flat list).
export function readSets(raw) {
  try {
    if (isObj(raw) && raw.version === SCHEMA_VERSION && isObj(raw.tables) && raw.setsInTables === true) return fromV4(raw).sets;
    return null;
  } catch { return null; }
}
