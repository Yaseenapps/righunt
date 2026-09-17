// Talking to Supabase without the Supabase library.
//
// The official client is 228KB, and it carries realtime websockets, file
// storage, edge functions and a query builder. This site uses none of them:
// it needs a session and a few REST calls. So that is what
// this file is - and the project keeps its rule of no build step and no
// frontend dependencies.
//
// Nothing secret is here. The publishable key below is meant to be read by
// anyone who views source; it grants nothing on its own. What actually keeps
// one visitor's saved list away from another is the Row Level Security policies in
// supabase/schema.sql, enforced by the database rather than by this code.

const SUPABASE_URL = 'https://nqntsolftwwbgveouptv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_M7dZgWGd6IwzBtsAyryiOQ_XNRG8XZj';

const SESSION_KEY = 'righunt.session';

/* ---------------------------------------------------------------------------
 * The session
 *
 * Nobody signs up. The first time a browser opens the site it is signed in
 * anonymously, which costs the visitor nothing and asks them nothing, but
 * gives them a real account - which is what lets a saved list belong to someone.
 *
 * The session is kept in localStorage so the same browser comes back as the
 * same person tomorrow. If it is ever lost, the visitor silently becomes a
 * new anonymous account with nothing saved. That is the honest cost of not
 * asking anyone to sign up, and it is why signing in with Google later is
 * worth adding: it makes a saved list survive a cleared browser.
 * ------------------------------------------------------------------------ */

let session = null;
let inflight = null;

function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return s && s.access_token && s.refresh_token ? s : null;
  } catch {
    return null;
  }
}

function keep(json) {
  if (!json || !json.access_token) return null;
  session = {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    // expires_in is seconds from now. Storing an absolute moment means a
    // browser that was asleep for an hour knows its token is stale.
    expires_at: Date.now() + (json.expires_in ?? 3600) * 1000,
    user_id: json.user?.id ?? session?.user_id ?? null,
  };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* private mode */ }
  return session;
}

async function authPost(path, body) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) return null;
  return r.json();
}

const signInAnonymously = () => authPost('signup', { data: {} });
const refreshWith = (token) => authPost('token?grant_type=refresh_token', { refresh_token: token });

/**
 * The current session, creating or renewing one if needed.
 * Returns null when Supabase cannot be reached - callers fall back to
 * the browser's own copy rather than failing.
 */
export async function auth() {
  // A minute of headroom: a token that expires mid-request is a 401 for the
  // visitor, and retrying that costs a round trip.
  if (session && session.expires_at - Date.now() > 60_000) return session;

  // One sign-in at a time. Without this, a page that paints the saved list and the
  // header at once would create two anonymous accounts on a first visit.
  if (inflight) return inflight;

  inflight = (async () => {
    const stored = session || loadSession();
    if (stored) {
      const renewed = await refreshWith(stored.refresh_token);
      if (renewed) return keep(renewed);
      // The refresh token was revoked, or the account was deleted from the
      // dashboard. Start again rather than leaving the site signed out.
      session = null;
    }
    return keep(await signInAnonymously());
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

export const userId = () => session?.user_id ?? null;

/* ---------------------------------------------------------------------------
 * The database
 *
 * One helper over PostgREST. Every call carries the session, so the policies
 * in the schema decide what it can see - this code never filters by user id
 * for security, only for clarity.
 * ------------------------------------------------------------------------ */

export async function db(path, { method = 'GET', body, prefer } = {}) {
  const s = await auth();
  if (!s) throw new Error('supabase-unreachable');

  const send = (token) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : null),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let r = await send(s.access_token);

  // A token can die earlier than it claimed - the project's JWT secret was
  // rotated, or the account was removed. One forced renewal, then give up.
  if (r.status === 401) {
    session = null;
    const fresh = await auth();
    if (!fresh) throw new Error('supabase-unreachable');
    r = await send(fresh.access_token);
  }

  if (!r.ok) throw new Error(`supabase ${r.status}: ${await r.text()}`);

  // A successful write can legitimately come back with nothing in it.
  // `Prefer: return=minimal` answers 201 and an empty body, not 204, so
  // checking the status alone is not enough - and calling .json() on an
  // empty string throws. That throw arrives *after* the row has been
  // written, so it reads as a failed write that actually succeeded. Read the
  // body first, and only parse it if there is one.
  if (r.status === 204) return null;
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}
