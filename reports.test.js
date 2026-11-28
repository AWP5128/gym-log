import test from "node:test";
import assert from "node:assert/strict";
import { buildReport, availablePeriods, periodKey, periodLabel, weightText, lengthText, zoneText } from "./reports.js";

// A small saved db: two gyms, one person. Dates are workout dates; sets belong to a workout exercise.
const empty = () => ({ tables: { workout: [], workout_type: [], workout_exercise: [], logged_set: [], gym_equipment: [], exercise: [], garmin_activity: [] } });

function make({ visits = [], sets = [], equipment = [], garmin = [] } = {}) {
  const db = empty();
  db.tables.gym_equipment = equipment;
  db.tables.exercise = equipment.map((e) => ({ id: e.exerciseId, name: e.name }));
  for (const v of visits) {
    const wid = "p:" + v.gym + ":" + v.date;
    if (!db.tables.workout.some((w) => w.id === wid)) db.tables.workout.push({ id: wid, personId: "p", gymId: v.gym, date: v.date });
    const wtid = wid + ":" + v.type;
    db.tables.workout_type.push({ id: wtid, workoutId: wid, exerciseTypeId: v.type });
    for (const ex of v.exercises ?? []) db.tables.workout_exercise.push({ id: wtid + ":" + ex, workoutTypeId: wtid, exerciseId: ex });
  }
  sets.forEach((s, i) => db.tables.logged_set.push({ id: "s" + i, personId: "p", gymId: s.gym ?? "g1", time: "2026-11-20T10:00:00.000Z", ...s, workoutExerciseId: s.we }));
  db.tables.garmin_activity = garmin;
  return db;
}
const eq = (gymId, exerciseId, name, unit, extra = {}) => ({ gymId, id: exerciseId, exerciseId, name, unit, exerciseTypeId: "legs", ...extra });

test("total weight is weight x reps; kg and lb add up in kg", () => {
  const db = make({
    visits: [{ gym: "g1", date: "2026-11-20", type: "legs", exercises: ["leg-press", "perfect-squat"] }],
    equipment: [eq("g1", "leg-press", "Leg Press Machine", "lb"), eq("g1", "perfect-squat", "Perfect Squat", "kg")],
    sets: [
      { we: "p:g1:2026-11-20:legs:leg-press", exerciseId: "leg-press", weight: 100, reps: 10, unit: "lb" },
      { we: "p:g1:2026-11-20:legs:perfect-squat", exerciseId: "perfect-squat", weight: 70, reps: 5, unit: "kg" },
    ],
  });
  const [r] = buildReport(db, "day");
  assert.ok(Math.abs(r.weightKg - (100 * 0.45359237 * 10 + 350)) < 1e-9);
  assert.equal(r.sets, 2);
});

test("a single limb set counts weight x total reps (left + right)", () => {
  const db = make({
    visits: [{ gym: "g1", date: "2026-11-25", type: "legs", exercises: ["leg-press"] }],
    equipment: [eq("g1", "leg-press", "Leg Press Machine", "lb")],
    sets: [{ we: "p:g1:2026-11-25:legs:leg-press", exerciseId: "leg-press", weight: 85, reps: 22, repsLeft: 12, repsRight: 10, unit: "lb" }],
  });
  assert.ok(Math.abs(buildReport(db, "day")[0].weightKg - 85 * 0.45359237 * 22) < 1e-9);
});

test("cardio sets, typed-in bests and body weight with nothing added add no weight", () => {
  const db = make({
    visits: [
      { gym: "g1", date: "2026-11-20", type: "cardio", exercises: ["cross-trainer"] },
      { gym: "g1", date: "2026-11-20", type: "arms", exercises: ["pull-up"] },
    ],
    equipment: [eq("g1", "pull-up", "Pull-ups", "kg", { exerciseTypeId: "arms" })],
    sets: [
      { we: "p:g1:2026-11-20:cardio:cross-trainer", exerciseId: "cross-trainer", minutes: 20 },
      { we: "p:g1:2026-11-20:arms:pull-up", exerciseId: "pull-up", weight: 0, reps: 8, unit: "kg" },
      { exerciseId: "pull-up", weight: 50, reps: 5, manual: true, time: null },
    ],
  });
  const rows = buildReport(db, "day");
  assert.equal(rows.length, 1);   // the typed-in best makes no period of its own
  const [r] = rows;
  assert.equal(r.weightKg, 0);
  assert.equal(r.sets, 1);
  assert.deepEqual(r.bySession, []);
  assert.deepEqual(r.byMuscle, []);
});

test("activities are counted once per type per day, whatever the gym or the number of exercises", () => {
  const db = make({
    visits: [
      { gym: "g1", date: "2026-11-20", type: "legs", exercises: ["a", "b"] },
      { gym: "g2", date: "2026-11-20", type: "legs", exercises: ["a"] },
      { gym: "g1", date: "2026-11-20", type: "abs", exercises: ["c"] },
      { gym: "g1", date: "2026-11-21", type: "legs", exercises: ["a"] },
      { gym: "out", date: "2026-11-21", type: "golf" },
      { gym: "out", date: "2026-11-21", type: "walking" },
    ],
  });
  const days = buildReport(db, "day");
  assert.deepEqual(days.map((d) => d.key), ["2026-11-21", "2026-11-20"]);
  assert.deepEqual(days[1].activities, [["legs", "Legs", 1], ["abs", "Abs", 1]]);
  assert.deepEqual(days[0].activities, [["legs", "Legs", 1], ["golf", "Golf", 1], ["walking", "Walking", 1]]);
  assert.deepEqual(buildReport(db, "month")[0].activities, [["legs", "Legs", 2], ["abs", "Abs", 1], ["golf", "Golf", 1], ["walking", "Walking", 1]]);
});

test("weight is split by session and by muscle (a gym's own muscle choice wins), biggest first", () => {
  const db = make({
    visits: [
      { gym: "g1", date: "2026-11-20", type: "legs", exercises: ["leg-press", "hamstring-curl"] },
      { gym: "g1", date: "2026-11-20", type: "abs", exercises: ["crunch"] },
    ],
    equipment: [
      eq("g1", "leg-press", "Leg Press Machine", "kg"),
      eq("g1", "hamstring-curl", "Hamstring Curl Machine", "kg"),
      eq("g1", "crunch", "Crunch", "kg", { exerciseTypeId: "abs", muscle: "obliques" }),
    ],
    sets: [
      { we: "p:g1:2026-11-20:legs:leg-press", exerciseId: "leg-press", weight: 100, reps: 10, unit: "kg" },
      { we: "p:g1:2026-11-20:legs:hamstring-curl", exerciseId: "hamstring-curl", weight: 40, reps: 10, unit: "kg" },
      { we: "p:g1:2026-11-20:abs:crunch", exerciseId: "crunch", weight: 5, reps: 10, unit: "kg" },
    ],
  });
  const [r] = buildReport(db, "day");
  assert.deepEqual(r.bySession, [["legs", "Legs", 1400], ["abs", "Abs", 50]]);
  assert.deepEqual(r.byMuscle, [["Quads", 1000], ["Hamstrings", 400], ["Obliques", 50]]);
  assert.equal(r.weightKg, 1450);
});

test("weeks run Monday to Sunday", () => {
  assert.equal(periodKey("2026-11-23", "week"), "2026-11-23");   // a Monday
  assert.equal(periodKey("2026-11-29", "week"), "2026-11-23");   // the Sunday
  assert.equal(periodKey("2026-11-30", "week"), "2026-11-30");   // next Monday
  assert.equal(periodKey("2026-11-28", "week"), "2026-11-23");
  assert.equal(periodKey("2027-01-01", "week"), "2026-12-28");   // across a year
});

test("period keys and labels", () => {
  assert.equal(periodKey("2026-11-28", "month"), "2026-11");
  assert.equal(periodKey("2026-11-28", "quarter"), "2026-Q4");
  assert.equal(periodKey("2026-03-31", "quarter"), "2026-Q1");
  assert.equal(periodKey("2026-04-01", "quarter"), "2026-Q2");
  assert.equal(periodKey("2026-11-28", "year"), "2026");
  assert.equal(periodLabel("2026-11-28", "day"), "Sat 28 Nov");
  assert.equal(periodLabel("2026-11-23", "week"), "23-29 Nov");
  assert.equal(periodLabel("2026-11-30", "week"), "30 Nov - 6 Dec");
  assert.equal(periodLabel("2026-11", "month"), "Nov 2026");
  assert.equal(periodLabel("2026-Q4", "quarter"), "Q4 2026");
  assert.equal(periodLabel("2026", "year"), "2026");
});

test("a week and a month add up the days inside them", () => {
  const db = make({
    visits: [
      { gym: "g1", date: "2026-11-29", type: "legs", exercises: ["lp"] },
      { gym: "g1", date: "2026-11-30", type: "legs", exercises: ["lp"] },
    ],
    equipment: [eq("g1", "lp", "Leg Press Machine", "kg")],
    sets: [
      { we: "p:g1:2026-11-29:legs:lp", exerciseId: "lp", weight: 10, reps: 10, unit: "kg" },
      { we: "p:g1:2026-11-30:legs:lp", exerciseId: "lp", weight: 20, reps: 10, unit: "kg" },
    ],
  });
  assert.deepEqual(buildReport(db, "week").map((r) => [r.key, r.weightKg]), [["2026-11-30", 200], ["2026-11-23", 100]]);
  assert.deepEqual(buildReport(db, "month").map((r) => [r.key, r.weightKg]), [["2026-11", 300]]);
});

const act = (id, type, start, durationS, zones) => ({
  id, personId: "p", garminId: id, activityType: type, start, durationS,
  ...Object.fromEntries((zones ?? []).map((v, i) => ["zone" + (i + 1) + "S", v])),
});

test("heart rate zones add up by period and by activity; below zone 1 is duration minus the zone seconds", () => {
  const db = make({
    garmin: [
      act("1", "strength_training", "2026-11-20T10:00:00Z", 3000, [60, 600, 1200, 900, 120]),   // 2880 in zones, 120 below
      act("2", "strength_training", "2026-11-20T18:00:00Z", 1000, [100, 100, 100, 100, 100]),    // 500 in zones, 500 below
      act("3", "golf", "2026-11-21T09:00:00Z", 7200, [3000, 2000, 1000, 100, 0]),                // 6100 in zones, 1100 below
    ],
  });
  const [d21, d20] = buildReport(db, "day");
  assert.equal(d20.zones.durationS, 4000);
  assert.deepEqual(d20.zones.secs, [160, 700, 1300, 1000, 220]);
  assert.equal(d20.zones.below, 620);
  assert.deepEqual(d20.zones.byType.map((x) => [x.name, x.durationS, x.below]), [["Strength", 4000, 620]]);
  assert.equal(d21.zones.below, 1100);
  const [month] = buildReport(db, "month");
  assert.equal(month.zones.durationS, 11200);
  assert.deepEqual(month.zones.secs, [3160, 2700, 2300, 1100, 220]);
  assert.equal(month.zones.below, 1720);
  assert.deepEqual(month.zones.byType.map((x) => x.name), ["Golf", "Strength"]);   // longest first
});

test("an activity with no zone figures counts its time but not a below zone 1 figure", () => {
  const db = make({ garmin: [act("1", "elliptical", "2026-11-03T08:00:00Z", 1800, [])] });
  const [r] = buildReport(db, "day");
  assert.equal(r.zones.durationS, 1800);
  assert.equal(r.zones.below, 0);
  assert.deepEqual(r.zones.secs, [0, 0, 0, 0, 0]);
});

test("a watch activity belongs to the UK day it started, not the UTC one", () => {
  const db = make({ garmin: [act("1", "golf", "2026-06-20T23:30:00Z", 3600, [1, 1, 1, 1, 1])] });   // 00:30 on the 21st in summer time
  assert.equal(buildReport(db, "day")[0].key, "2026-06-21");
});

test("periods with nothing in them are left out, and an empty db gives no rows", () => {
  assert.deepEqual(buildReport(make(), "week"), []);
  const [r] = buildReport(make({ visits: [{ gym: "g1", date: "2026-11-20", type: "legs", exercises: ["a"] }] }), "day");
  assert.equal(r.zones, null);
  assert.equal(r.weightKg, 0);
});

test("quarter and year are offered only once there is more than one month or quarter of data", () => {
  const visit = (date) => ({ gym: "g1", date, type: "legs", exercises: ["a"] });
  assert.deepEqual(availablePeriods(make({ visits: [visit("2026-11-02"), visit("2026-11-28")] })), ["day", "week", "month"]);
  assert.deepEqual(availablePeriods(make({ visits: [visit("2026-11-02"), visit("2026-12-05")] })), ["day", "week", "month", "quarter"]);
  assert.deepEqual(availablePeriods(make({ visits: [visit("2026-11-02"), visit("2027-02-05")] })), ["day", "week", "month", "quarter", "year"]);
});

test("text: pounds first with kilos in brackets, lengths and zone minutes", () => {
  assert.equal(weightText(1000), "2,205 lb (1,000 kg)");
  assert.equal(weightText(0), "0 lb (0 kg)");
  assert.equal(lengthText(3240), "54 min");
  assert.equal(lengthText(3900), "1h 05m");
  assert.equal(zoneText([240, 720, 1200, 900, 180]), "Z1 4 · Z2 12 · Z3 20 · Z4 15 · Z5 3");
});

test("a set counts under the session it was logged in, even when the exercise belongs to another (pull-ups on a legs day)", () => {
  const db = make({
    visits: [{ gym: "g1", date: "2026-11-20", type: "legs", exercises: ["pull-up"] }],
    equipment: [eq("g1", "pull-up", "Pull-ups", "kg", { exerciseTypeId: "arms" })],
    sets: [{ we: "p:g1:2026-11-20:legs:pull-up", exerciseId: "pull-up", weight: 10, reps: 5, unit: "kg" }],
  });
  assert.deepEqual(buildReport(db, "day")[0].bySession, [["legs", "Legs", 50]]);
});
