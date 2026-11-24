import test from "node:test";
import assert from "node:assert/strict";
import { openDb, rowsOf, gymsOf } from "./db.js";
import { TABLES } from "./schema4.js";
import { dedupe, matchActivities, importActivities, summarise, garminRow, NEAR_MS } from "./garmin.js";

// A small saved db: one person, one gym, and workouts shaped like real ones (times only, no real data).
const at = (day, hm) => `2026-11-${day}T${hm}:00.000Z`;
const wk = (day, gym = "main") => ({ id: `awp:${gym}:2026-11-${day}`, personId: "awp", gymId: gym, date: `2026-11-${day}` });
const part = (day, type, a, b) => ({ id: `awp:main:2026-11-${day}:${type}`, workoutId: `awp:main:2026-11-${day}`, exerciseTypeId: type, start: at(day, a), end: at(day, b) });
const cardio = (day, ex, a, b) => ({ id: `awp:main:2026-11-${day}:cardio:${ex}`, workoutTypeId: `awp:main:2026-11-${day}:cardio`, exerciseId: ex, distance: 5000, start: at(day, a), end: at(day, b) });

function db() {
  const tables = Object.fromEntries(TABLES.map((t) => [t, []]));
  Object.assign(tables, {
    gym: [{ id: "main", name: "Main", units: {} }],
    gym_member: [{ personId: "awp", gymId: "main", role: "owner", status: "active", offTypes: [] }],
    workout: [wk("14"), wk("18"), wk("19"), wk("10")],
    workout_type: [
      part("14", "legs", "10:35", "11:05"),                                   // one part
      part("18", "legs", "10:56", "11:15"), part("18", "arms", "11:20", "11:50"), part("18", "abs", "11:52", "12:05"),   // three parts
      part("19", "cardio", "10:42", "11:30"),
      part("10", "arms", "11:40", "11:58"),                                   // typed in afterwards: ends before the watch starts
    ],
    workout_exercise: [cardio("19", "cross-trainer", "10:43", "11:05"), cardio("19", "stationary-bike", "11:08", "11:30")],
  });
  return { version: 4, tables, currentGym: "main", defaultGym: "main", currentPerson: "awp" };
}
const D = () => openDb(db());
const act = (o) => ({ id: o.id ?? o.start, name: "x", durationS: 1800, distanceM: 0, avgHr: 100, maxHr: 130, calories: 200, zones: [600, 900, 300, 0, 0], ...o });
const one = (a, d = D()) => matchActivities([a], d, "awp")[0];

test("a strength session over one part links to that part and its workout", () => {
  const r = one(act({ type: "strength_training", start: at("14", "10:31"), durationS: 2800 }));
  assert.deepEqual([r.status, r.workoutId, r.workoutTypeId], ["match", "awp:main:2026-11-14", "awp:main:2026-11-14:legs"]);
});

test("a strength session over several parts of one workout links to the workout only", () => {
  const r = one(act({ type: "strength_training", start: at("18", "10:55"), durationS: 4080 }));
  assert.deepEqual([r.status, r.workoutId, r.workoutTypeId], ["match", "awp:main:2026-11-18", undefined]);
  assert.match(r.note, /3 parts/);
});

test("a session whose workout was typed in afterwards is offered as near, not linked silently", () => {
  const r = one(act({ type: "strength_training", start: at("10", "12:04"), durationS: 1658 }));
  assert.deepEqual([r.status, r.workoutId, r.workoutTypeId], ["near", "awp:main:2026-11-10", "awp:main:2026-11-10:arms"]);
  assert.ok(NEAR_MS === 30 * 60 * 1000);
});

test("a session far from every workout stays on its own", () => {
  assert.equal(one(act({ type: "strength_training", start: at("14", "15:00") })).status, "none");
  assert.equal(one(act({ type: "strength_training", start: at("02", "10:00") })).status, "none");
});

test("cardio matches its own machine: elliptical to the cross trainer, bike to the stationary bike", () => {
  const e = one(act({ type: "elliptical", start: at("19", "10:42"), durationS: 1335 }));
  assert.deepEqual([e.status, e.workoutExerciseId, e.workoutTypeId, e.workoutId], ["match", "awp:main:2026-11-19:cardio:cross-trainer", "awp:main:2026-11-19:cardio", "awp:main:2026-11-19"]);
  const b = one(act({ type: "indoor_cycling", start: at("19", "11:07"), durationS: 1329 }));
  assert.equal(b.workoutExerciseId, "awp:main:2026-11-19:cardio:stationary-bike");
});

test("an activity of a kind the app has no workout for is kept on its own", () => {
  const r = one(act({ type: "yoga", start: at("14", "10:40") }));
  assert.equal(r.status, "none");
  const d = importActivities(D(), "awp", [r]);
  assert.equal(rowsOf(d, "garmin_activity").length, 1);
  assert.equal(rowsOf(d, "workout").length, 4);                          // no workout made
});

test("two activities that fit the same part are both left unlinked", () => {
  const rs = matchActivities([act({ id: 1, type: "strength_training", start: at("14", "10:36"), durationS: 600 }),
    act({ id: 2, type: "strength_training", start: at("14", "10:50"), durationS: 600 })], D(), "awp");
  assert.deepEqual(rs.map((r) => [r.status, r.workoutTypeId]), [["ambiguous", undefined], ["ambiguous", undefined]]);
});

test("the same session saved twice by the watch is kept once, the earlier start", () => {
  const a = act({ id: 1, type: "strength_training", start: at("10", "12:04"), durationS: 1658 });
  const { kept, dropped } = dedupe([act({ ...a, id: 2, start: at("10", "12:11") }), a]);
  assert.deepEqual([kept.map((k) => k.id), dropped.map((k) => k.id)], [[1], [2]]);
  assert.equal(dedupe([a, act({ ...a, id: 3, start: at("11", "12:04") })]).kept.length, 2);                          // a day later: different
  assert.equal(dedupe([a, act({ ...a, id: 4, start: at("10", "12:11"), zones: [1, 2, 3, 4, 5] })]).kept.length, 2);  // other readings
  assert.equal(dedupe([a, a]).kept.length, 1);                                                                       // the same id
});

test("master rule: saving a matched activity leaves every workout row exactly as it was, and keeps the watch's own times", () => {
  const before = D();
  const r = one(act({ id: 77, type: "strength_training", start: at("14", "10:31"), durationS: 2800, distanceM: 1234 }), before);
  const after = importActivities(before, "awp", [r]);
  for (const t of ["workout", "workout_type", "workout_exercise", "gym", "gym_member", "logged_set"]) assert.deepEqual(after.tables[t], before.tables[t], t);
  const g = rowsOf(after, "garmin_activity")[0];
  assert.deepEqual([g.id, g.garminId, g.start, g.end, g.distanceM, g.zone2S, g.workoutId, g.workoutTypeId],
    ["awp:garmin:77", "77", at("14", "10:31"), "2026-11-14T11:17:40.000Z", 1234, 900, "awp:main:2026-11-14", "awp:main:2026-11-14:legs"]);
});

test("a golf round makes a workout at one hidden Outdoors place, with the watch's times and distance; the zones stay in garmin_activity only", () => {
  const a = act({ id: 5, type: "golf", name: "Bromsgrove Golf", start: at("20", "09:43"), durationS: 14357, distanceM: 10774.67 });
  const r = one(a);
  assert.equal(r.status, "create");
  const d = importActivities(D(), "awp", [r], { random: () => 0.5 });
  const gym = rowsOf(d, "gym").find((g) => g.outdoors);
  assert.deepEqual([gym.id, gym.name], ["g-iiiiiiii", "Outdoors"]);
  assert.deepEqual(gymsOf(d).map((g) => g.id), ["main"]);                        // hidden from the lists
  assert.ok(rowsOf(d, "gym_member").some((m) => m.gymId === gym.id && m.personId === "awp" && m.role === "owner"));
  const wid = `awp:${gym.id}:2026-11-20`;
  assert.deepEqual(rowsOf(d, "workout").find((w) => w.id === wid), { id: wid, personId: "awp", gymId: gym.id, date: "2026-11-20", start: at("20", "09:43"), end: "2026-11-20T13:42:17.000Z" });
  assert.deepEqual(rowsOf(d, "workout_type").find((w) => w.id === wid + ":golf").exerciseTypeId, "golf");
  const we = rowsOf(d, "workout_exercise").find((w) => w.id === wid + ":golf:golf");
  assert.deepEqual([we.exerciseId, we.distance, "avgHeartRate" in we, "zoneMinutes" in we], ["golf", 10774.67, false, false]);
  const g = rowsOf(d, "garmin_activity")[0];
  assert.deepEqual([g.workoutId, g.workoutTypeId, g.workoutExerciseId, g.avgHr, g.zone1S], [wid, wid + ":golf", wid + ":golf:golf", 100, 600]);
  assert.ok(rowsOf(d, "exercise_type").some((t) => t.id === "golf") && rowsOf(d, "exercise").some((e) => e.id === "golf" && e.name === "Golf"));
  // importing the same file again changes nothing
  const again = importActivities(d, "awp", matchActivities([a], d, "awp"), { random: () => 0.1 });
  assert.deepEqual(again.tables, d.tables);
  assert.equal(matchActivities([a], d, "awp")[0].status, "have");
});

test("a walk and a round on the same day share one Outdoors workout; a second place is never made", () => {
  const rs = matchActivities([act({ id: 1, type: "golf", start: at("20", "09:00"), durationS: 3600 }), act({ id: 2, type: "walking", start: at("20", "15:00"), durationS: 1800, distanceM: 3500 })], D(), "awp");
  const d = importActivities(D(), "awp", rs, { random: () => 0.3 });
  assert.equal(rowsOf(d, "gym").filter((g) => g.outdoors).length, 1);
  assert.equal(rowsOf(d, "workout").filter((w) => w.date === "2026-11-20").length, 1);
  assert.deepEqual(rowsOf(d, "workout_type").filter((w) => w.workoutId.endsWith(":2026-11-20")).map((w) => w.exerciseTypeId).sort(), ["golf", "walking"]);
});

test("the day is the UK day: a walk at 23:30 UTC in summer belongs to the next day", () => {
  const d = importActivities(D(), "awp", matchActivities([act({ id: 9, type: "walking", start: "2026-07-10T23:30:00.000Z", durationS: 600 })], D(), "awp"), { random: () => 0.2 });
  assert.equal(rowsOf(d, "workout").find((w) => w.id.endsWith(":2026-07-11")).date, "2026-07-11");
});

test("a golf round a workout already holds is linked, not duplicated", () => {
  const d0 = D();
  d0.tables.workout.push(wk("21")); d0.tables.workout_type.push(part("21", "golf", "09:00", "13:00"));
  const r = one(act({ id: 8, type: "golf", start: at("21", "09:05"), durationS: 14000 }), d0);
  assert.deepEqual([r.status, r.workoutId, r.workoutTypeId], ["match", "awp:main:2026-11-21", "awp:main:2026-11-21:golf"]);
});

test("summarise counts by status and garminRow leaves blanks out", () => {
  assert.deepEqual(summarise([{ status: "match" }, { status: "match" }, { status: "none" }]), { match: 2, none: 1 });
  const row = garminRow("awp", { act: act({ id: 3, type: "walking", start: at("20", "10:00"), distanceM: NaN, calories: undefined }) });
  assert.ok(!("distanceM" in row) && !("calories" in row) && !("workoutId" in row));
});
