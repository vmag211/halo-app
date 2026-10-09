import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError, rpcError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope, loggedText, UUID } from './helpers/envelope.mjs';
import { auditOwnerScope } from './helpers/isolationKit.mjs';
import {
  fullContextRow,
  homeContextHandlers,
  registerHomeContextRpcs,
  TRANSITION_HOME_CONTEXT_ARGS,
  UPDATE_HOME_CONTEXT_ATTRIBUTES_ARGS,
} from './helpers/fakeHomeContext.mjs';

const { contextSummary } = await import('../lib/homeContext.js');

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
/**
 * The harness above has no home_contexts table, as before migration 0016: the PATCH saves to the
 * profile as it always has and logs one warning per route instance. Silence it in tests that reach it.
 */
const quietFallback = (t) => t.mock.method(console, 'warn', () => {});
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

test('legacy request (the frontend body): both fields are saved and the answer is the profile, with a request id header', async (t) => {
  quietFallback(t);
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

test('legacy request: null clears home_year (the frontend sends it for "not sure") and water_source, each on its own', async (t) => {
  quietFallback(t);
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

test('legacy request: every body saveHome can send (a canonical water answer, a year or null) is accepted', async (t) => {
  quietFallback(t);
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

test('legacy request: a year may be a number or a numeric string, and a display answer is normalized as before', async (t) => {
  quietFallback(t);
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
  t.mock.method(console, 'warn', () => {}); // the normalizer's note, and the fallback's
  const h = harness();
  assert.equal((await patch(h, { water_source: 'banana' })).status, 200);
  assert.equal(aliceRow(h).water_source, 'other');
});

test('legacy request: unknown keys are ignored and the identity is the token, never the body', async (t) => {
  quietFallback(t);
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

test('home_year: a boolean, a list, an object or a very long string is a 400 (a list used to pass as its one element)', async (t) => {
  quietFallback(t);
  const h = harness();
  for (const value of [true, false, [1988], [], {}, { year: 1988 }, '1'.repeat(11), '0'.repeat(7) + '1988']) {
    await bad(h, { home_year: value }, [['home_year', 'invalid_year']], YEAR_MESSAGE);
  }
  assert.equal((await patch(h, { home_year: '0'.repeat(6) + '1988' })).status, 200, 'ten characters is the most');
  assert.equal(aliceRow(h).home_year, 1988);
});

// -------------------------------------------------------- water_source

test('water_source: anything but text or null is a 400 (it used to become other), and over 40 characters is too long', async (t) => {
  quietFallback(t);
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

test('the body limit is 2048 bytes: exactly that is read, one more byte is a 413 and changes nothing', async (t) => {
  quietFallback(t);
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

test('validation errors, bad bodies and successes echo a well formed client request id', async (t) => {
  quietFallback(t);
  const h = harness();
  const headers = { 'x-request-id': 'client-trace-0002' };
  await expectEnvelope(await patch(h, { home_year: 'x' }, { headers }), { status: 400, code: 'validation_failed', requestId: 'client-trace-0002' });
  await expectEnvelope(await patchRaw(h, '{', { headers }), { status: 400, code: 'bad_request', requestId: 'client-trace-0002' });
  assert.equal((await patch(h, { home_year: 1990 }, { headers })).headers.get('x-request-id'), 'client-trace-0002');
});

test('a database failure is a 500 envelope with no database text; the real error is logged with the request id', async (t) => {
  quietFallback(t);
  const logged = muteConsoleError(t);
  const broken = createRouteHarness({ tables: {} }); // profiles missing: PGRST205
  const body = await expectEnvelope(await patch(broken, { home_year: 1990 }), { status: 500, code: 'internal_error', retryable: true });
  assert.doesNotMatch(JSON.stringify(body), /schema cache|profiles|PGRST|Could not find/);
  assert.ok(loggedText(logged).includes(body.request_id));
  assert.ok(loggedText(logged).includes('Could not find the table'));
});

// ------------------------------------------ through the home context (0016)

const ALICE_HOME = 'a11ce000-2222-4000-8000-000000000001';
const ALICE_EARLIER_HOME = 'a11ce000-2222-4000-8000-000000000009';
const BOB_HOME = 'b0b00000-2222-4000-8000-000000000001';
const CONTEXT_TABLES = [...TABLES, 'home_contexts'];
const LEGACY_KEYS = ['household', 'household_set', 'onboarded', 'onboarding_complete', 'profile'];

/**
 * Alice and bob with migration 0016's table. `context: false` leaves alice located but without a
 * home context (located by the old onboard route after 0016 ran); `located: false` leaves her
 * without a location too. `rpc: false` keeps the two functions missing (PGRST202).
 */
function contextHarness({ rpc = true, context = true, located = true, lat = 35.4, lng = -80.5, earlier = false } = {}) {
  const h = createRouteHarness({
    tables: haloTables(...CONTEXT_TABLES),
    seed: ({ alice, bob }) => ({
      profiles: [
        located
          ? { id: alice.id, county: 'Cabarrus County', state: 'NC', pwsid: 'NC0113010', lat, lng, water_source: 'utility', home_year: 1975, renter_mode: false, locale: 'en' }
          : { id: alice.id, renter_mode: false, locale: 'en' },
        { id: bob.id, county: 'Union County', state: 'NC', pwsid: 'NC0129010', lat: 35.1, lng: -80.6, water_source: 'well', home_year: 2001, renter_mode: true, locale: 'es' },
      ],
      home_contexts: [
        ...(earlier
          ? [fullContextRow({
              id: ALICE_EARLIER_HOME, profile_id: alice.id, sequence: 1, revision: 7, origin: 'onboard', lat: 35.227, lng: -80.843,
              county: 'Mecklenburg County', state: 'NC', water_source: 'well', home_year: 1962, backfill_state: 'complete',
              effective_from: '2026-01-01T12:00:00Z', effective_to: '2026-06-01T12:00:00Z', closed_reason: 'moved',
            })]
          : []),
        ...(context && located
          ? [fullContextRow({
              id: ALICE_HOME, profile_id: alice.id, sequence: earlier ? 2 : 1, revision: 3, origin: earlier ? 'move' : 'onboard', lat, lng, county: 'Cabarrus County', state: 'NC',
              pwsid: 'NC0113010', service_area_status: 'measured', water_source: 'utility', home_year: 1975,
              match_method: 'mapbox_geocode_arcgis_point', backfill_state: 'complete', effective_from: '2026-06-01T12:00:00Z',
            })]
          : []),
        fullContextRow({
          id: BOB_HOME, profile_id: bob.id, sequence: 1, revision: 1, origin: 'onboard', lat: 35.1, lng: -80.6, county: 'Union County',
          state: 'NC', pwsid: 'NC0129010', water_source: 'well', home_year: 2001, backfill_state: 'complete', effective_from: '2026-06-01T12:00:00Z',
        }),
      ],
      daily_scores: [
        { profile_id: alice.id, date: '2026-06-02', aqi: 40, home_context_id: context && located ? ALICE_HOME : null },
        { profile_id: bob.id, date: '2026-06-02', aqi: 99, home_context_id: BOB_HOME },
      ],
    }),
  });
  if (rpc) registerHomeContextRpcs(h.db);
  return h;
}
const aliceContexts = (h) => h.db.rows('home_contexts').filter((row) => row.profile_id === h.identities.alice.id);
const bobState = (h) => JSON.stringify(CONTEXT_TABLES.map((table) => h.db.rows(table).filter((row) => (row.profile_id ?? row.id) === h.identities.bob.id)));
const routeWrites = (h) => h.db.queryLog.filter((q) => q.table === 'profiles' && q.operation === 'upsert');

test('with a current home: the answers go through update_home_context_attributes at the revision read in the same request', async (t) => {
  const warn = quietFallback(t);
  const h = contextHarness();
  const bobBefore = bobState(h);
  const res = await patch(h, { water_source: 'well' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), [...LEGACY_KEYS, 'home_context'].sort(), 'the profile answer as before, plus the home');
  assert.deepEqual([body.profile.water_source, body.profile.home_year, body.onboarding_complete], ['well', 1975, true]);
  const [context] = aliceContexts(h);
  assert.deepEqual([context.revision, context.water_source, context.home_year], [4, 'well', 1975], 'the other answer is kept');
  assert.deepEqual(body.home_context, contextSummary(context));
  assert.deepEqual(h.db.rpcCalls, [{
    name: 'update_home_context_attributes',
    args: { p_profile_id: h.identities.alice.id, p_context_id: ALICE_HOME, p_expected_revision: 3, p_attributes: { water_source: 'well' } },
  }]);
  assert.deepEqual([aliceRow(h).water_source, aliceRow(h).home_year], ['well', 1975], 'the function keeps the profile in step');
  assert.deepEqual(routeWrites(h), [], 'the route did not also write the profile itself');
  auditOwnerScope(h.db.queryLog, h.identities.alice.id, 'PATCH /api/profile');
  assert.equal(bobState(h), bobBefore);

  const next = await (await patch(h, { home_year: null })).json();
  assert.equal(h.db.rpcCalls[1].args.p_expected_revision, 4, 'the next request reads the new revision');
  assert.deepEqual([next.home_context.revision, next.home_context.water_source, next.home_context.home_year], [5, 'well', null]);
  assert.equal(warn.mock.callCount(), 0);
});

test('with earlier homes closed by moves, the current home is the one read and changed', async () => {
  const h = contextHarness({ earlier: true });
  const res = await patch(h, { home_year: 1990 });
  assert.equal(res.status, 200);
  assert.deepEqual(
    [h.db.rpcCalls[0].args.p_context_id, h.db.rpcCalls[0].args.p_expected_revision],
    [ALICE_HOME, 3],
    'the current home and its revision, not the closed one\'s',
  );
  const earlier = h.db.rows('home_contexts').find((row) => row.id === ALICE_EARLIER_HOME);
  assert.deepEqual([earlier.revision, earlier.home_year], [7, 1962], 'the earlier home is untouched');
  assert.equal((await res.json()).home_context.id, ALICE_HOME);
});

/** Registers update_home_context_attributes so that `meanwhile` runs (another request's change) before the real call. */
function racingUpdate(h, meanwhile) {
  const { update } = homeContextHandlers();
  h.db.registerRpc('update_home_context_attributes', async (args, db) => {
    await meanwhile(db);
    return update(args, db);
  }, { args: [...UPDATE_HOME_CONTEXT_ATTRIBUTES_ARGS] });
}

test('a change to the home between the read and the save is a 409 conflict with the current revision; nothing of this request is written', async () => {
  const h = contextHarness();
  racingUpdate(h, (db) => db.from('home_contexts').update({ revision: 9, home_year: 1980 }).eq('id', ALICE_HOME));
  const before = aliceRow(h);
  const body = await expectEnvelope(await patch(h, { water_source: 'well' }), {
    status: 409, code: 'conflict', retryable: false, extraKeys: ['reason', 'revision'],
  });
  assert.deepEqual([body.reason, body.revision], ['stale_revision', 9]);
  assert.equal(body.error, 'This home was changed since you last loaded it. Reload it and try again.');
  assert.deepEqual(aliceRow(h), before, 'the profile is as it was');
  assert.equal(aliceContexts(h)[0].water_source, 'utility');
  assert.deepEqual(routeWrites(h), [], 'no fallback write');
});

test('a move that closes the home between the read and the save is a 409 conflict too', async () => {
  const h = contextHarness();
  racingUpdate(h, (db) => db.from('home_contexts').update({ effective_to: '2026-10-01T00:00:00Z', closed_reason: 'moved' }).eq('id', ALICE_HOME));
  const body = await expectEnvelope(await patch(h, { home_year: 1950 }), { status: 409, code: 'conflict', extraKeys: ['reason'] });
  assert.equal(body.reason, 'context_closed');
  assert.equal(aliceRow(h).home_year, 1975);
  assert.deepEqual(routeWrites(h), []);
});

test('located but no home yet: the stored point makes the legacy home and saves the change in it, and the other answer is not wiped', async (t) => {
  const warn = quietFallback(t);
  const h = contextHarness({ context: false });
  const bobBefore = bobState(h);
  const res = await patch(h, { home_year: 1950 });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(h.db.rpcCalls, [{
    name: 'transition_home_context',
    args: {
      p_profile_id: h.identities.alice.id,
      p_location: { lat: 35.4, lng: -80.5, county: 'Cabarrus County', state: 'NC' },
      p_attributes: { pwsid: 'NC0113010', water_source: 'utility', home_year: 1950 },
      p_request_id: null,
    },
  }], 'the stored point as it is, and every answer, the unchanged one included');
  const contexts = aliceContexts(h);
  assert.equal(contexts.length, 1, 'no move: one home');
  const [home] = contexts;
  assert.deepEqual(
    [home.sequence, home.origin, home.revision, home.effective_to, home.lat, home.lng, home.pwsid, home.water_source, home.home_year, home.match_method],
    [1, 'legacy_migration', 2, null, 35.4, -80.5, 'NC0113010', 'utility', 1950, 'legacy_profile'],
  );
  assert.deepEqual(body.home_context, contextSummary(home));
  assert.deepEqual([body.profile.water_source, body.profile.home_year, body.profile.lat, body.profile.lng, body.profile.county], ['utility', 1950, 35.4, -80.5, 'Cabarrus County']);
  assert.deepEqual(h.db.rows('daily_scores').filter((row) => row.profile_id === h.identities.alice.id).map((row) => row.home_context_id), [home.id], 'her reading now belongs to that home, and was kept');
  assert.equal(bobState(h), bobBefore);
  assert.deepEqual(routeWrites(h), []);
  auditOwnerScope(h.db.queryLog, h.identities.alice.id, 'PATCH /api/profile');

  const next = await (await patch(h, { water_source: 'spring' })).json();
  assert.deepEqual(h.db.rpcCalls.map((call) => call.name), ['transition_home_context', 'update_home_context_attributes'], 'from then on, the attribute update');
  assert.equal(h.db.rpcCalls[1].args.p_expected_revision, 2);
  assert.deepEqual([next.home_context.revision, next.home_context.water_source, next.home_context.home_year], [3, 'spring', 1950]);
  assert.equal(warn.mock.callCount(), 0);
});

test('located but no home yet, sending water_source only: home_year is carried as it was, never cleared', async () => {
  const h = contextHarness({ context: false });
  await patch(h, { water_source: 'well' });
  assert.deepEqual(h.db.rpcCalls[0].args.p_attributes, { pwsid: 'NC0113010', water_source: 'well', home_year: 1975 });
  assert.deepEqual([aliceRow(h).water_source, aliceRow(h).home_year, aliceContexts(h)[0].home_year], ['well', 1975, 1975]);
});

test('if the address changed while the legacy home was made, the change is saved and the anomaly is logged with the request id', async (t) => {
  const logged = muteConsoleError(t);
  const h = contextHarness({ context: false });
  const { transition } = homeContextHandlers();
  h.db.registerRpc('transition_home_context', async (args, db) => {
    // another request onboards a new address first
    await transition({ ...args, p_location: { lat: 35.227, lng: -80.843 }, p_attributes: {}, p_request_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, db);
    return transition(args, db);
  }, { args: [...TRANSITION_HOME_CONTEXT_ARGS] });
  const res = await patch(h, { home_year: 1950 }, { headers: { 'x-request-id': 'client-trace-0201' } });
  assert.equal(res.status, 200);
  assert.equal(aliceRow(h).home_year, 1950);
  const text = loggedText(logged);
  assert.ok(text.includes('client-trace-0201'));
  assert.match(text, /address changed/);
});

test('not located (not onboarded yet): the legacy write, no function called and no warning', async (t) => {
  const warn = quietFallback(t);
  const h = contextHarness({ located: false });
  const res = await patch(h, { water_source: 'well' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), LEGACY_KEYS);
  assert.deepEqual(h.db.rpcCalls, []);
  assert.deepEqual(routeWrites(h).map((q) => q.rows), [[{ id: h.identities.alice.id, water_source: 'well' }]]);
  assert.equal(warn.mock.callCount(), 0);

  const nobody = createRouteHarness({ tables: haloTables(...CONTEXT_TABLES), identities: { carol: {} } });
  registerHomeContextRpcs(nobody.db);
  assert.equal((await nobody.call('/api/profile', 'PATCH', { as: 'carol', body: { home_year: 1990 } })).status, 200, 'a missing profile row is created, as before');
  assert.deepEqual(nobody.db.rows('profiles').map((row) => row.home_year), [1990]);
  assert.deepEqual(nobody.db.rpcCalls, []);
});

test('a stored point the function would refuse (not rounded to 3 decimals) is never sent to it: the legacy write', async (t) => {
  const warn = quietFallback(t);
  const h = contextHarness({ context: false, lat: 35.40881, lng: -80.57952 });
  assert.equal((await patch(h, { home_year: 1950 })).status, 200);
  assert.deepEqual(h.db.rpcCalls, []);
  assert.equal(aliceRow(h).home_year, 1950);
  assert.deepEqual(aliceContexts(h), []);
  assert.equal(warn.mock.callCount(), 0);
});

test('before migration 0016 (no home_contexts table) the PATCH is exactly the legacy one, and warns once per process', async (t) => {
  const warn = quietFallback(t);
  const h = harness(); // no home_contexts table: PGRST205
  const res = await patch(h, { water_source: 'well', home_year: 1950 });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    onboarded: true,
    onboarding_complete: true,
    profile: {
      county: 'Cabarrus County', state: 'NC', zip: null, pwsid: 'NC0113010', lat: 35.4, lng: -80.5, home_year: 1950,
      water_source: 'well', renter_mode: false, locale: 'en', onboard_request_id: null,
    },
    household: { has_toddler: false, has_child: false, has_teen: false, has_adult: false, has_senior: false, has_pregnant: false, has_respiratory: false },
    household_set: false,
  });
  assert.deepEqual(routeWrites(h).map((q) => q.rows), [[{ water_source: 'well', home_year: 1950, id: h.identities.alice.id }]]);
  assert.deepEqual(h.db.rpcCalls, [], 'with no table there is nothing to call');
  await patch(h, { home_year: 1960 });
  assert.equal(warn.mock.callCount(), 1, 'one warning per process, not one per request');
  const warning = warn.mock.calls[0].arguments.map(String).join(' ');
  assert.match(warning, /0016/);
  assert.match(warning, /PGRST205/);
  assert.equal(warning.includes(String.fromCharCode(0x2014)), false);
});

test('the table there but the functions missing (PGRST202, or 42883) is the legacy write with the same answer, and one warning', async (t) => {
  const warn = quietFallback(t);
  const legacy = await (await patch(harness(), { water_source: 'spring' })).json();
  for (const context of [true, false]) {
    const h = contextHarness({ rpc: false, context });
    const res = await patch(h, { water_source: 'spring' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), legacy, `context: ${context}: the same answer as before 0016`);
    assert.deepEqual(h.db.rpcCalls.map((call) => call.name), [context ? 'update_home_context_attributes' : 'transition_home_context']);
    assert.deepEqual(routeWrites(h).map((q) => q.rows), [[{ water_source: 'spring', id: h.identities.alice.id }]]);
    assert.equal(aliceContexts(h).length, context ? 1 : 0);
  }
  const unknown = contextHarness({ rpc: false });
  unknown.db.registerRpc('update_home_context_attributes', () => {
    throw rpcError('42883', 'function public.update_home_context_attributes(uuid, uuid, integer, jsonb) does not exist');
  });
  assert.equal((await patch(unknown, { water_source: 'spring' })).status, 200);
  assert.equal(aliceRow(unknown).water_source, 'spring');
  assert.equal(warn.mock.callCount(), 4, 'one per route instance (each harness loads its own)');
  assert.match(warn.mock.calls[1].arguments.map(String).join(' '), /PGRST202/);
  assert.match(warn.mock.calls[3].arguments.map(String).join(' '), /42883/);
});

test('any other failure of the functions or the home read is a 500, with nothing written by the route', async (t) => {
  quietFallback(t);
  const logged = muteConsoleError(t);
  const cases = [
    ['update', true, ['P0001', 'HALO_INVALID_INPUT', 'p_attributes.home_year must be a whole number or null']],
    ['update', true, ['40001', 'could not serialize access due to concurrent update', null]],
    ['update', true, ['P0001', 'HALO_CONTEXT_NOT_FOUND', null]],
    ['transition', false, ['P0001', 'HALO_PROFILE_NOT_FOUND', null]],
    ['transition', false, ['P0001', 'HALO_INVALID_INPUT', 'p_location.lat must be a number']],
    ['transition', false, ['57014', 'canceling statement due to statement timeout', null]],
  ];
  for (const [which, context, [code, message, details]] of cases) {
    const h = contextHarness({ rpc: false, context });
    const name = which === 'update' ? 'update_home_context_attributes' : 'transition_home_context';
    const args = which === 'update' ? UPDATE_HOME_CONTEXT_ATTRIBUTES_ARGS : TRANSITION_HOME_CONTEXT_ARGS;
    h.db.registerRpc(name, () => { throw rpcError(code, message, details); }, { args: [...args] });
    const before = aliceRow(h);
    const body = await expectEnvelope(await patch(h, { home_year: 1950 }), { status: 500, code: 'internal_error', retryable: true });
    assert.doesNotMatch(JSON.stringify(body), /HALO|serialize|statement|p_location|p_attributes/);
    assert.ok(loggedText(logged).includes(body.request_id));
    assert.ok(loggedText(logged).includes(message), message);
    assert.deepEqual(aliceRow(h), before, `${message}: the profile is unchanged`);
    assert.deepEqual(routeWrites(h), [], `${message}: no fallback write`);
  }
  for (const answer of [null, {}, { context: null }]) {
    const h = contextHarness({ rpc: false });
    h.db.registerRpc('update_home_context_attributes', () => answer, { args: [...UPDATE_HOME_CONTEXT_ATTRIBUTES_ARGS] });
    await expectEnvelope(await patch(h, { home_year: 1950 }), { status: 500, code: 'internal_error' });
  }
  const broken = contextHarness();
  const from = broken.db.from.bind(broken.db);
  broken.db.from = (name) => { if (name === 'home_contexts') throw new Error('secret database detail'); return from(name); };
  const failed = await expectEnvelope(await patch(broken, { home_year: 1950 }), { status: 500, code: 'internal_error' });
  assert.doesNotMatch(JSON.stringify(failed), /secret/);
  assert.equal(aliceRow(broken).home_year, 1975);
});

test('the identity is the token on the home path too: a body naming bob changes only alice\'s home', async () => {
  const h = contextHarness();
  const bobBefore = bobState(h);
  const res = await patch(h, { water_source: 'well', id: h.identities.bob.id, profile_id: h.identities.bob.id, p_profile_id: h.identities.bob.id, p_context_id: BOB_HOME });
  assert.equal(res.status, 200);
  assert.ok(h.db.rpcCalls.every((call) => call.args.p_profile_id === h.identities.alice.id && call.args.p_context_id === ALICE_HOME));
  assert.equal(bobState(h), bobBefore);
});
