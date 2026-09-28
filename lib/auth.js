/**
 * Client-side session handling for HALO.
 *
 * HALO asks for a home address before it can say anything useful, so a signup
 * wall would kill the first run. Instead every device silently gets an
 * anonymous Supabase user on load: a real auth.users row, which satisfies the
 * daily_scores -> profiles -> auth.users foreign key chain, lets RLS scope data
 * to one household, and can later be converted to a real email account with the
 * same uid and all its history intact.
 *
 * Sessions live in localStorage. `lib/supabase.js` needs no configuration for
 * this -- supabase-js already defaults to persistSession + autoRefreshToken.
 */

'use client';

import { supabase } from './supabase';

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Give up on the CAPTCHA rather than leave the user staring at a spinner. */
const TURNSTILE_TIMEOUT_MS = 12000;

/**
 * Single-flight guard. React 19 StrictMode invokes effects twice in dev, and a
 * dashboard can easily mount two components that both want a session. Without
 * this, concurrent callers each fire signInAnonymously and we mint two
 * throwaway users for one device -- the second one silently orphaning the
 * first one's profile row.
 */
let sessionPromise = null;
let resetPromise = null;
let recoveryPromise = null;

function isBrowser() {
  return typeof window !== 'undefined';
}

/* ─────────────────────────────────────────────
   Cloudflare Turnstile (invisible)
───────────────────────────────────────────── */

let turnstileScriptPromise = null;

function loadTurnstileScript() {
  if (turnstileScriptPromise) return turnstileScriptPromise;

  turnstileScriptPromise = new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const existing = document.querySelector(`script[src="${TURNSTILE_SCRIPT}"]`);
    const script = existing ?? document.createElement('script');
    const cleanup = () => {
      clearTimeout(timer);
      script.removeEventListener('load', loaded);
      script.removeEventListener('error', failed);
    };
    const failed = () => {
      cleanup();
      // A failed script tag must not be reused: its load/error events will never
      // fire again, which would otherwise leave every later retry hanging.
      script.remove();
      reject(new Error('Turnstile script failed to load'));
    };
    const loaded = () => {
      if (!window.turnstile) { failed(); return; }
      cleanup();
      resolve(window.turnstile);
    };
    const timer = setTimeout(failed, TURNSTILE_TIMEOUT_MS);
    script.addEventListener('load', loaded);
    script.addEventListener('error', failed);
    if (!existing) {
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }).catch((error) => {
    // Let a later attempt retry from scratch instead of caching the failure
    // forever -- a blocked network at first load is often fine on retry.
    turnstileScriptPromise = null;
    throw error;
  });

  return turnstileScriptPromise;
}

/**
 * Resolves to a CAPTCHA token, or to null when Turnstile is not configured.
 *
 * Returning null is a deliberate no-op path: with no site key set the whole
 * mechanism is skipped and sign-in proceeds unguarded, so the app ships and
 * runs today and CAPTCHA switches on the moment the key is added.
 */
async function getCaptchaToken() {
  if (!TURNSTILE_SITE_KEY || !isBrowser()) return null;

  const turnstile = await loadTurnstileScript();
  if (!turnstile) throw new Error('Turnstile unavailable');

  const container = document.createElement('div');
  container.style.display = 'none';
  document.body.appendChild(container);

  let widgetId;
  const cleanup = () => {
    try {
      if (widgetId !== undefined) turnstile.remove(widgetId);
    } catch {
      /* widget already gone */
    }
    container.remove();
  };

  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Turnstile timed out')),
        TURNSTILE_TIMEOUT_MS,
      );

      const settle = (fn) => (value) => {
        clearTimeout(timer);
        fn(value);
      };

      widgetId = turnstile.render(container, {
        sitekey: TURNSTILE_SITE_KEY,
        size: 'invisible',
        callback: settle(resolve),
        'error-callback': settle(() => reject(new Error('Turnstile verification failed'))),
        'timeout-callback': settle(() => reject(new Error('Turnstile timed out'))),
      });
    });
  } finally {
    cleanup();
  }
}

/* ─────────────────────────────────────────────
   Session
───────────────────────────────────────────── */

async function createAnonSession() {
  let captchaToken = null;

  try {
    captchaToken = await getCaptchaToken();
  } catch (error) {
    // Distinguish "the CAPTCHA broke" from "you are not signed in" so the UI can
    // offer a retry. Blocked scripts and venue wifi are the realistic causes,
    // and neither is the user's fault.
    const failure = new Error(
      'Verification could not be completed. Check your connection and try again.',
    );
    failure.code = 'captcha_failed';
    failure.cause = error;
    throw failure;
  }

  const options = captchaToken ? { captchaToken } : undefined;
  const { data, error } = await supabase.auth.signInAnonymously(
    options ? { options } : undefined,
  );

  if (error || !data?.session) {
    const failure = new Error(`Could not start a session: ${error?.message ?? 'No session was returned.'}`);
    failure.code = 'signin_failed';
    failure.cause = error;
    throw failure;
  }

  return data.session;
}

/**
 * Returns the current session, creating an anonymous one if there isn't one.
 * Safe to call from anywhere, as often as you like.
 *
 * @returns {Promise<import('@supabase/supabase-js').Session>}
 */
export function ensureAnonSession() {
  if (!isBrowser()) {
    return Promise.reject(new Error('ensureAnonSession must run in the browser'));
  }

  // An identity recovery owns sign-out and replacement together. Other screens
  // must not create a session in the gap between those operations.
  return recoveryPromise ?? readOrCreateSession();
}

function readOrCreateSession() {
  if (sessionPromise) return sessionPromise;

  const pending = (async () => {
    if (resetPromise) await resetPromise;
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      // A failed local/refresh check is not permission to replace identity.
      const failure = new Error('Could not read the current session. Please try again.');
      failure.code = 'signin_failed';
      failure.cause = error;
      throw failure;
    }
    if (data?.session) return data.session;
    return createAnonSession();
  })().finally(() => {
    // Only coalesce calls while they are in progress. Keeping a successful
    // promise forever reuses an expired token after Supabase has refreshed it.
    if (sessionPromise === pending) sessionPromise = null;
  });
  sessionPromise = pending;
  return pending;
}

/** The signed-in user's id, or null if there is no session yet. */
export async function getUserId() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id ?? null;
}

/**
 * A valid access token, creating a session if needed. supabase-js refreshes an
 * expiring token inside getSession(), so this is always safe to send.
 */
export async function getAccessToken() {
  const session = await ensureAnonSession();
  return session.access_token;
}

/**
 * fetch() with the caller's bearer token attached.
 *
 * This is the seam that keeps `lib/api.js` untouched: its helpers can be pointed
 * at authedFetch later without changing their signatures.
 */
export async function authedFetch(url, init = {}) {
  const checkCancelled = () => {
    if (init.signal?.aborted) throw new DOMException('The request was cancelled.', 'AbortError');
  };
  const send = async () => {
    checkCancelled();
    const token = await getAccessToken();
    checkCancelled();
    const response = await fetch(url, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
    return { response, token };
  };

  const { response, token } = await send();
  if (response.status !== 401) return response;

  // A stored session can be unusable while still looking perfectly valid
  // locally: the token has not expired, but the user behind it no longer
  // exists. Deleting stale anonymous users is standard housekeeping for
  // anonymous auth -- and something this project's own migration recommends --
  // so this is a routine state, not an edge case. getSession() returns the
  // stored session without checking any of that, so without this the device
  // would 401 on every request forever and reloading would not help.
  //
  // Discard it and start over. The new anonymous user loses the old one's
  // history, which is the unavoidable cost of the account it was attached to
  // being gone; a permanently broken app is the worse outcome.
  checkCancelled();
  await recoverRejectedSession(token);
  checkCancelled();
  // At most one retry. A second 401 is returned to the caller, not an endless
  // cycle of anonymous sign-ins. A 503 never enters identity recovery.
  return (await send()).response;
}

function recoverRejectedSession(rejectedToken) {
  if (recoveryPromise) return recoveryPromise;
  const pending = (async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      const failure = new Error('Could not read the current session. Please try again.');
      failure.code = 'signin_failed';
      failure.cause = error;
      throw failure;
    }
    // The rejected request may have arrived after another request recovered,
    // or after an automatic token refresh. Never discard that newer session.
    if (data?.session && data.session.access_token !== rejectedToken) return data.session;
    console.warn('[HALO] stored session was rejected; starting a new anonymous session');
    await resetSession();
    return readOrCreateSession();
  })().finally(() => {
    if (recoveryPromise === pending) recoveryPromise = null;
  });
  recoveryPromise = pending;
  return pending;
}

/**
 * Drops the local session so the next call mints a new anonymous user.
 *
 * scope: 'local' clears browser storage without asking the server to revoke
 * anything. That matters in the case this exists for -- a session whose user is
 * already gone -- where a server-side sign-out has nothing to revoke and can
 * fail. Errors are swallowed for the same reason: the goal is to end up with no
 * stored session, and a failed revoke must not prevent that.
 */
export function resetSession() {
  if (resetPromise) return resetPromise;
  const inFlight = sessionPromise;
  sessionPromise = null;
  const pending = (async () => {
    // Let any already-running creation finish before clearing it. Callers that
    // start afterward wait on resetPromise in readOrCreateSession.
    try { await inFlight; } catch { /* A failed creation still needs no session. */ }
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (error) {
      console.warn('[HALO] local sign-out failed, clearing anyway:', error?.message);
    }
  })().finally(() => {
    if (resetPromise === pending) resetPromise = null;
  });
  resetPromise = pending;
  return pending;
}
