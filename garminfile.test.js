import test from "node:test";
import assert from "node:assert/strict";
import { parseInflux, makeFile, readFile, FILE_FORMAT, FILE_VERSION } from "./garminfile.js";

// What InfluxDB prints for `select * from ActivitySummary` with -precision rfc3339 -format json (invented numbers).
const COLS = ["time", "ActivityID", "Activity_ID", "activityName", "activityType", "averageHR", "calories", "distance", "elapsedDuration",
  "hrTimeInZone_1", "hrTimeInZone_2", "hrTimeInZone_3", "hrTimeInZone_4", "hrTimeInZone_5", "maxHR", "locationName"];
const row = (o) => COLS.map((c) => o[c] ?? null);
const influx = (values, name = "ActivitySummary") => JSON.stringify({ results: [{ statement_id: 0, series: [{ name, columns: COLS, values }] }] });
const STRENGTH = row({ time: "2026-11-22T10:47:00Z", ActivityID: 111, Activity_ID: 111, activityName: "Strength", activityType: "strength_training", averageHR: 97, calories: 356,
  distance: 0, elapsedDuration: 4349.7080078125, hrTimeInZone_1: 1800.0123, hrTimeInZone_2: 1100, hrTimeInZone_3: 100, hrTimeInZone_4: 0, hrTimeInZone_5: 0, maxHR: 142 });
const END = row({ time: "2026-11-22T11:59:29Z", ActivityID: 111, Activity_ID: 111, activityName: "END", activityType: "No Activity" });
const GOLF = row({ time: "2026-11-20T09:43:40Z", ActivityID: "222", activityName: "Some Golf", activityType: "golf", averageHR: 86, distance: 10774.669921875, elapsedDuration: 14357.125,
  hrTimeInZone_1: 4400, hrTimeInZone_2: 100, hrTimeInZone_3: 0, hrTimeInZone_4: 0, hrTimeInZone_5: 0, maxHR: 117 });

test("the database answer becomes activities: END rows dropped, numbers tidied, oldest first", () => {
  const r = parseInflux(influx([STRENGTH, END, GOLF]));
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.activities, [
    { id: "222", type: "golf", name: "Some Golf", start: "2026-11-20T09:43:40.000Z", durationS: 14357.125, distanceM: 10774.67, avgHr: 86, maxHr: 117, zones: [4400, 100, 0, 0, 0] },
    { id: "111", type: "strength_training", name: "Strength", start: "2026-11-22T10:47:00.000Z", durationS: 4349.708, distanceM: 0, avgHr: 97, maxHr: 142, calories: 356, zones: [1800.012, 1100, 100, 0, 0] },
  ]);
});

test("an activity with no zone readings has no zones; an id falls back to Activity_ID, then to the start time", () => {
  const bare = row({ time: "2026-11-01T10:00:00Z", activityType: "walking" });
  const a = parseInflux(influx([bare])).activities[0];
  assert.deepEqual([a.id, "zones" in a], ["2026-11-01T10:00:00.000Z", false]);
  assert.equal(parseInflux(influx([row({ time: "2026-11-01T10:00:00Z", Activity_ID: 5, activityType: "walking" })])).activities[0].id, "5");
});

test("numbers as times are read as nanoseconds, milliseconds or seconds", () => {
  for (const t of [1763808420000000000, 1763808420000, 1763808420]) assert.equal(parseInflux(influx([row({ time: t, activityType: "golf" })])).activities[0].start, "2025-11-22T10:47:00.000Z");
});

test("an empty answer, an error and rubbish are told apart", () => {
  assert.deepEqual(parseInflux(JSON.stringify({ results: [{ statement_id: 0 }] })), { activities: [], skipped: 0 });
  assert.match(parseInflux(JSON.stringify({ results: [{ error: "database not found: GarminStats" }] })).error, /refused.*database not found/);
  assert.match(parseInflux("Failed to connect").error, /not readable/);
  assert.match(parseInflux(JSON.stringify({ results: [{ series: [{ name: "Other", columns: ["time", "x"], values: [] }] }] })).error, /ActivitySummary/);
});

test("the file round trips through makeFile and readFile", () => {
  const { activities } = parseInflux(influx([STRENGTH, GOLF]));
  const text = makeFile(activities, new Date("2026-11-24T08:00:00Z"));
  assert.equal(JSON.parse(text).format, FILE_FORMAT);
  assert.equal(JSON.parse(text).exported, "2026-11-24T08:00:00.000Z");
  assert.deepEqual(readFile(text), { activities, rejected: 0 });
});

test("the app refuses a file that is not ours, and counts activities that are not valid", () => {
  assert.match(readFile("nope").error, /could not be read/);
  assert.match(readFile(JSON.stringify({ activities: [] })).error, /not a Garmin file/);
  assert.match(readFile(JSON.stringify({ format: FILE_FORMAT, version: FILE_VERSION + 1, activities: [] })).error, /different version/);
  assert.match(readFile(JSON.stringify({ format: FILE_FORMAT, version: FILE_VERSION })).error, /no list/);
  const r = readFile(JSON.stringify({ format: FILE_FORMAT, version: FILE_VERSION, activities: [
    { type: "golf", start: "2026-11-20T09:43:40Z", zones: [1, 2, 3] }, { type: "golf", start: "not a time" }, { start: "2026-11-20T09:43:40Z" }, null, "x"] }));
  assert.equal(r.rejected, 4);
  assert.deepEqual(r.activities, [{ id: "2026-11-20T09:43:40.000Z", type: "golf", start: "2026-11-20T09:43:40.000Z" }]);       // 3 zones is not 5: left out, not guessed
});
