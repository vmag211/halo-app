/**
 * Adversarial review of the Google sign-in spike (lib/googleSignin.js and
 * GET /api/account/google), with a mocked Supabase only: no network, no
 * Google, no Supabase. It tries to make the flow adopt a session it should
 * not, merge two households, keep a marker it should drop, or throw where the
 * caller expects an outcome.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GOOGLE_CALLBACK_PATH,
  LINK_MESSAGES,
  PENDING_LINK_KEY,
  PENDING_LINK_TTL_MS,
  classifyReturn,
  completeGoogleLink,
  fetchGoogleSigninStatus,
  finishGoogleLinkOnCallback,
  googleSigninStatus,
  returnParameters,
  startGoogleLink,
} from '../lib/googleSignin.js';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';

const HOUSEHOLD = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const ORIGIN = 'https://halo.example.test';
const GOOGLE_IDENTITY = { provider: 'google', identity_data: { email: 'pat@example.test' }, created_at: '2026-10-25T12:00:00Z' };
const LINKED_USER = { id: HOUSEHOLD, is_anonymous: false, identities: [{ provider: 'anonymous' }, GOOGLE_IDENTITY] };
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

/** Storage that throws on every access, as a blocked sessionStorage does. */
const throwingStorage = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('SecurityError'); },
  removeItem() { throw new Error('SecurityError'); },
};

/** Same shape as the mock in googleSignin.test.mjs, plus overrides for failure modes. */
function mockAuth({ sessionUser = { id: HOUSEHOLD, is_anonymous: true, identities: [] }, tokenUsers = {}, linkResult, overrides = {} } = {}) {
  const calls = [];
  let session = sessionUser ? { access_token: 'device-token', user: sessionUser } : null;
  const auth = {
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
      return linkResult ?? { data: { provider: 'google', url: 'https://accounts.google.com/o/oauth2/v2/auth?state=y' }, error: null };
    },
  };
  for (const [name, fn] of Object.entries(overrides)) {
    auth[name] = async (...args) => { calls.push([name, ...args]); return fn(...args); };
  }
  return auth;
}

const callNames = (auth) => auth.calls.map(([name]) => name);
const mark = (storage, userId = HOUSEHOLD, at = T0) => storage.setItem(PENDING_LINK_KEY, JSON.stringify({ userId, startedAt: at }));
const tokenReturn = (token = 'linked-token') =>
  `${ORIGIN}${GOOGLE_CALLBACK_PATH}#access_token=${token}&refresh_token=r-${token}&expires_in=3600&token_type=bearer`;
const statusFetcher = (status, log = []) => async (url, init) => {
  log.push([url, init]);
  return new Response(JSON.stringify(status), { status: 200 });
};
const ON_STATUS = googleSigninStatus({ enabled: true, user: { is_anonymous: true, identities: [] } });
const OFF_STATUS = googleSigninStatus({ enabled: false, reason: 'off' });

// (1) The whole loop keeps the household.

test('round trip: start, Google, callback; the user id never changes and nothing but auth calls run', async () => {
  const owned = { profiles: [{ id: HOUSEHOLD, address: 'home' }], household_bands: [{ profile_id: HOUSEHOLD }] };
  const before = JSON.stringify(owned);
  const auth = mockAuth({ tokenUsers: { 'linked-token': LINKED_USER } });
  const storage = memoryStorage();

  const started = await startGoogleLink({ auth, storage, origin: ORIGIN, now: () => T0 });
  assert.equal(started.ok, true);
  const marker = JSON.parse(storage.getItem(PENDING_LINK_KEY));
  assert.equal(marker.userId, HOUSEHOLD);

  const done = await finishGoogleLinkOnCallback({ auth, storage, href: tokenReturn(), fetcher: statusFetcher(ON_STATUS), now: () => T0 + 60_000 });
  assert.deepEqual(done, { outcome: 'linked', userId: HOUSEHOLD });
  assert.equal(auth.session.user.id, HOUSEHOLD, 'the device is still on the same household');
  assert.deepEqual(
    [...new Set(callNames(auth))].sort(),
    ['getSession', 'getUser', 'linkIdentity', 'setSession'],
    'no sign-in, sign-out or other user call that could switch or merge households',
  );
  assert.equal(JSON.stringify(owned), before);
  assert.equal(storage.getItem(PENDING_LINK_KEY), null);
});

// (2) Already linked elsewhere.

test('already linked elsewhere: an error that also carries the other account tokens is refused before the tokens are touched', async () => {
  const auth = mockAuth({ tokenUsers: { 'other-token': { id: OTHER, is_anonymous: false, identities: [GOOGLE_IDENTITY] } } });
  const storage = memoryStorage();
  mark(storage);
  const href = `${ORIGIN}${GOOGLE_CALLBACK_PATH}?error=server_error&error_code=identity_already_exists#access_token=other-token&refresh_token=r-other`;
  const result = await finishGoogleLinkOnCallback({ auth, storage, href, fetcher: statusFetcher(ON_STATUS), now: () => T0 + 1000 });
  assert.deepEqual(result, { outcome: 'already_linked' });
  assert.ok(!callNames(auth).includes('getUser'), 'the other account tokens are never even checked');
  assert.ok(!callNames(auth).includes('setSession'));
  assert.equal(auth.session.user.id, HOUSEHOLD);
  assert.match(LINK_MESSAGES.already_linked, /still using the household on this device/);
});

test('already linked elsewhere, with no error at all: tokens for the Google owner are refused, never adopted', async () => {
  const auth = mockAuth({ tokenUsers: { 'other-token': { id: OTHER, is_anonymous: false, identities: [GOOGLE_IDENTITY] } } });
  const storage = memoryStorage();
  mark(storage);
  const result = await finishGoogleLinkOnCallback({ auth, storage, href: tokenReturn('other-token'), fetcher: statusFetcher(ON_STATUS), now: () => T0 + 1000 });
  assert.deepEqual(result, { outcome: 'different_account' });
  assert.ok(!callNames(auth).includes('setSession'));
  assert.equal(auth.session.user.id, HOUSEHOLD);
});

test('already linked elsewhere, reported only by description (no error_code): refused, though as a generic failure', () => {
  // Not a defect: nothing is adopted. Recorded because the clear "already
  // belongs to another household" message depends on Supabase sending error_code.
  const params = returnParameters(`${ORIGIN}${GOOGLE_CALLBACK_PATH}#error=server_error&error_description=Identity+is+already+linked+to+another+user`);
  assert.deepEqual(classifyReturn(params), { kind: 'error', outcome: 'failed', code: 'server_error' });
});

// (3) Cancel.

test('cancel at Google, in the query only, through the callback page: cancelled, and a replay is not_started', async () => {
  const auth = mockAuth();
  const storage = memoryStorage();
  mark(storage);
  const href = `${ORIGIN}${GOOGLE_CALLBACK_PATH}?error=access_denied&error_description=The+user+denied+the+request`;
  const fetcher = statusFetcher(ON_STATUS);
  assert.deepEqual(await finishGoogleLinkOnCallback({ auth, storage, href, fetcher, now: () => T0 + 1000 }), { outcome: 'cancelled' });
  assert.equal(storage.getItem(PENDING_LINK_KEY), null);
  assert.deepEqual(await finishGoogleLinkOnCallback({ auth, storage, href, fetcher, now: () => T0 + 2000 }), { outcome: 'not_started' });
  assert.ok(!callNames(auth).includes('setSession'));
});

// (4) Flag off.

test('flag off on the callback page: neither tokens nor errors are acted on, and the marker is dropped', async () => {
  for (const href of [tokenReturn(), `${ORIGIN}${GOOGLE_CALLBACK_PATH}#error=access_denied`]) {
    const auth = mockAuth({ tokenUsers: { 'linked-token': LINKED_USER } });
    const storage = memoryStorage();
    mark(storage);
    const result = await finishGoogleLinkOnCallback({ auth, storage, href, fetcher: statusFetcher(OFF_STATUS), now: () => T0 + 1000 });
    assert.deepEqual(result, { outcome: 'unavailable' });
    assert.deepEqual([...new Set(callNames(auth))], ['getSession'], 'never getUser or setSession');
    assert.equal(storage.getItem(PENDING_LINK_KEY), null);
  }
});

test('flag off on the route: even a provider that would fail is never asked', async () => {
  const h = createRouteHarness({ identities: { alice: { isAnonymous: true, identities: [{ provider: 'anonymous' }] } } });
  let reads = 0;
  h.db.auth.admin.getUserById = async () => { reads += 1; throw new Error('must not be called'); };
  for (const value of [undefined, '', 'off', '0', 'enabled', 'onn']) {
    const env = value === undefined ? {} : { HALO_FEATURE_GOOGLE_SIGNIN: value };
    const res = await h.call('/api/account/google', 'GET', { as: 'alice', env });
    assert.equal(res.status, 200, String(value));
    const body = await res.json();
    assert.equal(body.enabled, false);
    assert.equal(body.linked, false);
    assert.equal(body.anonymous, null);
  }
  assert.equal(reads, 0);
});

test('route, flag on: a provider error is a plain 500 that leaks nothing; a Google identity with no email is linked with no mask', async (t) => {
  muteConsoleError(t);
  const h = createRouteHarness({
    identities: { alice: { isAnonymous: false, identities: [{ provider: 'google', identity_data: {}, created_at: '2026-10-25T12:00:00Z' }] } },
  });
  const ok = await (await h.call('/api/account/google', 'GET', { as: 'alice', env: { HALO_FEATURE_GOOGLE_SIGNIN: 'on' } })).json();
  assert.equal(ok.linked, true);
  assert.equal(ok.maskedAccount, null);

  h.db.auth.admin.getUserById = async () => ({ data: { user: null }, error: { status: 500, message: 'secret upstream detail' } });
  const res = await h.call('/api/account/google', 'GET', { as: 'alice', env: { HALO_FEATURE_GOOGLE_SIGNIN: 'on' } });
  assert.equal(res.status, 500);
  assert.doesNotMatch(await res.text(), /secret upstream detail/);
});

// Pending marker and storage.

test('a malformed or empty pending marker is not_started, with no provider call', async () => {
  for (const raw of ['', '{', 'null', '[]', '"x"', '42', '{"userId":1,"startedAt":1800000000000}', `{"userId":"${HOUSEHOLD}","startedAt":"1800000000000"}`, `{"userId":"${HOUSEHOLD}"}`]) {
    const auth = mockAuth({ tokenUsers: { 'linked-token': LINKED_USER } });
    const storage = memoryStorage();
    storage.setItem(PENDING_LINK_KEY, raw);
    const result = await completeGoogleLink({ auth, storage, href: tokenReturn(), enabled: true, now: () => T0 + 1000 });
    assert.deepEqual(result, { outcome: 'not_started' }, raw);
    assert.deepEqual(callNames(auth), [], raw);
    assert.equal(storage.getItem(PENDING_LINK_KEY), null, raw);
  }
});

test('a marker with an empty user id never matches a session', async () => {
  const auth = mockAuth({ sessionUser: { id: '', identities: [] }, tokenUsers: { 'linked-token': { id: '', identities: [GOOGLE_IDENTITY] } } });
  const storage = memoryStorage();
  mark(storage, '');
  const result = await completeGoogleLink({ auth, storage, href: tokenReturn(), enabled: true, now: () => T0 + 1 });
  assert.notEqual(result.outcome, 'linked');
  assert.ok(!callNames(auth).includes('setSession'));
});

test('storage that throws: start refuses before Google, and the callback answers instead of throwing', async () => {
  const auth = mockAuth({ tokenUsers: { 'linked-token': LINKED_USER } });
  assert.deepEqual(await startGoogleLink({ auth, storage: throwingStorage, origin: ORIGIN }), { ok: false, outcome: 'failed' });
  assert.deepEqual(await startGoogleLink({ auth, storage: null, origin: ORIGIN }), { ok: false, outcome: 'failed' });
  assert.ok(!callNames(auth).includes('linkIdentity'), 'never sends the person away without a marker');

  for (const storage of [throwingStorage, null]) {
    const result = await finishGoogleLinkOnCallback({ auth, storage, href: tokenReturn(), fetcher: statusFetcher(ON_STATUS), now: () => T0 });
    assert.deepEqual(result, { outcome: 'not_started' });
  }
  assert.ok(!callNames(auth).includes('setSession'));
});

test('a replayed callback URL after success adopts nothing a second time', async () => {
  const auth = mockAuth({ tokenUsers: { 'linked-token': LINKED_USER } });
  const storage = memoryStorage();
  mark(storage);
  const fetcher = statusFetcher(ON_STATUS);
  assert.equal((await finishGoogleLinkOnCallback({ auth, storage, href: tokenReturn(), fetcher, now: () => T0 + 1 })).outcome, 'linked');
  const replay = await finishGoogleLinkOnCallback({ auth, storage, href: tokenReturn(), fetcher, now: () => T0 + 2 });
  assert.deepEqual(replay, { outcome: 'not_started' });
  assert.equal(callNames(auth).filter((name) => name === 'setSession').length, 1);
});

test('a future-dated marker is refused; the window edge is inclusive and one past it is not', async () => {
  const run = async (at) => {
    const auth = mockAuth({ tokenUsers: { 'linked-token': LINKED_USER } });
    const storage = memoryStorage();
    mark(storage);
    return (await completeGoogleLink({ auth, storage, href: tokenReturn(), enabled: true, now: () => at })).outcome;
  };
  assert.equal(await run(T0 - 1), 'not_started', 'a clock that runs backwards, or a planted marker');
  assert.equal(await run(T0 + PENDING_LINK_TTL_MS), 'linked');
  assert.equal(await run(T0 + PENDING_LINK_TTL_MS + 1), 'not_started');
});

test('returns that are not a usable token pair are failures: half a pair, a PKCE code, tokens with only error_description', async () => {
  for (const tail of ['#access_token=linked-token', '#refresh_token=r-linked-token', '?code=abc123', '#access_token=linked-token&refresh_token=r&error_description=x']) {
    const auth = mockAuth({ tokenUsers: { 'linked-token': LINKED_USER } });
    const storage = memoryStorage();
    mark(storage);
    const result = await completeGoogleLink({ auth, storage, href: `${ORIGIN}${GOOGLE_CALLBACK_PATH}${tail}`, enabled: true, now: () => T0 + 1 });
    assert.equal(result.outcome, 'failed', tail);
    assert.ok(!callNames(auth).includes('setSession'), tail);
  }
});

// Provider failures.

test(
  'linkIdentity throwing at start resolves to failed and leaves no marker',
  async () => {
    const auth = mockAuth({ overrides: { linkIdentity: () => { throw new TypeError('Failed to fetch'); } } });
    const storage = memoryStorage();
    let result;
    try {
      result = await startGoogleLink({ auth, storage, origin: ORIGIN, now: () => T0 });
    } catch (err) {
      result = { threw: err.message };
    }
    assert.equal(storage.getItem(PENDING_LINK_KEY), null, 'the marker must not outlive a start that never reached Google');
    assert.deepEqual(result, { ok: false, outcome: 'failed' });
  },
);

test('linkIdentity returning a non-https URL is refused and the marker dropped', async () => {
  for (const url of ['http://accounts.google.com/x', 'javascript:alert(1)', '//evil.test', '', null]) {
    const storage = memoryStorage();
    const result = await startGoogleLink({ auth: mockAuth({ linkResult: { data: { url }, error: null } }), storage, origin: ORIGIN });
    assert.deepEqual(result, { ok: false, outcome: 'failed' }, String(url));
    assert.equal(storage.getItem(PENDING_LINK_KEY), null);
  }
});

test('getUser error or throw, and setSession error: never linked, never adopted, marker already gone', async () => {
  const errorAuth = mockAuth({ overrides: { getUser: () => ({ data: { user: LINKED_USER }, error: { status: 500, message: 'down' } }) } });
  let storage = memoryStorage();
  mark(storage);
  assert.deepEqual(await completeGoogleLink({ auth: errorAuth, storage, href: tokenReturn(), enabled: true, now: () => T0 + 1 }), { outcome: 'failed' });
  assert.ok(!callNames(errorAuth).includes('setSession'), 'an error wins over a user in the same answer');

  const throwAuth = mockAuth({ overrides: { getUser: () => { throw new TypeError('Failed to fetch'); } } });
  storage = memoryStorage();
  mark(storage);
  await assert.rejects(completeGoogleLink({ auth: throwAuth, storage, href: tokenReturn(), enabled: true, now: () => T0 + 1 }));
  assert.equal(storage.getItem(PENDING_LINK_KEY), null, 'the page shows failed (it catches), and the marker is spent');
  assert.ok(!callNames(throwAuth).includes('setSession'));

  const setAuth = mockAuth({ tokenUsers: { 'linked-token': LINKED_USER }, overrides: { setSession: () => ({ data: { session: null }, error: { message: 'Invalid Refresh Token' } }) } });
  storage = memoryStorage();
  mark(storage);
  assert.deepEqual(await completeGoogleLink({ auth: setAuth, storage, href: tokenReturn(), enabled: true, now: () => T0 + 1 }), { outcome: 'failed' });
  assert.equal(setAuth.session.user.id, HOUSEHOLD, 'still on the household that started');
});

test('a status answer of an unexpected shape is failed on the callback, and null for Settings', async () => {
  const shapes = [
    [],
    { ...ON_STATUS, enabled: 'true' },
    { ...ON_STATUS, feature: 'google' },
    { feature: 'google-signin', enabled: true, linked: false },
    { ...ON_STATUS, linkedAt: 'yesterday' },
    { ...ON_STATUS, reason: 7 },
    { ...OFF_STATUS, linked: true },
  ];
  const bodies = [...shapes.map((shape) => JSON.stringify(shape)), 'not json', '', 'null'];
  for (const body of bodies) {
    const auth = mockAuth({ tokenUsers: { 'linked-token': LINKED_USER } });
    const storage = memoryStorage();
    mark(storage);
    const fetcher = async () => new Response(body, { status: 200 });
    assert.deepEqual(await finishGoogleLinkOnCallback({ auth, storage, href: tokenReturn(), fetcher, now: () => T0 + 1 }), { outcome: 'failed' }, body);
    assert.ok(!callNames(auth).includes('getUser'), body);
    assert.equal(storage.getItem(PENDING_LINK_KEY), null, body);
    assert.equal(await fetchGoogleSigninStatus({ auth, fetcher }), null, body);
  }
  const offline = async () => { throw new TypeError('Failed to fetch'); };
  assert.equal(await fetchGoogleSigninStatus({ auth: mockAuth(), fetcher: offline }), null);
});
