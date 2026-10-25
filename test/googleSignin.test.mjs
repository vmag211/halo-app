/**
 * "Sign in with Google to keep your household" (feasibility spike,
 * docs/backend/decisions/google-signin-feasibility.md).
 *
 * The browser half of the flow, `lib/googleSignin.js`, run against a mocked
 * Supabase auth client: no network, no Google, no Supabase. The cases the
 * spike must cover:
 *
 *   1. an anonymous user links Google and keeps the same user id (household);
 *   2. the Google identity already belongs to another account: refused
 *      plainly, no session switch, nothing merged (BE-334);
 *   3. the person cancels at Google;
 *   4. the flag is off: a return is never adopted, even with valid tokens;
 *
 * plus the guards around adopting a returned session: it must be for the user
 * who started the link, from this tab, within the time window.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GOOGLE_CALLBACK_PATH,
  LINK_MESSAGES,
  PENDING_LINK_KEY,
  PENDING_LINK_TTL_MS,
  classifyReturn,
  completeGoogleLink,
  finishGoogleLinkOnCallback,
  googleSigninStatus,
  returnParameters,
  startGoogleLink,
  validGoogleSigninStatus,
} from '../lib/googleSignin.js';
import { FEATURE_FLAGS, featureDisabledReason } from '../lib/features.js';
import { SCRUBBED_ENV } from './helpers/sandbox.mjs';

const HOUSEHOLD = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const ORIGIN = 'https://halo.example.test';
const GOOGLE_IDENTITY = { provider: 'google', identity_data: { email: 'pat@example.test' }, created_at: '2026-10-25T12:00:00Z' };
const T0 = 1_800_000_000_000;

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    map,
  };
}

/**
 * A mocked `supabase.auth`. `sessionUser` is who this device is signed in as;
 * `tokenUsers` maps an access token to the user the provider says it belongs
 * to. Every call is recorded, so a test can prove setSession never ran.
 */
function mockAuth({ sessionUser = { id: HOUSEHOLD, is_anonymous: true, identities: [] }, tokenUsers = {}, linkResult } = {}) {
  const calls = [];
  let session = sessionUser ? { access_token: 'device-token', user: sessionUser } : null;
  return {
    calls,
    get session() { return session; },
    getSession: async () => { calls.push(['getSession']); return { data: { session }, error: null }; },
    getUser: async (token) => {
      calls.push(['getUser', token]);
      const user = tokenUsers[token];
      return user ? { data: { user }, error: null } : { data: { user: null }, error: { status: 401, message: 'bad token' } };
    },
    setSession: async (pair) => {
      calls.push(['setSession', pair]);
      session = { access_token: pair.access_token, user: tokenUsers[pair.access_token] };
      return { data: { session }, error: null };
    },
    linkIdentity: async (credentials) => {
      calls.push(['linkIdentity', credentials]);
      return linkResult ?? { data: { provider: 'google', url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=y' }, error: null };
    },
  };
}

const callNames = (auth) => auth.calls.map(([name]) => name);
const startedAt = (storage, userId = HOUSEHOLD, at = T0) =>
  storage.setItem(PENDING_LINK_KEY, JSON.stringify({ userId, startedAt: at }));
const tokenReturn = (token = 'linked-token') =>
  `${ORIGIN}${GOOGLE_CALLBACK_PATH}#access_token=${token}&refresh_token=r-${token}&expires_in=3600&token_type=bearer&provider_token=google-secret`;
const errorReturn = (query) => `${ORIGIN}${GOOGLE_CALLBACK_PATH}?${query}#${query}&sb=`;

test('the flag is HALO_FEATURE_GOOGLE_SIGNIN, scrubbed from route tests, with a plain reason', () => {
  assert.equal(FEATURE_FLAGS.googleSignin, 'HALO_FEATURE_GOOGLE_SIGNIN');
  assert.ok(SCRUBBED_ENV.includes('HALO_FEATURE_GOOGLE_SIGNIN'));
  assert.match(featureDisabledReason('googleSignin'), /not available yet/);
});

test('start: an anonymous session gets a pending marker and the provider URL, with basic scopes and our callback', async () => {
  const auth = mockAuth();
  const storage = memoryStorage();
  const result = await startGoogleLink({ auth, storage, origin: `${ORIGIN}/`, now: () => T0 });
  assert.equal(result.ok, true);
  assert.match(result.url, /^https:\/\/accounts\.google\.com\//);
  const [, credentials] = auth.calls.find(([name]) => name === 'linkIdentity');
  assert.equal(credentials.provider, 'google');
  assert.equal(credentials.options.redirectTo, `${ORIGIN}${GOOGLE_CALLBACK_PATH}`);
  assert.equal(credentials.options.scopes, 'openid email profile', 'never a Gmail or Calendar scope');
  assert.equal(credentials.options.skipBrowserRedirect, true);
  assert.deepEqual(JSON.parse(storage.getItem(PENDING_LINK_KEY)), { userId: HOUSEHOLD, startedAt: T0 });
});

test('start: no session, an already linked user and a provider refusal never leave a marker', async () => {
  const none = await startGoogleLink({ auth: mockAuth({ sessionUser: null }), storage: memoryStorage(), origin: ORIGIN });
  assert.deepEqual(none, { ok: false, outcome: 'no_session' });

  const linked = await startGoogleLink({
    auth: mockAuth({ sessionUser: { id: HOUSEHOLD, is_anonymous: false, identities: [GOOGLE_IDENTITY] } }),
    storage: memoryStorage(),
    origin: ORIGIN,
  });
  assert.deepEqual(linked, { ok: false, outcome: 'linked' });

  for (const [error, outcome] of [
    [{ code: 'manual_linking_disabled', message: 'Manual linking is disabled' }, 'failed'],
    [{ code: 'identity_already_exists', message: 'Identity is already linked' }, 'already_linked'],
  ]) {
    const storage = memoryStorage();
    const result = await startGoogleLink({ auth: mockAuth({ linkResult: { data: { url: null }, error } }), storage, origin: ORIGIN });
    assert.deepEqual(result, { ok: false, outcome });
    assert.equal(storage.getItem(PENDING_LINK_KEY), null);
  }
});

test('an anonymous user links Google: the returned session is adopted only after the provider confirms the same user id', async () => {
  const afterLink = { id: HOUSEHOLD, is_anonymous: false, identities: [{ provider: 'anonymous' }, GOOGLE_IDENTITY] };
  const auth = mockAuth({ tokenUsers: { 'linked-token': afterLink } });
  const storage = memoryStorage();
  startedAt(storage);

  const result = await completeGoogleLink({ auth, storage, href: tokenReturn(), enabled: true, now: () => T0 + 1000 });
  assert.deepEqual(result, { outcome: 'linked', userId: HOUSEHOLD });
  assert.deepEqual(callNames(auth), ['getSession', 'getUser', 'setSession'], 'checked before adopted');
  const [, pair] = auth.calls.at(-1);
  assert.deepEqual(pair, { access_token: 'linked-token', refresh_token: 'r-linked-token' }, 'the Google provider token is never kept');
  assert.equal(auth.session.user.id, HOUSEHOLD, 'the household (user id) is preserved');
  assert.equal(storage.getItem(PENDING_LINK_KEY), null, 'the marker is single use');
  assert.match(LINK_MESSAGES.linked, /household/);
});

test('the Google identity already belongs to another account: refused clearly, no session switch, nothing merged', async () => {
  for (const query of [
    'error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked+to+another+user',
    'error=server_error&error_code=email_exists&error_description=Email+address+already+exists',
  ]) {
    const auth = mockAuth();
    const storage = memoryStorage();
    startedAt(storage);
    const result = await completeGoogleLink({ auth, storage, href: errorReturn(query), enabled: true, now: () => T0 + 1000 });
    assert.deepEqual(result, { outcome: 'already_linked' });
    assert.ok(!callNames(auth).includes('setSession'), 'the device never switches to the other account');
    assert.equal(auth.session.user.id, HOUSEHOLD, 'still on the household that started');
    assert.match(LINK_MESSAGES.already_linked, /Nothing was linked or merged/);
  }
});

test('a session that comes back for a different user is refused, even with a valid marker', async () => {
  const auth = mockAuth({ tokenUsers: { 'linked-token': { id: OTHER, is_anonymous: false, identities: [GOOGLE_IDENTITY] } } });
  const storage = memoryStorage();
  startedAt(storage);
  const result = await completeGoogleLink({ auth, storage, href: tokenReturn(), enabled: true, now: () => T0 + 1000 });
  assert.deepEqual(result, { outcome: 'different_account' });
  assert.ok(!callNames(auth).includes('setSession'));
  assert.equal(auth.session.user.id, HOUSEHOLD);
});

test('a device that changed household since the link started is refused before the tokens are even checked', async () => {
  const auth = mockAuth({ sessionUser: { id: OTHER, is_anonymous: true }, tokenUsers: { 'linked-token': { id: HOUSEHOLD, identities: [GOOGLE_IDENTITY] } } });
  const storage = memoryStorage();
  startedAt(storage);
  const result = await completeGoogleLink({ auth, storage, href: tokenReturn(), enabled: true, now: () => T0 + 1000 });
  assert.deepEqual(result, { outcome: 'different_account' });
  assert.deepEqual(callNames(auth), ['getSession']);
});

test('the person cancels at Google: nothing changes', async () => {
  const auth = mockAuth();
  const storage = memoryStorage();
  startedAt(storage);
  const href = errorReturn('error=access_denied&error_description=The+user+denied+the+request');
  const result = await completeGoogleLink({ auth, storage, href, enabled: true, now: () => T0 + 1000 });
  assert.deepEqual(result, { outcome: 'cancelled' });
  assert.ok(!callNames(auth).includes('setSession'));
  assert.equal(storage.getItem(PENDING_LINK_KEY), null);
  assert.match(LINK_MESSAGES.cancelled, /Nothing changed/);
});

test('access_denied with a Supabase code of its own (a banned user, signups off) is a failure, not a cancellation', () => {
  assert.equal(classifyReturn(returnParameters(errorReturn('error=access_denied&error_code=user_banned'))).outcome, 'failed');
  assert.equal(classifyReturn(returnParameters(errorReturn('error=access_denied&error_code=signup_disabled'))).outcome, 'failed');
});

test('the flag is off: a return is never adopted, even with valid tokens for the same user', async () => {
  const auth = mockAuth({ tokenUsers: { 'linked-token': { id: HOUSEHOLD, identities: [GOOGLE_IDENTITY] } } });
  const storage = memoryStorage();
  startedAt(storage);
  const result = await completeGoogleLink({ auth, storage, href: tokenReturn(), enabled: false, now: () => T0 + 1000 });
  assert.deepEqual(result, { outcome: 'unavailable' });
  assert.deepEqual(callNames(auth), [], 'no provider call at all');
  assert.equal(storage.getItem(PENDING_LINK_KEY), null);
});

test('a return this tab did not start, or one that took too long, is refused', async () => {
  const tokens = { 'linked-token': { id: HOUSEHOLD, identities: [GOOGLE_IDENTITY] } };
  const unstarted = mockAuth({ tokenUsers: tokens });
  assert.deepEqual(
    await completeGoogleLink({ auth: unstarted, storage: memoryStorage(), href: tokenReturn(), enabled: true }),
    { outcome: 'not_started' },
  );
  assert.deepEqual(callNames(unstarted), []);

  const late = mockAuth({ tokenUsers: tokens });
  const storage = memoryStorage();
  startedAt(storage);
  assert.deepEqual(
    await completeGoogleLink({ auth: late, storage, href: tokenReturn(), enabled: true, now: () => T0 + PENDING_LINK_TTL_MS + 1 }),
    { outcome: 'not_started' },
  );
  assert.ok(!callNames(late).includes('setSession'));
});

test('a returned user with no Google identity, or a bare return, is a failure', async () => {
  const auth = mockAuth({ tokenUsers: { 'linked-token': { id: HOUSEHOLD, is_anonymous: true, identities: [] } } });
  const storage = memoryStorage();
  startedAt(storage);
  assert.deepEqual(await completeGoogleLink({ auth, storage, href: tokenReturn(), enabled: true, now: () => T0 + 1 }), { outcome: 'failed' });
  assert.ok(!callNames(auth).includes('setSession'));

  const bare = memoryStorage();
  startedAt(bare);
  assert.deepEqual(
    await completeGoogleLink({ auth: mockAuth(), storage: bare, href: `${ORIGIN}${GOOGLE_CALLBACK_PATH}`, enabled: true, now: () => T0 + 1 }),
    { outcome: 'failed' },
  );
});

test('the callback page: no session is refused without creating one; the flag comes from the status route', async () => {
  const storage = memoryStorage();
  startedAt(storage);
  const fetches = [];
  const fetcher = async (url, init) => {
    fetches.push([url, init]);
    return new Response(JSON.stringify(googleSigninStatus({ enabled: false, reason: 'off' })), { status: 200 });
  };
  const noSession = await finishGoogleLinkOnCallback({ auth: mockAuth({ sessionUser: null }), storage, href: tokenReturn(), fetcher });
  assert.deepEqual(noSession, { outcome: 'no_session' });
  assert.equal(fetches.length, 0);
  assert.equal(storage.getItem(PENDING_LINK_KEY), null);

  const off = memoryStorage();
  startedAt(off);
  const auth = mockAuth({ tokenUsers: { 'linked-token': { id: HOUSEHOLD, identities: [GOOGLE_IDENTITY] } } });
  assert.deepEqual(await finishGoogleLinkOnCallback({ auth, storage: off, href: tokenReturn(), fetcher, now: () => T0 + 1 }), { outcome: 'unavailable' });
  assert.equal(fetches[0][0], '/api/account/google');
  assert.equal(fetches[0][1].headers.Authorization, 'Bearer device-token');
  assert.ok(!callNames(auth).includes('setSession'));

  const broken = memoryStorage();
  startedAt(broken);
  const failing = async () => new Response('nope', { status: 503 });
  assert.deepEqual(await finishGoogleLinkOnCallback({ auth: mockAuth(), storage: broken, href: tokenReturn(), fetcher: failing }), { outcome: 'failed' });
  assert.equal(broken.getItem(PENDING_LINK_KEY), null);
});

test('return parameters are read from the query and the fragment', () => {
  const params = returnParameters(`${ORIGIN}${GOOGLE_CALLBACK_PATH}?error=a#error=b&error_code=c`);
  assert.equal(params.error, 'b', 'the fragment wins');
  assert.equal(params.error_code, 'c');
  assert.deepEqual(returnParameters('not a url'), {});
  assert.deepEqual(classifyReturn({}), { kind: 'none' });
});

test('status: shape, masking left to the caller, and the off answer discloses nothing', () => {
  const off = googleSigninStatus({ enabled: false, reason: 'off', user: { is_anonymous: true, identities: [GOOGLE_IDENTITY] } });
  assert.deepEqual(off, { feature: 'google-signin', enabled: false, anonymous: null, linked: false, maskedAccount: null, linkedAt: null, reason: 'off' });
  assert.ok(validGoogleSigninStatus(off));

  const on = googleSigninStatus({ enabled: true, user: { is_anonymous: false, identities: [GOOGLE_IDENTITY] }, maskedAccount: 'p***@example.test' });
  assert.deepEqual(on, { feature: 'google-signin', enabled: true, anonymous: false, linked: true, maskedAccount: 'p***@example.test', linkedAt: '2026-10-25T12:00:00Z' });
  assert.ok(validGoogleSigninStatus(on));

  assert.equal(validGoogleSigninStatus({ ...off, linked: true }), false, 'off can never claim a link');
  assert.equal(validGoogleSigninStatus({ ...on, feature: 'recovery' }), false);
  assert.equal(validGoogleSigninStatus(null), false);
});

test('no app-facing message uses an em dash', () => {
  for (const message of Object.values(LINK_MESSAGES)) assert.doesNotMatch(message, /—/);
  for (const file of ['lib/googleSignin.js', 'app/auth/google/callback/page.tsx', 'app/api/account/google/route.js']) {
    assert.doesNotMatch(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), /—/, file);
  }
});

test('the browser client does not adopt a session from the URL on the callback path, and does elsewhere', async () => {
  const { detectSessionInUrl } = await import('../lib/supabase.js');
  const tokens = { access_token: 'a', refresh_token: 'r' };
  assert.equal(detectSessionInUrl(new URL(tokenReturn()), tokens), false);
  assert.equal(detectSessionInUrl(new URL(errorReturn('error=access_denied')), { error: 'access_denied' }), false);
  assert.equal(detectSessionInUrl(new URL(`${ORIGIN}/settings#access_token=a`), tokens), true, 'the default elsewhere');
  assert.equal(detectSessionInUrl(new URL(`${ORIGIN}/settings`), {}), false);
});
