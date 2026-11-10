// Step 28e: loads a Gym Log full backup file into the LOCAL database and checks it reads back identical.
//   node db-load.mjs <backup.json> [--replace] [--url postgresql://...]
// Needs the local database running (npx supabase start) and the pg package (npm install -D pg).
// It prints counts and OK or the list of tables that differ, never your data.
import { readFileSync } from "node:fs";
import { parseBackup } from "./backup.js";
import { toStoreV4 } from "./schema4.js";
import { loadTables, readTables, compareTables } from "./dbload.js";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--url");
const replace = args.includes("--replace");
const url = args.includes("--url") ? args[args.indexOf("--url") + 1] : (process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
if (!file) { console.log("Usage: node db-load.mjs <backup.json> [--replace]"); process.exit(1); }
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) { console.log("This script only loads the local database (127.0.0.1)."); process.exit(1); }

const r = parseBackup(readFileSync(file, "utf8"));
if (r.error) { console.log("Backup problem:", r.error); process.exit(1); }
const v4 = toStoreV4(r.backup.store, r.backup.sets);
if (!v4) { console.log("The backup could not be converted to version 4."); process.exit(1); }

let pg;
try { pg = (await import("pg")).default; } catch { console.log("Run: npm install -D pg"); process.exit(1); }
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const counts = await loadTables(client, v4, { replace });
  console.log("Loaded:", Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(", "));
  const problems = compareTables(v4, await readTables(client));
  console.log(problems.length === 0 ? "Read back identical: YES" : "Read back identical: NO\n" + problems.join("\n"));
  process.exitCode = problems.length === 0 ? 0 : 2;
} catch (e) {
  console.log("Stopped, nothing was changed:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
