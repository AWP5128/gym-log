// Step 29d: joins the app's data to the sync engine. Pure (the connection is passed in), so it can be tested.
// runSync turns the store and sets into the version 4 tables, runs one round with the engine, and, if something
// arrived from elsewhere, turns the merged tables back into the store and sets the screens use.
import { toStoreV4, readStore, readSets } from "./schema4.js";
import { syncOnce } from "./sync.js";

const byTime = (a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0);   // array sort is stable

// Returns { changed, store, sets, state, report }. When changed is false the caller keeps its own store and sets.
// If anything cannot be read, the OLD state is returned, so nothing pulled is ever noted as already merged.
export async function runSync({ store, sets, state, remote }) {
  const stop = (error) => ({ changed: false, store, sets, state, report: { error, queued: 0, pushed: 0, failed: [], pulled: 0, skipped: 0, offline: false } });
  const v4 = toStoreV4(store, sets);
  if (!v4) return stop("The data could not be converted for sync");
  const r = await syncOnce({ tables: v4.tables, state, remote });
  if (r.report.pulled === 0) return { changed: false, store, sets, state: r.state, report: r.report };
  const merged = { ...v4, tables: r.tables, setsInTables: true };
  const nextStore = readStore(merged);
  const nextSets = readSets(merged);
  if (!nextStore || !nextSets) return stop("What arrived could not be read, so it was not merged");
  return { changed: true, store: nextStore, sets: [...nextSets].sort(byTime), state: r.state, report: r.report };
}
