// The permanent store: gyms (shared machine stacks) and people (personal settings per gym).
// Everything here is pure (no browser calls) so it can be tested.
//
// store = {
//   version, currentGym, currentPerson, custom: [],
//   gyms:   { gymId: { name, machines: { exerciseId: { name, step, pins, stackSpec } } } },
//   people: { personId: { name, defaults: { heavy|volume: { reps, sets, warmupReps } },
//             gyms: { gymId: { machines: { exerciseId: { notes, pbWeight, pbReps,
//               heavy|volume: { warmup: { weight, extra, reps }, working: { weight, extra, reps, sets } } } } } } } }
// }
// weight is always the TOTAL; extra is the part of it that came from the extra list.
//
// The screens still use an older flat shape (startHeavy, workVolume, repsHeavy ...). The tables below
// say how each flat name maps to the store, and every conversion in this file is driven by them.

export const STORE_VERSION = 2;
export const DEFAULT_GYM = "main";
export const DEFAULT_PERSON = "awp";
export const MACHINES_FILE_TYPE = "gymlog-machines";

const SHARED = ["name", "step", "pins", "stackSpec"];
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

export function emptyStore() {
  return {
    version: STORE_VERSION,
    currentGym: DEFAULT_GYM,
    currentPerson: DEFAULT_PERSON,
    custom: [],
    gyms: { [DEFAULT_GYM]: { name: "My gym", machines: {} } },
    people: { [DEFAULT_PERSON]: { name: "Awp", defaults: {}, gyms: { [DEFAULT_GYM]: { machines: {} } } } },
  };
}

// A store read back from storage: tidied up, or null if it is missing or not this version.
export function cleanStore(raw) {
  if (!isObj(raw) || raw.version !== STORE_VERSION) return null;
  return {
    ...emptyStore(),
    ...raw,
    gyms: isObj(raw.gyms) ? raw.gyms : {},
    people: isObj(raw.people) ? raw.people : {},
    custom: Array.isArray(raw.custom) ? raw.custom : [],
    currentGym: typeof raw.currentGym === "string" ? raw.currentGym : DEFAULT_GYM,
    currentPerson: typeof raw.currentPerson === "string" ? raw.currentPerson : DEFAULT_PERSON,
  };
}

// Warm-up sets are for weight-stack machines (lb). Free weights, pull-ups and timed
// exercises have none. An exercise can override this with warmup: true or false.
export function supportsWarmup(exercise) {
  if (exercise.warmup !== undefined) return !!exercise.warmup;
  return exercise.unit === "lb" && exercise.kind !== "time";
}

// ---------- Flat settings <-> store ----------
// The shared (machine) part of one flat machine entry.
function sharedFrom(c) {
  const out = {};
  if (typeof c.name === "string" && c.name.trim()) out.name = c.name.trim();
  if (Number.isFinite(c.step) && c.step > 0) out.step = c.step;
  if (Array.isArray(c.pins) && c.pins.length > 0) out.pins = c.pins.filter(Number.isFinite);
  if (isObj(c.stackSpec)) out.stackSpec = c.stackSpec;
  return out;
}

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

// Builds a first store from the old gymlog.settings data.
export function migrateLegacy(legacy, opts = {}) {
  const { gymId = DEFAULT_GYM, personId = DEFAULT_PERSON, gymName = "My gym", personName = "Awp" } = opts;
  const s = splitFlat(legacy);
  return {
    ...emptyStore(),
    currentGym: gymId,
    currentPerson: personId,
    custom: s.custom,
    gyms: { [gymId]: { name: gymName, machines: s.shared } },
    people: { [personId]: { name: personName, defaults: s.defaults, gyms: { [gymId]: { machines: s.personal } } } },
  };
}

// The flat settings the screens use, for one person at one gym.
export function toLegacySettings(store, personId, gymId) {
  const person = store.people?.[personId] || {};
  const exercises = {};
  const entry = (id) => (exercises[id] ??= {});

  for (const [id, m] of Object.entries(store.gyms?.[gymId]?.machines || {})) {
    const out = entry(id);
    for (const f of SHARED) if (m[f] != null) out[f] = m[f];
  }
  for (const [id, p] of Object.entries(person.gyms?.[gymId]?.machines || {})) {
    const out = entry(id);
    if (p.notes) out.notes = p.notes;
    put(out, "pbWeight", p.pbWeight);
    put(out, "pbReps", p.pbReps);
    for (const [Cap, mode] of MODES) {
      if (!p[mode]) continue;
      for (const [prefix, group, key] of FIELDS) put(out, prefix + Cap, p[mode][group]?.[key]);
    }
  }
  const defaults = {};
  for (const [Cap, mode] of MODES) {
    for (const [prefix, key] of DEFAULTS) put(defaults, prefix + Cap, person.defaults?.[mode]?.[key]);
  }
  return { exercises, custom: store.custom || [], defaults };
}

// Returns a new store with the flat settings saved back into it for one person at one gym.
// Other gyms and other people are left exactly as they were.
export function applyLegacySettings(store, personId, gymId, flat) {
  const s = splitFlat(flat);
  const gym = store.gyms?.[gymId] || { name: "My gym" };
  const person = store.people?.[personId] || { name: personId, gyms: {} };
  return {
    ...store,
    custom: s.custom,
    gyms: { ...store.gyms, [gymId]: { ...gym, machines: s.shared } },
    people: {
      ...store.people,
      [personId]: {
        ...person,
        defaults: s.defaults,
        gyms: { ...person.gyms, [gymId]: { ...person.gyms?.[gymId], machines: s.personal } },
      },
    },
  };
}

// ---------- Sharing the machine list ----------
// Only the shared fields: no weights, reps or notes.
export function exportMachines(store, gymId) {
  const gym = store.gyms?.[gymId] || { name: "", machines: {} };
  return JSON.stringify({ type: MACHINES_FILE_TYPE, version: 1, gymName: gym.name, machines: gym.machines || {} }, null, 2);
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
  const gym = store.gyms?.[gymId] || { name: data.gymName || "My gym", machines: {} };
  const machines = { ...gym.machines, ...incoming };
  return { store: { ...store, gyms: { ...store.gyms, [gymId]: { ...gym, machines } } }, count: Object.keys(incoming).length, error: "" };
}