// Step 30b-1: the sign-in steps, tested with a pretend Supabase client (no network).
import test from "node:test";
import assert from "node:assert/strict";
import { makeAuth, friendly } from "./auth.js";

// A pretend client that records what it was asked and answers from the settings given.
function pretend({ session = null, otpError = null, verifyError = null, claim = { data: "awp" } } = {}) {
  const calls = [];
  const client = {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      signInWithOtp: async (a) => { calls.push(["otp", a]); return { error: otpError }; },
      verifyOtp: async (a) => { calls.push(["verify", a]); return { error: verifyError }; },
      signOut: async () => { calls.push(["signOut"]); },
    },
    rpc: async (name) => { calls.push(["rpc", name]); return claim; },
  };
  return { calls, auth: makeAuth({ client }) };
}

test("a code is requested for the typed email, trimmed and in lower case", async () => {
  const { calls, auth } = pretend();
  assert.deepEqual(await auth.sendCode("  Me@Example.COM "), { ok: true });
  assert.deepEqual(calls[0], ["otp", { email: "me@example.com", options: { shouldCreateUser: true } }]);
});

test("something that is not an email address is not sent", async () => {
  const { calls, auth } = pretend();
  assert.equal((await auth.sendCode("nope")).ok, false);
  assert.equal(calls.length, 0);
});

test("a code error comes back in plain words", async () => {
  const { auth } = pretend({ otpError: { message: "email rate limit exceeded" } });
  assert.match((await auth.sendCode("a@b.co")).error, /Too many tries/);
});

test("the right code signs in and links the person", async () => {
  const { calls, auth } = pretend();
  assert.deepEqual(await auth.verifyCode("A@B.co", "123 456"), { ok: true, personId: "awp" });
  assert.deepEqual(calls[0], ["verify", { email: "a@b.co", token: "123456", type: "email" }]);
  assert.deepEqual(calls[1], ["rpc", "claim_invite"]);
});

test("a wrong or expired code fails and does not try to link", async () => {
  const { calls, auth } = pretend({ verifyError: { message: "Token has expired or is invalid" } });
  const r = await auth.verifyCode("a@b.co", "000000");
  assert.equal(r.ok, false);
  assert.match(r.error, /wrong or has expired/);
  assert.equal(calls.some((c) => c[0] === "rpc"), false);
});

test("a code that is not a number is not sent", async () => {
  const { calls, auth } = pretend();
  assert.equal((await auth.verifyCode("a@b.co", "abc")).ok, false);
  assert.equal(calls.length, 0);
});

test("an email that was not invited is signed straight back out", async () => {
  const { calls, auth } = pretend({ claim: { data: null, error: { message: "No invitation for this email" } } });
  const r = await auth.verifyCode("x@y.co", "123456");
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
