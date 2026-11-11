// Step 30b-1: sign-in with an emailed code, then link the sign-in to the invited person.
// Pure (the Supabase client is passed in), so it can be tested without a network.
// Nothing here knows your email address: it is typed on the phone and checked by the database's invite table.

const clean = (e) => String(e ?? "").trim().toLowerCase();

// Turns the database's and Supabase's wording into something a person can act on.
export function friendly(message) {
  const m = String(message ?? "");
  if (/No invitation/i.test(m)) return "That email address has not been invited.";
  if (/not confirmed/i.test(m)) return "That email address is not confirmed yet. Use the code that was emailed.";
  if (/already linked/i.test(m)) return "That person is already linked to another sign-in.";
  if (/expired|invalid/i.test(m)) return "That code is wrong or has expired. Ask for a new one.";
  if (/rate limit|too many|seconds/i.test(m)) return "Too many tries. Wait a minute, then try again.";
  if (/network|fetch|failed to/i.test(m)) return "No connection. Try again when you are online.";
  return "Sign-in did not work: " + m;
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

  async function sendCode(email) {
    const e = clean(email);
    if (!e.includes("@")) return { ok: false, error: "Type your email address." };
    const { error } = await client.auth.signInWithOtp({ email: e, options: { shouldCreateUser: true } });
    return error ? { ok: false, error: friendly(error.message) } : { ok: true };
  }

  // Checks the code, then links the sign-in to the invited person. If the email was not invited, signs straight back out.
  async function verifyCode(email, code) {
    const token = String(code ?? "").replace(/\s+/g, "");
    if (!/^\d{6,10}$/.test(token)) return { ok: false, error: "Type the number from the email." };
    const { error } = await client.auth.verifyOtp({ email: clean(email), token, type: "email" });
    if (error) return { ok: false, error: friendly(error.message) };
    const { data: personId, error: e2 } = await client.rpc("claim_invite");
    if (e2) {
      await client.auth.signOut();
      return { ok: false, error: friendly(e2.message) };
    }
    return { ok: true, personId };
  }

  const signOut = async () => { await client.auth.signOut(); };
  return { status, sendCode, verifyCode, signOut };
}

// Loads the saved copy of the Supabase library (vendor/supabase.js) on first use and makes a client.
// Not used in tests: it needs a browser.
export function loadClient({ url, key, doc = document, win = window }) {
  const make = () => win.supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  if (win.supabase?.createClient) return Promise.resolve(make());
  return new Promise((resolve, reject) => {
    const s = doc.createElement("script");
    s.src = "vendor/supabase.js";
    s.onload = () => (win.supabase?.createClient ? resolve(make()) : reject(new Error("The sign-in library did not load")));
    s.onerror = () => reject(new Error("The sign-in library could not be loaded"));
    doc.head.appendChild(s);
  });
}
