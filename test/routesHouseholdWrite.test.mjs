import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError, rpcError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope, loggedText, UUID } from './helpers/envelope.mjs';
import { registerSaveHousehold } from './helpers/fakeSaveHousehold.mjs';

const { BAND_KEYS } = await import('../lib/household.js');
const TABLES = ['household_bands', 'profiles', 'symptom_logs', 'daily_scores'];
const ALL_FALSE = Object.fromEntries(BAND_KEYS.map((key) => [key, false]));
const FRONTEND_BODY = (on = []) => Object.fromEntries(BAND_KEYS.map((key) => [key, on.includes(key)])); // what normalizeHousehold sends

/**
 * Two households. `rpc: true` registers the stand-in for save_household (migration 0015 applied);
 * otherwise the fake answers PGRST202 for it, as PostgREST does before 0015, and the route falls back.
 */
function harness({ rpc = false } = {}) {
  const h = createRouteHarness({
    tables: haloTables(...TABLES),
    seed: ({ alice, bob }) => ({
      household_bands: [
        { profile_id: alice.id, ...ALL_FALSE, has_senior: true, has_toddler: true },
        { profile_id: bob.id, ...ALL_FALSE, has_pregnant: true },
      ],
      profiles: [
        { id: alice.id, renter_mode: false, locale: 'en', county: 'Cabarrus County' },
        { id: bob.id, renter_mode: true, locale: 'es', county: 'Union County' },
      ],
    }),
  });
  if (rpc) registerSaveHousehold(h.db);
  return h;
}

/** The two ways the route saves: one transaction through save_household, or the two-step write before 0015. */
const PATHS = [
  { label: 'save_household', rpc: true, transactional: true },
  { label: 'two-step fallback', rpc: false, transactional: false },
];
/** The fallback logs one warning per route instance; silence it in tests that reach it. */
const quietFallback = (t) => t.mock.method(console, 'warn', () => {});
const put = (h, body, options = {}) => h.call('/api/household', 'PUT', { as: 'alice', body, ...options });
const putRaw = (h, rawBody, options = {}) => h.call('/api/household', 'PUT', { as: 'alice', rawBody, ...options });
const snapshot = (h) => JSON.stringify(Object.fromEntries(TABLES.map((table) => [table, h.db.rows(table)])));
const aliceBands = (h) => h.db.rows('household_bands').find((row) => row.profile_id === h.identities.alice.id);
const bad = async (h, body, expected) => {
  const before = snapshot(h);
  const logBefore = h.db.queryLog.length;
  const rpcBefore = h.db.rpcCalls.length;
  const envelope = await expectEnvelope(await put(h, body), { status: 400, code: 'validation_failed', retryable: false });
  assert.deepEqual(envelope.field_errors.map((e) => [e.field, e.code]), expected);
  assert.equal(envelope.error, envelope.field_errors[0].message);
  assert.equal(snapshot(h), before, 'a rejected request changes no table');
  assert.equal(h.db.queryLog.length, logBefore, 'and no statement was run');
  assert.equal(h.db.rpcCalls.length, rpcBefore, 'and save_household was not called');
};

// ------------------------------------------------------------ legacy

for (const path of PATHS) {
  test(`legacy request (the frontend body), ${path.label}: seven booleans replace the composition; the answer has the old fields, transactional and a request id header`, async (t) => {
    quietFallback(t);
    const h = harness(path);
    const res = await put(h, FRONTEND_BODY(['has_child', 'has_respiratory']));
    assert.equal(res.status, 200);
    assert.match(res.headers.get('x-request-id'), UUID);
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ['household', 'household_set', 'transactional']);
    assert.deepEqual(body.household, { ...ALL_FALSE, has_child: true, has_respiratory: true });
    assert.equal(body.household_set, true);
    assert.equal(body.transactional, path.transactional);
    const row = aliceBands(h);
    assert.deepEqual(BAND_KEYS.filter((key) => row[key]), ['has_child', 'has_respiratory']);
    const profileWrites = h.db.queryLog.filter((q) => q.table === 'profiles' && q.operation !== 'select');
    assert.equal(profileWrites.length, 0, 'preferences are not touched when not sent');
  });

  test(`legacy request, ${path.label}: renter_mode and locale travel with the composition and are echoed (the smoke test body)`, async (t) => {
    quietFallback(t);
    const h = harness(path);
    const body = await (await put(h, { has_toddler: true, has_respiratory: true, renter_mode: true, locale: 'es' })).json();
    assert.deepEqual(Object.keys(body).sort(), ['household', 'household_set', 'locale', 'renter_mode', 'transactional']);
    assert.deepEqual([body.renter_mode, body.locale, body.transactional], [true, 'es', path.transactional]);
    const profile = h.db.rows('profiles').find((row) => row.id === h.identities.alice.id);
    assert.deepEqual([profile.renter_mode, profile.locale, profile.county], [true, 'es', 'Cabarrus County']);
  });

  test(`legacy request, ${path.label}: a key left out becomes false (replace, not merge), and the answer lists all seven`, async (t) => {
    quietFallback(t);
    const h = harness(path);
    const body = await (await put(h, { has_child: true })).json();
    assert.deepEqual(body.household, { ...ALL_FALSE, has_child: true });
    assert.deepEqual(BAND_KEYS.filter((key) => aliceBands(h)[key]), ['has_child'], 'senior and toddler were replaced');
    assert.deepEqual(Object.keys(body.household), BAND_KEYS);
  });

  test(`legacy request, ${path.label}: null counts as left out, an empty body is {} (so all false), unknown keys are ignored, identity is the token`, async (t) => {
    quietFallback(t);
    const h = harness(path);
    const bobBefore = JSON.stringify(h.db.rows('household_bands').find((row) => row.profile_id === h.identities.bob.id));
    const nulls = await (await put(h, { has_adult: null, renter_mode: null, locale: null, profile_id: h.identities.bob.id, user_id: h.identities.bob.id, id: h.identities.bob.id, has_pet: true })).json();
    assert.deepEqual(nulls.household, ALL_FALSE);
    assert.equal('has_pet' in aliceBands(h), false);
    assert.equal('renter_mode' in nulls, false);
    assert.equal(JSON.stringify(h.db.rows('household_bands').find((row) => row.profile_id === h.identities.bob.id)), bobBefore);
    const upserts = h.db.queryLog.filter((q) => q.operation === 'upsert');
    assert.ok(upserts.length > 0);
    assert.ok(upserts.every((q) => q.rows.every((row) => (row.profile_id ?? row.id) === h.identities.alice.id)));

    const empty = await putRaw(h, '');
    assert.equal(empty.status, 200);
    assert.deepEqual((await empty.json()).household, ALL_FALSE);
  });
}

// ----------------------------------------------------------- the booleans

const NOT_BOOLEANS = ['true', 'false', 1, 0, 'yes', '', [], [true], {}];

for (const key of BAND_KEYS) {
  test(`${key}: anything but a boolean is a 400 (it used to become false) and changes nothing`, async () => {
    const h = harness();
    for (const value of NOT_BOOLEANS) await bad(h, { ...FRONTEND_BODY(['has_adult']), [key]: value }, [[key, 'invalid_boolean']]);
  });
}

test('renter_mode must be a boolean when sent, and locale must be en or es (both were silently ignored)', async (t) => {
  quietFallback(t);
  const h = harness();
  for (const value of ['true', 1, 'yes', '', [], {}]) await bad(h, { has_child: true, renter_mode: value }, [['renter_mode', 'invalid_boolean']]);
  for (const value of ['fr', 'EN', 'Es', 'en-US', '', 5, true, [], {}]) await bad(h, { has_child: true, locale: value }, [['locale', 'invalid_option']]);
  assert.equal((await put(h, { renter_mode: false, locale: 'en' })).status, 200);
});

test('every problem is reported at once: the seven groups in order, then renter_mode and locale', async () => {
  await bad(harness(), { has_senior: 'x', has_toddler: 1, renter_mode: 'y', locale: 'z' }, [
    ['has_toddler', 'invalid_boolean'], ['has_senior', 'invalid_boolean'], ['renter_mode', 'invalid_boolean'], ['locale', 'invalid_option'],
  ]);
});

// ------------------------------------------------------------- body

test('malformed JSON and bodies that are not objects are 400 bad_request, and the household is not wiped', async () => {
  const h = harness();
  const before = snapshot(h);
  for (const rawBody of ['{not json', '[true]', '[]', '"has_child"', 'true', 'null', '{"has_child":', '   ']) {
    await expectEnvelope(await putRaw(h, rawBody), { status: 400, code: 'bad_request', retryable: false });
  }
  assert.equal(snapshot(h), before, 'the seeded composition is exactly as it was');
  assert.equal(aliceBands(h).has_senior, true);
  assert.equal(h.db.queryLog.length, 0);
  assert.deepEqual(h.db.rpcCalls, []);
});

test('the body limit is 2048 bytes: exactly that is read, one more byte is a 413 and changes nothing', async (t) => {
  quietFallback(t);
  const h = harness();
  const shell = JSON.stringify({ ...FRONTEND_BODY(['has_child']), pad: '' });
  const padded = (size) => JSON.stringify({ ...FRONTEND_BODY(['has_child']), pad: 'p'.repeat(size - shell.length) });
  assert.equal(Buffer.byteLength(padded(2048)), 2048);
  assert.equal((await putRaw(h, padded(2048))).status, 200);
  const before = snapshot(h);
  const envelope = await expectEnvelope(await putRaw(h, padded(2049)), { status: 413, code: 'payload_too_large', retryable: false });
  assert.equal(envelope.error, 'That request is too large.');
  await expectEnvelope(await putRaw(h, '{}', { headers: { 'content-length': '5000' } }), { status: 413, code: 'payload_too_large' });
  assert.equal(snapshot(h), before);
});

// --------------------------------------------------- envelope, errors

test('auth failures use the envelope and echo a client request id; nothing is written', async () => {
  const h = harness();
  const none = await expectEnvelope(await h.call('/api/household', 'PUT', { body: FRONTEND_BODY() }), { status: 401, code: 'auth_required' });
  assert.equal(none.error, 'Sign-in required.');
  await expectEnvelope(await h.call('/api/household', 'PUT', { body: FRONTEND_BODY(), headers: { 'x-request-id': 'client-trace-0001' } }), { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });
  assert.equal(h.db.queryLog.length, 0);
  assert.deepEqual(h.db.rpcCalls, []);
  assert.equal(aliceBands(h).has_senior, true);
});

test('validation errors, bad bodies and successes echo a well formed client request id', async (t) => {
  quietFallback(t);
  const h = harness();
  const headers = { 'x-request-id': 'client-trace-0002' };
  await expectEnvelope(await put(h, { has_child: 'x' }, { headers }), { status: 400, code: 'validation_failed', requestId: 'client-trace-0002' });
  await expectEnvelope(await putRaw(h, '{', { headers }), { status: 400, code: 'bad_request', requestId: 'client-trace-0002' });
  assert.equal((await put(h, FRONTEND_BODY(), { headers })).headers.get('x-request-id'), 'client-trace-0002');
});

test('a database failure is a 500 envelope with no database text; the real error is logged with the request id', async (t) => {
  quietFallback(t);
  const logged = muteConsoleError(t);
  const noBands = createRouteHarness({ tables: haloTables('profiles') }); // household_bands missing: PGRST205
  const res = await put(noBands, FRONTEND_BODY(['has_child']));
  const body = await expectEnvelope(res, { status: 500, code: 'internal_error', retryable: true });
  assert.doesNotMatch(JSON.stringify(body), /schema cache|household_bands|PGRST|Could not find/);
  assert.ok(loggedText(logged).includes(body.request_id));
  assert.ok(loggedText(logged).includes('Could not find the table'));

  const noProfiles = createRouteHarness({ tables: haloTables('household_bands') }); // preferences cannot be saved
  await expectEnvelope(await put(noProfiles, { ...FRONTEND_BODY(), renter_mode: true }), { status: 500, code: 'internal_error' });
});

// ------------------------------------------ one transaction (migration 0015)

const SAVED_AT = '2026-10-04T12:00:00.000Z';

test('with save_household available the whole save is one call: the route runs no table statement and answers from the saved state', async (t) => {
  const warn = quietFallback(t);
  const h = harness();
  h.db.registerRpc(
    'save_household',
    (args) => ({ household: { ...ALL_FALSE, ...args.p_bands }, renter_mode: args.p_renter_mode, locale: args.p_locale, updated_at: SAVED_AT }),
    { args: ['p_profile_id', 'p_bands', 'p_renter_mode', 'p_locale'] },
  );
  const res = await put(h, { ...FRONTEND_BODY(['has_senior']), renter_mode: false, locale: 'es' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    household: { ...ALL_FALSE, has_senior: true },
    household_set: true,
    renter_mode: false,
    locale: 'es',
    transactional: true,
  });
  assert.deepEqual(h.db.queryLog, [], 'no two-step write next to the transaction');
  assert.equal(warn.mock.callCount(), 0);
});

test('the answer is the state save_household returns, not an echo of the request; preferences are listed only when sent', async (t) => {
  quietFallback(t);
  const h = harness();
  // A stand-in whose saved state differs from the request, so an echo would show.
  h.db.registerRpc('save_household', () => ({
    household: { ...ALL_FALSE, has_child: true, has_adult: true },
    renter_mode: true,
    locale: 'es',
    updated_at: SAVED_AT,
  }));
  const body = await (await put(h, { has_child: true, locale: 'en' })).json();
  assert.deepEqual(body, { household: { ...ALL_FALSE, has_child: true, has_adult: true }, household_set: true, locale: 'es', transactional: true });
});

test('save_household gets the caller\'s id from the token, the seven groups only, and null for preferences not sent', async (t) => {
  quietFallback(t);
  const h = harness({ rpc: true });
  const { alice, bob } = h.identities;
  await put(h, { has_child: true, has_adult: null, has_pet: true, profile_id: bob.id, id: bob.id, user_id: bob.id, p_profile_id: bob.id });
  await put(h, { has_teen: true, renter_mode: true });
  assert.deepEqual(h.db.rpcCalls, [
    { name: 'save_household', args: { p_profile_id: alice.id, p_bands: { ...ALL_FALSE, has_child: true }, p_renter_mode: null, p_locale: null } },
    { name: 'save_household', args: { p_profile_id: alice.id, p_bands: { ...ALL_FALSE, has_teen: true }, p_renter_mode: true, p_locale: null } },
  ]);
  const bobBands = h.db.rows('household_bands').find((row) => row.profile_id === bob.id);
  assert.deepEqual(BAND_KEYS.filter((key) => bobBands[key]), ['has_pregnant'], 'bob\'s household is untouched');
});

test('before migration 0015 (PGRST202 from PostgREST) the route saves in two steps, says transactional: false, and warns once per process', async (t) => {
  const warn = quietFallback(t);
  const h = harness();
  const first = await (await put(h, { ...FRONTEND_BODY(['has_teen']), locale: 'es' })).json();
  assert.deepEqual([first.transactional, first.household.has_teen, first.locale], [false, true, 'es']);
  assert.deepEqual(BAND_KEYS.filter((key) => aliceBands(h)[key]), ['has_teen']);
  assert.equal(h.db.rows('profiles').find((row) => row.id === h.identities.alice.id).locale, 'es');

  const second = await (await put(h, FRONTEND_BODY(['has_adult']))).json();
  assert.equal(second.transactional, false);
  assert.deepEqual(h.db.rpcCalls.map((call) => call.name), ['save_household', 'save_household'], 'each request tries the function first');
  assert.equal(warn.mock.callCount(), 1, 'one warning per process, not one per request');
  const warning = warn.mock.calls[0].arguments.map(String).join(' ');
  assert.match(warning, /save_household/);
  assert.match(warning, /0015/);
  assert.match(warning, /PGRST202/);
  assert.equal(warning.includes(String.fromCharCode(0x2014)), false);
});

test('a database that does not know the function (42883) also falls back to the two-step write', async (t) => {
  const warn = quietFallback(t);
  const h = harness();
  h.db.registerRpc('save_household', () => {
    throw rpcError('42883', 'function public.save_household(uuid, jsonb, boolean, text) does not exist');
  });
  const body = await (await put(h, FRONTEND_BODY(['has_child']))).json();
  assert.deepEqual([body.transactional, body.household.has_child], [false, true]);
  assert.deepEqual(BAND_KEYS.filter((key) => aliceBands(h)[key]), ['has_child']);
  assert.equal(warn.mock.callCount(), 1);
});

const FAILURES = [
  ['P0002', 'save_household: no profile row for this household'],
  ['23514', 'new row for relation "profiles" violates check constraint "profiles_locale_check"'],
  ['40001', 'could not serialize access due to concurrent update'],
  ['57014', 'canceling statement due to statement timeout'],
  ['PGRST301', 'JWT expired'],
];

for (const [code, message] of FAILURES) {
  test(`save_household failing with ${code} is a 500 envelope; nothing is written and the two-step write is not tried`, async (t) => {
    const warn = quietFallback(t);
    const logged = muteConsoleError(t);
    const h = harness();
    h.db.registerRpc('save_household', () => { throw rpcError(code, message); });
    const before = snapshot(h);
    const res = await put(h, { ...FRONTEND_BODY(['has_child']), renter_mode: true, locale: 'es' });
    const body = await expectEnvelope(res, { status: 500, code: 'internal_error', retryable: true });
    assert.doesNotMatch(JSON.stringify(body), /save_household|profiles|PGRST|constraint|statement|serialize/);
    assert.equal(snapshot(h), before, 'the profile and the household are unchanged');
    assert.deepEqual(h.db.queryLog, [], 'no fallback write after a real failure');
    assert.ok(loggedText(logged).includes(body.request_id));
    assert.ok(loggedText(logged).includes(message));
    assert.equal(warn.mock.callCount(), 0, 'a failure is not "migration not applied"');
  });
}

test('an answer from save_household that is not the saved state is a 500, not a made-up success', async (t) => {
  quietFallback(t);
  muteConsoleError(t);
  for (const answer of [null, [], { household: null }, 'saved']) {
    const h = harness();
    h.db.registerRpc('save_household', () => answer);
    await expectEnvelope(await put(h, FRONTEND_BODY(['has_child'])), { status: 500, code: 'internal_error' });
    assert.deepEqual(h.db.queryLog, []);
  }
});

test('on the transactional path a household without a profile row gets a 500 and no composition is written', async (t) => {
  quietFallback(t);
  muteConsoleError(t);
  const carol = createRouteHarness({ tables: haloTables(...TABLES), identities: { carol: {} } });
  registerSaveHousehold(carol.db);
  const res = await carol.call('/api/household', 'PUT', { as: 'carol', body: FRONTEND_BODY(['has_child']) });
  await expectEnvelope(res, { status: 500, code: 'internal_error' });
  assert.deepEqual(carol.db.rows('household_bands'), []);
  assert.deepEqual(carol.db.rows('profiles'), []);
});
