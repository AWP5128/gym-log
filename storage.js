// All reading and writing of saved data goes through this file, so the rest of the app never touches
// the phone's storage directly. A database can replace this one file later.

// The storage names. Never rename these: the saved data lives under them.
// unreadable holds saved data this version could not read, kept before a fresh store is made.
// sync holds the sync engine's own notes (what was last sent, what is waiting, where it got to), step29d.
export const KEY = Object.fromEntries(
  ["session", "done", "workout", "store", "lastBackup", "beforeRestore", "sync", "unreadable"].map((k) => [k, "gymlog." + k])
);

// Old names the app no longer reads or writes (the flat sets and settings of the first versions, and the safety copies made
// by the upgrades to gyms, version 4 and stage C). They are removed from the phone once, by removeOldKeys.
export const OLD_KEYS = ["sets", "settings", "beforeGyms", "beforeV4", "beforeStageC"].map((k) => "gymlog." + k);

export function removeOldKeys() {
  try { for (const k of OLD_KEYS) localStorage.removeItem(k); }
  catch { /* storage unavailable: nothing to remove */ }
}

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

export function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* storage unavailable: the app still works for this visit */ }
}

// A saved list, or an empty one when nothing valid is saved.
export function loadList(key) {
  const value = load(key, []);
  return Array.isArray(value) ? value : [];
}