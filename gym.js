// Gyms and their equipment: the model, the unit rules, copying between gyms and kg/lb conversion.
// Everything here is pure (no browser calls) so it can be tested, and it imports nothing from the app.
//
// gym  = { name, units: { type: "kg" | "lb" }, equipment: { exerciseId: item } }
// item = { name, group, type, unit, step, common, min?, pins?, stackSpec?, hidden? }
//
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

// Extras: stack machines 2.5 to 20 lb or 1.25 to 10 kg; barbells and plate-loaded machines sit
// between their main steps (10 kg or 20 lb), so they offer 2.5, 5, 7.5 kg or 5, 10, 15 lb.
const STACK_EXTRAS = { lb: ladder(2.5, 8), kg: ladder(1.25, 8) };
const BAR_EXTRAS = { lb: [5, 10, 15], kg: [2.5, 5, 7.5] };
// The steps offered when building a stack list (change these if a machine needs another).
const STEPS = { lb: [5, 10, 15, 20], kg: [2.5, 5, 7.5, 10] };
// The step used until a stack list is built.
const START_STEP = {
  stack: { lb: 10, kg: 5 }, dumbbell: { lb: 5, kg: 2 },
  barbell: { lb: 20, kg: 10 }, plate: { lb: 20, kg: 10 }, bodyweight: { lb: 5, kg: 2.5 },
};

export function extraList(type, unit) {
  if (type === "stack") return STACK_EXTRAS[unit] || [];
  if (barLike(type)) return BAR_EXTRAS[unit] || [];
  return [];
}
// The main step of a barbell or plate-loaded machine, or null for other types.
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
  const visible = others.find(([, i]) => !isHidden(i));
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
});

// The built-in exercise list as equipment items: lb exercises are stack machines; the kg ones are
// the barbell, the dumbbells and the pull-ups. Timed exercises (cardio) come later and are skipped.
const STARTER_TYPE = { deadlift: "barbell", "farmers-hold": "dumbbell", "pull-up": "bodyweight" };
export function starterEquipment(builtIn) {
  const out = {};
  for (const e of builtIn) {
    if (e.kind === "time") continue;
    const type = e.unit === "lb" ? "stack" : STARTER_TYPE[e.id] || "barbell";
    // Barbells and plate-loaded machines count in main steps (10 kg or 20 lb) plus extras between them.
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

// Adds an item, taking the unit from the gym's setting for that type. Returns { gym, id } (id is null
// when the name is blank).
export function addItem(gym, spec) {
  if (!String(spec.name ?? "").trim()) return { gym, id: null };
  const type = TYPE_IDS.includes(spec.type) ? spec.type : "stack";
  const id = uniqueId(spec.name, Object.keys(gym.equipment || {}));
  const item = makeItem({ ...spec, type, unit: spec.unit ?? gym.units?.[type] });
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
  for (const f of ["step", "pins", "stackSpec", "common", "min", "group", "hidden"]) {
    if (!(f in patch)) continue;
    if (patch[f] == null) delete next[f];
    else next[f] = patch[f];
  }
  return { ...gym, equipment: { ...gym.equipment, [id]: makeItem(next) } };
}

// Deletes an item for good. The screens use hideItem instead, which can be undone.
export function removeItem(gym, id) {
  const { [id]: gone, ...equipment } = gym.equipment || {};
  return { ...gym, equipment };
}

// ---------- Hiding and bringing back ----------
export const isHidden = (item) => item?.hidden === true;
export const hideItem = (gym, id) => updateItem(gym, id, { hidden: true });
export const restoreItem = (gym, id) => updateItem(gym, id, { hidden: null });
// [id, item] pairs: the items in use, and the removed ones.
export const visibleEntries = (gym) => Object.entries(gym.equipment || {}).filter(([, i]) => !isHidden(i));
export const hiddenEntries = (gym) => Object.entries(gym.equipment || {}).filter(([, i]) => isHidden(i));

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

// Sets the unit new items of this type will get. Items already in the gym are not changed.
export const setDefaultUnit = (gym, type, unit) =>
  UNITS.includes(unit) && TYPE_IDS.includes(type) ? { ...gym, units: { ...gym.units, [type]: unit } } : gym;

// Copies the chosen items from one gym into another, keeping their ids. Items already in the
// other gym are skipped unless overwrite is true. Equipment data only; nothing personal.
// Returns { gym, copied, skipped }.
export function copyEquipment(from, ids, to, { overwrite = false } = {}) {
  const equipment = { ...to.equipment };
  let copied = 0;
  let skipped = 0;
  for (const id of ids) {
    const item = from.equipment?.[id];
    if (!item) continue;
    if (id in equipment && !overwrite) { skipped++; continue; }
    equipment[id] = structuredClone(item);
    copied++;
  }
  return { gym: { ...to, equipment }, copied, skipped };
}

// ---------- For the screens ----------
// An item in the shape the existing exercise code expects (id, extras, warm-up). Only stack
// machines have warm-up sets, as before.
export const toExercise = (id, item) => ({
  id,
  ...item,
  extras: extraList(item.type, item.unit),
  warmup: item.type === "stack",
});

// Items that have been hidden are left out.
export const exerciseList = (gym) => visibleEntries(gym).map(([id, item]) => toExercise(id, item));

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