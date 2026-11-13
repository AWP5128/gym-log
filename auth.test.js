// Steps 30b-1 and 30b-2: the sign-in steps (one-time password, then passkeys), tested with a pretend Supabase client (no network).
import test from "node:test";
import assert from "node:assert/strict";
import { makeAuth, friendly, friendlyPasskey, loadClient } from "./auth.js";

// A pretend client that records what it was asked and answers from the settings given.
function pretend({ session = null, passwordError = null, claim = { data: "awp" } } = {}) {
  const calls = [];
  const client = {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      signInWithPassword: async (a) => { calls.push(["password", a]); return { error: passwordError }; },
      signOut: async () => { calls.push(["signOut"]); },
    },
    rpc: async (name) => { calls.push(["rpc", name]); return claim; },
  };
  return { calls, auth: makeAuth({ client }) };
}

test("first sign-in uses the typed email (trimmed, lower case) and the password, then links the person", async () => {
  const { calls, auth } = pretend();
  assert.deepEqual(await auth.signInFirst("  Me@Example.COM ", "long-one-time"), { ok: true, personId: "awp" });
  assert.deepEqual(calls[0], ["password", { email: "me@example.com", password: "long-one-time" }]);
  assert.deepEqual(calls[1], ["rpc", "claim_invite"]);
});

test("something that is not an email address, or a missing password, is not sent", async () => {
  const { calls, auth } = pretend();
  assert.equal((await auth.signInFirst("nope", "x")).ok, false);
  assert.equal((await auth.signInFirst("a@b.co", "")).ok, false);
  assert.equal(calls.length, 0);
});

test("a wrong password fails in plain words and does not try to link", async () => {
  const { calls, auth } = pretend({ passwordError: { message: "Invalid login credentials" } });
  const r = await auth.signInFirst("a@b.co", "bad");
  assert.equal(r.ok, false);
  assert.match(r.error, /wrong/);
  assert.equal(calls.some((c) => c[0] === "rpc"), false);
});

test("an email that was not invited is signed straight back out", async () => {
  const { calls, auth } = pretend({ claim: { data: null, error: { message: "No invitation for this email" } } });
  const r = await auth.signInFirst("x@y.co", "pw");
  assert.equal(r.ok, false);
  assert.match(r.error, /has not been invited/);
  assert.equal(calls.at(-1)[0], "signOut");
});

test("status: signed out, and signed in with the linked person", async () => {
  assert.deepEqual(await pretend().auth.status(), { signedIn: false });
  const s = pretend({ session: { user: { email: "me@example.com" } } });
  assert.deepEqual(await s.auth.status(), { signedIn: true, email: "me@example.com", personId: "awp" });
});

test("status: signed in but not invited shows the problem, without crashing", async () => {
  const s = pretend({ session: { user: { email: "x@y.co" } }, claim: { data: null, error: { message: "No invitation for this email" } } });
  const st = await s.auth.status();
  assert.equal(st.signedIn, true);
  assert.equal(st.personId, null);
  assert.match(st.problem, /not been invited/);
});

test("sign out asks Supabase to sign out", async () => {
  const { calls, auth } = pretend();
  await auth.signOut();
  assert.deepEqual(calls, [["signOut"]]);
});

test("friendly wording for the database errors", () => {
  assert.match(friendly("Email not confirmed"), /not confirmed/);
  assert.match(friendly("That person is already linked to another sign-in"), /already linked/);
  assert.match(friendly("boom"), /boom/);
});

// ---- Step 30b-2: passkeys ----
function pretendPk({ sign = { data: { session: { access_token: "t" }, user: { email: "me@example.com" } }, error: null }, reg = { data: { id: "p1" }, error: null }, list = { data: [], error: null }, update = { error: null }, claim = { data: "awp" } } = {}) {
  const calls = [];
  const client = {
    auth: {
      signInWithPasskey: async () => { calls.push(["pkSignIn"]); return sign; },
      registerPasskey: async () => { calls.push(["pkRegister"]); return reg; },
      passkey: { list: async () => { if (list instanceof Error) throw list; return list; } },
      updateUser: async (a) => { calls.push(["update", a]); return update; },
    },
    rpc: async (name) => { calls.push(["rpc", name]); return claim; },
  };
  return { calls, auth: makeAuth({ client }) };
}

test("passkey sign-in takes no typing and links the person", async () => {
  const { calls, auth } = pretendPk();
  assert.deepEqual(await auth.signInPasskey(), { ok: true, personId: "awp", email: "me@example.com" });
  assert.deepEqual(calls, [["pkSignIn"], ["rpc", "claim_invite"]]);
});

test("a failed or cancelled passkey sign-in says so in plain words and does not link", async () => {
  const { calls, auth } = pretendPk({ sign: { data: null, error: { code: "webauthn_credential_not_found", message: "x" } } });
  const r = await auth.signInPasskey();
  assert.equal(r.ok, false);
  assert.match(r.error, /one-time password/);
  assert.equal(calls.some((c) => c[0] === "rpc"), false);
  const c = pretendPk({ sign: { data: null, error: { name: "NotAllowedError", message: "The operation was cancelled" } } });
  assert.match((await c.auth.signInPasskey()).error, /cancelled/);
});

test("a client without passkey support is handled", async () => {
  const auth = makeAuth({ client: { auth: {}, rpc: async () => ({}) } });
  assert.match((await auth.signInPasskey()).error, /not available/);
  assert.match((await auth.addPasskey()).error, /not available/);
  assert.equal(await auth.passkeyCount(), null);
});

test("adding a passkey: success and a duplicate", async () => {
  assert.deepEqual(await pretendPk().auth.addPasskey(), { ok: true, passkey: { id: "p1" } });
  const d = pretendPk({ reg: { data: null, error: { code: "webauthn_credential_exists", message: "x" } } });
  assert.match((await d.auth.addPasskey()).error, /already has a passkey/);
});

test("passkey count reads a list, a {data} answer, and gives null on any trouble", async () => {
  assert.equal(await pretendPk({ list: { data: [{ id: "a" }, { id: "b" }], error: null } }).auth.passkeyCount(), 2);
  assert.equal(await pretendPk({ list: [{ id: "a" }] }).auth.passkeyCount(), 1);
  assert.equal(await pretendPk({ list: { data: null, error: { message: "no" } } }).auth.passkeyCount(), null);
  assert.equal(await pretendPk({ list: new Error("offline") }).auth.passkeyCount(), null);
});

test("retiring the one-time password sets a long random url-safe password, new each time", async () => {
  const { calls, auth } = pretendPk();
  let n = 0;
  const rand = { getRandomValues: (b) => { b.fill(++n); return b; } };
  assert.deepEqual(await auth.retirePassword(rand), { ok: true });
  await auth.retirePassword(rand);
  const [p1, p2] = calls.filter((c) => c[0] === "update").map((c) => c[1].password);
  assert.match(p1, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(p1, p2);
});

test("retiring reports a refusal and says the password was not changed", async () => {
  const { auth } = pretendPk({ update: { error: { message: "Reauthentication needed" } } });
  const r = await auth.retirePassword({ getRandomValues: (b) => b });
  assert.equal(r.ok, false);
  assert.match(r.error, /not changed/);
});

test("friendlyPasskey wording for each Supabase code", () => {
  assert.match(friendlyPasskey({ code: "passkey_disabled" }), /not switched on/);
  assert.match(friendlyPasskey({ error_code: "too_many_passkeys" }), /too many/);
  assert.match(friendlyPasskey({ code: "webauthn_challenge_expired" }), /too long/);
  assert.match(friendlyPasskey({ code: "webauthn_verification_failed" }), /not accepted/);
  assert.match(friendlyPasskey({ code: "user_banned" }), /switched off/);
  assert.match(friendlyPasskey({ message: "boom" }), /boom/);
});

test("the library client is made with the passkey option switched on", async () => {
  let seen;
  const win = { supabase: { createClient: (u, k, o) => { seen = { u, k, o }; return {}; } } };
  await loadClient({ url: "https://x.supabase.co", key: "sb_publishable_x", doc: {}, win });
  assert.equal(seen.o.auth.experimental.passkey, true);
  assert.equal(seen.o.auth.persistSession, true);
});
