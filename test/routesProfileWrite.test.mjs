import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope, loggedText, UUID } from './helpers/envelope.mjs';

const TABLES = ['profiles', 'household_bands', 'symptom_logs', 'daily_scores'];
const YEAR = new Date().getFullYear();
const YEAR_MESSAGE = `Year built must be a whole year between 1700 and ${YEAR}, or left blank.`;

function harness() {
  return createRouteHarness({
    tables: haloTables(...TABLES),
    seed: ({ alice, bob }) => ({
      profiles: [
        { id: alice.id, county: 'Cabarrus County', state: 'NC', pwsid: 'NC0113010', lat: 35.4, lng: -80.5, water_source: 'utility', home_year: 1975, renter_mode: false, locale: 'en' },
        { id: bob.id, county: 'Union County', state: 'NC', pwsid: 'NC0129010', lat: 35.1, lng: -80.6, water_source: 'well', home_year: 2001, renter_mode: true, locale: 'es' },
      ],
    }),
  });
}
const patch = (h, body, options = {}) => h.call('/api/profile', 'PATCH', { as: 'alice', body, ...options });
const patchRaw = (h, rawBody, options = {}) => h.call('/api/profile', 'PATCH', { as: 'alice', rawBody, ...options });
const snapshot = (h) => JSON.stringify(Object.fromEntries(TABLES.map((table) => [table, h.db.rows(table)])));
const aliceRow = (h) => h.db.rows('profiles').find((row) => row.id === h.identities.alice.id);
const bad = async (h, body, expected, message) => {
  const before = snapshot(h);
  const logBefore = h.db.queryLog.length;
  const envelope = await expectEnvelope(await patch(h, body), { status: 400, code: 'validation_failed', retryable: false });
  assert.deepEqual(envelope.field_errors.map((e) => [e.field, e.code]), expected);
  assert.equal(envelope.error, envelope.field_errors[0].message);
  if (message) assert.equal(envelope.error, message);
  assert.equal(snapshot(h), before, 'a rejected request changes no table');
  assert.equal(h.db.queryLog.length, logBefore, 'and no statement was run');
};

// ------------------------------------------------------------ legacy

test('legacy request (the frontend body): both fields are saved and the answer is the profile, with a request id header', async () => {
  const h = harness();
  const res = await patch(h, { water_source: 'well', home_year: 1950 });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['household', 'household_set', 'onboarded', 'onboarding_complete', 'profile']);
  assert.deepEqual([body.profile.water_source, body.profile.home_year, body.onboarded, body.onboarding_complete], ['well', 1950, true, true]);
  assert.equal('request_id' in body, false);
  const row = aliceRow(h);
  assert.deepEqual([row.water_source, row.home_year, row.county, row.pwsid, row.lat, row.lng], ['well', 1950, 'Cabarrus County', 'NC0113010', 35.4, -80.5], 'only the two fields change');
});

test('legacy request: null clears home_year (the frontend sends it for "not sure") and water_source, each on its own', async () => {
  const h = harness();
  assert.equal((await patch(h, { water_source: 'spring', home_year: null })).status, 200);
  assert.deepEqual([aliceRow(h).water_source, aliceRow(h).home_year], ['spring', null]);

  assert.equal((await patch(h, { water_source: null })).status, 200, 'a key that is present counts even when null');
  assert.deepEqual([aliceRow(h).water_source, aliceRow(h).home_year], [null, null]);

  const h2 = harness();
  await patch(h2, { home_year: null });
  assert.deepEqual([aliceRow(h2).water_source, aliceRow(h2).home_year], ['utility', null], 'water_source was not in the request, so it stays');
  await patch(h2, { home_year: '' });
  assert.equal(aliceRow(h2).home_year, null);
});

test('legacy request: every body saveHome can send (a canonical water answer, a year or null) is accepted', async () => {
  const h = harness();
  for (const source of ['utility', 'well', 'spring', 'other']) {
    for (const year of [null, 1950, YEAR]) {
      const res = await patch(h, { water_source: source, home_year: year });
      assert.equal(res.status, 200, `${source} ${year}`);
      const { profile, onboarding_complete: complete } = await res.json();
      assert.deepEqual([profile.water_source, profile.home_year, complete], [source, year, true]);
    }
  }
});

test('legacy request: a year may be a number or a numeric string, and a display answer is normalized as before', async () => {
  const h = harness();
  await patch(h, { home_year: '1988', water_source: 'City utility' });
  assert.deepEqual([aliceRow(h).home_year, aliceRow(h).water_source], [1988, 'utility']);
  await patch(h, { home_year: 1700 });
  assert.equal(aliceRow(h).home_year, 1700);
  await patch(h, { home_year: YEAR });
  assert.equal(aliceRow(h).home_year, YEAR);
  await patch(h, { water_source: 'Private well' });
  assert.equal(aliceRow(h).water_source, 'well');
});

test('legacy request: unrecognised water text is stored as other (the documented safe answer), not rejected', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const h = harness();
  assert.equal((await patch(h, { water_source: 'banana' })).status, 200);
  assert.equal(aliceRow(h).water_source, 'other');
});

test('legacy request: unknown keys are ignored and the identity is the token, never the body', async () => {
  const h = harness();
  const bobBefore = JSON.stringify(h.db.rows('profiles').find((row) => row.id === h.identities.bob.id));
  const res = await patch(h, { water_source: 'well', id: h.identities.bob.id, profile_id: h.identities.bob.id, user_id: h.identities.bob.id, county: 'Injected County', pwsid: 'NC0000000', lat: 1 });
  assert.equal(res.status, 200);
  assert.deepEqual([aliceRow(h).county, aliceRow(h).pwsid, aliceRow(h).lat], ['Cabarrus County', 'NC0113010', 35.4]);
  assert.equal(JSON.stringify(h.db.rows('profiles').find((row) => row.id === h.identities.bob.id)), bobBefore);
  const upsert = h.db.queryLog.find((q) => q.table === 'profiles' && q.operation === 'upsert');
  assert.deepEqual(upsert.rows, [{ id: h.identities.alice.id, water_source: 'well' }]);
});

// ------------------------------------------------- one recognised key

test('at least one recognised key is required: an empty object, an empty body and unknown keys alone are a 400 with the old sentence', async () => {
  const h = harness();
  await bad(h, {}, [['body', 'nothing_to_change']], 'Nothing to change: send water_source and/or home_year.');
  await bad(h, { county: 'X', id: h.identities.bob.id }, [['body', 'nothing_to_change']]);
  const empty = await expectEnvelope(await patchRaw(h, ''), { status: 400, code: 'validation_failed' });
  assert.deepEqual(empty.field_errors.map((e) => e.code), ['nothing_to_change']);
});

// ---------------------------------------------------------- home_year

test('home_year: before 1700, after this year, fractions and text are a 400 with the sentence the lib already used', async () => {
  const h = harness();
  for (const value of [1699, YEAR + 1, 0, -1980, 1988.5, 'abc', '1988abc', 'next year', '19 88', '1e2']) {
    await bad(h, { home_year: value }, [['home_year', 'invalid_year']], YEAR_MESSAGE);
  }
});

test('home_year: a boolean, a list, an object or a very long string is a 400 (a list used to pass as its one element)', async () => {
  const h = harness();
  for (const value of [true, false, [1988], [], {}, { year: 1988 }, '1'.repeat(11), '0'.repeat(7) + '1988']) {
    await bad(h, { home_year: value }, [['home_year', 'invalid_year']], YEAR_MESSAGE);
  }
  assert.equal((await patch(h, { home_year: '0'.repeat(6) + '1988' })).status, 200, 'ten characters is the most');
  assert.equal(aliceRow(h).home_year, 1988);
});

// -------------------------------------------------------- water_source

test('water_source: anything but text or null is a 400 (it used to become other), and over 40 characters is too long', async () => {
  const h = harness();
  for (const value of [5, true, false, [], ['well'], {}]) await bad(h, { water_source: value }, [['water_source', 'invalid_text']]);
  await bad(h, { water_source: 'w'.repeat(41) }, [['water_source', 'text_too_long']]);
  assert.equal((await patch(h, { water_source: 'well'.padEnd(40, ' ') })).status, 200, 'padding is trimmed before the cap');
});

test('both fields bad: every problem is reported, water_source first', async () => {
  await bad(harness(), { water_source: 5, home_year: 'x' }, [['water_source', 'invalid_text'], ['home_year', 'invalid_year']]);
});

// ------------------------------------------------------------- body

test('malformed JSON and bodies that are not objects are 400 bad_request and change nothing', async () => {
  const h = harness();
  const before = snapshot(h);
  for (const rawBody of ['{not json', '[]', '[{"home_year":1990}]', '"well"', '5', 'null', '{"home_year":', '   ']) {
    await expectEnvelope(await patchRaw(h, rawBody), { status: 400, code: 'bad_request', retryable: false });
  }
  assert.equal(snapshot(h), before);
  assert.equal(h.db.queryLog.length, 0);
});

test('the body limit is 2048 bytes: exactly that is read, one more byte is a 413 and changes nothing', async () => {
  const h = harness();
  const shell = JSON.stringify({ home_year: 1960, pad: '' });
  const padded = (size) => JSON.stringify({ home_year: 1960, pad: 'p'.repeat(size - shell.length) });
  assert.equal(Buffer.byteLength(padded(2048)), 2048);
  assert.equal((await patchRaw(h, padded(2048))).status, 200);
  const before = snapshot(h);
  const envelope = await expectEnvelope(await patchRaw(h, padded(2049)), { status: 413, code: 'payload_too_large', retryable: false });
  assert.equal(envelope.error, 'That request is too large.');
  await expectEnvelope(await patchRaw(h, '{}', { headers: { 'content-length': '5000' } }), { status: 413, code: 'payload_too_large' });
  assert.equal(snapshot(h), before);
});

// --------------------------------------------------- envelope, errors

test('auth failures use the envelope and echo a client request id; nothing is written', async () => {
  const h = harness();
  const none = await expectEnvelope(await h.call('/api/profile', 'PATCH', { body: { home_year: 1990 } }), { status: 401, code: 'auth_required' });
  assert.equal(none.error, 'Sign-in required.');
  await expectEnvelope(await h.call('/api/profile', 'PATCH', { body: { home_year: 1990 }, headers: { 'x-request-id': 'client-trace-0001' } }), { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });
  assert.equal(h.db.queryLog.length, 0);
});

test('validation errors, bad bodies and successes echo a well formed client request id', async () => {
  const h = harness();
  const headers = { 'x-request-id': 'client-trace-0002' };
  await expectEnvelope(await patch(h, { home_year: 'x' }, { headers }), { status: 400, code: 'validation_failed', requestId: 'client-trace-0002' });
  await expectEnvelope(await patchRaw(h, '{', { headers }), { status: 400, code: 'bad_request', requestId: 'client-trace-0002' });
  assert.equal((await patch(h, { home_year: 1990 }, { headers })).headers.get('x-request-id'), 'client-trace-0002');
});

test('a database failure is a 500 envelope with no database text; the real error is logged with the request id', async (t) => {
  const logged = muteConsoleError(t);
  const broken = createRouteHarness({ tables: {} }); // profiles missing: PGRST205
  const body = await expectEnvelope(await patch(broken, { home_year: 1990 }), { status: 500, code: 'internal_error', retryable: true });
  assert.doesNotMatch(JSON.stringify(body), /schema cache|profiles|PGRST|Could not find/);
  assert.ok(loggedText(logged).includes(body.request_id));
  assert.ok(loggedText(logged).includes('Could not find the table'));
});
