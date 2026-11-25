// Step 29d, changed in step 82: joins the app's data to the sync engine. Pure (the connection is passed in), so it can be tested.
// runSync runs one round with the engine on the saved tables themselves (db.tables: every table stays, including garmin_activity and
// the golf/walk workouts, which the nested store cannot hold) and, if something arrived from elsewhere, gives back the merged db and
// the sets the screens use.
import { readStore, readSets } from "./schema4.js";
import { syncOnce } from "./sync.js";

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
