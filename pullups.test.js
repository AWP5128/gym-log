import test from "node:test";
import assert from "node:assert/strict";
import { exercises, exercisesForGroup } from "./exercises.js";
import { movePullUps, newGym, makeItem, updateItem } from "./gym.js";
import { emptyStore, cleanStore, addGym } from "./store.js";
import { pairCandidates, emptyPairs, setSuitable } from "./superset.js";

const pull = (group) => makeItem({ name: "Pull-ups (neutral grip)", group, type: "bodyweight", unit: "kg", min: 0 });

test("pull-ups are an arms exercise in the built-in list, not a legs one", () => {
  assert.equal(exercises.find((e) => e.id === "pull-up").group, "arms");
  assert.ok(exercisesForGroup("arms", true).some((e) => e.id === "pull-up"));
  assert.ok(!exercisesForGroup("legs", true).some((e) => e.id === "pull-up"));
});

test("a new store files the pull-up under arms and marks the gym", () => {
  const s = emptyStore();
  assert.equal(s.gyms.main.equipment["pull-up"].group, "arms");
  assert.equal(s.gyms.main.pullUpsMoved, true);
});

test("a gym saved with the pull-up under legs is moved to arms once", () => {
  const gym = { ...newGym("Old", {}, { "pull-up": pull("legs") }) };
  const moved = movePullUps(gym);
  assert.equal(moved.equipment["pull-up"].group, "arms");
  assert.equal(moved.pullUpsMoved, true);
  assert.equal(gym.equipment["pull-up"].group, "legs");   // the input is not changed
  assert.equal(movePullUps(moved), moved);                // running it again changes nothing
});

test("a later choice of session is kept: the gym is only moved once", () => {
  const moved = movePullUps(newGym("Old", {}, { "pull-up": pull("legs") }));
  const back = updateItem(moved, "pull-up", { group: "legs" });
  assert.equal(movePullUps(back).equipment["pull-up"].group, "legs");
});

test("a gym with no pull-up, or one already under arms, is marked and otherwise left alone", () => {
  const none = movePullUps(newGym("None", {}, {}));
  assert.equal(none.pullUpsMoved, true);
  assert.deepEqual(none.equipment, {});
  const arms = movePullUps(newGym("Arms", {}, { "pull-up": pull("arms") }));
  assert.equal(arms.equipment["pull-up"].group, "arms");
});

test("a version 3 store saved before this change is upgraded on reading, history untouched", () => {
  const old = cleanStore(emptyStore());
  delete old.gyms.main.pullUpsMoved;
  old.gyms.main.equipment["pull-up"].group = "legs";
  const s = cleanStore(old);
  assert.equal(s.gyms.main.equipment["pull-up"].group, "arms");
  assert.equal(s.gyms.main.pullUpsMoved, true);
  assert.equal(cleanStore(s).gyms.main.equipment["pull-up"].group, "arms");
});

test("a gym added later is marked and copies the pull-up as it is", () => {
  const { store, id } = addGym(emptyStore(), "Hotel", { from: "main", ids: ["pull-up"] });
  assert.equal(store.gyms[id].pullUpsMoved, true);
  assert.equal(store.gyms[id].equipment["pull-up"].group, "arms");
  assert.equal(cleanStore(store).gyms[id].equipment["pull-up"].group, "arms");
});

test("on a legs day the pull-up still counts as the session's own for supersets", () => {
  const all = [
    { id: "leg-press", name: "Leg Press", group: "legs" }, { id: "pull-up", name: "Pull-ups", group: "arms" },
    { id: "bicep-curl", name: "Bicep Curl", group: "arms" },
  ];
  let p = emptyPairs();
  for (const e of all) p = setSuitable(p, e.id, true);
  const without = pairCandidates({ ex: all[0], all, prefs: p });
  assert.ok(without.other.some((e) => e.id === "pull-up"));
  const withAny = pairCandidates({ ex: all[0], all, prefs: p, anyDay: ["pull-up"] });
  assert.ok(withAny.rest.some((e) => e.id === "pull-up"));
  assert.ok(withAny.other.some((e) => e.id === "bicep-curl"));
});
