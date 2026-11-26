// Step 29c: the connection to the online database, for the sync engine (sync.js). It talks to Supabase's web service
// (PostgREST) with plain fetch, signed in as the person (a token from getToken), so the database's own rules decide
// what is allowed. Not used by the app yet. url and key are the project address and the PUBLISHABLE key, which are
// meant to be public; the person's token is what grants access. Never put the secret (service) key in the app.
//   const remote = makeRemote({ url, key, getToken });   // getToken: async () => the signed-in person's token, or null
//   remote.push(changes) -> { done, failed }     remote.pull(cursor) -> { rows, deletes, cursor }
// (person and gym rows are sent as a PATCH, with create_gym for a gym that is not online yet: step 84.)
// A network problem, a sign-in that has run out (401) or a server error (5xx) throws, so the sync engine treats the
// round as offline and keeps everything queued. A refusal for one row (4xx, such as a rule saying no) is reported
// for that row only.
import { SYNC_TABLES, SYNC_PK, pkOfKey } from "./sync.js";
import { toDbRow, fromDbRow, dbColumns, snake } from "./dbload.js";

const BATCH = 200;
const pkCols = (table) => SYNC_PK[table].map(snake);
const enc = encodeURIComponent;

export function makeRemote({ url, key, getToken, fetchFn = (...a) => fetch(...a), pageSize = 1000, overlapMs = 5 * 60 * 1000 }) {
  const base = url.replace(/\/+$/, "") + "/rest/v1/";

  async function call(method, path, { body, headers = {} } = {}) {
    const token = await getToken();
    if (!token) throw new Error("Not signed in");
    const res = await fetchFn(base + path, {
      method,
      headers: { apikey: key, Authorization: "Bearer " + token, "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) throw new Error("Signed out");
    if (res.status >= 500) throw new Error("Server error " + res.status);
    return res;
  }
  // only the code and message of a refusal, never the row
  async function refusal(res) {
    let code = "";
    let message = "";
    try { const j = await res.json(); code = j.code ?? ""; message = String(j.message ?? "").slice(0, 120); } catch { /* no body */ }
    return `${res.status} ${code} ${message}`.trim();
  }

  // consecutive changes to one table with the same operation go together; deletes go one at a time.
  // person and gym rows go one at a time as well: the row rules refuse an upsert for them (see sendOwn).
  const OWN = new Set(["person", "gym"]);
  function groups(changes) {
    const out = [];
    for (const c of changes) {
      const last = out[out.length - 1];
      if (c.op === "upsert" && !OWN.has(c.table) && last && last.op === "upsert" && last.table === c.table && last.items.length < BATCH) last.items.push(c);
      else out.push({ op: c.op, table: c.table, items: [c] });
    }
    return out;
  }
  const refused = (message) => ({ ok: false, status: 400, json: async () => ({ message }) });
  // Step 84: a person or gym row is a plain PATCH by primary key (an upsert is refused by the row rules: it needs the insert rule, which
  // people and gyms no longer have). Every other column is sent too, blank ones as null, so a cleared value is cleared online as well.
  // PATCH answers with the rows it changed. None means this gym is not online yet (or is not yours): create_gym makes it with you as its
  // owner (a gym id that is someone else's is refused there), then the PATCH sets the other columns. A person always exists online.
  async function sendOwn(table, row) {
    const pk = pkCols(table)[0];
    const db = toDbRow(table, row);
    const body = Object.fromEntries(dbColumns(table).filter((c) => c !== pk).map((c) => [c, db[c] ?? null]));
    const path = `${table}?${pk}=eq.${enc(db[pk])}`;
    const patch = async () => {
      const res = await call("PATCH", path, { body, headers: { Prefer: "return=representation" } });
      return res.ok ? { res, found: (await res.json()).length > 0 } : { res };
    };
    let r = await patch();
    if (!r.res.ok || r.found) return r.res;
    if (table !== "gym") return refused("That person is not online");
    const made = await call("POST", "rpc/create_gym", { body: { g: db.id, n: db.name } });
    if (!made.ok) return made;
    r = await patch();
    return r.res.ok && !r.found ? refused("That gym could not be saved online") : r.res;
  }
  async function send(g) {
    if (g.op === "upsert" && OWN.has(g.table)) return sendOwn(g.table, g.items[0].row);
    if (g.op === "upsert") {
      const path = `${g.table}?on_conflict=${pkCols(g.table).join(",")}&columns=${dbColumns(g.table).join(",")}`;
      return call("POST", path, { body: g.items.map((c) => toDbRow(g.table, c.row)), headers: { Prefer: "resolution=merge-duplicates,return=minimal" } });
    }
    const vals = pkOfKey(g.items[0].key);
    return call("DELETE", `${g.table}?` + pkCols(g.table).map((c, i) => `${c}=eq.${enc(vals[i])}`).join("&"), { headers: { Prefer: "return=minimal" } });
  }

  async function push(changes) {
    const done = [];
    const failed = [];
    for (const g of groups(changes)) {
      const res = await send(g);
      if (res.ok) { done.push(...g.items.map((c) => c.key)); continue; }
      if (g.items.length === 1) { failed.push({ key: g.items[0].key, error: await refusal(res) }); continue; }
      for (const c of g.items) {                                  // find out which row of the group is refused
        const one = await send({ op: "upsert", table: g.table, items: [c] });
        if (one.ok) done.push(c.key); else failed.push({ key: c.key, error: await refusal(one) });
      }
    }
    return { done, failed };
  }

  async function pages(path) {
    const all = [];
    for (let from = 0; ; from += pageSize) {
      const res = await call("GET", path, { headers: { "Range-Unit": "items", Range: `${from}-${from + pageSize - 1}` } });
      if (!res.ok) throw new Error("Could not read: " + (await refusal(res)));
      const rows = await res.json();
      all.push(...rows);
      if (rows.length < pageSize) return all;
    }
  }

  // everything that changed since the cursor (a little earlier, so a row saved just as the last pull ran is not missed;
  // the engine ignores rows it already has)
  async function pull(cursor) {
    const since = cursor ? new Date(Date.parse(cursor) - overlapMs).toISOString() : null;
    let newest = cursor;
    const note = (t) => { if (t && (!newest || Date.parse(t) > Date.parse(newest))) newest = t; };
    const rows = [];
    for (const table of SYNC_TABLES) {
      const filter = since ? `&updated_at=gte.${enc(since)}` : "";
      const order = ["updated_at", ...pkCols(table)].join(",");
      for (const r of await pages(`${table}?select=*${filter}&order=${order}`)) {
        note(r.updated_at);
        rows.push({ table, row: fromDbRow(table, r) });
      }
    }
    const deletes = [];
    const filter = since ? `&deleted_at=gte.${enc(since)}` : "";
    for (const r of await pages(`deleted_row?select=key,deleted_at${filter}&order=deleted_at,key`)) {
      note(r.deleted_at);
      deletes.push({ key: r.key });
    }
    return { rows, deletes, cursor: newest ?? null };
  }

  return { push, pull };
}
