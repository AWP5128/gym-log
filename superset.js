// Superset partners: which exercises are offered to pair with the one you have chosen.
// Pure (no browser calls) so it can be tested; imports nothing from the app.
//
// The rules: partners come from the same session (the pool the screen passes in) and the
// ones with OPPOSITE muscles are offered first. Exercises from other sessions are offered
// separately, and a pair you save is offered first, in both directions.

export const MUSCLES = {
  biceps: "Biceps", triceps: "Triceps", chest: "Chest", back: "Back", shoulders: "Shoulders",
  "rear-delts": "Rear delts", quads: "Quads", hamstrings: "Hamstrings", glutes: "Glutes",
  calves: "Calves", abductors: "Hip abductors", adductors: "Hip adductors", abs: "Abs", grip: "Grip",
};

// Muscles that work against each other (either way round).
const OPPOSITES = [
  ["biceps", "triceps"], ["chest", "back"], ["shoulders", "back"], ["rear-delts", "chest"],
  ["quads", "hamstrings"], ["glutes", "quads"], ["abductors", "adductors"],
];

// The main muscle of each starter exercise (by id).
export const DEFAULT_MUSCLE = {
  "hip-abduction": "abductors", "hip-adduction": "adductors", "calf-press": "calves",
  "leg-press": "quads", "squat-machine": "quads", deadlift: "hamstrings", "pull-up": "back",
  "quad-extension": "quads", "hamstring-curl": "hamstrings",
  "shoulder-press": "shoulders", "chest-press": "chest", "tricep-dip": "triceps", "bicep-curl": "biceps",
  "tricep-extension": "triceps", "lat-pulldown": "back", "upright-row": "shoulders",
  "farmers-hold": "grip", "delt-fly": "shoulders", "rear-fly": "rear-delts",
  "dumbbell-curl": "biceps", "hammer-curl": "biceps", "dumbbell-shoulder-press": "shoulders",
  "lateral-raise": "shoulders", "dumbbell-chest-press": "chest", "dumbbell-row": "back",
  "overhead-tricep-extension": "triceps", "goblet-squat": "quads", "dumbbell-lunge": "quads",
  "dumbbell-rdl": "hamstrings", "dumbbell-step-up": "quads", "weighted-crunch": "abs",
  "russian-twist": "abs", "dumbbell-side-bend": "abs", "barbell-squat": "quads",
  "barbell-rdl": "hamstrings", "hip-thrust": "glutes", "barbell-bench-press": "chest",
  "overhead-press": "shoulders", "barbell-row": "back", "barbell-curl": "biceps",
};

// For exercises you add yourself: a guess from the name (first match wins). Null when nothing fits.
const GUESS = [
  [/hamstring|romanian|rdl|deadlift/i, "hamstrings"],
  [/tricep|dip|skull/i, "triceps"],
  [/bicep|curl/i, "biceps"],
  [/rear|reverse fly/i, "rear-delts"],
  [/chest|bench|push-?up|fly/i, "chest"],
  [/lat |pull-?down|pull-?up|chin-?up|row/i, "back"],
  [/shoulder|overhead|lateral|delt|upright/i, "shoulders"],
  [/calf|calves/i, "calves"],
  [/abduct/i, "abductors"],
  [/adduct/i, "adductors"],
  [/glute|thrust|bridge/i, "glutes"],
  [/quad|squat|leg press|lunge|step-?up/i, "quads"],
  [/crunch|twist|side bend|sit-?up|plank|abs/i, "abs"],
];

// The muscle of an exercise (an object with id and name), or null when unknown.
export function muscleOf(ex) {
  if (!ex) return null;
  if (ex.muscle && MUSCLES[ex.muscle]) return ex.muscle;
  if (DEFAULT_MUSCLE[ex.id]) return DEFAULT_MUSCLE[ex.id];
  const name = String(ex.name || "");
  for (const [re, muscle] of GUESS) if (re.test(name)) return muscle;
  return null;
}

export const muscleLabel = (muscle) => MUSCLES[muscle] || "";

export function isOpposite(a, b) {
  if (!a || !b) return false;
  return OPPOSITES.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

// ---------- Pairs you save (per person) ----------
// prefs = { pairs: [[idA, idB], ...] }. A pair works both ways.
export const emptyPairs = () => ({ pairs: [] });

const sameIds = (p, a, b) => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a);

export function cleanPairs(raw) {
  const out = [];
  const list = raw && Array.isArray(raw.pairs) ? raw.pairs : [];
  for (const p of list) {
    if (!Array.isArray(p) || typeof p[0] !== "string" || typeof p[1] !== "string" || p[0] === p[1]) continue;
    if (!out.some((q) => sameIds(q, p[0], p[1]))) out.push([p[0], p[1]]);
  }
  return { pairs: out };
}

export const hasPair = (prefs, a, b) => cleanPairs(prefs).pairs.some((p) => sameIds(p, a, b));

export function addPair(prefs, a, b) {
  const clean = cleanPairs(prefs);
  if (!a || !b || a === b || hasPair(clean, a, b)) return clean;
  return { pairs: [...clean.pairs, [a, b]] };
}

export function removePair(prefs, a, b) {
  return { pairs: cleanPairs(prefs).pairs.filter((p) => !sameIds(p, a, b)) };
}

// The ids saved as partners of one exercise.
export function pairedWith(prefs, id) {
  return cleanPairs(prefs).pairs.filter((p) => p[0] === id || p[1] === id).map((p) => (p[0] === id ? p[1] : p[0]));
}

// A person's saved pairs, and the store with new ones saved (other people and gyms are left alone).
export const getPairs = (store, personId) => cleanPairs(store?.people?.[personId]?.superset);

export function setPairs(store, personId, prefs) {
  const person = store.people?.[personId] || { name: personId, gyms: {} };
  return { ...store, people: { ...store.people, [personId]: { ...person, superset: cleanPairs(prefs) } } };
}

// ---------- What to offer ----------
// ex: the exercise already chosen. pool: this session's exercises (plus any-day ones such as pull-ups).
// others: every other exercise at the gym. taken: ids to leave out (on the page, done today).
// Returns { suggested, rest, elsewhere, saved }:
//   suggested: saved pairs first, then opposite muscles in this session;
//   rest: the other exercises of this session; elsewhere: other sessions' exercises (the exceptions);
//   saved: the set of ids that are a saved pair with ex.
export function partnerGroups({ ex, pool = [], others = [], prefs = emptyPairs(), taken = new Set() }) {
  const poolIds = new Set(pool.map((e) => e.id));
  const open = (e) => e.id !== ex.id && !taken.has(e.id);
  const saved = new Set(pairedWith(prefs, ex.id));
  const mine = muscleOf(ex);
  const inPool = pool.filter(open);
  const outside = others.filter((e) => open(e) && !poolIds.has(e.id));
  const savedFirst = [...inPool, ...outside].filter((e) => saved.has(e.id));
  const opposite = inPool.filter((e) => !saved.has(e.id) && isOpposite(mine, muscleOf(e)));
  const suggested = [...savedFirst, ...opposite];
  const used = new Set(suggested.map((e) => e.id));
  return {
    suggested,
    rest: inPool.filter((e) => !used.has(e.id)),
    elsewhere: outside.filter((e) => !used.has(e.id)),
    saved,
  };
}
