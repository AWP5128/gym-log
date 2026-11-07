import test from "node:test";
import assert from "node:assert/strict";
import {
  muscleOf, isOpposite, emptyPairs, cleanPairs, hasPair, addPair, removePair, pairedWith,
  getPairs, setPairs, partnerGroups, DEFAULT_MUSCLE, MUSCLES,
} from "./superset.js";
import { emptyStore, cleanStore, toLegacySettings, applyLegacySettings } from "./store.js";
import { exercises } from "./exercises.js";
import { STARTER_FREE } from "./gym.js";

const ex = (id, name = id, group = "arms") => ({ id, name, group });

test("every starter exercise has a known muscle", () => {
  for (const e of [...exercises, ...STARTER_FREE]) {
    assert.ok(MUSCLES[DEFAULT_MUSCLE[e.id]], e.id + " has no muscle");
  }
});

test("muscle: own setting, then the starter list, then a guess from the name", () => {
  assert.equal(muscleOf({ id: "x", name: "Anything", muscle: "chest" }), "chest");
  assert.equal(muscleOf(ex("bicep-curl")), "biceps");
  assert.equal(muscleOf(ex("mine", "Preacher Curl")), "biceps");
  assert.equal(muscleOf(ex("mine2", "Seated Hamstring Curl")), "hamstrings");
  assert.equal(muscleOf(ex("mine3", "Cable Tricep Pushdown")), "triceps");
  assert.equal(muscleOf(ex("mine4", "Mystery")), null);
  assert.equal(muscleOf(null), null);
});

test("opposite muscles work both ways", () => {
  assert.ok(isOpposite("biceps", "triceps"));
  assert.ok(isOpposite("triceps", "biceps"));
  assert.ok(isOpposite("quads", "hamstrings"));
  assert.ok(isOpposite("chest", "back"));
  assert.ok(!isOpposite("biceps", "biceps"));
  assert.ok(!isOpposite("biceps", "quads"));
  assert.ok(!isOpposite(null, "biceps"));
});

test("saved pairs: added once, both ways, removable, tidied", () => {
  let p = addPair(emptyPairs(), "a", "b");
  p = addPair(p, "b", "a");
  assert.equal(p.pairs.length, 1);
  assert.ok(hasPair(p, "b", "a"));
  assert.deepEqual(pairedWith(p, "a"), ["b"]);
  assert.deepEqual(pairedWith(p, "b"), ["a"]);
  assert.equal(addPair(p, "a", "a").pairs.length, 1);
  assert.equal(removePair(p, "b", "a").pairs.length, 0);
  assert.deepEqual(cleanPairs({ pairs: [["a", "b"], ["b", "a"], ["c", "c"], "bad", [1, 2]] }).pairs, [["a", "b"]]);
  assert.deepEqual(cleanPairs(null), { pairs: [] });
});

const arms = [
  ex("bicep-curl", "Bicep Curl Machine"), ex("tricep-extension", "Tricep Extension Machine"),
  ex("tricep-dip", "Tricep Dip Machine"), ex("chest-press", "Chest Press Machine"),
  ex("lat-pulldown", "Lat Pull-down"), ex("pull-up", "Pull-ups", "legs"),
];
const legs = [ex("leg-press", "Leg Press", "legs"), ex("hamstring-curl", "Hamstring Curl", "legs"), ex("quad-extension", "Quad Extension", "legs")];

test("biceps: triceps come first, then the rest of the session, never other sessions", () => {
  const g = partnerGroups({ ex: arms[0], pool: arms, others: legs });
  assert.deepEqual(g.suggested.map((e) => e.id), ["tricep-extension", "tricep-dip"]);
  assert.deepEqual(g.rest.map((e) => e.id), ["chest-press", "lat-pulldown", "pull-up"]);
  assert.deepEqual(g.elsewhere.map((e) => e.id), ["leg-press", "hamstring-curl", "quad-extension"]);
});

test("the exercise itself and taken ones are left out", () => {
  const g = partnerGroups({ ex: arms[0], pool: arms, others: legs, taken: new Set(["tricep-dip", "leg-press"]) });
  assert.deepEqual(g.suggested.map((e) => e.id), ["tricep-extension"]);
  assert.ok(!g.rest.some((e) => e.id === "bicep-curl"));
  assert.ok(!g.elsewhere.some((e) => e.id === "leg-press"));
});

test("pull-ups (in the pool on an arms day) pair with arms exercises", () => {
  const g = partnerGroups({ ex: arms[5], pool: arms, others: legs });
  assert.ok(g.rest.concat(g.suggested).some((e) => e.id === "bicep-curl"));
});

test("a saved pair from another session is offered first, in both directions", () => {
  const prefs = addPair(emptyPairs(), "bicep-curl", "leg-press");
  const a = partnerGroups({ ex: arms[0], pool: arms, others: legs, prefs });
  assert.equal(a.suggested[0].id, "leg-press");
  assert.ok(a.saved.has("leg-press"));
  assert.ok(!a.elsewhere.some((e) => e.id === "leg-press"));
  const b = partnerGroups({ ex: legs[0], pool: legs, others: arms, prefs });
  assert.equal(b.suggested[0].id, "bicep-curl");
});

test("an exercise with no known muscle only gets saved pairs suggested", () => {
  const odd = ex("odd", "Mystery");
  const g = partnerGroups({ ex: odd, pool: [odd, ...arms], others: [] });
  assert.equal(g.suggested.length, 0);
  assert.equal(g.rest.length, arms.length);
});

test("saved pairs live under the person and survive the store round trip", () => {
  let store = emptyStore();
  const person = store.currentPerson;
  store = setPairs(store, person, addPair(emptyPairs(), "pull-up", "leg-press"));
  assert.deepEqual(getPairs(store, person).pairs, [["pull-up", "leg-press"]]);
  assert.deepEqual(getPairs(store, "someone-else").pairs, []);
  // saving ordinary settings and reloading keeps them
  store = applyLegacySettings(store, person, store.currentGym, toLegacySettings(store, person, store.currentGym));
  assert.deepEqual(getPairs(store, person).pairs, [["pull-up", "leg-press"]]);
  const again = cleanStore(JSON.parse(JSON.stringify(store)));
  assert.deepEqual(getPairs(again, person).pairs, [["pull-up", "leg-press"]]);
});

// ---------- Muscle chosen on the Edit item screen ----------
import { makeItem, editItem, updateItem, copyEquipment, exerciseList } from "./gym.js";

test("an item keeps its own muscle; a blank one is dropped", () => {
  assert.equal(makeItem({ name: "A", group: "arms", type: "stack", muscle: " chest " }).muscle, "chest");
  assert.equal("muscle" in makeItem({ name: "A", group: "arms", type: "stack", muscle: "  " }), false);
  assert.equal("muscle" in makeItem({ name: "A", group: "arms", type: "stack" }), false);
});

test("editItem sets the muscle, and an empty one goes back to automatic", () => {
  const gym = emptyStore().gyms[emptyStore().currentGym];
  let r = editItem(gym, "bicep-curl", { muscle: "chest" });
  assert.ok(r.ok);
  assert.equal(r.gym.equipment["bicep-curl"].muscle, "chest");
  assert.equal(muscleOf(exerciseList(r.gym).find((e) => e.id === "bicep-curl")), "chest");
  r = editItem(r.gym, "bicep-curl", { muscle: "" });
  assert.ok(r.ok);
  assert.equal("muscle" in r.gym.equipment["bicep-curl"], false);
  assert.equal(muscleOf(exerciseList(r.gym).find((e) => e.id === "bicep-curl")), "biceps");
  // a patch without a muscle leaves it alone
  const kept = editItem(editItem(gym, "bicep-curl", { muscle: "chest" }).gym, "bicep-curl", { name: "Curl" });
  assert.equal(kept.gym.equipment["bicep-curl"].muscle, "chest");
});

test("the muscle survives saving other settings and copying to another gym", () => {
  let store = emptyStore();
  const person = store.currentPerson;
  const gym = editItem(store.gyms[store.currentGym], "bicep-curl", { muscle: "chest" }).gym;
  store = { ...store, gyms: { ...store.gyms, [store.currentGym]: gym } };
  store = applyLegacySettings(store, person, store.currentGym, toLegacySettings(store, person, store.currentGym));
  assert.equal(store.gyms[store.currentGym].equipment["bicep-curl"].muscle, "chest");
  assert.equal(cleanStore(JSON.parse(JSON.stringify(store))).gyms[store.currentGym].equipment["bicep-curl"].muscle, "chest");
  const to = copyEquipment(store.gyms[store.currentGym], ["bicep-curl"], { name: "Other", units: {}, equipment: {}, weightSets: {} }).gym;
  assert.equal(to.equipment["bicep-curl"].muscle, "chest");
  assert.equal(updateItem(gym, "bicep-curl", { name: "X" }).equipment["bicep-curl"].muscle, "chest");
});
