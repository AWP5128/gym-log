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
//     gym             { id, name, units, listDefault?, starterFree?, starterAbs?, pullUpsMoved? }
//     gym_member      { personId, gymId, role, status, offTypes }   offTypes: equipment types switched off
//     gym_equipment   { gymId, id, exerciseId | null, equipmentTypeId, exerciseTypeId?, name, unit, step?,
//                       common?, min?, pins?, stackSpec?, hidden?, muscle?, uses?, top? }
//                     one row per gym and exercise; the gym's Dumbbells and Barbell are rows too (id "set:dumbbells",
//                     exerciseId null) and an exercise points to its set with `uses` (the set's id, without "set:")
//   What
//     equipment_type  { id, label }
//     exercise_type   { id, label, dayTypes }                  dayTypes: ["heavy", "volume"] or []
//     exercise        { id, name, exerciseTypeId, alsoUnder, custom? }   one movement, shared by every gym
//   Personal
//     personal_setup  { personId, gymId, exerciseId, dayType, warmup, working, notes? }
//                     a row per person, machine and day type; notes are written on each day-type row;
//                     a machine with notes only has one row with dayType null
//   Training log
//     workout         { id, personId, gymId, date, start, end }        one per gym per day
//     workout_type    { id, workoutId, exerciseTypeId, dayType, start, end }
//     workout_exercise{ id, workoutTypeId, exerciseId, distance, avgHeartRate, zoneMinutes, watts, level }
//                     the cardio fields are blank (null) until there is data
//     logged_set      { id, seq, workoutExerciseId, exerciseId, gymId, time, weight, reps, minutes, unit, mode }
//                     seq is the place in the old flat list. A typed-in best from before the app is a manual
//                     logged_set: { id, personId, gymId, exerciseId, manual: true, weight, reps, time: null }.
//
// Not carried over (they are about today, not history): the running workout timer, the done-today list and
// the chosen session. Total weight, bests and times per machine are calculated, never stored.

import { cleanStore, migrateLegacy, DEFAULT_GYM, DEFAULT_PERSON } from "./store.js";
import { exercises as BUILT_IN, sessionTypes } from "./exercises.js";
import { TYPES, STARTER_FREE, STARTER_ABS } from "./gym.js";

export const SCHEMA_VERSION = 4;
export const TABLES = [
  "person", "gym", "gym_member", "gym_equipment", "equipment_type", "exercise_type", "exercise",
  "personal_setup", "workout", "workout_type", "workout_exercise", "logged_set",
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
for (const e of [...BUILT_IN, ...STARTER_FREE, ...STARTER_ABS]) KNOWN.set(e.id, { name: e.name, group: e.group });

// ---------- Version 3 (+ sets) to version 4 ----------
// input: { store, settings, sets }. store is the saved gymlog.store (or null); settings is the old
// gymlog.settings, used only when there is no store. Returns { ok, v4, report, error }.
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
  const addType = (id) => {
    if (typeof id !== "string" || typeIds.has(id)) return;
    typeIds.add(id);
    t.exercise_type.push({ id, label: id, dayTypes: [] });
  };

  // person and gym
  const people = Object.entries(v3.people);
  for (const [id, p] of people) {
    t.person.push(clean({ id, name: p.name, defaults: p.defaults ?? {}, superset: p.superset }));
  }
  const gymEntries = Object.entries(v3.gyms);
  for (const [id, g] of gymEntries) {
    t.gym.push(clean({
      id, name: g.name, units: g.units, listDefault: g.listDefault, starterFree: g.starterFree, starterAbs: g.starterAbs,
      pullUpsMoved: g.pullUpsMoved,
    }));
  }

  // gym_member: everyone on this phone owns the gyms they have data for
  const orphanSetups = [];
  for (const [personId, p] of people) {
    for (const gymId of Object.keys(isObj(p.gyms) ? p.gyms : {})) {
      if (!v3.gyms[gymId]) { orphanSetups.push(personId + "/" + gymId); continue; }
      t.gym_member.push({ personId, gymId, role: "owner", status: "active", offTypes: [] });
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
      t.gym_equipment.push(clean({
        gymId, id, exerciseId: id, equipmentTypeId: it.type, exerciseTypeId: it.group, name: it.name,
        unit: it.unit, step: it.step, common: it.common, min: it.min, pins: it.pins, stackSpec: it.stackSpec,
        hidden: it.hidden, muscle: it.muscle, uses: it.weightSet,
      }));
    }
    for (const [id, ws] of Object.entries(g.weightSets || {})) {
      t.gym_equipment.push(clean({
        gymId, id: SET_PREFIX + id, exerciseId: null, equipmentTypeId: ws.type, name: ws.name, unit: ws.unit,
        pins: ws.pins, stackSpec: ws.stackSpec, top: ws.top, hidden: ws.hidden,
      }));
    }
  }
  const customs = new Map(v3.custom.filter((c) => isObj(c) && typeof c.id === "string").map((c, i) => [c.id, { def: c, i }]));
  for (const id of customs.keys()) note(id, null);

  // personal_setup (and manual bests as logged sets)
  let setupCount = 0;
  for (const [personId, p] of people) {
    for (const [gymId, pg] of Object.entries(isObj(p.gyms) ? p.gyms : {})) {
      if (!v3.gyms[gymId]) continue;
      for (const [exerciseId, m] of Object.entries(isObj(pg?.machines) ? pg.machines : {})) {
        note(exerciseId, null);
        const dayRows = DAY_TYPES.filter((d) => isObj(m[d]));
        for (const dayType of dayRows) {
          setupCount++;
          t.personal_setup.push(clean({
            personId, gymId, exerciseId, dayType, warmup: m[dayType].warmup, working: m[dayType].working,
            notes: m.notes || undefined,
          }));
        }
        if (dayRows.length === 0 && m.notes) {
          setupCount++;
          t.personal_setup.push({ personId, gymId, exerciseId, dayType: null, notes: m.notes });
        }
        if (Number.isFinite(m.pbWeight) || Number.isFinite(m.pbReps)) {
          t.logged_set.push(clean({
            id: "manual:" + personId + ":" + gymId + ":" + exerciseId, personId, gymId, exerciseId, manual: true,
            weight: Number.isFinite(m.pbWeight) ? m.pbWeight : undefined,
            reps: Number.isFinite(m.pbReps) ? m.pbReps : undefined, time: null, workoutExerciseId: null,
          }));
        }
      }
    }
  }

  // the logged sets: one workout per gym per day
  const good = [];
  sets.forEach((s, seq) => { if (validSet(s)) good.push({ s, seq }); });
  const dropped = sets.length - good.length;
  const groupOf = (gymId, exerciseId) => v3.gyms[gymId]?.equipment?.[exerciseId]?.group
    ?? KNOWN.get(exerciseId)?.group ?? customs.get(exerciseId)?.def.group ?? "unknown";
  const workouts = new Map();
  const wtypes = new Map();
  const wexes = new Map();
  const loggedSets = [];
  for (const { s, seq } of good) {
    const gymId = s.gymId ?? DEFAULT_GYM;
    note(s.exerciseId, null);
    const date = ymd(s.time);
    const wid = gymId + ":" + date;
    let w = workouts.get(wid);
    if (!w) {
      w = { id: wid, personId: v3.currentPerson, gymId, date, start: s.time, end: s.time };
      workouts.set(wid, w);
    }
    if (s.time < w.start) w.start = s.time;
    if (s.time > w.end) w.end = s.time;
    const typeId = groupOf(gymId, s.exerciseId);
    addType(typeId);
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
        distance: null, avgHeartRate: null, zoneMinutes: null, watts: null, level: null,
      });
    }
    loggedSets.push(clean({
      id: "set-" + seq, seq, workoutExerciseId: weid, exerciseId: s.exerciseId, gymId, time: s.time,
      weight: s.weight, reps: s.reps, minutes: s.minutes, unit: s.unit, mode: s.mode,
    }));
  }
  t.workout.push(...workouts.values());
  t.workout_type.push(...wtypes.values());
  t.workout_exercise.push(...wexes.values());
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

// ---------- Version 4 back to the version 3 shapes (for checking, and for the screens until they move) ----------
// Returns { store, sets }: the version 3 store (as cleanStore gives it) and the flat list of logged sets.
export function fromV4(v4) {
  const t = v4.tables;
  const gyms = {};
  for (const g of t.gym) {
    gyms[g.id] = clean({
      name: g.name, units: g.units, equipment: {}, weightSets: {},
      starterFree: g.starterFree, starterAbs: g.starterAbs, pullUpsMoved: g.pullUpsMoved, listDefault: g.listDefault,
    });
  }
  for (const r of t.gym_equipment) {
    const gym = gyms[r.gymId];
    if (!gym) continue;
    if (r.id.startsWith(SET_PREFIX)) {
      gym.weightSets[r.id.slice(SET_PREFIX.length)] = clean({
        name: r.name, type: r.equipmentTypeId, unit: r.unit, pins: r.pins, stackSpec: r.stackSpec, top: r.top, hidden: r.hidden,
      });
    } else {
      gym.equipment[r.exerciseId] = clean({
        name: r.name, group: r.exerciseTypeId, type: r.equipmentTypeId, unit: r.unit, step: r.step, common: r.common,
        min: r.min, pins: r.pins, stackSpec: r.stackSpec, hidden: r.hidden, muscle: r.muscle, weightSet: r.uses,
      });
    }
  }
  const people = {};
  for (const p of t.person) people[p.id] = clean({ name: p.name, defaults: p.defaults, gyms: {}, superset: p.superset });
  for (const m of t.gym_member) if (people[m.personId]) people[m.personId].gyms[m.gymId] = { machines: {} };
  const machine = (r) => people[r.personId]?.gyms[r.gymId]?.machines && (people[r.personId].gyms[r.gymId].machines[r.exerciseId] ??= {});
  for (const r of t.personal_setup) {
    const m = machine(r);
    if (!m) continue;
    if (r.notes && !m.notes) m.notes = r.notes;
    if (r.dayType) m[r.dayType] = { warmup: r.warmup, working: r.working };
  }
  for (const r of t.logged_set) {
    if (!r.manual) continue;
    const m = machine(r);
    if (!m) continue;
    if (Number.isFinite(r.weight)) m.pbWeight = r.weight;
    if (Number.isFinite(r.reps)) m.pbReps = r.reps;
  }
  const custom = t.exercise.filter((e) => e.custom).sort((a, b) => a.custom.customIndex - b.custom.customIndex)
    .map((e) => { const { customIndex, ...def } = e.custom; return def; });
  const store = {
    version: 3,
    currentGym: v4.currentGym,
    defaultGym: v4.defaultGym,
    currentPerson: v4.currentPerson ?? DEFAULT_PERSON,
    custom,
    gyms,
    people,
  };
  const sets = t.logged_set.filter((r) => !r.manual).sort((a, b) => a.seq - b.seq)
    .map((r) => clean({
      exerciseId: r.exerciseId, time: r.time, weight: r.weight, reps: r.reps, minutes: r.minutes, unit: r.unit,
      mode: r.mode, gymId: r.gymId,
    }));
  return { store, sets };
}
