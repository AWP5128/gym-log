// Step 29d, changed in step 82: joins the app's data to the sync engine. Pure (the connection is passed in), so it can be tested.
// runSync runs one round with the engine on the saved tables themselves (db.tables: every table stays, including garmin_activity and
// the golf/walk workouts, which the nested store cannot hold) and, if something arrived from elsewhere, gives back the merged db and
// the sets the screens use.
import { readStore, readSets } from "./schema4.js";
import { syncOnce, tableOfKey } from "./sync.js";

const byTime = (a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0);   // array sort is stable

// Returns { changed, db, sets, state, report }. When changed is false the caller keeps its own db and sets (sets is null).
// If anything cannot be read, the OLD state is returned, so nothing pulled is ever noted as already merged.
export async function runSync({ db, state, remote }) {
  const stop = (error) => ({ changed: false, db, sets: null, state, report: { error, queued: 0, pushed: 0, failed: [], pulled: 0, skipped: 0, offline: false } });
  if (!db || typeof db !== "object" || !db.tables || typeof db.tables !== "object") return stop("The data could not be converted for sync");
  const r = await syncOnce({ tables: db.tables, state, remote });
  if (r.report.pulled === 0) return { changed: false, db, sets: null, state: r.state, report: r.report };
  const merged = { ...db, tables: r.tables, setsInTables: true };
  if (!readStore(merged) || !readSets(merged)) return stop("What arrived could not be read, so it was not merged");
  return { changed: true, db: merged, sets: [...readSets(merged)].sort(byTime), state: r.state, report: r.report };
}

// Step 84: the short status shown in the Account box, so a phone can show that a sync worked. Plain lines of text, never row contents:
// a refused row is shown as its table, the server's code and its message only (the same as push reports it), counted per kind.
//   info = { at: ms, report, waiting } of the last try (report as runSync gives it; or { error } when the try could not start), or null
const when = (ms) => new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export function describeSync({ enabled, info }, fmt = when) {
  if (!enabled) return ["Sync is off."];
  if (!info) return ["No sync yet."];
  const r = info.report ?? {};
  const lines = [];
  if (info.error || r.offline || r.error) lines.push("Last try " + fmt(info.at) + " did not finish: " + String(info.error ?? r.error ?? "offline").slice(0, 80) + ".");
  else lines.push("Last sync " + fmt(info.at) + ": sent " + (r.pushed ?? 0) + ", received " + (r.pulled ?? 0) + ".");
  if (info.waiting > 0) lines.push(info.waiting + " waiting to be sent.");
  const kinds = new Map();
  for (const f of r.failed ?? []) {
    const k = tableOfKey(f.key) + " " + String(f.error ?? "").slice(0, 120);
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
  }
  let shown = 0;
  for (const [k, n] of kinds) { if (shown++ < 5) lines.push("Refused: " + k + (n > 1 ? " (" + n + ")" : "")); }
  if (kinds.size > 5) lines.push("and " + (kinds.size - 5) + " more kinds refused.");
  return lines;
}
