// Step 30b-1: the sign-in steps (first sign-in with a one-time password), tested with a pretend Supabase client (no network).
import test from "node:test";
import assert from "node:assert/strict";
import { makeAuth, friendly } from "./auth.js";

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
