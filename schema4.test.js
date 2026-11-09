import test from "node:test";
import assert from "node:assert/strict";
import { SCHEMA_VERSION, TABLES, migrateToV4, fromV4 } from "./schema4.js";
import { emptyStore, cleanStore, migrateLegacy, addGym, toLegacySettings } from "./store.js";
import { updateItem, hideItem, hideWeightSet, addItem } from "./gym.js";
import { makeSet, bestSet, personalBests } from "./log.js";
import { exercises } from "./exercises.js";

// Key order does not matter, undefined values do not count (as in saved JSON); array order does.
const canon = (v) => {
  const walk = (x) => Array.isArray(x) ? x.map(walk)
    : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => [k, walk(x[k])]))
    : x;
  return JSON.stringify(walk(v));
};

const legacy = {
  exercises: {
    "leg-press": {
      name: "Leg Press", step: 15, pins: [10, 20, 35],
      stackSpec: { low: 10, step: 10, top: 35, changes: [{ at: 20, step: 15 }] },
      notes: "Seat 4",
      startHeavy: 100, startExtraHeavy: 5, warmRepsHeavy: 8, workHeavy: 115, workExtraHeavy: 2.5, repsHeavy: 5, setsHeavy: 4,
      workVolume: 85, repsVolume: 10,
      pbWeight: 200, pbReps: 3,
    },
    "pull-up": { workHeavy: 10, repsHeavy: 5 },
    "chest-press": { notes: "only a note" },
    "custom-x": { name: "X machine", step: 5 },
  },
  custom: [{ id: "custom-x", name: "X", group: "abs", unit: "lb", step: 5, common: true, custom: true }],
  defaults: { repsHeavy: 6, setsVolume: 3, warmRepsHeavy: 10 },
};

// A fuller store: two gyms, a hidden item and a hidden weight set, a muscle, a custom exercise, a second person.
function richStore() {
  let s = migrateLegacy(legacy);
  const a = addGym(s, "Hotel", { from: "main", ids: ["leg-press", "deadlift"] });
  s = a.store;
  let hotel = s.gyms[a.id];
  hotel = updateItem(hotel, "deadlift", { muscle: "glutes" });
  hotel = hideItem(hotel, "leg-press");
  hotel = hideWeightSet(hotel, "dumbbells");
  const added = addItem(hotel, { name: "Cable Row", group: "arms", type: "stack", unit: "kg" });
  s = { ...s, gyms: { ...s.gyms, [a.id]: added.gym } };
  s.people.awp.superset = { pairs: [["bicep-curl", "tricep-extension"]], suitable: ["bicep-curl", "tricep-extension", "pull-up"] };
  s.people.awp.gyms[a.id] = { machines: { "leg-press": { pbWeight: 150, notes: "Hotel seat" } } };
  s.people.sam = { name: "Sam", defaults: { heavy: { reps: 8, sets: 3, warmupReps: 12 } }, gyms: { main: { machines: {} } } };
  s.currentGym = a.id;
  return { s: cleanStore(s), hotelId: a.id };
}

const sets = (gyms) => [
  makeSet({ exerciseId: "leg-press", weight: 100, reps: 8, mode: "heavy", gymId: "main", unit: "lb", now: new Date("2026-11-01T10:00:00Z") }),
  makeSet({ exerciseId: "leg-press", weight: 120, reps: 5, mode: "heavy", gymId: "main", unit: "lb", now: new Date("2026-11-01T10:05:00Z") }),
  makeSet({ exerciseId: "pull-up", weight: 10, reps: 6, mode: "heavy", gymId: "main", unit: "kg", now: new Date("2026-11-01T10:20:00Z") }),
  makeSet({ exerciseId: "bicep-curl", weight: 50, reps: 10, mode: "volume", gymId: "main", unit: "lb", now: new Date("2026-11-03T10:00:00Z") }),
  makeSet({ exerciseId: "leg-press", weight: 90, reps: 9, mode: "heavy", gymId: gyms.hotel, unit: "lb", now: new Date("2026-11-03T12:00:00Z") }),
  makeSet({ exerciseId: "crunch", reps: 20, now: new Date("2026-11-03T12:10:00Z") }),   // an old set: no gym, no mode
  makeSet({ exerciseId: "custom-x", minutes: 12, gymId: "main", now: new Date("2026-11-04T09:00:00Z") }),
];

test("the version and the twelve tables", () => {
  assert.equal(SCHEMA_VERSION, 4);
  assert.equal(TABLES.length, 12);
  const r = migrateToV4({ store: emptyStore() });
  assert.equal(r.ok, true);
  assert.equal(r.v4.version, 4);
  assert.deepEqual(Object.keys(r.v4.tables), TABLES);
});

test("the seeded gym comes across item for item and is small", () => {
  const store = cleanStore(emptyStore());
  const r = migrateToV4({ store, sets: [] });
  assert.equal(r.report.items, Object.keys(store.gyms.main.equipment).length);
  assert.equal(r.report.items, 48);
  assert.equal(canon(fromV4(r.v4).store), canon(store));
  assert.ok(JSON.stringify(r.v4).length < 60000);
});

test("equipment order and the dumbbell and barbell rows are kept", () => {
  const store = cleanStore(emptyStore());
  const r = migrateToV4({ store });
  assert.deepEqual(Object.keys(fromV4(r.v4).store.gyms.main.equipment), Object.keys(store.gyms.main.equipment));
  const sets = r.v4.tables.gym_equipment.filter((e) => e.id.startsWith("set:"));
  assert.deepEqual(sets.map((e) => e.id), ["set:dumbbells", "set:barbell"]);
  assert.ok(sets.every((e) => e.exerciseId === null));
  const curl = r.v4.tables.gym_equipment.find((e) => e.id === "dumbbell-curl");
  assert.equal(curl.uses, "dumbbells");
});

test("a fuller store round trips exactly: notes, stacks, muscle, hidden, pairs, custom, manual best", () => {
  const { s } = richStore();
  const r = migrateToV4({ store: s });
  assert.equal(r.ok, true);
  const back = fromV4(r.v4).store;
  assert.equal(canon(back), canon(s));
  assert.deepEqual(back.people.awp.superset, s.people.awp.superset);
  assert.equal(back.gyms.main.equipment["leg-press"].name, "Leg Press");
  assert.equal(back.gyms[s.currentGym].equipment.deadlift.muscle, "glutes");
  assert.equal(back.gyms[s.currentGym].weightSets.dumbbells.hidden, true);
  assert.equal(back.people.awp.gyms.main.machines["leg-press"].pbWeight, 200);
  assert.equal(back.people.awp.gyms.main.machines["chest-press"].notes, "only a note");
  assert.deepEqual(back.custom, s.custom);
});

test("what the screens read is the same: toLegacySettings for every person and gym", () => {
  const { s } = richStore();
  const back = fromV4(migrateToV4({ store: s }).v4).store;
  for (const p of Object.keys(s.people)) {
    for (const g of Object.keys(s.gyms)) {
      assert.equal(canon(toLegacySettings(back, p, g)), canon(toLegacySettings(s, p, g)), p + " at " + g);
    }
  }
});

test("personal setup is a row per person, machine and day type, with the notes on each", () => {
  const { s } = richStore();
  const rows = migrateToV4({ store: s }).v4.tables.personal_setup.filter((r) => r.exerciseId === "leg-press" && r.gymId === "main");
  assert.deepEqual(rows.map((r) => r.dayType).sort(), ["heavy", "volume"]);
  assert.ok(rows.every((r) => r.notes === "Seat 4"));
  const heavy = rows.find((r) => r.dayType === "heavy");
  assert.deepEqual(heavy.warmup, { weight: 100, extra: 5, reps: 8 });
  assert.deepEqual(heavy.working, { weight: 115, extra: 2.5, reps: 5, sets: 4 });
  const noteOnly = migrateToV4({ store: s }).v4.tables.personal_setup.find((r) => r.exerciseId === "chest-press");
  assert.equal(noteOnly.dayType, null);
});

test("a typed-in best becomes a manual logged set", () => {
  const { s } = richStore();
  const manual = migrateToV4({ store: s }).v4.tables.logged_set.filter((x) => x.manual);
  const m = manual.find((x) => x.exerciseId === "leg-press" && x.gymId === "main");
  assert.equal(m.weight, 200);
  assert.equal(m.reps, 3);
  assert.equal(m.time, null);
});

test("no logged set is lost, and the order, gym and values come back", () => {
  const { s, hotelId } = richStore();
  const list = sets({ hotel: hotelId });
  const r = migrateToV4({ store: s, sets: list });
  assert.equal(r.report.sets, list.length);
  assert.equal(r.report.dropped, 0);
  const back = fromV4(r.v4).sets;
  assert.equal(back.length, list.length);
  list.forEach((orig, i) => {
    assert.equal(back[i].exerciseId, orig.exerciseId);
    assert.equal(back[i].time, orig.time);
    assert.equal(back[i].weight, orig.weight);
    assert.equal(back[i].reps, orig.reps);
    assert.equal(back[i].minutes, orig.minutes);
    assert.equal(back[i].unit, orig.unit);
    assert.equal(back[i].mode, orig.mode);
    assert.equal(back[i].gymId, orig.gymId ?? "main");   // an old set with no gym is the first gym's
  });
});

test("bests are unchanged: here and ever, for every exercise that was logged", () => {
  const { s, hotelId } = richStore();
  const list = sets({ hotel: hotelId });
  const back = fromV4(migrateToV4({ store: s, sets: list }).v4).sets;
  const ids = [...new Set(list.map((x) => x.exerciseId))];
  for (const id of ids) {
    assert.deepEqual(bestSet(back, id), bestSet(list, id), id + " ever");
    for (const gymId of ["main", hotelId]) {
      assert.deepEqual(bestSet(back, id, null, { gymId }), bestSet(list, id, null, { gymId }), id + " at " + gymId);
    }
  }
  const ex = exercises.find((e) => e.id === "leg-press");
  assert.deepEqual(personalBests(back, ex, "main"), personalBests(list, ex, "main"));
});

test("sets are grouped into one workout per gym per day, with a session part for each kind", () => {
  const { s, hotelId } = richStore();
  const v4 = migrateToV4({ store: s, sets: sets({ hotel: hotelId }) }).v4;
  const w = v4.tables.workout;
  // main on 1 Nov, main on 3 Nov (the curl and the old crunch with no gym), the hotel on 3 Nov, main on 4 Nov
  assert.deepEqual(w.map((x) => x.id).sort(), ["main:2026-11-01", "main:2026-11-03", "main:2026-11-04", hotelId + ":2026-11-03"].sort());
  const day3 = v4.tables.workout_exercise.filter((x) => x.id.startsWith("main:2026-11-03")).map((x) => x.exerciseId).sort();
  assert.deepEqual(day3, ["bicep-curl", "crunch"]);
});

test("workout times, session parts and the blank cardio fields", () => {
  const { s } = richStore();
  const list = [
    makeSet({ exerciseId: "leg-press", weight: 100, reps: 8, mode: "heavy", gymId: "main", unit: "lb", now: new Date("2026-11-01T10:00:00Z") }),
    makeSet({ exerciseId: "pull-up", weight: 10, reps: 6, mode: "heavy", gymId: "main", unit: "kg", now: new Date("2026-11-01T10:20:00Z") }),
    makeSet({ exerciseId: "bicep-curl", weight: 50, reps: 10, mode: "heavy", gymId: "main", unit: "lb", now: new Date("2026-11-01T10:40:00Z") }),
  ];
  const t = migrateToV4({ store: s, sets: list }).v4.tables;
  assert.equal(t.workout.length, 1);
  assert.equal(t.workout[0].start, "2026-11-01T10:00:00.000Z");
  assert.equal(t.workout[0].end, "2026-11-01T10:40:00.000Z");
  assert.deepEqual(t.workout_type.map((x) => x.exerciseTypeId).sort(), ["arms", "legs"]);   // leg press is legs; pull-up and curl are arms
  assert.equal(t.workout_exercise.length, 3);
  for (const x of t.workout_exercise) {
    assert.deepEqual([x.distance, x.avgHeartRate, x.zoneMinutes, x.watts, x.level], [null, null, null, null, null]);
  }
  assert.deepEqual(t.exercise.find((e) => e.id === "pull-up").alsoUnder, ["legs"]);
  assert.equal(t.exercise.find((e) => e.id === "pull-up").exerciseTypeId, "arms");
});

test("running it twice, or on its own output, gives the same result", () => {
  const { s, hotelId } = richStore();
  const list = sets({ hotel: hotelId });
  const a = migrateToV4({ store: s, sets: list });
  const b = migrateToV4({ store: s, sets: list });
  assert.equal(canon(a.v4), canon(b.v4));
  const back = fromV4(a.v4);
  const c = migrateToV4({ store: back.store, sets: back.sets });
  assert.equal(canon(c.v4), canon(a.v4));
});

test("there is no store yet: the old settings are used", () => {
  const r = migrateToV4({ store: null, settings: legacy, sets: [] });
  assert.equal(r.ok, true);
  assert.equal(r.report.source, "legacy");
  assert.equal(canon(fromV4(r.v4).store), canon(cleanStore(migrateLegacy(legacy))));
  assert.equal(migrateToV4({ settings: undefined }).report.source, "legacy");
});

test("a version 2 store is upgraded on the way", () => {
  const v2 = { version: 2, currentGym: "main", defaultGym: "main", currentPerson: "awp", custom: [],
    gyms: { main: { name: "My gym", machines: { "leg-press": { name: "LP", step: 15 } } } },
    people: { awp: { name: "Awp", defaults: {}, gyms: { main: { machines: {} } } } } };
  const r = migrateToV4({ store: v2 });
  assert.equal(r.ok, true);
  assert.equal(r.v4.tables.gym_equipment.find((e) => e.id === "leg-press").name, "LP");
});

test("damaged input fails cleanly or is counted, and never throws", () => {
  for (const bad of [{ version: 99 }, "text", 7, [], { version: 3, gyms: 5, people: [] }]) {
    let r;
    assert.doesNotThrow(() => { r = migrateToV4({ store: bad }); });
    if (bad && bad.version === 3) assert.equal(r.ok, true);   // cleanStore tidies a damaged version 3
    else { assert.equal(r.ok, false); assert.ok(r.error.length > 0); assert.equal(r.v4, null); }
  }
  assert.equal(migrateToV4({ store: emptyStore(), sets: "no" }).ok, false);
  const list = [
    makeSet({ exerciseId: "crunch", reps: 5, now: new Date("2026-11-01T10:00:00Z") }),
    { exerciseId: "crunch", time: "not a date" }, { time: "2026-11-01T10:00:00Z" }, null, 5,
  ];
  const r = migrateToV4({ store: emptyStore(), sets: list });
  assert.equal(r.ok, true);
  assert.equal(r.report.sets, 1);
  assert.equal(r.report.dropped, 4);
});

test("a set for an exercise nobody lists still gets a place, and setup for a missing gym is reported", () => {
  const s = emptyStore();
  s.people.awp.gyms.ghost = { machines: { "leg-press": { notes: "x" } } };
  const r = migrateToV4({ store: s, sets: [makeSet({ exerciseId: "gone-id", weight: 5, reps: 5, now: new Date("2026-11-01T10:00:00Z") })] });
  assert.equal(r.report.sets, 1);
  assert.deepEqual(r.report.orphanSetups, ["awp/ghost"]);
  assert.ok(r.v4.tables.exercise.some((e) => e.id === "gone-id"));
});

test("the result is plain data that survives being saved and read back", () => {
  const { s, hotelId } = richStore();
  const v4 = migrateToV4({ store: s, sets: sets({ hotel: hotelId }) }).v4;
  assert.equal(canon(JSON.parse(JSON.stringify(v4))), canon(v4));
});

import { checkV4 } from "./schema4.js";
test("checkV4: a seeded store with sets round trips, and bad data is reported without throwing", () => {
  const store = emptyStore();
  const sets = [makeSet({ exerciseId: "leg-press", weight: 100, reps: 5, mode: "heavy", gymId: "main", unit: "lb" })];
  const ok = checkV4({ store, sets });
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.ok, true);
  assert.ok(ok.bytes4 > ok.bytes3);
  assert.equal(checkV4({ store: null, settings: {}, sets: [] }).ok, true);
  const bad = checkV4({ store: { version: 99 }, sets: [] });
  assert.equal(bad.ok, false);
  assert.equal(checkV4({ store, sets: "nope" }).ok, false);
});
