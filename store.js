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

export const STORE_VERSION = 2;
export const DEFAULT_GYM = "main";
export const DEFAULT_PERSON = "awp";
export const DEFAULT_WARMUP_REPS = 10;
export const MACHINES_FILE_TYPE = "gymlog-machines";

const SHARED_FIELDS = ["name", "step", "pins", "stackSpec"];
const MODES = [["Heavy", "heavy"], ["Volume", "volume"]];
const n = (v) => (Number.isFinite(v) ? v : null);
const put = (obj, key, v) => { if (Number.isFinite(v)) obj[key] = v; };

export function emptyStore() {
  return {
    version: STORE_VERSION,
    currentGym: DEFAULT_GYM,
    currentPerson: DEFAULT_PERSON,
    custom: [],
    gyms: { [DEFAULT_GYM]: { name: "My gym", machines: {} } },
    people: {
      [DEFAULT_PERSON]: { name: "Awp", defaults: {}, gyms: { [DEFAULT_GYM]: { machines: {} } } },
    },
  };
}

// A store read back from storage: tidied up, or null if it is missing or not this version.
export function cleanStore(raw) {
  if (!raw || typeof raw !== "object" || raw.version !== STORE_VERSION) return null;
  const base = emptyStore();
  return {
    ...base,
    ...raw,
    gyms: raw.gyms && typeof raw.gyms === "object" ? raw.gyms : {},
    people: raw.people && typeof raw.people === "object" ? raw.people : {},
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

// ---------- Shared (machine) part ----------
function sharedFrom(c) {
  const out = {};
  if (typeof c.name === "string" && c.name.trim()) out.name = c.name.trim();
  if (Number.isFinite(c.step) && c.step > 0) out.step = c.step;
  if (Array.isArray(c.pins) && c.pins.length > 0) out.pins = c.pins.filter(Number.isFinite);
  if (c.stackSpec && typeof c.stackSpec === "object") out.stackSpec = c.stackSpec;
  return out;
}

// ---------- Personal part ----------
function personalFrom(c) {
  const out = {};
  if (typeof c.notes === "string" && c.notes !== "") out.notes = c.notes;
  if (Number.isFinite(c.pbWeight)) out.pbWeight = c.pbWeight;
  if (Number.isFinite(c.pbReps)) out.pbReps = c.pbReps;
  for (const [Cap, mode] of MODES) {
    const warmup = { weight: n(c["start" + Cap]), extra: n(c["startExtra" + Cap]), reps: n(c["warmReps" + Cap]) };
    const working = {
      weight: n(c["work" + Cap]), extra: n(c["workExtra" + Cap]),
      reps: n(c["reps" + Cap]), sets: n(c["sets" + Cap]),
    };
    const any = [...Object.values(warmup), ...Object.values(working)].some((v) => v !== null);
    if (any) out[mode] = { warmup, working };
  }
  return out;
}

// Splits the settings shape the app uses today into its shared and personal parts.
function splitLegacy(legacy) {
  const l = legacy && typeof legacy === "object" ? legacy : {};
  const shared = {};
  const personal = {};
  for (const [id, c] of Object.entries(l.exercises || {})) {
    if (!c || typeof c !== "object") continue;
    const s = sharedFrom(c);
    const p = personalFrom(c);
    if (Object.keys(s).length) shared[id] = s;
    if (Object.keys(p).length) personal[id] = p;
  }
  const d = l.defaults || {};
  const defaults = {};
  for (const [Cap, mode] of MODES) {
    const o = { reps: n(d["reps" + Cap]), sets: n(d["sets" + Cap]), warmupReps: n(d["warmReps" + Cap]) };
    if (Object.values(o).some((v) => v !== null)) defaults[mode] = o;
  }
  return { shared, personal, defaults, custom: Array.isArray(l.custom) ? l.custom : [] };
}

// Builds a first store from the old gymlog.settings data.
export function migrateLegacy(legacy, opts = {}) {
  const { gymId = DEFAULT_GYM, personId = DEFAULT_PERSON, gymName = "My gym", personName = "Awp" } = opts;
  const s = splitLegacy(legacy);
  return {
    ...emptyStore(),
    currentGym: gymId,
    currentPerson: personId,
    custom: s.custom,
    gyms: { [gymId]: { name: gymName, machines: s.shared } },
    people: { [personId]: { name: personName, defaults: s.defaults, gyms: { [gymId]: { machines: s.personal } } } },
  };
}

// The settings shape the app uses today, for one person at one gym.
export function toLegacySettings(store, personId, gymId) {
  const gym = (store.gyms || {})[gymId] || {};
  const person = (store.people || {})[personId] || {};
  const mine = ((person.gyms || {})[gymId] || {}).machines || {};
  const exercises = {};
  const entry = (id) => (exercises[id] = exercises[id] || {});

  for (const [id, m] of Object.entries(gym.machines || {})) {
    const out = entry(id);
    for (const f of SHARED_FIELDS) if (m[f] !== undefined && m[f] !== null) out[f] = m[f];
  }
  for (const [id, p] of Object.entries(mine)) {
    const out = entry(id);
    if (p.notes) out.notes = p.notes;
    put(out, "pbWeight", p.pbWeight);
    put(out, "pbReps", p.pbReps);
    for (const [Cap, mode] of MODES) {
      const b = p[mode];
      if (!b) continue;
      const w = b.warmup || {};
      const k = b.working || {};
      put(out, "start" + Cap, w.weight);
      put(out, "startExtra" + Cap, w.extra);
      put(out, "warmReps" + Cap, w.reps);
      put(out, "work" + Cap, k.weight);
      put(out, "workExtra" + Cap, k.extra);
      put(out, "reps" + Cap, k.reps);
      put(out, "sets" + Cap, k.sets);
    }
  }
  const defaults = {};
  const d = person.defaults || {};
  for (const [Cap, mode] of MODES) {
    const o = d[mode] || {};
    put(defaults, "reps" + Cap, o.reps);
    put(defaults, "sets" + Cap, o.sets);
    put(defaults, "warmReps" + Cap, o.warmupReps);
  }
  return { exercises, custom: store.custom || [], defaults };
}

// Returns a new store with the app's settings saved back into it for one person at one gym.
// Other gyms and other people are left exactly as they were.
export function applyLegacySettings(store, personId, gymId, legacy) {
  const s = splitLegacy(legacy);
  const gym = (store.gyms || {})[gymId] || { name: "My gym" };
  const person = (store.people || {})[personId] || { name: personId, gyms: {} };
  const personGym = (person.gyms || {})[gymId] || {};
  return {
    ...store,
    custom: s.custom,
    gyms: { ...store.gyms, [gymId]: { ...gym, machines: s.shared } },
    people: {
      ...store.people,
      [personId]: {
        ...person,
        defaults: s.defaults,
        gyms: { ...(person.gyms || {}), [gymId]: { ...personGym, machines: s.personal } },
      },
    },
  };
}

// ---------- Sharing the machine list ----------
// Only the shared fields: no weights, reps or notes.
export function exportMachines(store, gymId) {
  const gym = (store.gyms || {})[gymId] || { name: "", machines: {} };
  return JSON.stringify(
    { type: MACHINES_FILE_TYPE, version: 1, gymName: gym.name, machines: gym.machines || {} },
    null,
    2
  );
}

// Adds the machines from an exported file to a gym. Personal settings are not touched.
// Returns { store, count, error }; error is "" when it worked.
export function importMachines(store, gymId, text) {
  let data;
  try { data = JSON.parse(text); }
  catch { return { store, count: 0, error: "That is not a valid file." }; }
  if (!data || data.type !== MACHINES_FILE_TYPE || !data.machines || typeof data.machines !== "object") {
    return { store, count: 0, error: "That is not a Gym Log machines file." };
  }
  const incoming = {};
  let count = 0;
  for (const [id, c] of Object.entries(data.machines)) {
    const s = sharedFrom(c || {});
    if (Object.keys(s).length) { incoming[id] = s; count++; }
  }
  const gym = (store.gyms || {})[gymId] || { name: data.gymName || "My gym", machines: {} };
  const next = {
    ...store,
    gyms: { ...store.gyms, [gymId]: { ...gym, machines: { ...(gym.machines || {}), ...incoming } } },
  };
  return { store: next, count, error: "" };
}