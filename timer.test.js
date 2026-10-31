import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatTime, startWorkout, isRunning, workoutElapsed, machineElapsed,
  runMachines, endWorkout, cleanWorkout,
} from "./timer.js";

const T0 = new Date(2026, 9, 27, 18, 0, 0).getTime();   // 27 Oct 2026, 18:00:00
const sec = (n) => n * 1000;

// A workout started at T0 where each [ids, seconds] step runs those machines at that time.
const workoutWith = (...steps) =>
  steps.reduce((w, [ids, s]) => runMachines(w, ids, T0 + sec(s)), startWorkout(T0));
// Seconds a machine has counted at a given second.
const counted = (w, id, s) => machineElapsed(w, id, T0 + sec(s)) / 1000;

test("formatTime shows minutes and seconds", () => {
  const expected = [[0, "0:00"], [sec(5), "0:05"], [sec(75), "1:15"], [sec(75 * 60 + 3), "75:03"], [-500, "0:00"]];
  for (const [ms, text] of expected) assert.equal(formatTime(ms), text);
});

test("a new workout is running and counts from its start", () => {
  const w = startWorkout(T0);
  assert.equal(isRunning(w), true);
  assert.equal(workoutElapsed(w, T0 + sec(90)), sec(90));
  assert.equal(workoutElapsed(null, T0), 0);
});

test("a machine only counts while it is running", () => {
  let w = workoutWith([["leg-press"], 10]);
  assert.equal(counted(w, "leg-press", 40), 30);
  w = runMachines(w, [], T0 + sec(40));                      // leave the machine
  assert.equal(counted(w, "leg-press", 100), 30);
  w = runMachines(w, ["leg-press"], T0 + sec(100));          // come back
  assert.equal(counted(w, "leg-press", 130), 60);
  assert.equal(counted(w, "unknown", 130), 0);
});

test("a superset runs both machines and finishing one leaves the other going", () => {
  const w = workoutWith([["a", "b"], 0], [["b"], 60]);
  assert.equal(counted(w, "a", 120), 60);
  assert.equal(counted(w, "b", 120), 120);
});

test("running the same machine again does not restart its clock", () => {
  const w = workoutWith([["a"], 0], [["a"], 20]);
  assert.equal(counted(w, "a", 50), 50);
});

test("runMachines does not change the workout it was given", () => {
  const w = startWorkout(T0);
  runMachines(w, ["a"], T0 + sec(5));
  assert.deepEqual(w.machines, {});
});

test("ending a workout freezes the total and stops the machines", () => {
  const w = endWorkout(workoutWith([["a"], 10]), T0 + sec(70));
  assert.equal(isRunning(w), false);
  assert.equal(workoutElapsed(w, T0 + sec(500)), sec(70));
  assert.equal(counted(w, "a", 500), 60);
});

test("cleanWorkout keeps a good workout from today", () => {
  const raw = { start: T0, end: null, machines: { a: { ms: 5000, since: T0 + 1000 } } };
  assert.deepEqual(cleanWorkout(raw, T0 + sec(60)), raw);
});

test("cleanWorkout drops missing, damaged or old workouts", () => {
  const nextDay = T0 + 24 * 3600 * 1000;
  assert.equal(cleanWorkout(null, T0), null);
  assert.equal(cleanWorkout("nonsense", T0), null);
  assert.equal(cleanWorkout({ start: "x" }, T0), null);
  assert.equal(cleanWorkout({ start: T0, end: null, machines: {} }, nextDay), null);
});

test("cleanWorkout repairs damaged machine entries", () => {
  const w = cleanWorkout({ start: T0, machines: { a: { ms: "x" }, b: null } }, T0);
  assert.deepEqual(w.machines, { a: { ms: 0, since: null }, b: { ms: 0, since: null } });
  assert.equal(w.end, null);
});