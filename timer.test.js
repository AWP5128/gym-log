import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatTime, startWorkout, isRunning, workoutElapsed, machineElapsed,
  runMachines, endWorkout, cleanWorkout,
} from "./timer.js";

const T0 = new Date(2026, 9, 27, 18, 0, 0).getTime();   // 27 Oct 2026, 18:00:00
const sec = (n) => n * 1000;

test("formatTime shows minutes and seconds", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(sec(5)), "0:05");
  assert.equal(formatTime(sec(75)), "1:15");
  assert.equal(formatTime(sec(75 * 60 + 3)), "75:03");
  assert.equal(formatTime(-500), "0:00");
});

test("a new workout is running and counts from its start", () => {
  const w = startWorkout(T0);
  assert.equal(isRunning(w), true);
  assert.equal(workoutElapsed(w, T0 + sec(90)), sec(90));
  assert.equal(workoutElapsed(null, T0), 0);
});

test("a machine only counts while it is running", () => {
  let w = startWorkout(T0);
  w = runMachines(w, ["leg-press"], T0 + sec(10));
  assert.equal(machineElapsed(w, "leg-press", T0 + sec(40)), sec(30));
  w = runMachines(w, [], T0 + sec(40));                      // leave the machine
  assert.equal(machineElapsed(w, "leg-press", T0 + sec(100)), sec(30));
  w = runMachines(w, ["leg-press"], T0 + sec(100));          // come back
  assert.equal(machineElapsed(w, "leg-press", T0 + sec(130)), sec(60));
  assert.equal(machineElapsed(w, "unknown", T0 + sec(130)), 0);
});

test("a superset runs both machines and finishing one leaves the other going", () => {
  let w = startWorkout(T0);
  w = runMachines(w, ["a", "b"], T0);
  w = runMachines(w, ["b"], T0 + sec(60));
  assert.equal(machineElapsed(w, "a", T0 + sec(120)), sec(60));
  assert.equal(machineElapsed(w, "b", T0 + sec(120)), sec(120));
});

test("running the same machine again does not restart its clock", () => {
  let w = startWorkout(T0);
  w = runMachines(w, ["a"], T0);
  w = runMachines(w, ["a"], T0 + sec(20));
  assert.equal(machineElapsed(w, "a", T0 + sec(50)), sec(50));
});

test("runMachines does not change the workout it was given", () => {
  const w = startWorkout(T0);
  runMachines(w, ["a"], T0 + sec(5));
  assert.deepEqual(w.machines, {});
});

test("ending a workout freezes the total and stops the machines", () => {
  let w = startWorkout(T0);
  w = runMachines(w, ["a"], T0 + sec(10));
  w = endWorkout(w, T0 + sec(70));
  assert.equal(isRunning(w), false);
  assert.equal(workoutElapsed(w, T0 + sec(500)), sec(70));
  assert.equal(machineElapsed(w, "a", T0 + sec(500)), sec(60));
});

test("cleanWorkout keeps a good workout from today", () => {
  const raw = { start: T0, end: null, machines: { a: { ms: 5000, since: T0 + 1000 } } };
  assert.deepEqual(cleanWorkout(raw, T0 + sec(60)), raw);
});

test("cleanWorkout drops missing, damaged or old workouts", () => {
  assert.equal(cleanWorkout(null, T0), null);
  assert.equal(cleanWorkout("nonsense", T0), null);
  assert.equal(cleanWorkout({ start: "x" }, T0), null);
  assert.equal(cleanWorkout({ start: T0, end: null, machines: {} }, T0 + 24 * 3600 * 1000), null);
});

test("cleanWorkout repairs damaged machine entries", () => {
  const w = cleanWorkout({ start: T0, machines: { a: { ms: "x" }, b: null } }, T0);
  assert.deepEqual(w.machines, { a: { ms: 0, since: null }, b: { ms: 0, since: null } });
  assert.equal(w.end, null);
});