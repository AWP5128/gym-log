import test from "node:test";
import assert from "node:assert/strict";
import {
  newGym, makeItem, addItem, updateItem, hideItem, restoreItem, exerciseList, toExercise, copyEquipment,
  dumbbellBands, dumbbellWeights, barbellWeights, makeWeightSet, defaultWeightSets, ensureWeightSets,
  updateWeightSet, setWeightSetUnit, weightSetUsers, weightSetUnitLocked, seedStarterFree, STARTER_FREE,
  extraList, setIdFor,
} from "./gym.js";
import { buildPins } from "./stacks.js";
import { weightOptions, idsWithHistory } from "./log.js";
import { emptyStore, cleanStore, addGym, exportMachines, DEFAULT_GYM } from "./store.js";

test("the usual dumbbell weights match the stack builder, and barbell weights go up in tens", () => {
  assert.deepEqual(dumbbellWeights("kg"), buildPins(dumbbellBands("kg")).pins);
  assert.deepEqual(dumbbellWeights("lb"), buildPins(dumbbellBands("lb")).pins);
  assert.deepEqual(barbellWeights("kg").slice(0, 4), [10, 20, 30, 40]);
  assert.equal(barbellWeights("kg").at(-1), 200);
  assert.equal(barbellWeights("lb").at(-1), 450);
  assert.deepEqual(barbellWeights("kg", 35), [10, 20, 30]);
  for (const unit of ["kg", "lb"]) assert.deepEqual(extraList("barbell", unit), [2.5, 5, 7.5]);
  assert.equal(setIdFor("dumbbell"), "dumbbells");
  assert.equal(setIdFor("barbell"), "barbell");
  assert.equal(setIdFor("stack"), null);
});

test("makeWeightSet starts with the usual weights and tidies what it is given", () => {
  const d = makeWeightSet({ type: "dumbbell", unit: "lb" });
  assert.equal(d.name, "Dumbbells");
  assert.equal(d.unit, "lb");
  assert.deepEqual(d.pins, dumbbellWeights("lb"));
  assert.deepEqual(d.stackSpec, dumbbellBands("lb"));
  const custom = makeWeightSet({ type: "dumbbell", unit: "kg", pins: [20, 10, 10, 0, 15] });
  assert.deepEqual(custom.pins, [10, 15, 20]);
  assert.equal(custom.stackSpec, undefined);
  const b = makeWeightSet({ type: "barbell", unit: "kg" });
  assert.equal(b.name, "Barbell");
  assert.equal(b.top, 200);
  assert.deepEqual(b.pins, barbellWeights("kg"));
  assert.equal(makeWeightSet({ type: "barbell", unit: "lb", top: 100 }).pins.at(-1), 100);
  assert.equal(makeWeightSet({ type: "nonsense", unit: "bad" }).type, "dumbbell");
  assert.deepEqual(makeWeightSet(makeWeightSet(d)), d);   // tidying twice changes nothing
});

test("a new gym has a dumbbell set and a barbell set in its own units", () => {
  const g = newGym("G", { dumbbell: "lb" });
  assert.deepEqual(Object.keys(g.weightSets), ["dumbbells", "barbell"]);
  assert.equal(g.weightSets.dumbbells.unit, "lb");
  assert.equal(g.weightSets.barbell.unit, "kg");
  assert.deepEqual(defaultWeightSets().dumbbells.pins, dumbbellWeights("kg"));
});

test("items that use a set take its unit and weights, and exercises pick from the list", () => {
  let g = newGym("G", { dumbbell: "lb" });
  const r = addItem(g, { name: "Dumbbell Curl", group: "arms", type: "dumbbell" });
  g = r.gym;
  assert.equal(g.equipment[r.id].weightSet, "dumbbells");
  assert.equal(g.equipment[r.id].unit, "lb");
  const ex = exerciseList(g)[0];
  assert.equal(ex.unit, "lb");
  assert.deepEqual(ex.pins, dumbbellWeights("lb"));
  assert.deepEqual(weightOptions(ex), dumbbellWeights("lb"));
  assert.equal(weightOptions(ex, 12.5).includes(12.5), true);       // the current weight is always offered
  g = updateWeightSet(g, "dumbbells", { pins: [5, 10, 12.5, 20] });
  assert.deepEqual(exerciseList(g)[0].pins, [5, 10, 12.5, 20]);     // change the set once, every exercise follows
  const bar = addItem(g, { name: "Barbell Squat", group: "legs", type: "barbell" });
  const sq = exerciseList(bar.gym).find((e) => e.name === "Barbell Squat");
  assert.equal(sq.weightSet, "barbell");
  assert.deepEqual(sq.extras, [2.5, 5, 7.5]);
  assert.equal(sq.pins[0], 10);
  // Asking for a different unit than the set's leaves the item on its own.
  const own = addItem(g, { name: "Metric bells", group: "arms", type: "dumbbell", unit: "kg" });
  assert.equal(own.gym.equipment[own.id].weightSet, undefined);
  assert.equal(own.gym.equipment[own.id].unit, "kg");
  // toExercise still works without sets.
  assert.equal(toExercise("x", makeItem({ name: "X", type: "dumbbell", weightSet: "dumbbells" })).unit, "kg");
});

test("ensureWeightSets builds missing sets from existing items, links matching items and is repeatable", () => {
  const old = {
    name: "Old", units: { stack: "lb", dumbbell: "lb", barbell: "kg", plate: "kg", bodyweight: "kg" },
    equipment: {
      fh: makeItem({ name: "Farmers Hold", type: "dumbbell", unit: "kg", pins: [8, 4, 12], stackSpec: { low: 4 } }),
      dl: makeItem({ name: "Deadlift", type: "barbell", unit: "kg" }),
      lb: makeItem({ name: "Lb bells", type: "dumbbell", unit: "lb" }),
      lp: makeItem({ name: "Leg Press", type: "stack" }),
    },
  };
  const g = ensureWeightSets(old);
  assert.equal(g.weightSets.dumbbells.unit, "kg");                  // from the first dumbbell item, not the gym default
  assert.deepEqual(g.weightSets.dumbbells.pins, [4, 8, 12]);        // and it keeps that item's weight list
  assert.deepEqual(g.weightSets.dumbbells.stackSpec, { low: 4 });
  assert.equal(g.equipment.fh.weightSet, "dumbbells");
  assert.equal(g.equipment.dl.weightSet, "barbell");
  assert.equal(g.equipment.lb.weightSet, undefined);                // a different unit is left alone
  assert.equal(g.equipment.lp.weightSet, undefined);
  assert.deepEqual(g.equipment.lb.unit, "lb");
  assert.deepEqual(ensureWeightSets(g), g);
  assert.deepEqual(weightSetUsers(g, "dumbbells"), ["fh"]);
  const blank = ensureWeightSets({ name: "B", units: {}, equipment: {} });
  assert.deepEqual(blank.weightSets, defaultWeightSets());
});

test("the starter exercises are added once to a gym with equipment, and never to an empty or new gym", () => {
  const ids = STARTER_FREE.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(STARTER_FREE.every((s) => ["dumbbell", "barbell"].includes(s.type) && ["legs", "arms", "abs"].includes(s.group)));
  const base = ensureWeightSets(newGym("G", {}, { lp: makeItem({ name: "Leg Press" }), "barbell-curl": makeItem({ name: "My curl", type: "barbell" }) }));
  const g = seedStarterFree(base);
  assert.equal(g.starterFree, true);
  assert.equal(Object.keys(g.equipment).length, 2 + STARTER_FREE.length - 1);   // an id the gym already has is left alone
  assert.equal(g.equipment["barbell-curl"].name, "My curl");
  assert.equal(g.equipment["dumbbell-curl"].weightSet, "dumbbells");
  assert.equal(g.equipment["dumbbell-curl"].unit, g.weightSets.dumbbells.unit);
  assert.equal(g.equipment["weighted-crunch"].group, "abs");
  assert.equal(seedStarterFree(g), g);
  assert.equal(Object.keys(seedStarterFree(newGym("Empty")).equipment).length, 0);
  assert.equal(seedStarterFree(newGym("Empty")).starterFree, true);
  assert.equal(exerciseList(hideItem(g, "dumbbell-curl")).some((e) => e.id === "dumbbell-curl"), false);
});

test("a set's weights can be edited, reset and given a new top weight", () => {
  const g = newGym("G");
  const edited = updateWeightSet(g, "dumbbells", { pins: [20, 5, 10, 10], name: "  Home bells " });
  assert.deepEqual(edited.weightSets.dumbbells.pins, [5, 10, 20]);
  assert.equal(edited.weightSets.dumbbells.name, "Home bells");
  assert.deepEqual(updateWeightSet(edited, "dumbbells", { pins: [] }).weightSets.dumbbells.pins, dumbbellWeights("kg"));
  const top = updateWeightSet(g, "barbell", { top: 100 });
  assert.equal(top.weightSets.barbell.top, 100);
  assert.equal(top.weightSets.barbell.pins.at(-1), 100);
  assert.deepEqual(updateWeightSet(g, "barbell", { top: 5 }).weightSets.barbell.pins, barbellWeights("kg"));   // too low: ignored
  assert.equal(updateWeightSet(g, "missing", { name: "x" }), g);
  assert.equal(g.weightSets.dumbbells.pins.length, dumbbellWeights("kg").length);     // the original gym is unchanged
});

test("a set's unit can change only while no exercise using it has history at the gym", () => {
  let g = newGym("G");
  g = addItem(g, { name: "Curl", group: "arms", type: "dumbbell" }).gym;
  g = addItem(g, { name: "Press", group: "arms", type: "dumbbell" }).gym;
  const none = new Set();
  const used = idsWithHistory([{ exerciseId: "curl", weight: 10, reps: 8, gymId: "main", unit: "kg" }], "main");
  assert.equal(weightSetUnitLocked(g, "dumbbells", none), false);
  assert.equal(weightSetUnitLocked(g, "dumbbells", used), true);
  assert.equal(weightSetUnitLocked(g, "barbell", used), false);
  const blocked = setWeightSetUnit(g, "dumbbells", "lb", used);
  assert.deepEqual([blocked.ok, blocked.reason], [false, "history"]);
  assert.equal(blocked.gym, g);
  const same = setWeightSetUnit(g, "dumbbells", "kg", none);
  assert.deepEqual([same.ok, same.reason], [false, "same"]);
  assert.equal(setWeightSetUnit(g, "nope", "lb", none).reason, "missing");
  const done = setWeightSetUnit(g, "dumbbells", "lb", none);
  assert.equal(done.ok, true);
  assert.equal(done.gym.weightSets.dumbbells.unit, "lb");
  assert.deepEqual(done.gym.weightSets.dumbbells.pins, dumbbellWeights("lb"));
  assert.equal(done.gym.equipment.curl.unit, "lb");
  assert.equal(done.gym.equipment.press.unit, "lb");
  assert.equal(g.weightSets.dumbbells.unit, "kg");
});

test("copying a dumbbell exercise to another gym uses that gym's own dumbbells", () => {
  let from = newGym("A", { dumbbell: "kg" });
  from = addItem(from, { name: "Curl", group: "arms", type: "dumbbell" }).gym;
  from = updateWeightSet(from, "dumbbells", { pins: [5, 10, 15] });
  const to = newGym("B", { dumbbell: "lb" });
  const r = copyEquipment(from, ["curl"], to);
  assert.equal(r.copied, 1);
  assert.equal(r.gym.equipment.curl.weightSet, "dumbbells");
  assert.equal(r.gym.equipment.curl.unit, "lb");                       // it takes the other gym's unit
  assert.deepEqual(r.gym.weightSets.dumbbells.pins, dumbbellWeights("lb"));   // and the other gym's weights
  assert.equal(exerciseList(r.gym)[0].unit, "lb");
  // A gym with no sets at all (saved before weight sets) gets a copy of the set.
  const bare = { name: "C", units: {}, equipment: {} };
  const r2 = copyEquipment(from, ["curl"], bare);
  assert.deepEqual(r2.gym.weightSets.dumbbells.pins, [5, 10, 15]);
  assert.notEqual(r2.gym.weightSets.dumbbells, from.weightSets.dumbbells);
});

test("an old store is upgraded: sets and starter exercises appear, nothing is lost, and it is repeatable", () => {
  const fresh = emptyStore();
  const gym = fresh.gyms[DEFAULT_GYM];
  const oldGym = { name: gym.name, units: gym.units, equipment: Object.fromEntries(Object.entries(gym.equipment).filter(([id]) => !STARTER_FREE.some((s) => s.id === id))) };
  oldGym.equipment["farmers-hold"] = { ...oldGym.equipment["farmers-hold"], pins: [6, 12], hidden: true };
  const old = { ...fresh, gyms: { [DEFAULT_GYM]: oldGym } };
  const once = cleanStore(old);
  const g = once.gyms[DEFAULT_GYM];
  assert.equal(g.weightSets.dumbbells.unit, "kg");
  assert.deepEqual(g.weightSets.dumbbells.pins, [6, 12]);
  assert.equal(g.equipment["farmers-hold"].weightSet, "dumbbells");
  assert.equal(g.equipment["farmers-hold"].hidden, true);
  assert.equal(g.equipment.deadlift.weightSet, "barbell");
  assert.equal(g.equipment["leg-press"].weightSet, undefined);
  assert.ok(STARTER_FREE.every((s) => g.equipment[s.id]));
  assert.equal(g.starterFree, true);
  assert.deepEqual(cleanStore(once), once);
  // A hidden starter exercise stays hidden, and bringing it back works.
  const hidden = { ...once, gyms: { [DEFAULT_GYM]: hideItem(g, "dumbbell-curl") } };
  const again = cleanStore(hidden).gyms[DEFAULT_GYM];
  assert.equal(again.equipment["dumbbell-curl"].hidden, true);
  assert.equal(restoreItem(again, "dumbbell-curl").equipment["dumbbell-curl"].hidden, undefined);
});

test("a new gym never gets the starter exercises, even after the store is read back", () => {
  const s = emptyStore();
  const blank = addGym(s, "Holiday");
  assert.equal(blank.store.gyms[blank.id].starterFree, true);
  const copy = addGym(blank.store, "Home", { from: DEFAULT_GYM, ids: ["leg-press", "dumbbell-curl"] });
  assert.equal(copy.copied, 2);
  const read = cleanStore(copy.store);
  assert.equal(Object.keys(read.gyms[blank.id].equipment).length, 0);
  assert.deepEqual(Object.keys(read.gyms[copy.id].equipment).sort(), ["dumbbell-curl", "leg-press"]);
  assert.equal(read.gyms[copy.id].equipment["dumbbell-curl"].weightSet, "dumbbells");
  assert.deepEqual(Object.keys(read.gyms[copy.id].weightSets), ["dumbbells", "barbell"]);
});

test("the machines file does not list the starter exercises or the weights that belong to a set", () => {
  const s = emptyStore();
  assert.deepEqual(JSON.parse(exportMachines(s, DEFAULT_GYM)).machines, {});
  const renamed = updateItem(s.gyms[DEFAULT_GYM], "dumbbell-curl", { name: "DB Curl" });
  const out = JSON.parse(exportMachines({ ...s, gyms: { [DEFAULT_GYM]: renamed } }, DEFAULT_GYM)).machines;
  assert.deepEqual(out, { "dumbbell-curl": { name: "DB Curl" } });
});