import test from "node:test";
import assert from "node:assert/strict";
import {
  toMetres, fromMetres, describeDistance, makeMinutes, splitMinutes, describeTime, speedKmh, describeSpeed, describeWatts,
  makeCardioSet, todaysEntries, describeEntry, entryBoxes, cardioBests, newCardioBests, bestLines, newBestLines, isCardioSet,
  clockText, startFromText, endOf, chooseDuration, chooseStart,
} from "./cardio.js";
import { startWorkout, runMachines, machineStart, machineElapsed, cleanWorkout } from "./timer.js";
import {
  STARTER_CARDIO, seedStarterCardio, newGym, makeItem, setDefaultUnit, editItem, exerciseList, listKindOf, hideItem, TYPES,
} from "./gym.js";
import { emptyStore, addGym, cleanStore } from "./store.js";
import { migrateToV4, fromV4, checkV4 } from "./schema4.js";
import { removeLastSet, setsForGym } from "./log.js";

const canon = (v) => JSON.stringify(v);
const at = (iso) => new Date(iso);

test("distances are saved in metres and shown in km, miles and metres", () => {
  assert.equal(toMetres(12.5, "km"), 12500);
  assert.equal(toMetres(2000, "m"), 2000);
  assert.equal(toMetres(1, "mi"), 1609.3);
  assert.equal(fromMetres(12500, "km"), 12.5);
  assert.equal(fromMetres(2000, "m"), 2000);
  assert.equal(fromMetres(1609.3, "mi"), 1);
  assert.equal(describeDistance(12500, "km"), "12.50 km (7.77 mi)");
  assert.equal(describeDistance(2000, "m"), "2000 m");
});

test("time is typed as minutes and seconds", () => {
  assert.equal(makeMinutes(32, 20), 32.3333);
  assert.equal(makeMinutes(null, 45), 0.75);
  assert.equal(makeMinutes(20, null), 20);
  assert.equal(makeMinutes(null, null), null);
  assert.deepEqual(splitMinutes(32.3333), { min: 32, sec: 20 });
  assert.deepEqual(splitMinutes(null), { min: 0, sec: 0 });
  assert.equal(describeTime(32.3333), "32 min 20 s");
  assert.equal(describeTime(20), "20 min");
});

test("speed is km/h from metres and minutes, with mph in brackets", () => {
  assert.equal(speedKmh(10000, 30), 20);
  assert.equal(speedKmh(0, 30), null);
  assert.equal(speedKmh(2000, 0), null);
  assert.equal(describeSpeed(20), "20.00 km/h (12.43 mph)");
  assert.equal(describeWatts(150.4), "150 W");
});

test("an entry keeps metres, and watts only when given", () => {
  const a = makeCardioSet({ exerciseId: "stationary-bike", minutes: 30, distance: 12.5, unit: "km", watts: 150, gymId: "main", now: at("2026-11-14T09:00:00Z") });
  assert.equal(a.distance, 12500);
  assert.equal(a.watts, 150);
  assert.equal(a.weight, undefined);
  assert.ok(isCardioSet(a));
  const b = makeCardioSet({ exerciseId: "rowing-machine", minutes: 8, distance: 2000, unit: "m", watts: NaN, gymId: "main", now: at("2026-11-14T09:00:00Z") });
  assert.equal(b.distance, 2000);
  assert.ok(!("watts" in b));
  const clock = (iso) => clockText(new Date(iso));
  assert.equal(describeEntry(a, "km"), clock(a.start) + "-" + clock(a.end) + " · 30 min · 12.50 km (7.77 mi) · 25.00 km/h (15.53 mph) · 150 W");
  assert.deepEqual(entryBoxes(a, "km"), { min: 30, sec: 0, distance: 12.5, watts: 150, startText: clock(a.start) });
  assert.equal(entryBoxes(a, "mi").distance, 7.77);
  const bare = { exerciseId: "x", time: a.time, minutes: 30, distance: 12500, watts: 150 };   // an entry from before step 33
  assert.equal(describeEntry(bare, "km"), "30 min · 12.50 km (7.77 mi) · 25.00 km/h (15.53 mph) · 150 W");
  assert.deepEqual(entryBoxes(bare, "km"), { min: 30, sec: 0, distance: 12.5, watts: 150 });
});

test("bests are per machine: speed and watts, best here and best ever", () => {
  const now = at("2026-11-14T12:00:00Z");
  const e = (id, gym, min, km, w, day) => makeCardioSet({ exerciseId: id, minutes: min, distance: km, unit: "km", watts: w, gymId: gym, now: at("2026-11-" + day + "T09:00:00Z") });
  const all = [e("stationary-bike", "main", 30, 12, 140, "01"), e("stationary-bike", "other", 30, 15, undefined, "02"), e("cross-trainer", "main", 30, 20, 300, "03")];
  const b = cardioBests(all, "stationary-bike", "main");
  assert.equal(b.gym.speed, 24);
  assert.equal(b.ever.speed, 30);
  assert.equal(b.gym.watts, 140);
  assert.equal(b.ever.watts, 140);   // the cross trainer's 300 W never counts for the bike
  assert.deepEqual(cardioBests(all, "rowing-machine", "main"), { gym: { speed: null, watts: null }, ever: { speed: null, watts: null } });
  // new entries
  const fast = e("stationary-bike", "main", 30, 16, 120, "04");
  assert.deepEqual(newCardioBests(b, fast), { speed: "ever", watts: null });
  const hereOnly = e("stationary-bike", "main", 30, 13, 160, "04");
  assert.deepEqual(newCardioBests(b, hereOnly), { speed: "gym", watts: "ever" });
  const none = e("stationary-bike", "main", 30, 10, undefined, "04");
  assert.deepEqual(newCardioBests(b, none), { speed: null, watts: null });
  // the very first entry never counts
  assert.deepEqual(newCardioBests(cardioBests([], "stationary-bike", "main"), fast), { speed: null, watts: null });
  assert.deepEqual(newBestLines({ speed: "ever", watts: "gym" }), ["New best speed ever", "New best watts here"]);
  assert.deepEqual(bestLines(b).map((l) => l[0]), ["Best speed here", "Best speed ever", "Best watts here and ever"]);
  assert.deepEqual(bestLines(b, false).map((l) => l[0]), ["Best speed here", "Best speed ever"]);
});

test("today's entries and Undo", () => {
  const now = new Date();
  const a = makeCardioSet({ exerciseId: "cross-trainer", minutes: 20, distance: 5, unit: "km", gymId: "main", now });
  const old = makeCardioSet({ exerciseId: "cross-trainer", minutes: 20, distance: 5, unit: "km", gymId: "main", now: new Date(now - 3 * 86400000) });
  assert.equal(todaysEntries([old, a], "cross-trainer").length, 1);
  assert.deepEqual(removeLastSet([old, a], "cross-trainer", "main"), [old]);
});

test("the starter cardio machines: three, hideable, added once, never to a new gym", () => {
  assert.deepEqual(STARTER_CARDIO.map((s) => s.id), ["cross-trainer", "stationary-bike", "rowing-machine"]);
  const s = cleanStore(emptyStore());
  const g = s.gyms.main;
  assert.equal(g.starterCardio, true);
  assert.equal(g.equipment["rowing-machine"].unit, "m");
  assert.equal(g.equipment["stationary-bike"].unit, "km");
  assert.ok(STARTER_CARDIO.every((x) => g.equipment[x.id].type === "cardio" && g.equipment[x.id].group === "cardio"));
  assert.equal(listKindOf(g.equipment["stationary-bike"]), "machines");
  assert.equal(exerciseList(g).filter((e) => e.group === "cardio").length, 3);
  assert.equal(exerciseList(hideItem(g, "stationary-bike")).filter((e) => e.group === "cardio").length, 2);
  assert.deepEqual(seedStarterCardio(g), g);   // running it again changes nothing
  const added = addGym(s, "Hotel");
  const hotel = added.store.gyms[added.id];
  assert.equal(hotel.starterCardio, true);
  assert.equal(Object.keys(hotel.equipment).length, 0);
  // an existing gym without the flag gets them once, in the gym's own unit
  const old = { ...newGym("Old", { cardio: "mi" }, { x: makeItem({ name: "X", group: "legs", type: "stack" }) }) };
  const seeded = seedStarterCardio(old);
  assert.equal(seeded.equipment["stationary-bike"].unit, "mi");
  assert.equal(seeded.equipment["rowing-machine"].unit, "m");
  assert.equal(seedStarterCardio({ ...newGym("Empty") }).starterCardio, true);
  assert.equal(Object.keys(seedStarterCardio(newGym("Empty")).equipment).length, 0);
});

test("watts can be switched off per machine, and the gym's cardio unit moves km and miles machines only", () => {
  const g = cleanStore(emptyStore()).gyms.main;
  assert.equal(g.equipment["cross-trainer"].watts, undefined);   // on by default
  const off = editItem(g, "cross-trainer", { name: "Cross Trainer", watts: false });
  assert.equal(off.ok, true);
  assert.equal(off.gym.equipment["cross-trainer"].watts, false);
  const on = editItem(off.gym, "cross-trainer", { name: "Cross Trainer", watts: true });
  assert.equal(on.gym.equipment["cross-trainer"].watts, undefined);
  const mi = setDefaultUnit(g, "cardio", "mi");
  assert.equal(mi.units.cardio, "mi");
  assert.equal(mi.equipment["stationary-bike"].unit, "mi");
  assert.equal(mi.equipment["rowing-machine"].unit, "m");
  assert.equal(setDefaultUnit(g, "cardio", "lb"), g);   // not a distance unit
  assert.equal(setDefaultUnit(g, "stack", "km"), g);
});

test("a cardio unit can change even with history, because distances are metres", () => {
  const g = cleanStore(emptyStore()).gyms.main;
  const history = new Set(["stationary-bike"]);
  const r = editItem(g, "stationary-bike", { name: "Stationary Bike", unit: "mi" }, history);
  assert.equal(r.ok, true);
  assert.equal(r.gym.equipment["stationary-bike"].unit, "mi");
  const t = editItem(g, "stationary-bike", { name: "Stationary Bike", type: "stack" }, history);   // a type change still needs no history
  assert.equal(t.reason, "history");
  assert.ok(TYPES.some((x) => x.id === "cardio"));
});

test("cardio entries and the watts switch survive the version 4 tables and back", () => {
  let store = cleanStore(emptyStore());
  store = { ...store, gyms: { ...store.gyms, main: editItem(store.gyms.main, "cross-trainer", { name: "Cross Trainer", watts: false }).gym } };
  const e1 = makeCardioSet({ exerciseId: "stationary-bike", minutes: 30.5, distance: 12.5, unit: "km", watts: 150, gymId: "main", now: at("2026-11-14T09:00:00Z") });
  const e2 = makeCardioSet({ exerciseId: "rowing-machine", minutes: 8, distance: 2000, unit: "m", gymId: "main", now: at("2026-11-14T09:40:00Z") });
  const sets = [{ exerciseId: "leg-press", time: "2026-11-14T08:00:00.000Z", weight: 100, reps: 5, gymId: "main", unit: "lb", mode: "heavy" }, e1, e2];
  const r = migrateToV4({ store, sets });
  assert.equal(r.ok, true);
  const we = r.v4.tables.workout_exercise.find((w) => w.exerciseId === "stationary-bike");
  assert.equal(we.distance, 12500);
  assert.equal(we.watts, 150);
  assert.equal(r.v4.tables.workout_exercise.find((w) => w.exerciseId === "leg-press").distance, null);
  assert.equal(r.v4.tables.workout_type.some((w) => w.exerciseTypeId === "cardio"), true);
  const back = fromV4(r.v4);
  assert.deepEqual(back.sets, sets);
  assert.equal(back.store.gyms.main.equipment["cross-trainer"].watts, false);
  assert.equal(back.store.gyms.main.starterCardio, true);
  assert.equal(checkV4({ store, sets }).ok, true);
});

// ---------- Step 33: start, duration and end ----------
test("the Start box reads a time as today, or yesterday when it is later than now", () => {
  const now = new Date(2026, 10, 14, 8, 0);
  assert.equal(clockText(startFromText("07:05", now)), "07:05");
  assert.equal(startFromText("07:05", now).getDate(), 14);
  assert.equal(startFromText("23:50", now).getDate(), 13);   // before midnight
  assert.equal(startFromText("7:5", now), null);
  assert.equal(startFromText("25:00", now), null);
  assert.equal(startFromText("", now), null);
  assert.equal(clockText(new Date(2026, 10, 14, 9, 5)), "09:05");
});

test("the duration is the clock unless the user typed one; the start is the clock's first start unless edited", () => {
  assert.deepEqual(chooseDuration(null, null, 1_935_000), { minutes: 32.25, source: "timer" });
  assert.deepEqual(chooseDuration(30, null, 1_935_000), { minutes: 30, source: "typed" });
  assert.deepEqual(chooseDuration(null, 45, 0), { minutes: 0.75, source: "typed" });
  assert.equal(chooseDuration(null, null, 400), null);   // under a second and nothing typed
  assert.equal(chooseDuration(0, 0, 0), null);
  const now = new Date(2026, 10, 14, 8, 0);
  const first = new Date(2026, 10, 14, 7, 10).getTime();
  assert.equal(chooseStart({ text: undefined, timerStart: first, minutes: 30, now }).getTime(), first);
  assert.equal(clockText(chooseStart({ text: "07:00", timerStart: first, minutes: 30, now })), "07:00");   // an edit wins
  assert.equal(chooseStart({ text: "nope", timerStart: first, minutes: 30, now }), null);
  assert.equal(chooseStart({ text: undefined, timerStart: null, minutes: 30, now }).getTime(), now.getTime() - 30 * 60000);
  assert.equal(endOf(new Date(first), 32.25).getTime(), first + 1_935_000);
});

test("an entry stores start and end, and end is always start + duration", () => {
  const now = new Date(2026, 10, 14, 8, 0);
  const start = new Date(2026, 10, 14, 7, 10);
  const e = makeCardioSet({ exerciseId: "stationary-bike", minutes: 32.25, distance: 12.5, unit: "km", gymId: "main", start, now });
  assert.equal(e.start, start.toISOString());
  assert.equal(new Date(e.end) - new Date(e.start), 32.25 * 60000);
  assert.equal(e.time, now.toISOString());   // when it was logged
  const forgot = makeCardioSet({ exerciseId: "stationary-bike", minutes: 20, distance: 5, unit: "km", gymId: "main", now });   // no start given
  assert.equal(new Date(forgot.end).getTime(), now.getTime());
});

test("a machine's clock remembers when it first started, across pauses", () => {
  const T0 = new Date(2026, 10, 14, 7, 10).getTime();
  let w = startWorkout(T0 - 5000);
  assert.equal(machineStart(w, "stationary-bike"), null);
  w = runMachines(w, ["stationary-bike"], T0);
  assert.equal(machineStart(w, "stationary-bike"), T0);
  w = runMachines(w, ["cross-trainer"], T0 + 60_000);   // leave the bike
  w = runMachines(w, ["stationary-bike"], T0 + 120_000);   // come back
  assert.equal(machineStart(w, "stationary-bike"), T0);   // still the first start
  assert.equal(machineElapsed(w, "stationary-bike", T0 + 180_000), 120_000);   // 60 s before leaving + 60 s since returning
  const back = cleanWorkout(JSON.parse(JSON.stringify(w)), T0 + 200_000);
  assert.equal(machineStart(back, "stationary-bike"), T0);   // survives being saved and read
  assert.equal(machineStart(cleanWorkout({ start: T0, end: null, machines: { a: { ms: 5, since: null } } }, T0), "a"), null);
});

test("start and end survive the version 4 tables and back; older entries have none", () => {
  const store = cleanStore(emptyStore());
  const start = new Date("2026-11-14T07:10:00.000Z");
  const e1 = makeCardioSet({ exerciseId: "stationary-bike", minutes: 30, distance: 12.5, unit: "km", watts: 150, gymId: "main", start, now: new Date("2026-11-14T07:42:00.000Z") });
  const old = { exerciseId: "cross-trainer", time: "2026-11-13T08:00:00.000Z", minutes: 20, distance: 5000, gymId: "main" };
  const sets = [old, e1];
  const r = migrateToV4({ store, sets });
  assert.equal(r.ok, true);
  const we = r.v4.tables.workout_exercise.find((w) => w.exerciseId === "stationary-bike");
  assert.equal(we.start, "2026-11-14T07:10:00.000Z");
  assert.equal(we.end, "2026-11-14T07:40:00.000Z");
  assert.equal(r.v4.tables.workout_exercise.find((w) => w.exerciseId === "cross-trainer").start, null);
  assert.deepEqual(fromV4(r.v4).sets, sets);
});
