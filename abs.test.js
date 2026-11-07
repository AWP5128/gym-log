import test from "node:test";
import assert from "node:assert/strict";
import { STARTER_ABS, seedStarterAbs, newGym, makeItem, hideItem, exerciseList, checkName } from "./gym.js";
import { emptyStore, cleanStore, addGym, exportMachines, importMachines } from "./store.js";
import { muscleOf, muscleLabel, MUSCLES, DEFAULT_MUSCLE } from "./superset.js";

test("the starter abs exercises: ids are unique and all are in the abs session", () => {
  const ids = STARTER_ABS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(STARTER_ABS.every((s) => s.group === "abs" && ["bodyweight", "stack"].includes(s.type)));
  for (const want of ["leg-overs", "hurdle-tucks", "crunch", "leg-raise"]) assert.ok(ids.includes(want), want);
});

test("each starter abs exercise has a muscle region, and the three regions exist", () => {
  for (const s of STARTER_ABS) assert.ok(["upper-abs", "lower-abs", "obliques"].includes(DEFAULT_MUSCLE[s.id]), s.id);
  assert.equal(muscleLabel("upper-abs"), "Upper abs");
  assert.equal(muscleLabel("lower-abs"), "Lower abs");
  assert.equal(muscleLabel("obliques"), "Obliques");
  assert.ok(MUSCLES.abs);   // an exercise already set to plain Abs keeps working
  assert.equal(muscleOf({ id: "x", name: "x", muscle: "abs" }), "abs");
});

test("the dumbbell abs exercises now have regions too", () => {
  assert.equal(muscleOf({ id: "weighted-crunch" }), "upper-abs");
  assert.equal(muscleOf({ id: "russian-twist" }), "obliques");
  assert.equal(muscleOf({ id: "dumbbell-side-bend" }), "obliques");
});

test("an exercise you add gets a region guessed from its name", () => {
  const g = (name) => muscleOf({ id: "mine-" + name, name });
  assert.equal(g("Reverse Crunch"), "lower-abs");
  assert.equal(g("Hanging Knee Raise"), "lower-abs");
  assert.equal(g("Cable Crunch"), "upper-abs");
  assert.equal(g("Woodchop Twist"), "obliques");
  assert.equal(g("Windscreen Wipers Oblique"), "obliques");
  assert.equal(g("Plank"), "abs");
  assert.equal(g("Seated Hamstring Curl"), "hamstrings");   // the new patterns do not catch other exercises
  assert.equal(g("Bicep Curl"), "biceps");
});

test("a gym that already has equipment gets the abs exercises once", () => {
  const gym = { ...newGym("Old", {}, { "leg-press": makeItem({ name: "Leg Press Machine", group: "legs", type: "stack" }) }) };
  const seeded = seedStarterAbs(gym);
  assert.equal(seeded.starterAbs, true);
  assert.equal(Object.keys(seeded.equipment).length, 1 + STARTER_ABS.length);
  assert.equal(seeded.equipment["leg-overs"].name, "Leg-overs");
  assert.equal(seeded.equipment["leg-overs"].type, "bodyweight");
  assert.equal(seeded.equipment["ab-crunch-machine"].type, "stack");
  // not added a second time, even when one has been hidden
  const hidden = hideItem(seeded, "leg-overs");
  const again = seedStarterAbs(hidden);
  assert.equal(Object.keys(again.equipment).length, 1 + STARTER_ABS.length);
  assert.ok(again.equipment["leg-overs"].hidden);
});

test("an id the gym already has is left alone; an empty gym is only marked", () => {
  const mine = makeItem({ name: "My crunch", group: "abs", type: "bodyweight" });
  const g = seedStarterAbs(newGym("G", {}, { crunch: mine }));
  assert.equal(g.equipment.crunch.name, "My crunch");
  const empty = seedStarterAbs(newGym("Empty"));
  assert.equal(empty.starterAbs, true);
  assert.equal(Object.keys(empty.equipment).length, 0);
});

test("the first gym starts with the abs exercises; a gym you add does not", () => {
  const store = emptyStore();
  const gym = store.gyms[store.currentGym];
  assert.ok(STARTER_ABS.every((s) => gym.equipment[s.id]));
  const added = addGym(store, "Hotel gym");
  assert.equal(added.store.gyms[added.id].starterAbs, true);
  assert.equal(Object.keys(added.store.gyms[added.id].equipment).length, 0);
});

test("an older store without the abs flag gets them on load, once, and a hidden one stays hidden", () => {
  const store = emptyStore();
  const gym = { ...store.gyms[store.currentGym] };
  delete gym.starterAbs;
  gym.equipment = Object.fromEntries(Object.entries(gym.equipment).filter(([id]) => !STARTER_ABS.some((s) => s.id === id)));
  const old = { ...store, gyms: { ...store.gyms, [store.currentGym]: gym } };
  const loaded = cleanStore(JSON.parse(JSON.stringify(old)));
  const g = loaded.gyms[store.currentGym];
  assert.ok(STARTER_ABS.every((s) => g.equipment[s.id]));
  assert.equal(g.starterAbs, true);
  const hidden = { ...loaded, gyms: { ...loaded.gyms, [store.currentGym]: hideItem(g, "hurdle-tucks") } };
  const again = cleanStore(JSON.parse(JSON.stringify(hidden))).gyms[store.currentGym];
  assert.ok(again.equipment["hurdle-tucks"].hidden);
  assert.equal(Object.keys(again.equipment).length, Object.keys(g.equipment).length);
});

test("the abs session lists them, the less common ones behind the usual button, hidden ones not at all", () => {
  const gym = emptyStore().gyms.main;
  const list = exerciseList(gym).filter((e) => e.group === "abs");
  assert.ok(list.some((e) => e.id === "hurdle-tucks" && e.common));
  assert.ok(list.some((e) => e.id === "sit-up" && !e.common));
  const gone = exerciseList(hideItem(gym, "hurdle-tucks")).filter((e) => e.group === "abs");
  assert.ok(!gone.some((e) => e.id === "hurdle-tucks"));
  assert.equal(checkName(gym, "Hurdle Tucks").reason, "duplicate");
});

test("the machines file does not list the untouched abs exercises as changes", () => {
  const store = emptyStore();
  const data = JSON.parse(exportMachines(store, store.currentGym));
  for (const s of STARTER_ABS) assert.ok(!(s.id in data.machines), s.id);
  const back = importMachines(store, store.currentGym, JSON.stringify(data));
  assert.equal(back.error, "");
});
