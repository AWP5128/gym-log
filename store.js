// The permanent store: gyms (each with its own equipment) and people (personal settings per gym).
// Everything here is pure (no browser calls) so it can be tested.
//
// store = {
//   version, currentGym, defaultGym, currentPerson, custom: [],
//   gyms:   { gymId: { name, units: { type: "kg" | "lb" }, equipment: { exerciseId: item } } },
//   people: { personId: { name, defaults: { heavy|volume: { reps, sets, warmupReps } },
//             gyms: { gymId: { machines: { exerciseId: { notes, pbWeight, pbReps,
//               heavy|volume: { warmup: { weight, extra, reps }, working: { weight, extra, reps, sets } } } } } } } }
// }
// An equipment item (see gym.js) is { name, group, type, unit, step, common, min?, pins?, stackSpec? }.
// weight is always the TOTAL; extra is the part of it that came from the extra list.
//
// The settings saved by the first versions of the app were flat (startHeavy, workVolume, repsHeavy ...).
// The tables below say how each flat name maps to the store; they are used to read those old settings
// once (migrateLegacy), to clean what setPersonal saves, and to write and read the machines file. In the
// flat shape a machine's name, step and stack appear only when they differ from the built-in exercise.

import { exercises } from "./exercises.js";
import { addCustomExercise, removeCustomExercise } from "./settings.js";
import {
  newGym, makeItem, starterEquipment, withMachineData, updateItem, copyEquipment, uniqueId, DEFAULT_UNITS,
  ensureWeightSets, seedStarterFree, STARTER_FREE, seedStarterAbs, STARTER_ABS, seedStarterCardio, STARTER_CARDIO, movePullUps,
} from "./gym.js";

export const STORE_VERSION = 3;
export const DEFAULT_GYM = "main";
export const DEFAULT_PERSON = "awp";
export const MACHINES_FILE_TYPE = "gymlog-machines";

const MODES = [["Heavy", "heavy"], ["Volume", "volume"]];
// [flat name before Heavy/Volume, group in a day type's block, field in that group]
const FIELDS = [
  ["start", "warmup", "weight"], ["startExtra", "warmup", "extra"], ["warmReps", "warmup", "reps"],
  ["work", "working", "weight"], ["workExtra", "working", "extra"], ["reps", "working", "reps"], ["sets", "working", "sets"],
];
// [flat name before Heavy/Volume, field in the person's defaults]
const DEFAULTS = [["reps", "reps"], ["sets", "sets"], ["warmReps", "warmupReps"]];

const isObj = (v) => !!v && typeof v === "object";
const has = (o) => Object.keys(o).length > 0;
const num = (v) => (Number.isFinite(v) ? v : null);
const put = (obj, key, v) => { if (Number.isFinite(v)) obj[key] = v; };

// The built-in exercises as equipment items: what a first gym starts with.
const STARTER = starterEquipment(exercises);
// The starter dumbbell and barbell exercises as built in (so they are not listed as changed).
const STARTER_FREE_BASE = Object.fromEntries(STARTER_FREE.map((x) => [x.id, makeItem(x)]));

// The starter abs exercises as built in.
const STARTER_ABS_BASE = Object.fromEntries(STARTER_ABS.map((x) => [x.id, makeItem(x)]));

// The starter cardio machines as built in.
const STARTER_CARDIO_BASE = Object.fromEntries(STARTER_CARDIO.map((x) => [x.id, makeItem(x)]));

// A gym with its dumbbell and barbell sets in place and the starter exercises added.
const freshGym = (gym) => movePullUps(seedStarterCardio(seedStarterAbs(ensureWeightSets(seedStarterFree(ensureWeightSets(gym))))));

export function emptyStore() {
  return {
    version: STORE_VERSION,
    currentGym: DEFAULT_GYM,
    defaultGym: DEFAULT_GYM,
    currentPerson: DEFAULT_PERSON,
    custom: [],
    gyms: { [DEFAULT_GYM]: freshGym(newGym("My gym", {}, starterEquipment(exercises))) },
    people: { [DEFAULT_PERSON]: { name: "Awp", defaults: {}, gyms: { [DEFAULT_GYM]: { machines: {} } } } },
  };
}

// ---------- Equipment <-> shared machine fields ----------
// The shared fields of one flat machine entry (name, step, stack).
function sharedFrom(c) {
  const out = {};
  if (typeof c.name === "string" && c.name.trim()) out.name = c.name.trim();
  if (Number.isFinite(c.step) && c.step > 0) out.step = c.step;
  if (Array.isArray(c.pins) && c.pins.length > 0) out.pins = c.pins.filter(Number.isFinite);
  if (isObj(c.stackSpec)) out.stackSpec = c.stackSpec;
  return out;
}

// What an item has that its built-in version does not: a new name or step, and any stack.
function overrides(item, base = {}) {
  const out = {};
  if (item.name && item.name !== base.name) out.name = item.name;
  if (item.weightSet) return out;   // its weights belong to the gym's weight set
  if (item.step > 0 && item.step !== base.step) out.step = item.step;
  if (Array.isArray(item.pins) && item.pins.length > 0) out.pins = item.pins;
  if (isObj(item.stackSpec)) out.stackSpec = item.stackSpec;
  return out;
}

// What an item is compared with: its built-in exercise, or the exercise you added.
const baseFor = (id, custom = []) => STARTER[id] || STARTER_FREE_BASE[id] || STARTER_ABS_BASE[id] || STARTER_CARDIO_BASE[id] || custom.find((c) => c.id === id) || {};

// An item for an id that is not built in (an exercise you added), from its shared fields.
function newItem(id, shared, custom) {
  const def = custom.find((c) => c.id === id) || {};
  return makeItem({ type: def.unit === "kg" ? "barbell" : "stack", ...def, ...shared });
}

// A gym's equipment from the old shared machine data: the built-in list with that data laid over it.
function buildEquipment(shared, custom) {
  const equipment = withMachineData(STARTER, shared);
  for (const [id, o] of Object.entries(shared)) if (!equipment[id]) equipment[id] = newItem(id, o, custom);
  return equipment;
}

// ---------- Reading a store ----------
function cleanGym(g) {
  if (!isObj(g)) return freshGym(newGym("My gym"));
  return freshGym({
    ...g,
    name: typeof g.name === "string" && g.name.trim() ? g.name : "My gym",
    units: { ...DEFAULT_UNITS, ...(isObj(g.units) ? g.units : {}) },
    equipment: isObj(g.equipment) ? g.equipment : {},
  });
}

// Version 2 kept only the shared machine data in each gym. Version 3 gives each gym its own equipment list.
function upgradeV2(raw) {
  const custom = Array.isArray(raw.custom) ? raw.custom : [];
  const gyms = {};
  for (const [id, g] of Object.entries(isObj(raw.gyms) ? raw.gyms : {})) {
    const machines = isObj(g) && isObj(g.machines) ? g.machines : {};
    gyms[id] = newGym(isObj(g) ? g.name : "", {}, buildEquipment(machines, custom));
  }
  return { ...raw, version: STORE_VERSION, gyms };
}

// A store read back from storage: tidied up (a version 2 store is upgraded), or null if it is
// missing or not a version this file knows.
export function cleanStore(raw) {
  if (!isObj(raw) || (raw.version !== STORE_VERSION && raw.version !== 2)) return null;
  const v3 = raw.version === 2 ? upgradeV2(raw) : raw;
  const gyms = Object.fromEntries(Object.entries(isObj(v3.gyms) ? v3.gyms : {}).map(([id, g]) => [id, cleanGym(g)]));
  // The current and default gym must be gyms that exist (when there are any).
  const ids = Object.keys(gyms);
  const exists = (id) => ids.length === 0 || ids.includes(id);
  const asked = typeof v3.currentGym === "string" ? v3.currentGym : DEFAULT_GYM;
  const currentGym = exists(asked) ? asked : ids[0];
  const defaultGym = typeof v3.defaultGym === "string" && exists(v3.defaultGym) ? v3.defaultGym : currentGym;
  return {
    ...emptyStore(),
    ...v3,
    gyms,
    people: isObj(v3.people) ? v3.people : {},
    custom: Array.isArray(v3.custom) ? v3.custom : [],
    currentGym,
    defaultGym,
    currentPerson: typeof v3.currentPerson === "string" ? v3.currentPerson : DEFAULT_PERSON,
  };
}

// ---------- Gyms ----------
// The gyms as a list for the screens: [{ id, name }].
export const gymList = (store) => Object.entries(store.gyms || {}).map(([id, g]) => ({ id, name: g.name }));

// Adds a gym. It starts with no equipment, or with the chosen items (ids) copied from another gym (from):
// equipment data only, with stacks and units kept and nothing personal. Does not change the current gym.
// Returns { store, id, copied }; id is null when the name is blank.
export function addGym(store, name, { from, ids = [] } = {}) {
  const clean = String(name ?? "").trim();
  if (!clean) return { store, id: null, copied: 0 };
  const id = uniqueId(clean, Object.keys(store.gyms || {}), "gym");
  let gym = { ...newGym(clean), starterFree: true, starterAbs: true, starterCardio: true, pullUpsMoved: true };   // a new gym never gets the starter exercises
  let copied = 0;
  if (from && store.gyms?.[from]) ({ gym, copied } = copyEquipment(store.gyms[from], ids, gym));
  return { store: { ...store, gyms: { ...store.gyms, [id]: gym } }, id, copied };
}

// A blank name or an unknown gym leaves the store as it was.
export function renameGym(store, id, name) {
  const clean = String(name ?? "").trim();
  const gym = store.gyms?.[id];
  if (!gym || !clean) return store;
  return { ...store, gyms: { ...store.gyms, [id]: { ...gym, name: clean } } };
}

export const setDefaultGym = (store, id) => (store.gyms?.[id] ? { ...store, defaultGym: id } : store);
export const setCurrentGym = (store, id) => (store.gyms?.[id] ? { ...store, currentGym: id } : store);

// The gym to start in: the default gym becomes the current one.
export const useDefaultGym = (store) => setCurrentGym(store, store.defaultGym);

// Warm-up sets are for weight-stack machines (lb). Free weights, pull-ups and timed
// exercises have none. An exercise can override this with warmup: true or false.
export function supportsWarmup(exercise) {
  if (exercise.warmup !== undefined) return !!exercise.warmup;
  return exercise.unit === "lb" && exercise.kind !== "time";
}

// ---------- Old flat settings -> store ----------
// The personal part of one flat machine entry.
function personalFrom(c) {
  const out = {};
  if (typeof c.notes === "string" && c.notes !== "") out.notes = c.notes;
  put(out, "pbWeight", c.pbWeight);
  put(out, "pbReps", c.pbReps);
  for (const [Cap, mode] of MODES) {
    const block = { warmup: {}, working: {} };
    let any = false;
    for (const [prefix, group, key] of FIELDS) {
      const v = num(c[prefix + Cap]);
      block[group][key] = v;
      any ||= v !== null;
    }
    if (any) out[mode] = block;
  }
  return out;
}

// Splits flat settings into the shared machines, the personal settings and the person's defaults.
function splitFlat(flat) {
  const f = isObj(flat) ? flat : {};
  const shared = {};
  const personal = {};
  for (const [id, c] of Object.entries(f.exercises || {})) {
    if (!isObj(c)) continue;
    const s = sharedFrom(c);
    const p = personalFrom(c);
    if (has(s)) shared[id] = s;
    if (has(p)) personal[id] = p;
  }
  const d = f.defaults || {};
  const defaults = {};
  for (const [Cap, mode] of MODES) {
    const o = {};
    for (const [prefix, key] of DEFAULTS) o[key] = num(d[prefix + Cap]);
    if (Object.values(o).some((v) => v !== null)) defaults[mode] = o;
  }
  return { shared, personal, defaults, custom: Array.isArray(f.custom) ? f.custom : [] };
}

// Builds a first store from the old gymlog.settings data. The first gym gets the built-in
// exercises with that data laid over them.
export function migrateLegacy(legacy, opts = {}) {
  const { gymId = DEFAULT_GYM, personId = DEFAULT_PERSON, gymName = "My gym", personName = "Awp" } = opts;
  const s = splitFlat(legacy);
  return {
    ...emptyStore(),
    currentGym: gymId,
    defaultGym: gymId,
    currentPerson: personId,
    custom: s.custom,
    gyms: { [gymId]: freshGym(newGym(gymName, {}, buildEquipment(s.shared, s.custom))) },
    people: { [personId]: { name: personName, defaults: s.defaults, gyms: { [gymId]: { machines: s.personal } } } },
  };
}

// ---------- Personal settings, read and written directly ----------
// What the screens use: a person's settings read from and written to the store, with no flat shape in between.
// A day type is "heavy" or "volume". A person's settings for one exercise at one gym:
//   { notes, pbWeight, pbReps, heavy|volume: { warmup: { weight, extra, reps }, working: { weight, extra, reps, sets } } }
// Reading gives every field (null when not set, "" for no notes). A patch to setPersonal gives only the fields to change;
// a field given as null is cleared, a field left out stays. weight is always the TOTAL, extra the part that came from the extra list.
const hasOwn = (o, k) => isObj(o) && Object.prototype.hasOwnProperty.call(o, k);

export function personalOf(store, personId, gymId, id) {
  const p = store.people?.[personId]?.gyms?.[gymId]?.machines?.[id] || {};
  const out = { notes: typeof p.notes === "string" ? p.notes : "", pbWeight: num(p.pbWeight), pbReps: num(p.pbReps) };
  for (const [, mode] of MODES) {
    const block = { warmup: {}, working: {} };
    for (const [, group, key] of FIELDS) block[group][key] = num(p[mode]?.[group]?.[key]);
    out[mode] = block;
  }
  return out;
}

// Returns a new store with the patch applied to this person's settings for the exercise. Everything else is left as it was
// (other exercises, other gyms and people, never, use, the superset marks). An exercise left with nothing set loses its entry.
export function setPersonal(store, personId, gymId, id, patch) {
  const now = personalOf(store, personId, gymId, id);
  const flat = { notes: hasOwn(patch, "notes") ? patch.notes : now.notes, pbWeight: hasOwn(patch, "pbWeight") ? patch.pbWeight : now.pbWeight, pbReps: hasOwn(patch, "pbReps") ? patch.pbReps : now.pbReps };
  for (const [Cap, mode] of MODES) {
    for (const [prefix, group, key] of FIELDS) {
      const given = hasOwn(patch?.[mode]?.[group], key);
      flat[prefix + Cap] = given ? patch[mode][group][key] : now[mode][group][key];
    }
  }
  const entry = personalFrom(flat);   // the same cleaning as the flat path
  const person = store.people?.[personId] || { name: personId, gyms: {}, defaults: {} };
  const here = person.gyms?.[gymId] || {};
  const machines = { ...(here.machines || {}) };
  if (has(entry)) machines[id] = entry; else delete machines[id];
  return { ...store, people: { ...store.people, [personId]: { ...person, gyms: { ...person.gyms, [gymId]: { ...here, machines } } } } };
}

// The person's every-machine defaults: { heavy|volume: { reps, sets, warmupReps } }, every field present (null when not set).
export function defaultsOf(store, personId) {
  const d = store.people?.[personId]?.defaults || {};
  const out = {};
  for (const [, mode] of MODES) {
    out[mode] = {};
    for (const [, key] of DEFAULTS) out[mode][key] = num(d[mode]?.[key]);
  }
  return out;
}

// Returns a new store with the defaults patched (given fields change, null clears, left out stays). A day type with nothing set is left out.
export function setDefaults(store, personId, patch) {
  const now = defaultsOf(store, personId);
  const defaults = {};
  for (const [, mode] of MODES) {
    const o = {};
    for (const [, key] of DEFAULTS) o[key] = hasOwn(patch?.[mode], key) ? num(patch[mode][key]) : now[mode][key];
    if (Object.values(o).some((v) => v !== null)) defaults[mode] = o;
  }
  const person = store.people?.[personId] || { name: personId, gyms: {} };
  return { ...store, people: { ...store.people, [personId]: { ...person, defaults } } };
}

// The exercises you added (the same list the flat settings call custom).
export const customOf = (store) => store.custom || [];
export const addCustom = (store, def) => ({ ...store, custom: addCustomExercise({ custom: store.custom || [] }, def).custom });
export const removeCustom = (store, id) => ({ ...store, custom: removeCustomExercise({ custom: store.custom || [] }, id).custom });

// ---------- Never used (personal, per gym) ----------
// A person can mark an exercise "never used" at a gym: it is hidden from their lists there (the gym keeps it).
// Saved as people[person].gyms[gym].never = { exerciseId: true }.
export const neverIds = (store, personId, gymId) => store.people?.[personId]?.gyms?.[gymId]?.never || {};
export const isNever = (store, personId, gymId, exerciseId) => neverIds(store, personId, gymId)[exerciseId] === true;

// Returns a new store with the exercises in ids marked never used (on = true) or back to normal (on = false).
export function setNever(store, personId, gymId, ids, on) {
  const person = store.people?.[personId] || { name: personId, gyms: {} };
  const { never: old, ...rest } = person.gyms?.[gymId] || {};
  const never = { ...(old || {}) };
  for (const id of ids) { if (on) never[id] = true; else delete never[id]; }
  return {
    ...store,
    people: { ...store.people, [personId]: { ...person, gyms: { ...person.gyms, [gymId]: { ...rest, machines: rest.machines || {}, ...(Object.keys(never).length > 0 ? { never } : {}) } } } },
  };
}

// Normal / Rare / Never (personal, per gym). Normal = the main list, Rare = under "Show less common", Never = hidden.
// An exercise starts as Normal, or Rare if the built-in data marks it less common (common: false); only a choice that
// differs from that is saved, in people[person].gyms[gym].use = { exerciseId: "normal" | "rare" } (Never is in `never`).
export const useIds = (store, personId, gymId) => store.people?.[personId]?.gyms?.[gymId]?.use || {};
export const defaultUse = (exercise) => (exercise?.common === false ? "rare" : "normal");
export const useOf = (store, personId, gymId, exercise) =>
  isNever(store, personId, gymId, exercise.id) ? "never" : useIds(store, personId, gymId)[exercise.id] || defaultUse(exercise);

// Returns a new store with the exercise set to "normal", "rare" or "never" for this person at this gym.
export function setUse(store, personId, gymId, exercise, state) {
  const person = store.people?.[personId] || { name: personId, gyms: {} };
  const { never: oldNever, use: oldUse, ...rest } = person.gyms?.[gymId] || {};
  const never = { ...(oldNever || {}) };
  const use = { ...(oldUse || {}) };
  delete never[exercise.id];
  delete use[exercise.id];
  if (state === "never") never[exercise.id] = true;
  else if (state !== defaultUse(exercise) && (state === "normal" || state === "rare")) use[exercise.id] = state;
  return {
    ...store,
    people: { ...store.people, [personId]: { ...person, gyms: { ...person.gyms, [gymId]: {
      ...rest, machines: rest.machines || {}, ...(Object.keys(never).length > 0 ? { never } : {}), ...(Object.keys(use).length > 0 ? { use } : {}),
    } } } },
  };
}

// ---------- Sharing the machine list ----------
// Only the shared fields (name, step, stack): no weights, reps or notes. Machines that are
// exactly as built in are left out.
export function exportMachines(store, gymId) {
  const gym = store.gyms?.[gymId] || { name: "", equipment: {} };
  const machines = {};
  for (const [id, item] of Object.entries(gym.equipment || {})) {
    const o = overrides(item, baseFor(id, store.custom));
    if (has(o)) machines[id] = o;
  }
  return JSON.stringify({ type: MACHINES_FILE_TYPE, version: 1, gymName: gym.name, machines }, null, 2);
}

// Adds the machines from an exported file to a gym. Personal settings are not touched.
// Returns { store, count, error }; error is "" when it worked.
export function importMachines(store, gymId, text) {
  let data;
  try { data = JSON.parse(text); }
  catch { return { store, count: 0, error: "That is not a valid file." }; }
  if (data?.type !== MACHINES_FILE_TYPE || !isObj(data.machines)) {
    return { store, count: 0, error: "That is not a Gym Log machines file." };
  }
  const incoming = {};
  for (const [id, c] of Object.entries(data.machines)) {
    const s = sharedFrom(c || {});
    if (has(s)) incoming[id] = s;
  }
  let gym = store.gyms?.[gymId] || newGym(data.gymName || "My gym", {}, starterEquipment(exercises));
  for (const [id, o] of Object.entries(incoming)) {
    gym = gym.equipment?.[id]
      ? updateItem(gym, id, o)
      : { ...gym, equipment: { ...gym.equipment, [id]: newItem(id, o, store.custom || []) } };
  }
  return { store: { ...store, gyms: { ...store.gyms, [gymId]: gym } }, count: Object.keys(incoming).length, error: "" };
}