// All reading and writing of saved data goes through this file, so the rest of the app never touches
// the phone's storage directly. A database can replace this one file later.

// The storage names. Never rename these: the saved data lives under them.
export const KEY = Object.fromEntries(
  ["sets", "session", "settings", "done", "workout", "store", "lastBackup", "beforeRestore"].map((k) => [k, "gymlog." + k])
);

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