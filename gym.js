// Gyms and their equipment: the model, the unit rules, copying between gyms and kg/lb conversion.
// Everything here is pure (no browser calls) so it can be tested, and it imports nothing from the app.
//
// gym  = { name, units: { type: "kg" | "lb" }, equipment: { exerciseId: item } }
// item = { name, group, type, unit, step, common, min?, pins?, stackSpec?, hidden?, muscle? }
//
// - Dumbbells and barbells are shared: a gym has weight sets (gym.weightSets, normally "dumbbells" and
//   "barbell") that hold the unit and the list of weights the gym has. Any number of exercises can use a set
//   (item.weightSet is the set's id), and each picks its working weight from the set's list.
//   weightSet = { name, type: "dumbbell" | "barbell", unit, pins, stackSpec?, top? }
//   Dumbbell weights are per dumbbell (the weight in each hand). Barbell weights go up in steps of 10 (kg or
//   lb), with extras of 2.5, 5 and 7.5 on top; the bar's own weight is not recorded.
// - hidden: true means the item was removed from the gym's list but is kept, so it can be brought back.
//   Logged sets are never touched by hiding. Hidden items are left out of the exercise list.
// - The unit belongs to the equipment type within a gym (stack machines can be lb while dumbbells are kg).
//   gym.units only sets the unit of NEW items; each item keeps its own unit and can override it.
// - The exercise id is the same in every gym, so personal bests can be matched across gyms.
// - pins is the list of main weights (a stack list, a dumbbell list, or the barbell steps).
// - Extras (the small weights added on top) come from the type and unit, not from the item.

export const UNITS = ["kg", "lb"];
export const TYPES = [
  { id: "stack", label: "Stack machine" },
  { id: "dumbbell", label: "Dumbbells" },
  { id: "barbell", label: "Barbell" },
  { id: "plate", label: "Plate-loaded machine" },
  { id: "bodyweight", label: "Body weight" },
];
const TYPE_IDS = TYPES.map((t) => t.id);
export const DEFAULT_UNITS = { stack: "lb", dumbbell: "kg", barbell: "kg", plate: "kg", bodyweight: "kg" };

export const round2 = (n) => Math.round(n * 100) / 100;
const ladder = (step, count) => Array.from({ length: count }, (_, i) => round2(step * (i + 1)));
const barLike = (type) => type === "barbell" || type === "plate";

// Extras: stack machines 2.5 to 20 lb or 1.25 to 10 kg; barbells and plate-loaded machines count in main
// steps of 10 (kg or lb), so they offer extras of 2.5, 5 and 7.5.
const STACK_EXTRAS = { lb: ladder(2.5, 8), kg: ladder(1.25, 8) };
const BAR_EXTRAS = { lb: [2.5, 5, 7.5], kg: [2.5, 5, 7.5] };
// The steps offered when building a stack list (change these if a machine needs another).
const STEPS = { lb: [5, 10, 15, 20], kg: [2.5, 5, 7.5, 10] };
// The step used until a stack list is built.
const START_STEP = {
  stack: { lb: 10, kg: 5 }, dumbbell: { lb: 5, kg: 2 },
  barbell: { lb: 10, kg: 10 }, plate: { lb: 10, kg: 10 }, bodyweight: { lb: 5, kg: 2.5 },
};

export function extraList(type, unit) {
  if (type === "stack") return STACK_EXTRAS[unit] || [];
  if (barLike(type)) return BAR_EXTRAS[unit] || [];
  return [];
}
// The main step of a barbell or plate-loaded machine (10 kg or 10 lb), or null for other types.
export const mainStep = (type, unit) => (barLike(type) ? START_STEP[type][unit] ?? null : null);
export const stepChoices = (unit) => STEPS[unit] || [];
export const defaultStep = (type, unit) => START_STEP[type]?.[unit] ?? 1;

// ---------- Items ----------
// A tidy item from loose data (unknown fields are dropped, missing ones filled in).
export function makeItem(spec) {
  const type = TYPE_IDS.includes(spec.type) ? spec.type : "stack";
  const unit = UNITS.includes(spec.unit) ? spec.unit : DEFAULT_UNITS[type];
  const item = {
    name: String(spec.name ?? "").trim(),
    group: spec.group,
    type,
    unit,
    step: spec.step > 0 ? spec.step : defaultStep(type, unit),
    common: spec.common !== false,
  };
  if (Number.isFinite(spec.min)) item.min = spec.min;
  const pins = cleanPins(spec.pins);
  if (pins.length > 0) item.pins = pins;
  if (spec.stackSpec && typeof spec.stackSpec === "object") item.stackSpec = spec.stackSpec;
  if (spec.hidden === true) item.hidden = true;
  if (typeof spec.muscle === "string" && spec.muscle.trim()) item.muscle = spec.muscle.trim();
  if (typeof spec.weightSet === "string" && spec.weightSet) item.weightSet = spec.weightSet;
  return item;
}

// A weight list tidied: only positive numbers, no repeats, lowest first.
const cleanPins = (pins) =>
  Array.isArray(pins) ? [...new Set(pins.filter((p) => Number.isFinite(p) && p > 0))].sort((a, b) => a - b) : [];

// ---------- Names ----------
const sameName = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

// Checks a name before an item is added or renamed (exceptId is the item being renamed).
// Returns { ok, reason, existing }: reason is "blank", "duplicate" (a visible item has the name) or
// "hidden" (a removed item has it, so the screen can offer to bring that one back); existing is its id.
export function checkName(gym, name, exceptId = null) {
  if (!String(name ?? "").trim()) return { ok: false, reason: "blank", existing: null };
  const others = Object.entries(gym.equipment || {}).filter(([id, i]) => id !== exceptId && sameName(i.name, name));
  const visible = others.find(([, i]) => !isHidden(i) && !inHiddenSet(gym, i));
  if (visible) return { ok: false, reason: "duplicate", existing: visible[0] };
  if (others.length > 0) return { ok: false, reason: "hidden", existing: others[0][0] };
  return { ok: true, reason: "", existing: null };
}

// An id from a name, unique among the taken ids: "Leg Press" gives "leg-press", then "leg-press-2".
export function uniqueId(name, taken, fallback = "item") {
  const base = String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || fallback;
  const used = new Set(taken);
  let id = base;
  let n = 2;
  while (used.has(id)) id = base + "-" + n++;
  return id;
}

// ---------- Gyms ----------
export const newGym = (name, units = {}, equipment = {}) => ({
  name: String(name ?? "").trim() || "My gym",
  units: { ...DEFAULT_UNITS, ...units },
  equipment,
  weightSets: defaultWeightSets({ ...DEFAULT_UNITS, ...units }),
});

// The built-in exercise list as equipment items: lb exercises are stack machines; the kg ones are
// the barbell, the dumbbells and the pull-ups. Timed exercises (cardio) come later and are skipped.
const STARTER_TYPE = { deadlift: "barbell", "farmers-hold": "dumbbell", "pull-up": "bodyweight" };
export function starterEquipment(builtIn) {
  const out = {};
  for (const e of builtIn) {
    if (e.kind === "time") continue;
    const type = e.unit === "lb" ? "stack" : STARTER_TYPE[e.id] || "barbell";
    // Barbells and plate-loaded machines count in main steps of 10 plus extras between them.
    out[e.id] = makeItem({ ...e, type, ...(barLike(type) ? { step: mainStep(type, e.unit) } : {}) });
  }
  return out;
}

// Lays the old shared machine data ({ id: { name, step, pins, stackSpec } }) over equipment items.
export function withMachineData(equipment, machines = {}) {
  const out = {};
  for (const [id, item] of Object.entries(equipment)) {
    const patch = {};
    for (const f of ["name", "step", "pins", "stackSpec"]) if (machines[id]?.[f] != null) patch[f] = machines[id][f];
    out[id] = makeItem({ ...item, ...patch });
  }
  return out;
}

// Adds an item, taking the unit from the gym's setting for that type. A dumbbell or barbell item joins the
// gym's weight set for that type (and takes its unit), unless a different unit is asked for. Returns
// { gym, id } (id is null when the name is blank).
export function addItem(gym, spec) {
  if (!String(spec.name ?? "").trim()) return { gym, id: null };
  const type = TYPE_IDS.includes(spec.type) ? spec.type : "stack";
  const id = uniqueId(spec.name, Object.keys(gym.equipment || {}));
  const setId = setIdFor(type);
  const set = setId ? gym.weightSets?.[setId] : null;
  const linked = !!set && (spec.unit === undefined || spec.unit === set.unit);
  const unit = linked ? set.unit : spec.unit ?? gym.units?.[type];
  const item = makeItem({ ...spec, type, unit, ...(linked ? { weightSet: setId } : {}) });
  return { gym: { ...gym, equipment: { ...gym.equipment, [id]: item } }, id };
}

// Changes an item. Changing its unit clears its weight list, because the old weights no longer fit.
// Changing its type keeps a weight list it already has; without one the step goes back to the new
// type's usual step. A field set to null is removed (for example clearing a stack list).
export function updateItem(gym, id, patch) {
  const old = gym.equipment?.[id];
  if (!old) return gym;
  const next = { ...old };
  if (TYPE_IDS.includes(patch.type) && patch.type !== old.type) {
    next.type = patch.type;
    if (!(Array.isArray(old.pins) && old.pins.length > 0)) next.step = defaultStep(next.type, next.unit);
  }
  if (UNITS.includes(patch.unit) && patch.unit !== old.unit) {
    next.unit = patch.unit;
    next.step = defaultStep(next.type, patch.unit);
    delete next.pins;
    delete next.stackSpec;
    delete next.min;
  }
  if (String(patch.name ?? "").trim()) next.name = String(patch.name).trim();
  for (const f of ["step", "pins", "stackSpec", "common", "min", "group", "hidden", "muscle"]) {
    if (!(f in patch)) continue;
    if (patch[f] == null) delete next[f];
    else next[f] = patch[f];
  }
  return { ...gym, equipment: { ...gym.equipment, [id]: makeItem(next) } };
}

// Deletes an item for good. The screens use hideItem instead, which can be undone.
// Edits an item from the Edit item screen: name, session, muscle, type, unit, or linking it to the gym's weight set.
// Returns { gym, ok, reason } where reason is "" when it worked, or "missing", "blank", "duplicate", "hidden"
// (the name belongs to another item; existing says which) or "history" (the type or unit cannot change
// because the item has logged sets at this gym: historyIds is the set of exercise ids with sets there).
export function editItem(gym, id, patch, historyIds = new Set()) {
  const old = gym.equipment?.[id];
  if (!old) return { gym, ok: false, reason: "missing", existing: null };
  const name = "name" in patch ? String(patch.name ?? "").trim() : old.name;
  const c = checkName(gym, name, id);
  if (!c.ok) return { gym, ok: false, reason: c.reason, existing: c.existing };
  const type = TYPE_IDS.includes(patch.type) ? patch.type : old.type;
  const setId = setIdFor(type);
  const set = setId ? gym.weightSets?.[setId] : null;
  const next = { ...old, name };
  if (patch.group) next.group = patch.group;
  if ("muscle" in patch) {
    if (patch.muscle) next.muscle = String(patch.muscle);
    else delete next.muscle;   // back to the automatic muscle
  }
  const wantsLink = !!set && (type !== old.type || patch.useSet === true) && !old.weightSet;
  const typeChanged = type !== old.type;
  const unit = UNITS.includes(patch.unit) ? patch.unit : old.unit;
  const unitChanged = !old.weightSet && !wantsLink && unit !== old.unit;
  const linkUnitChanged = wantsLink && set.unit !== old.unit;
  if ((typeChanged || unitChanged || linkUnitChanged) && historyIds.has(id)) return { gym, ok: false, reason: "history", existing: null };
  if (typeChanged) {
    next.type = type;
    delete next.weightSet;
    delete next.pins;
    delete next.stackSpec;
    delete next.min;
    next.step = defaultStep(type, next.unit);
  }
  if (wantsLink) {
    next.weightSet = setId;
    next.unit = set.unit;
    delete next.pins;
    delete next.stackSpec;
    next.step = defaultStep(type, set.unit);
  } else if (unitChanged) {
    next.unit = unit;
    next.step = defaultStep(type, unit);
    delete next.pins;
    delete next.stackSpec;
    delete next.min;
  }
  return { gym: { ...gym, equipment: { ...gym.equipment, [id]: makeItem(next) } }, ok: true, reason: "", existing: null };
}

export function removeItem(gym, id) {
  const { [id]: gone, ...equipment } = gym.equipment || {};
  return { ...gym, equipment };
}

// ---------- Hiding and bringing back ----------
export const isHidden = (item) => item?.hidden === true;
export const hideItem = (gym, id) => updateItem(gym, id, { hidden: true });
export const restoreItem = (gym, id) => updateItem(gym, id, { hidden: null });
// [id, item] pairs: the items in use, and the removed ones.
// A whole weight set (the gym's dumbbells or barbell) can be hidden when the gym does not have it. Every
// exercise that uses it then drops out of the lists, and comes back when the set is restored.
export const isSetHidden = (gym, setId) => gym.weightSets?.[setId]?.hidden === true;
const inHiddenSet = (gym, item) => !!item?.weightSet && isSetHidden(gym, item.weightSet);
export const visibleEntries = (gym) => Object.entries(gym.equipment || {}).filter(([, i]) => !isHidden(i) && !inHiddenSet(gym, i));
// Items hidden one by one (items inside a hidden set are not listed: they come back with the set).
export const hiddenEntries = (gym) => Object.entries(gym.equipment || {}).filter(([, i]) => isHidden(i) && !inHiddenSet(gym, i));
export const hideWeightSet = (gym, id) => updateWeightSet(gym, id, { hidden: true });
export const restoreWeightSet = (gym, id) => updateWeightSet(gym, id, { hidden: null });
export const hiddenSetIds = (gym) => Object.keys(gym.weightSets || {}).filter((id) => isSetHidden(gym, id));

// ---------- Units ----------
// What changing the unit of every item of this type in a gym would do, for a warning before it happens:
// how many items would change, and how many of those have a saved weight list that would be cleared.
export function unitChangeImpact(gym, type, unit) {
  const affected = Object.values(gym.equipment || {}).filter((i) => i.type === type && i.unit !== unit);
  return { items: affected.length, lists: affected.filter((i) => Array.isArray(i.pins) && i.pins.length > 0).length };
}

// ---------- Dumbbell weights ----------
// The usual dumbbell weights as a spec for the stack builder: kg goes up by 1 to 10 and then by 2 to 50;
// lb goes up by 2.5 to 10 and then by 5 to 100. stacks.js (buildPins) turns a spec into the weight list;
// it cannot be imported here, so only the spec lives in this file.
const DUMBBELL_BANDS = {
  kg: { low: 1, step: 1, top: 50, changes: [{ at: 10, step: 2 }] },
  lb: { low: 2.5, step: 2.5, top: 100, changes: [{ at: 10, step: 5 }] },
};
export const dumbbellBands = (unit) => structuredClone(DUMBBELL_BANDS[unit] ?? DUMBBELL_BANDS.kg);

// ---------- Weight sets: the dumbbells and barbell a gym has ----------
export const WEIGHT_SET_TYPES = ["dumbbell", "barbell"];
export const setIdFor = (type) => (type === "dumbbell" ? "dumbbells" : type === "barbell" ? "barbell" : null);
const SET_NAME = { dumbbell: "Dumbbells", barbell: "Barbell" };
const BARBELL_TOP = { kg: 200, lb: 450 };

// The usual dumbbell weights in a unit (see dumbbellBands). stacks.js buildPins gives the same list.
export function dumbbellWeights(unit) {
  const { low, step, top, changes } = dumbbellBands(unit);
  const weights = [low];
  for (let w = low; ; ) {
    w = round2(w + changes.reduce((s, c) => (c.at <= w ? c.step : s), step));
    if (w > top) break;
    weights.push(w);
  }
  return weights;
}

// Barbell main weights: 10, 20, 30 ... up to top (200 kg or 450 lb unless a gym says otherwise).
export function barbellWeights(unit, top = BARBELL_TOP[unit] ?? BARBELL_TOP.kg) {
  const out = [];
  for (let w = 10; w <= top; w += 10) out.push(w);
  return out;
}

// A tidy weight set from loose data. With no weights given it starts with the usual ones for its type.
export function makeWeightSet(spec) {
  const type = WEIGHT_SET_TYPES.includes(spec.type) ? spec.type : "dumbbell";
  const unit = UNITS.includes(spec.unit) ? spec.unit : DEFAULT_UNITS[type];
  const out = { name: String(spec.name ?? "").trim() || SET_NAME[type], type, unit };
  if (spec.hidden === true) out.hidden = true;
  const pins = cleanPins(spec.pins);
  if (type === "barbell") {
    out.top = Number.isFinite(spec.top) && spec.top >= 10 ? spec.top : pins.length > 0 ? pins[pins.length - 1] : BARBELL_TOP[unit];
    out.pins = pins.length > 0 ? pins : barbellWeights(unit, out.top);
  } else {
    out.pins = pins.length > 0 ? pins : dumbbellWeights(unit);
    if (spec.stackSpec && typeof spec.stackSpec === "object") out.stackSpec = spec.stackSpec;
    else if (pins.length === 0) out.stackSpec = dumbbellBands(unit);
  }
  return out;
}

// The two sets a new gym starts with, in the gym's units for those types.
export const defaultWeightSets = (units = DEFAULT_UNITS) => ({
  dumbbells: makeWeightSet({ type: "dumbbell", unit: units.dumbbell }),
  barbell: makeWeightSet({ type: "barbell", unit: units.barbell }),
});

// Makes sure a gym has its dumbbell and barbell sets and that its dumbbell and barbell items use them. A
// missing set is built from the gym's first item of that type (its unit and any weight list it had), else
// the usual weights. An item whose unit differs from the set's is left alone, with its own weights.
// Running it again changes nothing.
export function ensureWeightSets(gym) {
  const units = { ...DEFAULT_UNITS, ...(gym.units || {}) };
  const entries = Object.entries(gym.equipment || {});
  const weightSets = {};
  for (const [id, s] of Object.entries(gym.weightSets && typeof gym.weightSets === "object" ? gym.weightSets : {})) {
    weightSets[id] = makeWeightSet(s);
  }
  for (const type of WEIGHT_SET_TYPES) {
    const id = setIdFor(type);
    if (weightSets[id]) continue;
    const first = entries.map(([, i]) => i).find((i) => i.type === type);
    weightSets[id] = makeWeightSet({
      type, unit: first?.unit ?? units[type], pins: first?.pins, stackSpec: first?.stackSpec,
    });
  }
  const equipment = {};
  for (const [id, item] of entries) {
    const setId = setIdFor(item.type);
    const own = item.weightSet && weightSets[item.weightSet]?.type === item.type ? weightSets[item.weightSet] : null;
    const set = own ?? (setId && !item.weightSet ? weightSets[setId] : null);
    equipment[id] = set && set.unit === item.unit ? makeItem({ ...item, weightSet: own ? item.weightSet : setId }) : item;
  }
  return { ...gym, weightSets, equipment };
}

// Items that use a weight set.
export const weightSetUsers = (gym, id) =>
  Object.entries(gym.equipment || {}).filter(([, i]) => i.weightSet === id).map(([itemId]) => itemId);

// A set's unit cannot change once an exercise that uses it has logged sets at this gym (historyIds is the
// set of exercise ids with sets there, from idsWithHistory in log.js).
export const weightSetUnitLocked = (gym, id, historyIds = new Set()) =>
  weightSetUsers(gym, id).some((itemId) => historyIds.has(itemId));

// Changes a set's weights, name or top weight (a barbell's top builds a new list unless pins are given).
// An empty list of pins goes back to the usual weights. A field set to null (stackSpec) is removed.
export function updateWeightSet(gym, id, patch) {
  const old = gym.weightSets?.[id];
  if (!old) return gym;
  const next = { ...old };
  if (String(patch.name ?? "").trim()) next.name = String(patch.name).trim();
  if ("top" in patch && old.type === "barbell" && patch.top >= 10) {
    next.top = patch.top;
    if (!("pins" in patch)) next.pins = barbellWeights(old.unit, patch.top);
  }
  if ("pins" in patch) next.pins = patch.pins;
  if ("hidden" in patch) {
    if (patch.hidden === true) next.hidden = true;
    else delete next.hidden;
  }
  if ("stackSpec" in patch) {
    if (patch.stackSpec == null) delete next.stackSpec;
    else next.stackSpec = patch.stackSpec;
  }
  return { ...gym, weightSets: { ...gym.weightSets, [id]: makeWeightSet(next) } };
}

// Changes a set's unit: its weights start again at the usual ones, and the items that use it move to the
// new unit. Refused when an exercise using it has history here. Returns { gym, ok, reason } where reason is
// "" when it worked, or "missing", "same" or "history".
export function setWeightSetUnit(gym, id, unit, historyIds = new Set()) {
  const old = gym.weightSets?.[id];
  if (!old) return { gym, ok: false, reason: "missing" };
  if (!UNITS.includes(unit) || unit === old.unit) return { gym, ok: false, reason: "same" };
  if (weightSetUnitLocked(gym, id, historyIds)) return { gym, ok: false, reason: "history" };
  let next = { ...gym, weightSets: { ...gym.weightSets, [id]: makeWeightSet({ name: old.name, type: old.type, unit, hidden: old.hidden }) } };
  for (const itemId of weightSetUsers(gym, id)) next = updateItem(next, itemId, { unit });
  return { gym: next, ok: true, reason: "" };
}

// ---------- The starter dumbbell and barbell exercises ----------
// Added once to a gym that has equipment already (see seedStarterFree). Any of them can be hidden.
const free = (id, name, group, type, common = true) => ({ id, name, group, type, common });
export const STARTER_FREE = [
  free("dumbbell-curl", "Dumbbell Curl", "arms", "dumbbell"),
  free("hammer-curl", "Hammer Curl", "arms", "dumbbell", false),
  free("dumbbell-shoulder-press", "Dumbbell Shoulder Press", "arms", "dumbbell"),
  free("lateral-raise", "Lateral Raise", "arms", "dumbbell", false),
  free("dumbbell-chest-press", "Dumbbell Chest Press", "arms", "dumbbell"),
  free("dumbbell-row", "Dumbbell Row", "arms", "dumbbell"),
  free("overhead-tricep-extension", "Overhead Tricep Extension (dumbbell)", "arms", "dumbbell", false),
  free("goblet-squat", "Goblet Squat", "legs", "dumbbell"),
  free("dumbbell-lunge", "Dumbbell Lunge", "legs", "dumbbell", false),
  free("dumbbell-rdl", "Dumbbell Romanian Deadlift", "legs", "dumbbell", false),
  free("dumbbell-step-up", "Dumbbell Step-up", "legs", "dumbbell", false),
  free("weighted-crunch", "Weighted Crunch", "abs", "dumbbell"),
  free("russian-twist", "Russian Twist", "abs", "dumbbell", false),
  free("dumbbell-side-bend", "Dumbbell Side Bend", "abs", "dumbbell", false),
  free("barbell-squat", "Barbell Squat", "legs", "barbell"),
  free("barbell-rdl", "Barbell Romanian Deadlift", "legs", "barbell", false),
  free("hip-thrust", "Hip Thrust (barbell)", "legs", "barbell", false),
  free("barbell-bench-press", "Barbell Bench Press", "arms", "barbell"),
  free("overhead-press", "Overhead Press (barbell)", "arms", "barbell"),
  free("barbell-row", "Bent-over Row (barbell)", "arms", "barbell"),
  free("barbell-curl", "Barbell Curl", "arms", "barbell", false),
];

// Adds the starter exercises to a gym that already has equipment, once (the gym remembers it with
// starterFree). An empty gym is marked without adding anything. Ids the gym already has are left alone.
export function seedStarterFree(gym) {
  if (gym.starterFree === true) return gym;
  if (Object.keys(gym.equipment || {}).length === 0) return { ...gym, starterFree: true };
  const equipment = { ...gym.equipment };
  for (const s of STARTER_FREE) {
    if (equipment[s.id]) continue;
    const set = gym.weightSets?.[setIdFor(s.type)];
    equipment[s.id] = makeItem({ ...s, ...(set ? { unit: set.unit, weightSet: setIdFor(s.type) } : {}) });
  }
  return { ...gym, equipment, starterFree: true };
}

// Sets the unit new items of this type will get. Items already in the gym are not changed.
export const setDefaultUnit = (gym, type, unit) =>
  UNITS.includes(unit) && TYPE_IDS.includes(type) ? { ...gym, units: { ...gym.units, [type]: unit } } : gym;

// Copies the chosen items from one gym into another, keeping their ids. Items already in the
// other gym are skipped unless overwrite is true. Equipment data only; nothing personal.
// An item that uses a weight set joins the other gym's set of that name, which keeps its own weights and unit
// (every gym has its own dumbbells); the set is copied across only if the other gym has none.
// Returns { gym, copied, skipped }.
export function copyEquipment(from, ids, to, { overwrite = false } = {}) {
  const equipment = { ...to.equipment };
  const weightSets = { ...to.weightSets };
  let copied = 0;
  let skipped = 0;
  for (const id of ids) {
    const item = from.equipment?.[id];
    if (!item) continue;
    if (id in equipment && !overwrite) { skipped++; continue; }
    const copy = structuredClone(item);
    if (copy.weightSet) {
      if (!weightSets[copy.weightSet] && from.weightSets?.[copy.weightSet]) {
        weightSets[copy.weightSet] = structuredClone(from.weightSets[copy.weightSet]);
      }
      if (weightSets[copy.weightSet]) copy.unit = weightSets[copy.weightSet].unit;
      else delete copy.weightSet;
    }
    equipment[id] = copy;
    copied++;
  }
  return { gym: { ...to, equipment, weightSets }, copied, skipped };
}

// ---------- The kinds of exercise list ----------
// The exercise list shows one kind at a time so it is short: machines (stack and plate-loaded), dumbbells,
// barbells or body weight. Each gym has a default kind (gym.listDefault); an exercise without a type counts
// as a machine.
export const LIST_KINDS = [
  { id: "machines", label: "Machines", types: ["stack", "plate"] },
  { id: "dumbbells", label: "Dumbbells", types: ["dumbbell"] },
  { id: "barbell", label: "Barbells", types: ["barbell"] },
  { id: "bodyweight", label: "Body weight", types: ["bodyweight"] },
];
export const listKindOf = (item) => LIST_KINDS.find((k) => k.types.includes(item?.type))?.id ?? "machines";
export const listDefaultOf = (gym) => (LIST_KINDS.some((k) => k.id === gym?.listDefault) ? gym.listDefault : "machines");
export const setListDefault = (gym, kind) => (LIST_KINDS.some((k) => k.id === kind) ? { ...gym, listDefault: kind } : gym);

// Counts per kind for a list of exercises: { machines, dumbbells, barbell, bodyweight }.
export function kindCounts(list) {
  const out = Object.fromEntries(LIST_KINDS.map((k) => [k.id, 0]));
  for (const e of list) out[listKindOf(e)] += 1;
  return out;
}

// Which kind to show. present = kinds the session has at all; open = exercises still to do per kind (from
// kindCounts). Tries what was picked, then the gym's default, then the first kind with something left, then
// any kind the session has.
export function chooseListKind(present, open, wanted, fallback) {
  const order = [wanted, fallback, ...LIST_KINDS.map((k) => k.id)].filter(Boolean);
  return order.find((k) => present.includes(k) && open[k] > 0) ?? order.find((k) => present.includes(k)) ?? fallback ?? "machines";
}

// ---------- For the screens ----------
// An item in the shape the existing exercise code expects (id, extras, warm-up). Only stack
// machines have warm-up sets, as before.
// An item that uses a weight set takes its unit and weight list from the set (pass the gym's weightSets).
export function toExercise(id, item, weightSets = {}) {
  const set = item.weightSet ? weightSets?.[item.weightSet] : null;
  const base = set ? { ...item, unit: set.unit, pins: set.pins } : item;
  return { id, ...base, extras: extraList(item.type, base.unit), warmup: item.type === "stack" };
}

// Items that have been hidden are left out.
export const exerciseList = (gym) => visibleEntries(gym).map(([id, item]) => toExercise(id, item, gym.weightSets));

// ---------- kg and lb ----------
export const KG_PER_LB = 0.45359237;
export const convert = (weight, from, to) =>
  from === to ? weight : from === "lb" ? weight * KG_PER_LB : weight / KG_PER_LB;
const tidy = (n) => Math.round(n * 10) / 10;

// A weight in both units, such as "100 lb (45.4 kg)". The weight is in unit; first is the unit shown
// first (the weight's own unit unless you say otherwise). The converted figure has one decimal place.
export function formatBoth(weight, unit, first = unit) {
  const second = first === "kg" ? "lb" : "kg";
  const show = (u) => (u === unit ? weight : tidy(convert(weight, unit, u))) + " " + u;
  return show(first) + " (" + show(second) + ")";
}