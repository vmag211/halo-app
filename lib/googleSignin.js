/**
 * "Sign in with Google to keep your household": a feasibility spike, behind
 * the server flag `googleSignin` (HALO_FEATURE_GOOGLE_SIGNIN), off by default.
 * The findings and the console steps are in
 * docs/backend/decisions/google-signin-feasibility.md.
 *
 * What it does: a person who is signed in anonymously links a Google identity
 * to the SAME Supabase user with `supabase.auth.linkIdentity`. The user id does
 * not change, so `profiles.id`, every owned row, RLS and the cascades carry
 * over untouched (BE-050). Supabase clears `is_anonymous` when the link lands.
 *
 * What it never does: merge two households. If the Google identity already
 * belongs to another HALO user, Supabase refuses the link with
 * `identity_already_exists` and this module reports that plainly; it never
 * switches the device to that other user and never moves rows (BE-334). A
 * returned session is adopted only when it is for the user who started the
 * link, from this browser, within the time window, and only after the provider
 * has confirmed that user now has a Google identity.
 *
 * This file has no Node or browser imports, so the route, the callback page and
 * the tests all load the same code. The Supabase auth client and the storage
 * are passed in, which is what lets the tests run with no network.
 *
 * It does not build the other-device sign-in (the recover intent, BE-227), the
 * Gmail connection or the Calendar connection; the decision record covers why.
 */

/** The page Supabase returns to after Google. It must be in Supabase's Redirect URLs allow list. */
export const GOOGLE_CALLBACK_PATH = '/auth/google/callback';

/** The provider name Supabase uses, and the only one this flow links. */
export const GOOGLE_PROVIDER = 'google';

/** sessionStorage key for the one link this tab started. */
export const PENDING_LINK_KEY = 'halo.googleLink.pending';

/** How long a started link may take before its return is refused. */
export const PENDING_LINK_TTL_MS = 15 * 60 * 1000;

/** Basic sign-in scopes only. Nothing here asks for Gmail or Calendar. */
export const GOOGLE_SIGNIN_SCOPES = 'openid email profile';

/**
 * Every outcome the callback can reach, and what the person is told. Plain
 * sentences, no em dashes, and each one says what happened to the household.
 */
export const LINK_MESSAGES = Object.freeze({
  linked: 'Your household is now kept with your Google account. Nothing else changed.',
  already_linked:
    'That Google account already belongs to another HALO household. Nothing was linked or merged, and you are still using the household on this device.',
  cancelled: 'Google sign-in was cancelled. Nothing changed, and you are still using the household on this device.',
  different_account:
    'The sign-in came back for a different account, so HALO did not use it. You are still using the household on this device.',
  not_started:
    'HALO did not start a Google sign-in on this device, or it took too long. Nothing changed. Start again from Settings.',
  no_session: 'This device has no HALO session to keep. Nothing changed. Open HALO and start again from Settings.',
  unavailable: 'Signing in with Google is not available yet. Nothing changed.',
  failed: 'Google sign-in did not finish. Nothing changed, and you are still using the household on this device.',
});

/** Supabase error codes that mean "this identity or address is someone else's". */
const TAKEN_CODES = new Set(['identity_already_exists', 'email_exists', 'user_already_exists']);

/**
 * The parameters Supabase put on the return URL. Supabase writes errors to
 * both the query and the fragment, and the implicit flow's tokens to the
 * fragment, so both are read; the fragment wins on a clash.
 *
 * @param {string} href the full return URL
 * @returns {Record<string, string>}
 */
export function returnParameters(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return {};
  }
  const params = {};
  for (const [key, value] of url.searchParams) params[key] = value;
  const fragment = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  for (const [key, value] of new URLSearchParams(fragment)) params[key] = value;
  return params;
}

/**
 * What the return URL says, without acting on it.
 *
 * @param {Record<string, string>} params from returnParameters
 * @returns {{ kind: 'error', outcome: 'already_linked'|'cancelled'|'failed', code: string }
 *   | { kind: 'tokens', accessToken: string, refreshToken: string }
 *   | { kind: 'none' }}
 */
export function classifyReturn(params) {
  const error = params.error ?? '';
  const code = params.error_code ?? '';
  if (error || code || params.error_description) {
    if (TAKEN_CODES.has(code)) return { kind: 'error', outcome: 'already_linked', code };
    // Google answers access_denied when the person presses Cancel, and
    // Supabase forwards it with no code of its own. Supabase also uses
    // access_denied for a banned user or disabled signups, but then it names
    // its own code, so only the bare form counts as a cancellation.
    if (error === 'access_denied' && (!code || code === 'access_denied')) {
      return { kind: 'error', outcome: 'cancelled', code: code || error };
    }
    return { kind: 'error', outcome: 'failed', code: code || error || 'unspecified' };
  }
  if (params.access_token && params.refresh_token) {
    return { kind: 'tokens', accessToken: params.access_token, refreshToken: params.refresh_token };
  }
  return { kind: 'none' };
}

/** The Google identity on a Supabase user, or null. */
export function googleIdentityOf(user) {
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  return identities.find((identity) => identity?.provider === GOOGLE_PROVIDER) ?? null;
}

/** The address Google reported for that identity, if any. */
export function googleIdentityEmail(identity) {
  const email = identity?.identity_data?.email ?? identity?.email ?? null;
  return typeof email === 'string' && email ? email : null;
}

/**
 * The status the account route reports. `maskedAccount` is already masked by
 * the caller (lib/account.js `maskEmail`), so the address itself never
 * reaches this function's output.
 */
export function googleSigninStatus({ enabled, reason, user = null, maskedAccount = null }) {
  const identity = enabled ? googleIdentityOf(user) : null;
  const status = {
    feature: 'google-signin',
    enabled,
    anonymous: enabled ? user?.is_anonymous === true : null,
    linked: !!identity,
    maskedAccount: identity ? maskedAccount : null,
    linkedAt: identity ? (identity.created_at ?? null) : null,
  };
  if (reason) status.reason = reason;
  return status;
}

/** The client's check of that status before it shows anything. */
export function validGoogleSigninStatus(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.feature !== 'google-signin' || typeof value.enabled !== 'boolean' || typeof value.linked !== 'boolean') return false;
  if (value.reason !== undefined && typeof value.reason !== 'string') return false;
  if (value.anonymous !== null && typeof value.anonymous !== 'boolean') return false;
  if (value.maskedAccount !== null && typeof value.maskedAccount !== 'string') return false;
  if (value.linkedAt !== null && !(typeof value.linkedAt === 'string' && Number.isFinite(Date.parse(value.linkedAt)))) return false;
  if (!value.enabled && value.linked) return false;
  return true;
}

/** The status route's path. */
export const GOOGLE_STATUS_PATH = '/api/account/google';

/**
 * Reads the status with the device's CURRENT session, and never creates one:
 * the callback page must not mint an anonymous household on its way to
 * deciding whether to adopt a returned session. Null when there is no session
 * or the answer is not the status shape.
 *
 * @param {object} input
 * @param {object} input.auth a Supabase auth client
 * @param {typeof fetch} input.fetcher
 */
export async function fetchGoogleSigninStatus({ auth, fetcher }) {
  try {
    const { data } = await auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return null;
    const response = await fetcher(GOOGLE_STATUS_PATH, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!response.ok) return null;
    const value = await response.json();
    return validGoogleSigninStatus(value) ? value : null;
  } catch {
    return null;
  }
}

function readPending(storage) {
  try {
    const raw = storage?.getItem(PENDING_LINK_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value.userId !== 'string' || !Number.isFinite(value.startedAt)) return null;
    return value;
  } catch {
    return null;
  }
}

function clearPending(storage) {
  try {
    storage?.removeItem(PENDING_LINK_KEY);
  } catch {
    /* storage blocked: the marker is unreadable anyway */
  }
}

/**
 * Starts the link from Settings. Returns the provider URL for the caller to
 * open; it does not navigate by itself, so a test can run it.
 *
 * @param {object} input
 * @param {object} input.auth a Supabase auth client (`supabase.auth`)
 * @param {Storage} input.storage sessionStorage
 * @param {string} input.origin this deployment's origin, e.g. window.location.origin
 * @param {() => number} [input.now]
 * @returns {Promise<{ ok: true, url: string } | { ok: false, outcome: 'no_session'|'linked'|'already_linked'|'failed' }>}
 */
export async function startGoogleLink({ auth, storage, origin, now = Date.now }) {
  const { data, error } = await auth.getSession();
  const user = data?.session?.user;
  if (error || !user?.id) return { ok: false, outcome: 'no_session' };
  if (googleIdentityOf(user)) return { ok: false, outcome: 'linked' };

  try {
    storage.setItem(PENDING_LINK_KEY, JSON.stringify({ userId: user.id, startedAt: now() }));
  } catch {
    // Without the marker the return would be refused, so do not send the person away.
    return { ok: false, outcome: 'failed' };
  }

  let result;
  try {
    result = await auth.linkIdentity({
      provider: GOOGLE_PROVIDER,
      options: {
        redirectTo: `${String(origin).replace(/\/+$/, '')}${GOOGLE_CALLBACK_PATH}`,
        scopes: GOOGLE_SIGNIN_SCOPES,
        skipBrowserRedirect: true,
      },
    });
  } catch {
    // Offline or a network failure: the person never left, so no return may count as started.
    clearPending(storage);
    return { ok: false, outcome: 'failed' };
  }
  const url = result?.data?.url;
  if (result?.error || typeof url !== 'string' || !/^https:\/\//.test(url)) {
    clearPending(storage);
    const code = result?.error?.code;
    return { ok: false, outcome: TAKEN_CODES.has(code) ? 'already_linked' : 'failed' };
  }
  return { ok: true, url };
}

/**
 * Finishes the link on the callback page. Acts only on a return this tab
 * started; a session is adopted only for the user who started it.
 *
 * The page must strip the URL (tokens included) before or right after calling
 * this, and the global client must not consume the fragment on this path
 * (lib/supabase.js), or the checks below would run after the fact.
 *
 * @param {object} input
 * @param {object} input.auth a Supabase auth client (`supabase.auth`)
 * @param {Storage} input.storage sessionStorage
 * @param {string} input.href the return URL as it arrived
 * @param {boolean} input.enabled the server flag, from the status route
 * @param {() => number} [input.now]
 * @returns {Promise<{ outcome: keyof typeof LINK_MESSAGES, userId?: string }>}
 */
export async function completeGoogleLink({ auth, storage, href, enabled, now = Date.now }) {
  const pending = readPending(storage);
  clearPending(storage); // single use, whatever happens next
  const result = classifyReturn(returnParameters(href));

  if (!enabled) return { outcome: 'unavailable' };
  if (!pending || now() - pending.startedAt > PENDING_LINK_TTL_MS || now() < pending.startedAt) {
    return { outcome: 'not_started' };
  }
  if (result.kind === 'error') return { outcome: result.outcome };
  if (result.kind !== 'tokens') return { outcome: 'failed' };

  // The device must still be on the household that started the link.
  const { data: current } = await auth.getSession();
  const currentId = current?.session?.user?.id;
  if (!currentId) return { outcome: 'no_session' };
  if (currentId !== pending.userId) return { outcome: 'different_account' };

  // Ask the provider who the returned tokens belong to before using them.
  const { data: returned, error } = await auth.getUser(result.accessToken);
  const returnedUser = returned?.user;
  if (error || !returnedUser?.id) return { outcome: 'failed' };
  if (returnedUser.id !== pending.userId) return { outcome: 'different_account' };
  if (!googleIdentityOf(returnedUser)) return { outcome: 'failed' };

  const { error: setError } = await auth.setSession({
    access_token: result.accessToken,
    refresh_token: result.refreshToken,
  });
  if (setError) return { outcome: 'failed' };
  return { outcome: 'linked', userId: returnedUser.id };
}

/**
 * The callback page's whole job, so the page itself stays a few lines: check
 * the device still has a session (never creating one), read the server flag
 * with it, then finish or refuse. The pending marker is cleared on every path.
 *
 * @param {object} input
 * @param {object} input.auth a Supabase auth client
 * @param {Storage|null} input.storage sessionStorage
 * @param {string} input.href the return URL as it arrived
 * @param {typeof fetch} input.fetcher
 * @param {() => number} [input.now]
 * @returns {Promise<{ outcome: keyof typeof LINK_MESSAGES, userId?: string }>}
 */
export async function finishGoogleLinkOnCallback({ auth, storage, href, fetcher, now = Date.now }) {
  const { data } = await auth.getSession();
  if (!data?.session?.access_token) {
    clearPending(storage);
    return { outcome: 'no_session' };
  }
  const status = await fetchGoogleSigninStatus({ auth, fetcher });
  if (!status) {
    clearPending(storage);
    return { outcome: 'failed' };
  }
  return completeGoogleLink({ auth, storage, href, enabled: status.enabled, now });
}
