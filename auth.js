// Step 30b-1: first sign-in with a one-time password made by the owner, then link the sign-in to the invited person.
// Step 30b-2 adds passkeys, which replace the password afterwards. No email is sent: the free plan's built-in sender cannot be used.
// Pure (the Supabase client is passed in), so it can be tested without a network.
// Nothing here knows your email address: it is typed on the phone and checked by the database's invite table.

const clean = (e) => String(e ?? "").trim().toLowerCase();

// Turns the database's and Supabase's wording into something a person can act on.
export function friendly(message) {
  const m = String(message ?? "");
  if (/No invitation/i.test(m)) return "That email address has not been invited.";
  if (/not confirmed/i.test(m)) return "That email address is not confirmed yet. Ask the owner to confirm it in the dashboard.";
  if (/already linked/i.test(m)) return "That person is already linked to another sign-in.";
  if (/invalid login|invalid credentials|invalid/i.test(m)) return "That email or one-time password is wrong. Check both.";
  if (/rate limit|too many|seconds/i.test(m)) return "Too many tries. Wait a minute, then try again.";
  if (/network|fetch|failed to/i.test(m)) return "No connection. Try again when you are online.";
  return "Sign-in did not work: " + m;
}

// Passkey errors (Supabase beta): the code is in error.code or error.error_code; the browser's own errors have a name.
export function friendlyPasskey(err) {
  const code = String(err?.code ?? err?.error_code ?? err?.name ?? "");
  const m = String(err?.message ?? "");
  if (code === "passkey_disabled") return "Passkeys are not switched on for this project yet.";
  if (code === "too_many_passkeys") return "This account has too many passkeys. Remove one first.";
  if (code === "webauthn_credential_exists") return "This device already has a passkey for you.";
  if (code === "webauthn_credential_not_found") return "No passkey found for this account. Use your one-time password.";
  if (code === "webauthn_challenge_expired" || code === "webauthn_challenge_not_found") return "That took too long. Try again.";
  if (code === "webauthn_verification_failed") return "The passkey was not accepted. Try again.";
  if (code === "email_not_confirmed") return "That email address is not confirmed yet.";
  if (code === "user_banned") return "This account is switched off.";
  if (/NotAllowed|ABORT|CANCEL/i.test(code) || /cancel|abort|not allowed/i.test(m)) return "Passkey cancelled.";
  if (/network|fetch|failed to/i.test(m)) return "No connection. Try again when you are online.";
  return "Passkey did not work: " + (m || code || "unknown error");
}

export function makeAuth({ client }) {
  // Who is signed in right now, and which person they are. The link call is safe to repeat.
  async function status() {
    const { data, error } = await client.auth.getSession();
    const session = data?.session;
    if (error || !session) return { signedIn: false };
    const email = session.user?.email ?? "";
    const { data: personId, error: e2 } = await client.rpc("claim_invite");
    if (e2) return { signedIn: true, email, personId: null, problem: friendly(e2.message) };
    return { signedIn: true, email, personId };
  }

  // First sign-in: the email and the one-time password the owner made in the dashboard (no email is sent anywhere).
  // Then links the sign-in to the invited person. If the email was not invited, signs straight back out.
  async function signInFirst(email, password) {
    const e = clean(email);
    if (!e.includes("@")) return { ok: false, error: "Type your email address." };
    if (!password) return { ok: false, error: "Type the one-time password." };
    const { error } = await client.auth.signInWithPassword({ email: e, password: String(password) });
    if (error) return { ok: false, error: friendly(error.message) };
    const { data: personId, error: e2 } = await client.rpc("claim_invite");
    if (e2) {
      await client.auth.signOut();
      return { ok: false, error: friendly(e2.message) };
    }
    return { ok: true, personId };
  }

  const signOut = async () => { await client.auth.signOut(); };

  // Passkeys (step 30b-2, Supabase beta). Sign in with no typing: the phone offers its saved passkey (Face ID or PIN).
  async function signInPasskey() {
    if (typeof client.auth.signInWithPasskey !== "function") return { ok: false, error: "Passkeys are not available in this browser." };
    const { data, error } = await client.auth.signInWithPasskey();
    if (error || !data?.session) return { ok: false, error: friendlyPasskey(error ?? { message: "no session returned" }) };
    const { data: personId, error: e2 } = await client.rpc("claim_invite");
    if (e2) return { ok: true, personId: null, email: data.user?.email ?? "", problem: friendly(e2.message) };
    return { ok: true, personId, email: data.user?.email ?? "" };
  }

  // Needs a signed-in person. Makes a passkey on this device.
  async function addPasskey() {
    if (typeof client.auth.registerPasskey !== "function") return { ok: false, error: "Passkeys are not available in this browser." };
    const { data, error } = await client.auth.registerPasskey();
    if (error) return { ok: false, error: friendlyPasskey(error) };
    return { ok: true, passkey: data };
  }

  // How many passkeys the signed-in person has; null when it cannot be read (nothing breaks).
  async function passkeyCount() {
    try {
      const r = await client.auth.passkey.list();
      const list = Array.isArray(r) ? r : r?.data;
      return r?.error || !Array.isArray(list) ? null : list.length;
    } catch { return null; }
  }

  // Replaces the one-time password with a random one nobody knows. Only after a passkey sign-in has worked.
  async function retirePassword(rand = globalThis.crypto) {
    const bytes = rand.getRandomValues(new Uint8Array(32));
    const password = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const { error } = await client.auth.updateUser({ password });
    if (error) return { ok: false, error: "The one-time password was not changed: " + String(error.message ?? error) };
    return { ok: true };
  }

  return { status, signInFirst, signOut, signInPasskey, addPasskey, passkeyCount, retirePassword };
}

// Loads the saved copy of the Supabase library (vendor/supabase.js) on first use and makes a client.
// Not used in tests: it needs a browser.
export function loadClient({ url, key, doc = document, win = window }) {
  const make = () => win.supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, experimental: { passkey: true } } });
  if (win.supabase?.createClient) return Promise.resolve(make());
  return new Promise((resolve, reject) => {
    const s = doc.createElement("script");
    s.src = "vendor/supabase.js";
    s.onload = () => (win.supabase?.createClient ? resolve(make()) : reject(new Error("The sign-in library did not load")));
    s.onerror = () => reject(new Error("The sign-in library could not be loaded"));
    doc.head.appendChild(s);
  });
}
