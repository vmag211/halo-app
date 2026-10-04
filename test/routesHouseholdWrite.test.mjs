import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope, loggedText, UUID } from './helpers/envelope.mjs';

const { BAND_KEYS } = await import('../lib/household.js');
const TABLES = ['household_bands', 'profiles', 'symptom_logs', 'daily_scores'];
const ALL_FALSE = Object.fromEntries(BAND_KEYS.map((key) => [key, false]));
const FRONTEND_BODY = (on = []) => Object.fromEntries(BAND_KEYS.map((key) => [key, on.includes(key)])); // what normalizeHousehold sends

function harness() {
  return createRouteHarness({
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
}
const put = (h, body, options = {}) => h.call('/api/household', 'PUT', { as: 'alice', body, ...options });
const putRaw = (h, rawBody, options = {}) => h.call('/api/household', 'PUT', { as: 'alice', rawBody, ...options });
const snapshot = (h) => JSON.stringify(Object.fromEntries(TABLES.map((table) => [table, h.db.rows(table)])));
const aliceBands = (h) => h.db.rows('household_bands').find((row) => row.profile_id === h.identities.alice.id);
const bad = async (h, body, expected) => {
  const before = snapshot(h);
  const logBefore = h.db.queryLog.length;
  const envelope = await expectEnvelope(await put(h, body), { status: 400, code: 'validation_failed', retryable: false });
  assert.deepEqual(envelope.field_errors.map((e) => [e.field, e.code]), expected);
  assert.equal(envelope.error, envelope.field_errors[0].message);
  assert.equal(snapshot(h), before, 'a rejected request changes no table');
  assert.equal(h.db.queryLog.length, logBefore, 'and no statement was run');
};

// ------------------------------------------------------------ legacy

test('legacy request (the frontend body): seven booleans replace the composition; the answer has the old fields and a request id header', async () => {
  const h = harness();
  const res = await put(h, FRONTEND_BODY(['has_child', 'has_respiratory']));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['household', 'household_set']);
  assert.deepEqual(body.household, { ...ALL_FALSE, has_child: true, has_respiratory: true });
  assert.equal(body.household_set, true);
  const row = aliceBands(h);
  assert.deepEqual(BAND_KEYS.filter((key) => row[key]), ['has_child', 'has_respiratory']);
  assert.equal(h.db.queryLog.filter((q) => q.table === 'profiles').length, 0, 'preferences are not touched when not sent');
});

test('legacy request: renter_mode and locale travel with the composition and are echoed (the smoke test body)', async () => {
  const h = harness();
  const body = await (await put(h, { has_toddler: true, has_respiratory: true, renter_mode: true, locale: 'es' })).json();
  assert.deepEqual(Object.keys(body).sort(), ['household', 'household_set', 'locale', 'renter_mode']);
  assert.deepEqual([body.renter_mode, body.locale], [true, 'es']);
  const profile = h.db.rows('profiles').find((row) => row.id === h.identities.alice.id);
  assert.deepEqual([profile.renter_mode, profile.locale, profile.county], [true, 'es', 'Cabarrus County']);
});

test('legacy request: a key left out becomes false (replace, not merge), and the answer lists all seven', async () => {
  const h = harness();
  const body = await (await put(h, { has_child: true })).json();
  assert.deepEqual(body.household, { ...ALL_FALSE, has_child: true });
  assert.deepEqual(BAND_KEYS.filter((key) => aliceBands(h)[key]), ['has_child'], 'senior and toddler were replaced');
  assert.deepEqual(Object.keys(body.household), BAND_KEYS);
});

test('legacy request: null counts as left out, an empty body is {} (so all false), unknown keys are ignored, identity is the token', async () => {
  const h = harness();
  const bobBefore = JSON.stringify(h.db.rows('household_bands').find((row) => row.profile_id === h.identities.bob.id));
  const nulls = await (await put(h, { has_adult: null, renter_mode: null, locale: null, profile_id: h.identities.bob.id, user_id: h.identities.bob.id, id: h.identities.bob.id, has_pet: true })).json();
  assert.deepEqual(nulls.household, ALL_FALSE);
  assert.equal('has_pet' in aliceBands(h), false);
  assert.equal('renter_mode' in nulls, false);
  assert.equal(JSON.stringify(h.db.rows('household_bands').find((row) => row.profile_id === h.identities.bob.id)), bobBefore);
  const upserts = h.db.queryLog.filter((q) => q.operation === 'upsert');
  assert.ok(upserts.every((q) => q.rows.every((row) => (row.profile_id ?? row.id) === h.identities.alice.id)));

  const empty = await putRaw(h, '');
  assert.equal(empty.status, 200);
  assert.deepEqual((await empty.json()).household, ALL_FALSE);
});

// ----------------------------------------------------------- the booleans

const NOT_BOOLEANS = ['true', 'false', 1, 0, 'yes', '', [], [true], {}];

for (const key of BAND_KEYS) {
  test(`${key}: anything but a boolean is a 400 (it used to become false) and changes nothing`, async () => {
    const h = harness();
    for (const value of NOT_BOOLEANS) await bad(h, { ...FRONTEND_BODY(['has_adult']), [key]: value }, [[key, 'invalid_boolean']]);
  });
}

test('renter_mode must be a boolean when sent, and locale must be en or es (both were silently ignored)', async () => {
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
});

test('the body limit is 2048 bytes: exactly that is read, one more byte is a 413 and changes nothing', async () => {
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
  assert.equal(aliceBands(h).has_senior, true);
});

test('validation errors, bad bodies and successes echo a well formed client request id', async () => {
  const h = harness();
  const headers = { 'x-request-id': 'client-trace-0002' };
  await expectEnvelope(await put(h, { has_child: 'x' }, { headers }), { status: 400, code: 'validation_failed', requestId: 'client-trace-0002' });
  await expectEnvelope(await putRaw(h, '{', { headers }), { status: 400, code: 'bad_request', requestId: 'client-trace-0002' });
  assert.equal((await put(h, FRONTEND_BODY(), { headers })).headers.get('x-request-id'), 'client-trace-0002');
});

test('a database failure is a 500 envelope with no database text; the real error is logged with the request id', async (t) => {
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
