// Backup and restore helpers. Pure (no browser calls) so they can be tested.
import { cleanStore, MACHINES_FILE_TYPE } from "./store.js";

export const BACKUP_TYPE = "gymlog-backup";
export const BACKUP_VERSION = 1;

const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
const validSet = (s) =>
  !!s && typeof s === "object" && typeof s.exerciseId === "string" &&
  typeof s.time === "string" && !Number.isNaN(new Date(s.time).getTime());

// Everything that is worth keeping: the store (machines, settings) and the logged sets.
export function makeBackup({ store, sets }, now = new Date()) {
  return { type: BACKUP_TYPE, version: BACKUP_VERSION, createdAt: now.toISOString(), store, sets };
}

// kind is "backup" or "machines", e.g. gym-log-backup-2026-10-30.json (local date).
export function backupFileName(kind, now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return "gym-log-" + kind + "-" + now.getFullYear() + "-" + p(now.getMonth() + 1) + "-" + p(now.getDate()) + ".json";
}

// Reads a backup file. Returns { backup, dropped, error }; error is "" when it worked.
// Damaged sets are left out and counted in dropped.
export function parseBackup(text) {
  const fail = (error) => ({ backup: null, dropped: 0, error });
  let data;
  try { data = JSON.parse(text); }
  catch { return fail("That is not a valid file."); }
  if (!data || data.type !== BACKUP_TYPE) return fail("That is not a Gym Log backup file.");
  if (data.version !== BACKUP_VERSION) return fail("This backup was made by a different version of the app.");
  const store = cleanStore(data.store);
  if (!store) return fail("This backup was made by a different version of the app.");
  const raw = Array.isArray(data.sets) ? data.sets : [];
  const sets = raw.filter(validSet);
  return {
    backup: { store, sets, createdAt: typeof data.createdAt === "string" ? data.createdAt : null },
    dropped: raw.length - sets.length,
    error: "",
  };
}

// "backup", "machines" or null for a file we do not recognise.
export function fileKind(text) {
  try {
    const d = JSON.parse(text);
    if (d && d.type === BACKUP_TYPE) return "backup";
    if (d && d.type === MACHINES_FILE_TYPE) return "machines";
  } catch { /* not JSON */ }
  return null;
}

// Counts for the screen: sets, the days they were logged on, machines, and machines with a stack.
export function dataSummary(store, sets) {
  let machines = 0;
  let stacks = 0;
  for (const gym of Object.values((store && store.gyms) || {})) {
    for (const m of Object.values(gym.machines || {})) {
      machines++;
      if (Array.isArray(m.pins) && m.pins.length > 0) stacks++;
    }
  }
  const days = new Set(sets.map((s) => new Date(s.time).toDateString())).size;
  return { sets: sets.length, days, machines, stacks };
}

export function describeData({ sets, days, machines, stacks }) {
  const logged = plural(sets, "logged set", "logged sets") + (sets > 0 ? " over " + plural(days, "day", "days") : "");
  return logged + ", " + plural(machines, "machine", "machines") + " (" + stacks + " with a stack)";
}

// How long ago the last backup was. stale is true after a week or when there never was one.
export function backupAge(lastIso, now = new Date()) {
  const last = lastIso ? new Date(lastIso) : null;
  if (!last || Number.isNaN(last.getTime())) return { days: null, text: "never", stale: true };
  const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.max(0, Math.round((day(now) - day(last)) / 86400000));
  const text = days === 0 ? "today" : days === 1 ? "yesterday" : days + " days ago";
  return { days, text, stale: days >= 7 };
}