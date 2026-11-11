// Step 29a: the sync engine. Pure logic (no network, no browser): it works out what changed on this phone, pushes it,
// pulls what changed elsewhere, and merges. The connection itself is a `remote` object supplied by the caller:
//   remote.push(changes) -> { done: [key], failed: [{ key, error }] }       changes are in a safe order
//   remote.pull(cursor)  -> { rows: [{ table, row }], deletes: [{ key }], cursor }   everything changed since the cursor
// Rule: the last change to ARRIVE at the server wins, row by row (the server stamps the time, so a phone's clock does
// not matter). Logged sets are only ever added (an undo is the one delete). Nothing is lost if the phone is offline:
// the changes wait in a queue.
//
// state = { snapshot: { key: hash }, queue: { key: change }, cursor }   saved on the phone beside the data
// key   = "table|[primary key values]"   change = { key, table, op: "upsert" | "delete", row? }
import { LOAD_ORDER } from "./dbload.js";

const PK = {
  exercise: ["id"], person: ["id"], gym: ["id"], gym_member: ["personId", "gymId"], gym_equipment: ["gymId", "id"],
  personal_setup: ["personId", "gymId", "exerciseId", "dayType"], workout: ["id"], workout_type: ["id"],
  workout_exercise: ["id"], logged_set: ["id"],
};
// equipment_type and exercise_type are fixed lists that only the laptop changes, so they are never synced.
export const SYNC_PK = PK;
export const SYNC_TABLES = LOAD_ORDER.filter((t) => PK[t]);
// An exercise row is only ever added (nobody may change or delete one from a phone).
const INSERT_ONLY = new Set(["exercise"]);

export const emptySync = () => ({ snapshot: {}, queue: {}, cursor: null });

// A logged set's place in this phone's own list (seq) means nothing to another phone and shifts whenever sets from
// elsewhere arrive, so it is never synced; the sets are ordered by their time instead.
export const syncRow = (table, row) => {
  if (table !== "logged_set" || !("seq" in row)) return row;
  const { seq, ...rest } = row;
  return rest;
};

export function rowKey(table, row) {
  return table + "|" + JSON.stringify(PK[table].map((k) => (k === "dayType" ? row[k] ?? "none" : row[k] ?? null)));
}
export const tableOfKey = (key) => key.slice(0, key.indexOf("|"));
export const pkOfKey = (key) => JSON.parse(key.slice(key.indexOf("|") + 1));

const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).filter(([, y]) => y !== null && y !== undefined).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
// a short fingerprint of a row (cyrb53), so the phone keeps a few bytes per row instead of a second copy
export function hashRow(row) {
  const s = canon(row);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// What changed in `tables` since the snapshot. Returns { changes, snapshot } (the snapshot as it is now).
export function detectChanges(snapshot, tables) {
  const now = {};
  const changes = [];
  for (const table of SYNC_TABLES) {
    for (const full of tables[table] ?? []) {
      const row = syncRow(table, full);
      const key = rowKey(table, row);
      const hash = hashRow(row);
      now[key] = hash;
      if (snapshot[key] === hash) continue;
      if (INSERT_ONLY.has(table) && key in snapshot) continue;
      changes.push({ key, table, op: "upsert", row });
    }
  }
  for (const key of Object.keys(snapshot)) {
    if (key in now) continue;
    const table = tableOfKey(key);
    if (INSERT_ONLY.has(table)) { now[key] = snapshot[key]; continue; }
    changes.push({ key, table, op: "delete" });
  }
  return { changes, snapshot: now };
}

// Deletes of children first, then adds and changes with parents first: a delete never leaves an orphan and an add
// never arrives before its parent.
export function orderChanges(changes) {
  const rank = (c) => LOAD_ORDER.indexOf(c.table);
  const dels = changes.filter((c) => c.op === "delete").sort((a, b) => rank(b) - rank(a));
  const ups = changes.filter((c) => c.op === "upsert").sort((a, b) => rank(a) - rank(b));
  return [...dels, ...ups];
}

// The latest change to a row replaces any earlier waiting one.
export const queueChanges = (queue, changes) => {
  const q = { ...queue };
  for (const c of changes) q[c.key] = c;
  return q;
};

// Applies what was pulled. Rows with a change still waiting in the queue are left alone: when that change is pushed
// it arrives last and wins. Returns { tables, snapshot, pulled, skipped }.
export function applyPulled(tables, snapshot, queue, pulled) {
  const maps = {};
  const mapOf = (t) => (maps[t] ??= new Map((tables[t] ?? []).map((r) => [rowKey(t, r), r])));
  const snap = { ...snapshot };
  let count = 0;
  let skipped = 0;
  const touched = new Set();
  for (const { table, row: got } of pulled.rows ?? []) {
    if (!PK[table]) continue;
    const row = syncRow(table, got);
    const key = rowKey(table, row);
    if (queue[key]) { skipped++; continue; }
    const hash = hashRow(row);
    if (snap[key] === hash && mapOf(table).has(key)) continue;
    mapOf(table).set(key, row);
    snap[key] = hash;
    touched.add(table);
    count++;
  }
  for (const { key } of pulled.deletes ?? []) {
    const table = tableOfKey(key);
    if (!PK[table]) continue;
    if (queue[key]) { skipped++; continue; }
    if (mapOf(table).delete(key)) { touched.add(table); count++; }
    delete snap[key];
  }
  const next = { ...tables };
  for (const t of touched) next[t] = [...maps[t].values()];
  return { tables: next, snapshot: snap, pulled: count, skipped };
}

// One round: note local changes, push the queue, pull, merge.
// Returns { tables, state, report: { queued, pushed, failed: [{ key, error }], pulled, skipped, offline } }.
// If the connection fails, nothing is lost: the changes stay queued and the data is unchanged.
export async function syncOnce({ tables, state = emptySync(), remote }) {
  const found = detectChanges(state.snapshot, tables);
  let queue = queueChanges(state.queue, found.changes);
  let snapshot = found.snapshot;
  const report = { queued: found.changes.length, pushed: 0, failed: [], pulled: 0, skipped: 0, offline: false };
  const keep = () => ({ tables, state: { snapshot, queue, cursor: state.cursor }, report });
  try {
    const waiting = orderChanges(Object.values(queue));
    if (waiting.length) {
      const r = await remote.push(waiting);
      for (const key of r.done ?? []) { delete queue[key]; report.pushed++; }
      queue = { ...queue };
      report.failed = r.failed ?? [];
    }
    const pulled = await remote.pull(state.cursor);
    const merged = applyPulled(tables, snapshot, queue, pulled);
    report.pulled = merged.pulled;
    report.skipped = merged.skipped;
    return { tables: merged.tables, state: { snapshot: merged.snapshot, queue, cursor: pulled.cursor ?? state.cursor }, report };
  } catch (e) {
    report.offline = true;
    report.error = String(e?.message ?? e);
    return keep();
  }
}
