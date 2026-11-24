// Step 79: the Garmin export file. The laptop script (garmin-export.mjs) asks the watch database (InfluxDB) for the activities and
// writes ONE file; the app reads that file (Backup > Import Garmin file). Pure, so it is tested. The file holds heart-rate data:
// its name starts gym-log- so git ignores it, and it must never be committed or shared.
//
//   { format: "gym-log-garmin", version: 1, exported: ISO, activities: [ activity ] }
//   activity = { id, type, name, start (ISO UTC), durationS, distanceM, avgHr, maxHr, calories, zones: [z1..z5 seconds] }
export const FILE_FORMAT = "gym-log-garmin";
export const FILE_VERSION = 1;

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : undefined);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
// InfluxDB gives times as text ("2026-11-22T10:47:00Z") when asked for rfc3339; a number is read as ns, ms or s by its size
const when = (t) => {
  const ms = typeof t === "number" ? (t > 1e17 ? t / 1e6 : t > 1e11 ? t : t * 1000) : Date.parse(t);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

// The text InfluxDB printed for `select * from ActivitySummary ...` (-format json) -> { activities, skipped } or { error }.
// The "END" rows (activityType "No Activity") that the fetcher writes after every activity are skipped.
export function parseInflux(text) {
  let j;
  try { j = JSON.parse(text); } catch { return { error: "The database answer was not readable (not JSON)." }; }
  const res = j?.results?.[0];
  if (j?.error || res?.error) return { error: "The database refused the question: " + String(j?.error ?? res.error).slice(0, 120) };
  const series = res?.series?.find((s) => s.name === "ActivitySummary") ?? res?.series?.[0];
  if (!series) return { activities: [], skipped: 0 };
  const col = Object.fromEntries(series.columns.map((c, i) => [c.toLowerCase(), i]));
  if (!("time" in col) || !("activitytype" in col)) return { error: "The answer has no activityType column: is this the ActivitySummary measurement?" };
  const activities = [];
  let skipped = 0;
  for (const row of series.values ?? []) {
    const get = (name) => row[col[name.toLowerCase()]];
    const type = get("activityType");
    const start = when(get("time"));
    if (typeof type !== "string" || type === "" || type === "No Activity" || !start) { skipped++; continue; }
    const zones = [1, 2, 3, 4, 5].map((n) => num(get("hrTimeInZone_" + n)));
    activities.push(clean({
      id: String(get("ActivityID") ?? get("Activity_ID") ?? start), type, name: typeof get("activityName") === "string" ? get("activityName") : undefined,
      start, durationS: num(get("elapsedDuration")), distanceM: num(get("distance")), avgHr: num(get("averageHR")), maxHr: num(get("maxHR")),
      calories: num(get("calories")), zones: zones.some((z) => z !== undefined) ? zones.map((z) => z ?? 0) : undefined,
    }));
  }
  return { activities: activities.sort((a, b) => (a.start < b.start ? -1 : 1)), skipped };
}

export const makeFile = (activities, now = new Date()) => JSON.stringify({ format: FILE_FORMAT, version: FILE_VERSION, exported: now.toISOString(), activities }, null, 1);

// The app reads the file: { activities } or { error } in plain words. Anything that is not a valid activity is counted, not guessed at.
export function readFile(text) {
  let j;
  try { j = JSON.parse(text); } catch { return { error: "That file is not a Garmin file from this app (it could not be read)." }; }
  if (j?.format !== FILE_FORMAT) return { error: "That file is not a Garmin file from this app." };
  if (j.version !== FILE_VERSION) return { error: "That Garmin file was made by a different version of the export script." };
  if (!Array.isArray(j.activities)) return { error: "That Garmin file has no list of activities." };
  const activities = [];
  let rejected = 0;
  for (const a of j.activities) {
    const ok = a && typeof a === "object" && typeof a.type === "string" && a.type !== "" && typeof a.start === "string" && Number.isFinite(Date.parse(a.start));
    if (!ok) { rejected++; continue; }
    const zones = Array.isArray(a.zones) && a.zones.length === 5 && a.zones.every((z) => typeof z === "number" && Number.isFinite(z)) ? a.zones : undefined;
    activities.push(clean({
      id: String(a.id ?? new Date(a.start).toISOString()), type: a.type, name: typeof a.name === "string" ? a.name : undefined, start: new Date(a.start).toISOString(),
      durationS: num(a.durationS), distanceM: num(a.distanceM), avgHr: num(a.avgHr), maxHr: num(a.maxHr), calories: num(a.calories), zones,
    }));
  }
  return { activities, rejected };
}
