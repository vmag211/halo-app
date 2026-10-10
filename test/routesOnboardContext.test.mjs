/**
 * POST /api/onboard through transition_home_context (migration 0016), on the fake RPCs that
 * mirror the SQL (test/helpers/fakeHomeContext.mjs, held to the real functions by
 * homeContextFake.test.mjs): first home, the same home again, an idempotent retry, a move, the
 * utility lookup's outcome, a missing profile row, failures, the fallback before 0016, and the
 * backfill after the response with its progress on the home. The route before 0016 alone is
 * routesOnboardWrite.test.mjs; on the real database, homeContextRoutesDb.test.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError, rpcError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { fullContextRow, registerHomeContextRpcs, TRANSITION_HOME_CONTEXT_ARGS } from './helpers/fakeHomeContext.mjs';
import { dailyScoreLimiter } from './helpers/stubs/ratelimit.mjs';
import { expectEnvelope, loggedText } from './helpers/envelope.mjs';
import { addDays, localDate } from './helpers/isolationSeed.mjs';

const { contextSummary } = await import('../lib/homeContext.js');

const TODAY = localDate();
const day = (n) => addDays(TODAY, -n);
const R1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const R2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OLD_HOME = 'a11ce000-2222-4000-8000-000000000001';
const BOB_HOME = 'b0b00000-2222-4000-8000-000000000001';
const UTILITY = 'NC0250010';

// Two addresses Mapbox knows; '2 Elm Court' is the new home in most tests.
const PLACES = {
  '2 Elm Court': { center: [-80.61, 35.41], context: [{ id: 'postcode.1', text: '28027' }, { id: 'district.1', text: 'Cabarrus County' }, { id: 'region.1', text: 'North Carolina', short_code: 'US-NC' }] },
  '7 Old Road': { center: [-80.5, 35.5], context: [{ id: 'district.1', text: 'Old County' }, { id: 'region.1', text: 'North Carolina', short_code: 'US-NC' }] },
};
const ALICE_OLD = { lat: 35.5, lng: -80.5, county: 'Old County', state: 'NC', pwsid: 'NC9990001', water_source: 'utility', home_year: 1975 };
const BOB_PROFILE = { lat: 35.227, lng: -80.843, county: 'Mecklenburg County', state: 'NC', pwsid: 'NC9990002', water_source: 'well', home_year: 1962 };

/** Open-Meteo's history for the 28 past days and today. */
function openMeteo(url) {
  const dates = Array.from({ length: 29 }, (_, n) => addDays(TODAY, n - 28));
  if (url.startsWith('https://air-quality-api.open-meteo.com/')) {
    return Response.json({ hourly: { time: dates.map((d) => `${d}T12:00`), us_aqi: dates.map(() => 40) } });
  }
  return Response.json({ daily: { time: dates, uv_index_max: dates.map(() => 5), relative_humidity_2m_mean: dates.map(() => 50), precipitation_probability_max: dates.map(() => 10) } });
}

/**
 * Alice and bob. `alice`: 'new' (a profile row with no location, no home), 'located' (at 7 Old Road
 * with her home OLD_HOME and readings for today, yesterday and an unlinked one the day before),
 * 'none' (no profile row at all). `functions`: register the fake RPCs (default) or not (before 0016).
 * `h.utility` decides the ArcGIS answer per request: 'measured', 'outside' or 'failed'.
 */
function harness({ alice = 'new', functions = true, tables = ['profiles', 'daily_scores', 'home_contexts'], historyDown = false } = {}) {
  const outbound = [];
  const h = createRouteHarness({
    tables: haloTables(...tables),
    env: { MAPBOX_TOKEN: 'pk.test-token' },
    seed: ({ alice: a, bob }) => {
      const profiles = [{ id: bob.id, ...BOB_PROFILE, onboard_request_id: null }];
      if (alice === 'new') profiles.push({ id: a.id });
      if (alice === 'located') profiles.push({ id: a.id, ...ALICE_OLD, onboard_request_id: null });
      const homes = [fullContextRow({ id: BOB_HOME, profile_id: bob.id, sequence: 1, revision: 1, origin: 'onboard', ...BOB_PROFILE, service_area_status: 'measured', backfill_state: 'complete', effective_from: `${day(40)}T12:00:00Z` })];
      if (alice === 'located') {
        homes.push(fullContextRow({ id: OLD_HOME, profile_id: a.id, sequence: 1, revision: 1, origin: 'onboard', ...ALICE_OLD, service_area_status: 'measured', match_method: 'mapbox_geocode_arcgis_point', backfill_state: 'complete', effective_from: `${day(40)}T12:00:00Z` }));
      }
      const readings = [{ profile_id: bob.id, date: TODAY, aqi: 150, home_context_id: BOB_HOME }];
      if (alice === 'located') {
        readings.push(
          { profile_id: a.id, date: TODAY, aqi: 41, home_context_id: OLD_HOME },
          { profile_id: a.id, date: day(1), aqi: 42, home_context_id: OLD_HOME },
          { profile_id: a.id, date: day(2), aqi: 43, home_context_id: null },
        );
      }
      const seed = { profiles, daily_scores: readings };
      if (tables.includes('home_contexts')) seed.home_contexts = homes;
      return seed;
    },
    fetch: async (url) => {
      const target = String(url);
      outbound.push(target);
      if (target.startsWith('https://api.mapbox.com/')) {
        const address = decodeURIComponent(target.split('/mapbox.places/')[1].split('.json')[0]);
        return Response.json({ features: PLACES[address] ? [PLACES[address]] : [] });
      }
      if (target.startsWith('https://services.arcgis.com/')) {
        if (h.utility === 'failed') return new Response('down', { status: 503 });
        return Response.json({ features: h.utility === 'outside' ? [] : [{ attributes: { PWSID: UTILITY } }] });
      }
      if (target.includes('open-meteo.com/')) return historyDown ? new Response('{}', { status: 500 }) : openMeteo(target);
      return new Response('{}', { status: 503 });
    },
  });
  if (functions) registerHomeContextRpcs(h.db);
  return Object.assign(h, { outbound, utility: 'measured' });
}

const post = (h, body, options = {}) => h.call('/api/onboard', 'POST', { as: 'alice', body, ...options });
const ok = async (res) => { assert.equal(res.status, 200); return res.json(); };
const homesOf = (h, who) => h.db.rows('home_contexts').filter((row) => row.profile_id === h.identities[who].id).sort((a, b) => a.sequence - b.sequence);
const profileOf = (h, who) => h.db.rows('profiles').find((row) => row.id === h.identities[who].id);
const readingsOf = (h, who) => h.db.rows('daily_scores').filter((row) => row.profile_id === h.identities[who].id);
const bobState = (h) => JSON.stringify({ homes: homesOf(h, 'bob'), profile: profileOf(h, 'bob'), readings: readingsOf(h, 'bob') });
const transitions = (h) => h.db.rpcCalls.filter((call) => call.name === 'transition_home_context');
const writes = (h, from = 0) => h.db.queryLog.slice(from).filter((q) => q.operation !== 'select');
const resets = (t) => t.mock.method(dailyScoreLimiter, 'resetUsedTokens', async () => {});
const LEGACY_KEYS = ['county', 'home_year', 'lat', 'lng', 'onboard_request_id', 'profile_id', 'pwsid', 'service_area_status', 'state', 'water_source', 'zip'];

// ------------------------------------------------------------- first home

test('first home: transition_home_context makes sequence 1 (origin onboard); the answer keeps every old field and adds home_context and moved false', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const reset = resets(t);
  const h = harness();
  const bobBefore = bobState(h);
  const body = await ok(await post(h, { address: '2 Elm Court', request_id: R1, water_source: 'Well', home_year: 1990, profile_id: h.identities.alice.id }));

  assert.deepEqual(Object.keys(body).sort(), [...LEGACY_KEYS, 'home_context', 'moved'].sort());
  const [home] = homesOf(h, 'alice');
  assert.deepEqual(body, {
    profile_id: h.identities.alice.id, lat: 35.41, lng: -80.61, zip: '28027', county: 'Cabarrus County', state: 'NC', pwsid: UTILITY,
    service_area_status: 'measured', water_source: 'well', home_year: 1990, onboard_request_id: R1,
    home_context: contextSummary(home), moved: false,
  });
  assert.deepEqual(
    [home.sequence, home.revision, home.origin, home.effective_to, home.lat, home.lng, home.county, home.state, home.pwsid, home.service_area_status, home.water_source, home.home_year, home.match_method, home.onboard_request_id],
    [1, 1, 'onboard', null, 35.41, -80.61, 'Cabarrus County', 'NC', UTILITY, 'measured', 'well', 1990, 'mapbox_geocode_arcgis_point', R1],
  );
  assert.equal(body.home_context.current, true);
  assert.equal('profile_id' in body.home_context || 'onboard_request_id' in body.home_context, false);

  // One call, with the token's id and exactly the arguments 0016 takes.
  assert.deepEqual(transitions(h).map((call) => call.args), [{
    p_profile_id: h.identities.alice.id,
    p_location: { lat: 35.41, lng: -80.61, county: 'Cabarrus County', state: 'NC' },
    p_attributes: { pwsid: UTILITY, service_area_status: 'measured', water_source: 'well', home_year: 1990, match_method: 'mapbox_geocode_arcgis_point' },
    p_request_id: R1,
  }]);
  assert.deepEqual(Object.keys(transitions(h)[0].args).sort(), [...TRANSITION_HOME_CONTEXT_ARGS].sort());

  // The profile follows the home, written by the function only (no second write by the route).
  const profile = profileOf(h, 'alice');
  assert.deepEqual(
    [profile.lat, profile.lng, profile.county, profile.state, profile.pwsid, profile.water_source, profile.home_year, profile.onboard_request_id, profile.zip],
    [35.41, -80.61, 'Cabarrus County', 'NC', UTILITY, 'well', 1990, R1, null],
  );
  assert.deepEqual(writes(h).filter((q) => q.table === 'profiles').map((q) => q.operation), ['update'], 'the function\'s profile update, no route upsert');
  assert.equal(writes(h).filter((q) => q.table === 'daily_scores').length, 0);
  assert.equal(reset.mock.callCount(), 0);
  assert.equal(warn.mock.callCount(), 0, 'no fallback warning when 0016 is there');
  assert.equal(bobState(h), bobBefore);
});

test('the same home again: updated in place (revision 2, same id and sequence), answers left out are kept, moved false, nothing deleted', async (t) => {
  const reset = resets(t);
  const h = harness();
  const first = await ok(await post(h, { address: '2 Elm Court', request_id: R1, water_source: 'well', home_year: 1990 }));
  h.db.seed('daily_scores', [{ profile_id: h.identities.alice.id, date: TODAY, aqi: 44, home_context_id: first.home_context.id }]);
  const readingsBefore = readingsOf(h, 'alice');

  const again = await ok(await post(h, { address: '2 Elm Court', request_id: R2 }));
  assert.equal(again.moved, false);
  assert.deepEqual(
    [again.home_context.id, again.home_context.sequence, again.home_context.revision, again.home_context.origin],
    [first.home_context.id, 1, 2, 'onboard'],
  );
  assert.deepEqual([again.water_source, again.home_year], [null, null], 'the answer echoes the request, as before');
  assert.deepEqual([again.home_context.water_source, again.home_context.home_year], ['well', 1990], 'the home keeps the answers already given');
  assert.equal(homesOf(h, 'alice').length, 1);
  assert.deepEqual(readingsOf(h, 'alice'), readingsBefore, 'today\'s reading for this home is kept');
  assert.equal(profileOf(h, 'alice').onboard_request_id, R2);
  assert.equal(reset.mock.callCount(), 0);
});

test('a retry of the same request id answers the saved home as it is and writes nothing again', async () => {
  const h = harness();
  const request = { address: '2 Elm Court', request_id: R1, water_source: 'well' };
  const first = await ok(await post(h, request));
  const rows = JSON.stringify({ homes: h.db.rows('home_contexts'), profiles: h.db.rows('profiles'), readings: h.db.rows('daily_scores') });
  const from = h.db.queryLog.length;

  const retry = await ok(await post(h, { ...request, request_id: R1.toUpperCase() }));
  assert.deepEqual(retry, first, 'the same answer, revision 1 still');
  assert.deepEqual(writes(h, from), [], 'only reads');
  assert.equal(JSON.stringify({ homes: h.db.rows('home_contexts'), profiles: h.db.rows('profiles'), readings: h.db.rows('daily_scores') }), rows);
  assert.equal(transitions(h).at(-1).args.p_request_id, R1, 'stored lower case');
});

// ------------------------------------------------------------------- move

test('a move closes the old home and opens the next: moved true, the old home\'s reading for today is gone, its earlier days are kept and linked to it', async (t) => {
  const reset = resets(t);
  const h = harness({ alice: 'located' });
  const bobBefore = bobState(h);
  const body = await ok(await post(h, { address: '2 Elm Court', request_id: R1 }));

  assert.equal(body.moved, true);
  const [old, current] = homesOf(h, 'alice');
  assert.equal(old.id, OLD_HOME);
  assert.deepEqual([old.closed_reason, typeof old.effective_to, old.lat, old.pwsid, old.water_source], ['moved', 'string', 35.5, 'NC9990001', 'utility'], 'the old home keeps its own details');
  assert.deepEqual([current.sequence, current.origin, current.effective_to, current.effective_from], [2, 'move', null, old.effective_to]);
  assert.deepEqual(body.home_context, contextSummary(current));
  assert.deepEqual([body.lat, body.lng, body.county, body.pwsid, body.service_area_status], [35.41, -80.61, 'Cabarrus County', UTILITY, 'measured']);

  // Nothing of the old home is carried over: the answers are unknown at the new one until given.
  assert.deepEqual([current.water_source, current.home_year], [null, null]);
  assert.deepEqual([profileOf(h, 'alice').water_source, profileOf(h, 'alice').home_year, profileOf(h, 'alice').lat], [null, null, 35.41]);

  const readings = readingsOf(h, 'alice').map((row) => [row.date, row.home_context_id]).sort();
  assert.deepEqual(readings, [[day(2), OLD_HOME], [day(1), OLD_HOME]].sort(), 'today\'s old reading gone, the earlier days kept with the old home');
  assert.deepEqual(reset.mock.calls.map((call) => call.arguments), [[`daily-score:${h.identities.alice.id}`]]);
  assert.equal(bobState(h), bobBefore, 'bob\'s home, profile and reading are untouched');
  assert.equal(writes(h).filter((q) => q.table === 'daily_scores' && q.operation === 'delete' && !JSON.stringify(q.filters).includes('home_context_id')).length, 0, 'the route deletes nothing itself: only the function, for the closed home');
});

test('moving back to an earlier address is a new home, never the old one reopened', async (t) => {
  resets(t);
  const h = harness({ alice: 'located' });
  await ok(await post(h, { address: '2 Elm Court', request_id: R1 }));
  const back = await ok(await post(h, { address: '7 Old Road', request_id: R2 }));
  assert.equal(back.moved, true);
  assert.deepEqual(homesOf(h, 'alice').map((home) => [home.sequence, home.origin, home.effective_to === null]), [[1, 'onboard', false], [2, 'move', false], [3, 'move', true]]);
});

// ---------------------------------------------------------- utility lookup

test('the utility lookup\'s outcome is the home\'s service_area_status: measured, outside a known area, failed', async () => {
  const outside = harness();
  outside.utility = 'outside';
  const away = await ok(await post(outside, { address: '2 Elm Court' }));
  assert.deepEqual([away.pwsid, away.service_area_status, away.home_context.pwsid, away.home_context.service_area_status], [null, 'outside_known_area', null, 'outside_known_area']);

  const failed = harness();
  failed.utility = 'failed';
  const first = await ok(await post(failed, { address: '2 Elm Court' }));
  assert.deepEqual([first.pwsid, first.service_area_status, first.home_context.pwsid, first.home_context.service_area_status], [null, 'lookup_failed', null, 'lookup_failed']);
  assert.deepEqual(transitions(failed)[0].args.p_attributes, { service_area_status: 'lookup_failed', match_method: 'mapbox_geocode_arcgis_point' }, 'no utility is sent for a failed lookup');
});

test('a failed lookup at the same home keeps the utility on file and reports it; at a new home the old home\'s utility is not reported', async (t) => {
  resets(t);
  const same = harness({ alice: 'located' });
  same.utility = 'failed';
  const kept = await ok(await same.call('/api/onboard', 'POST', { as: 'alice', body: { address: '7 Old Road' } }));
  assert.equal(kept.moved, false);
  assert.deepEqual([kept.pwsid, kept.service_area_status], ['NC9990001', 'lookup_failed']);
  assert.deepEqual([kept.home_context.pwsid, kept.home_context.service_area_status], ['NC9990001', 'measured'], 'a failure never replaces what is on file');
  assert.equal(profileOf(same, 'alice').pwsid, 'NC9990001');

  const moved = harness({ alice: 'located' });
  moved.utility = 'failed';
  const fresh = await ok(await post(moved, { address: '2 Elm Court' }));
  assert.equal(fresh.moved, true);
  assert.deepEqual([fresh.pwsid, fresh.home_context.pwsid, fresh.home_context.service_area_status], [null, null, 'lookup_failed']);
  assert.equal(profileOf(moved, 'alice').pwsid, null);
  assert.equal(homesOf(moved, 'alice')[0].pwsid, 'NC9990001', 'the old home keeps its utility');
});

// ------------------------------------------------------- profile row, failures

test('a household with no profile row gets the bare row the auth trigger would make, then its home', async () => {
  const h = harness({ alice: 'none' });
  const body = await ok(await post(h, { address: '2 Elm Court', request_id: R1 }));
  assert.equal(body.home_context.sequence, 1);
  const upserts = h.db.queryLog.filter((q) => q.table === 'profiles' && q.operation === 'upsert');
  assert.deepEqual(upserts.map((q) => q.rows), [[{ id: h.identities.alice.id }]]);
  assert.equal(transitions(h).length, 2, 'refused once (no profile), then saved');
  assert.deepEqual([profileOf(h, 'alice').lat, profileOf(h, 'alice').onboard_request_id], [35.41, R1]);
});

for (const [label, failure] of [
  ['a refusal (HALO_INVALID_INPUT)', () => { throw rpcError('P0001', 'HALO_INVALID_INPUT', 'p_location.lat must be a number'); }],
  ['a database error', () => { throw rpcError('XX000', 'secret database detail'); }],
  ['an answer without a home', () => ({ moved: false })],
  ['a connection failure', () => { throw new Error('fetch failed'); }],
]) {
  test(`${label} from the function is a 500 with nothing saved by the route, no backfill and no fallback`, async (t) => {
    const logged = muteConsoleError(t);
    const warn = t.mock.method(console, 'warn', () => {});
    const h = harness({ functions: false });
    h.db.registerRpc('transition_home_context', failure, { args: [...TRANSITION_HOME_CONTEXT_ARGS] });
    const before = JSON.stringify({ profiles: h.db.rows('profiles'), readings: h.db.rows('daily_scores'), homes: h.db.rows('home_contexts') });
    const body = await expectEnvelope(await post(h, { address: '2 Elm Court' }), { status: 500, code: 'internal_error' });
    assert.doesNotMatch(JSON.stringify(body), /secret|HALO_|fetch failed/);
    assert.ok(loggedText(logged).includes(body.request_id));
    assert.equal(JSON.stringify({ profiles: h.db.rows('profiles'), readings: h.db.rows('daily_scores'), homes: h.db.rows('home_contexts') }), before);
    assert.deepEqual(writes(h), []);
    await h.runAfter();
    assert.deepEqual(writes(h), [], 'no backfill was queued');
    assert.equal(warn.mock.callCount(), 0);
  });
}

// ----------------------------------------------------- before 0016 (fallback)

/** The statements the route has always run for a move with a failed lookup, in order. */
function legacyStatements(h, profileUpdate) {
  const alice = h.identities.alice.id;
  const eq = (column, value) => ({ type: 'cmp', column, op: 'eq', value });
  return [
    { table: 'profiles', operation: 'select', filters: [eq('id', alice)], rows: [], values: null },
    { table: 'profiles', operation: 'upsert', filters: [], rows: [profileUpdate], values: null },
    { table: 'profiles', operation: 'select', filters: [eq('id', alice)], rows: [], values: null },
    { table: 'daily_scores', operation: 'delete', filters: [eq('profile_id', alice), eq('date', TODAY)], rows: [], values: null },
  ];
}

for (const [code, setup] of [
  ['PGRST202', (h) => h],
  ['42883', (h) => h.db.registerRpc('transition_home_context', () => { throw rpcError('42883', 'function public.transition_home_context(uuid, jsonb, jsonb, uuid) does not exist'); })],
  ['PGRST205', (h) => h.db.registerRpc('transition_home_context', () => { throw rpcError('PGRST205', "Could not find the table 'public.home_contexts' in the schema cache"); })],
  ['42P01', (h) => h.db.registerRpc('transition_home_context', () => { throw rpcError('42P01', 'relation "public.home_contexts" does not exist'); })],
]) {
  test(`before 0016 (${code}): the legacy save statement for statement, home_context null, moved from the old check, one warning per process`, async (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const reset = resets(t);
    const h = harness({ alice: 'located', functions: false, tables: ['profiles', 'daily_scores'] });
    setup(h);
    h.utility = 'failed';
    const body = await ok(await post(h, { address: '2 Elm Court', request_id: R1, home_year: 2001 }));
    assert.deepEqual(body, {
      profile_id: h.identities.alice.id, lat: 35.41, lng: -80.61, zip: '28027', county: 'Cabarrus County', state: 'NC', pwsid: 'NC9990001',
      service_area_status: 'lookup_failed', water_source: null, home_year: 2001, onboard_request_id: R1,
      home_context: null, moved: true,
    });
    const profileUpdate = { id: h.identities.alice.id, lat: 35.41, lng: -80.61, county: 'Cabarrus County', zip: null, state: 'NC', home_year: 2001, onboard_request_id: R1 };
    assert.deepEqual(h.db.queryLog, legacyStatements(h, profileUpdate));
    assert.deepEqual(readingsOf(h, 'alice').map((row) => row.date).sort(), [day(2), day(1)].sort(), 'today\'s reading cleared, as before');
    assert.equal(profileOf(h, 'alice').water_source, 'utility', 'the legacy save keeps answers the request left out');
    assert.equal(reset.mock.callCount(), 1);

    // The backfill after the response is the old one: no home, no link, no progress.
    const from = h.db.queryLog.length;
    await h.runAfter();
    const after = h.db.queryLog.slice(from);
    assert.ok(after.some((q) => q.table === 'daily_scores' && q.operation === 'insert'));
    assert.ok(after.every((q) => q.table === 'daily_scores' && !JSON.stringify(q).includes('home_context')));

    const again = await ok(await post(h, { address: '2 Elm Court' }));
    assert.equal(again.moved, false);
    assert.equal(again.home_context, null);
    assert.equal(warn.mock.callCount(), 1, 'one warning, not one per request');
    assert.match(String(warn.mock.calls[0].arguments[0]), new RegExp(`home contexts are not available \\(${code}\\)`));
  });
}

test('the answer through the function is the legacy answer plus the two new fields', async (t) => {
  resets(t);
  t.mock.method(console, 'warn', () => {});
  const request = { address: '2 Elm Court', request_id: R1, water_source: 'utility', home_year: 1999 };
  const through = await ok(await post(harness({ alice: 'located' }), request));
  const legacy = await ok(await post(harness({ alice: 'located', functions: false }), request));
  const strip = (body) => {
    const copy = { ...body };
    delete copy.home_context;
    return copy;
  };
  assert.deepEqual(strip(through), strip(legacy));
  assert.equal(through.moved, true);
  assert.equal(legacy.home_context, null);
  assert.notEqual(through.home_context, null);
});

// --------------------------------------------------- the backfill afterwards

const contextWrites = (h, from = 0) => h.db.queryLog.slice(from).filter((q) => q.table === 'home_contexts' && q.operation === 'update' && 'backfill_state' in (q.values ?? {}));

test('after the response, the backfill fills the saved home\'s history and records running, then complete, with its dates', async () => {
  const h = harness();
  const body = await ok(await post(h, { address: '2 Elm Court', request_id: R1 }));
  assert.equal(body.home_context.backfill.state, 'not_started', 'nothing has run before the answer');
  assert.equal(readingsOf(h, 'alice').length, 0);

  await h.runAfter();
  const from = day(28);
  const to = day(1);
  const states = contextWrites(h);
  assert.deepEqual(states.map((q) => [q.values.backfill_state, q.values.backfill_from, q.values.backfill_to]), [['running', from, to], ['complete', from, to]]);
  for (const q of states) assert.deepEqual(q.filters.map((f) => [f.column, f.value]), [['profile_id', h.identities.alice.id], ['id', body.home_context.id]]);
  const [home] = homesOf(h, 'alice');
  assert.deepEqual([home.backfill_state, home.backfill_from, home.backfill_to, typeof home.backfill_updated_at], ['complete', from, to, 'string']);
  const rows = readingsOf(h, 'alice');
  assert.equal(rows.length, 28);
  assert.ok(rows.every((row) => row.home_context_id === body.home_context.id));
});

test('after a move, the new home gets its own history; the old home\'s days stay with it, untouched', async (t) => {
  resets(t);
  const h = harness({ alice: 'located' });
  const body = await ok(await post(h, { address: '2 Elm Court', request_id: R1 }));
  const oldRows = readingsOf(h, 'alice');
  await h.runAfter();
  const mine = readingsOf(h, 'alice').filter((row) => row.home_context_id === body.home_context.id);
  assert.equal(mine.length, 28, 'every day, including the ones the old home has readings for');
  for (const row of oldRows) assert.deepEqual(readingsOf(h, 'alice').find((r) => r.id === row.id), row);
  assert.equal(homesOf(h, 'alice')[0].backfill_state, 'complete', 'the old home\'s record is its own');
  assert.equal(homesOf(h, 'alice')[1].backfill_state, 'complete');
});

test('a failed backfill is recorded as failed and never reaches onboarding', async (t) => {
  const logged = muteConsoleError(t);
  // The history provider is down for the whole request and afterwards.
  const h = harness({ historyDown: true });
  const res = await post(h, { address: '2 Elm Court', request_id: R1 });
  assert.equal(res.status, 200, 'answered before the backfill runs');
  const body = await res.json();
  assert.equal(body.home_context.backfill.state, 'not_started');
  assert.equal(h.outbound.filter((url) => url.includes('open-meteo.com/')).length, 0, 'the backfill did not run in the request');
  await h.runAfter();
  assert.deepEqual(contextWrites(h).map((q) => q.values.backfill_state), ['running', 'failed']);
  assert.equal(homesOf(h, 'alice')[0].backfill_state, 'failed');
  assert.equal(readingsOf(h, 'alice').length, 0);
  assert.ok(loggedText(logged).includes('Backfill failed'));
  assert.equal(body.home_context.id, homesOf(h, 'alice')[0].id);
});

test('a backfill state that cannot be saved breaks neither the after callback nor the readings', async (t) => {
  const logged = muteConsoleError(t);
  const h = harness();
  await ok(await post(h, { address: '2 Elm Court', request_id: R1 }));
  const from = h.db.from;
  h.db.from = (name) => {
    if (name === 'home_contexts') throw new Error('connection reset');
    return from(name);
  };
  await h.runAfter();
  h.db.from = from;
  assert.equal(readingsOf(h, 'alice').length, 28);
  assert.equal(homesOf(h, 'alice')[0].backfill_state, 'not_started');
  assert.match(loggedText(logged), /Backfill state "running" not saved/);
});

test('a home context column the backfill needs is missing: one warning, and the readings are saved without it', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const h = harness();
  await ok(await post(h, { address: '2 Elm Court', request_id: R1 }));
  const from = h.db.from;
  h.db.from = (name) => {
    const builder = from(name);
    if (name !== 'home_contexts') return builder;
    // Only the backfill's own columns are missing; the function's writes go through.
    const update = builder.update.bind(builder);
    builder.update = (values) => ('backfill_state' in values
      ? { eq: () => ({ eq: () => Promise.resolve({ data: null, error: { code: 'PGRST204', message: "Could not find the 'backfill_from' column of 'home_contexts' in the schema cache" } }) }) }
      : update(values));
    return builder;
  };
  await h.runAfter();
  await ok(await post(h, { address: '2 Elm Court', request_id: R2 }));
  await h.runAfter();
  h.db.from = from;
  assert.ok(readingsOf(h, 'alice').length >= 28);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0].arguments[0]), /a home context column is missing \(PGRST204/);
});
