// Step 79: Garmin export, on the laptop. Asks the watch database for the activities since a date and writes ONE file for the app.
//   node garmin-export.mjs                       activities since 2026-11-01   -> gym-log-garmin-<today>.json
//   node garmin-export.mjs --since 2026-11-15    only since that day
//   node garmin-export.mjs --out other-name.json (keep the name starting gym-log-: git then ignores it)
// Needs Docker Desktop running with the garmin-grafana containers (the one called influxdb). It only READS the watch database.
// The file holds heart-rate data: do not commit it, share it or put it anywhere public. Import it in the app (Backup > Import Garmin file).
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { parseInflux, makeFile } from "./garminfile.js";

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const since = opt("--since") ?? "2026-11-01";
const out = opt("--out") ?? `gym-log-garmin-${new Date().toISOString().slice(0, 10)}.json`;
if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) { console.log("--since must look like 2026-11-15"); process.exit(1); }
if (!out.startsWith("gym-log-")) { console.log("The file name must start with gym-log- (so git ignores it)."); process.exit(1); }

const question = `SELECT * FROM "ActivitySummary" WHERE time >= '${since}T00:00:00Z'`;
const r = spawnSync("docker", ["exec", "influxdb", "influx", "-database", "GarminStats", "-precision", "rfc3339", "-format", "json", "-execute", question],
  { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
if (r.error || r.status !== 0) {
  console.log("Could not read the watch database. Is Docker Desktop running, with the influxdb container up?");
  console.log((r.error?.message ?? r.stderr ?? "").toString().slice(0, 300));
  process.exit(1);
}
const got = parseInflux(r.stdout);
if (got.error) { console.log(got.error); process.exit(1); }
writeFileSync(out, makeFile(got.activities));
const count = {};
for (const a of got.activities) count[a.type] = (count[a.type] ?? 0) + 1;
console.log(`${got.activities.length} activities since ${since} written to ${out}`);
console.log(Object.entries(count).map(([t, n]) => `${t}: ${n}`).join(", "));
console.log("This file holds heart-rate data: keep it private, and do not commit it.");
