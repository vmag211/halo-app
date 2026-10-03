import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope, loggedText, UUID } from './helpers/envelope.mjs';

const ALL = ['profiles', 'household_bands'];
const PROFILE = {
  alice: { lat: 35.40881, lng: -80.57952, county: 'Cabarrus County', state: 'NC', zip: '28025', pwsid: 'NC9990001', water_source: 'utility', home_year: 1988, renter_mode: false, locale: 'en', onboard_request_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  bob: { lat: 35.22712, lng: -80.84313, county: 'Mecklenburg County', state: 'NC', zip: '28202', pwsid: 'NC9990002', water_source: 'well', home_year: 1962, renter_mode: true, locale: 'es', onboard_request_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
};

// A table that is not in `tables` is not seeded either, so it answers like an unapplied migration (PGRST205).
function harness({ tables = haloTables(...ALL), seed = (ids) => ({
  profiles: [{ id: ids.alice.id, ...PROFILE.alice }, { id: ids.bob.id, ...PROFILE.bob }],
  household_bands: [{ profile_id: ids.alice.id, has_pregnant: true, has_senior: true }, { profile_id: ids.bob.id, has_toddler: true }],
}) } = {}) {
  return createRouteHarness({ tables, seed: (ids) => Object.fromEntries(Object.entries(seed(ids)).filter(([table]) => table in tables)) });
}
const get = (h, route, as = 'alice', headers) => h.call(`/api/${route}`, 'GET', { as, headers });
const without = (...names) => haloTables(...ALL.filter((name) => !names.includes(name)));
const breakReads = (h, table) => { // every read of `table` throws, like a database that fell over mid request
  const from = h.db.from.bind(h.db);
  h.db.from = (name) => { if (name === table) throw new Error('secret database detail'); return from(name); };
};

// ---------------------------------------------------------------- profile

test('profile legacy request: every old field is there, plus a request id header', async () => {
  const res = await get(harness(), 'profile');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['household', 'household_set', 'onboarded', 'onboarding_complete', 'profile']);
  assert.deepEqual(Object.keys(body.profile).sort(), ['county', 'home_year', 'lat', 'lng', 'locale', 'onboard_request_id', 'pwsid', 'renter_mode', 'state', 'water_source', 'zip']);
  assert.deepEqual([body.onboarded, body.onboarding_complete, body.household_set], [true, true, true]);
  assert.deepEqual([body.profile.county, body.profile.zip, body.profile.home_year, body.profile.water_source], ['Cabarrus County', '28025', 1988, 'utility']);
  assert.deepEqual([body.household.has_pregnant, body.household.has_senior, body.household.has_toddler], [true, true, false]);
  assert.equal('request_id' in body, false, 'success bodies do not carry request_id');
  assert.equal('unavailable' in body, false);
});

test('profile: a household with no profile row or no composition row is a true empty, not an unavailable answer', async () => {
  const none = await (await get(harness({ seed: () => ({ profiles: [], household_bands: [] }) }), 'profile')).json();
  assert.deepEqual([none.onboarded, none.onboarding_complete, none.profile, none.household_set], [false, false, null, false]);
  assert.equal('unavailable' in none, false);
});

test('profile: a composition read that fails keeps its documented general-population answer and now says it is unavailable', async (t) => {
  const logged = muteConsoleError(t);
  const res = await get(harness({ tables: without('household_bands') }), 'profile');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual([body.household_set, body.household.has_pregnant, body.unavailable, body.reason], [false, false, true, 'household_unavailable']);
  assert.equal(body.profile.county, 'Cabarrus County', 'the profile itself is still answered');
  assert.ok(loggedText(logged).includes(res.headers.get('x-request-id')));
});

test('profile: a failed profile read is a 500 envelope with no database text, never a 200 with an empty profile', async (t) => {
  const logged = muteConsoleError(t);
  const res = await get(harness({ tables: without('profiles') }), 'profile');
  const body = await expectEnvelope(res, { status: 500, code: 'internal_error', retryable: true });
  assert.equal(body.error, 'Something went wrong on our side. Please try again.');
  assert.doesNotMatch(JSON.stringify(body), /schema cache|profiles|PGRST|Could not read/);
  assert.ok(loggedText(logged).includes(body.request_id));
  assert.ok(loggedText(logged).includes('Could not read profile'));
});

test('profile: both reads are the caller\'s own, whatever ids the request names', async () => {
  const h = harness();
  const [alice, bob] = await Promise.all([get(h, 'profile', 'alice').then((r) => r.json()), get(h, 'profile', 'bob').then((r) => r.json())]);
  assert.deepEqual([alice.profile.county, bob.profile.county], ['Cabarrus County', 'Mecklenburg County']);
  assert.deepEqual([alice.household.has_toddler, bob.household.has_toddler], [false, true]);
  for (const q of h.db.queryLog) {
    const column = q.table === 'profiles' ? 'id' : 'profile_id';
    const caller = q.filters.find((f) => f.op === 'eq' && f.column === column);
    assert.ok(caller, `${q.table} read is filtered by ${column}`);
  }
  const other = await h.call('/api/profile', 'GET', { as: 'alice', url: `/api/profile?id=${h.identities.bob.id}&profile_id=${h.identities.bob.id}` });
  assert.equal((await other.json()).profile.county, 'Cabarrus County');
});

test('profile: a missing session is a 401 envelope that echoes a client request id; an unexpected failure is a 500 envelope', async (t) => {
  const h = harness();
  const none = await expectEnvelope(await h.call('/api/profile', 'GET', {}), { status: 401, code: 'auth_required' });
  assert.equal(none.error, 'Sign-in required.');
  await expectEnvelope(await h.call('/api/profile', 'GET', { headers: { 'x-request-id': 'client-trace-0001' } }), { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });
  assert.equal((await get(h, 'profile', 'alice', { 'x-request-id': 'client-trace-0001' })).headers.get('x-request-id'), 'client-trace-0001');
  const logged = muteConsoleError(t);
  breakReads(h, 'household_bands');
  const body = await expectEnvelope(await get(h, 'profile'), { status: 500, code: 'internal_error' });
  assert.doesNotMatch(JSON.stringify(body), /secret database detail/);
  assert.ok(loggedText(logged).includes(body.request_id));
});

// -------------------------------------------------------------- household

test('household legacy request: the seven groups, household_set, renter_mode and locale, plus a request id header', async () => {
  const res = await get(harness(), 'household');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['household', 'household_set', 'locale', 'renter_mode']);
  assert.deepEqual(Object.keys(body.household).sort(), ['has_adult', 'has_child', 'has_pregnant', 'has_respiratory', 'has_senior', 'has_teen', 'has_toddler']);
  assert.deepEqual([body.household.has_pregnant, body.household.has_toddler, body.household_set, body.renter_mode, body.locale], [true, false, true, false, 'en']);
  const bob = await (await get(harness(), 'household', 'bob')).json();
  assert.deepEqual([bob.household.has_toddler, bob.household.has_pregnant, bob.renter_mode, bob.locale], [true, false, true, 'es']);
});

test('household: a household with no rows gets the defaults, with no unavailable marker', async () => {
  const body = await (await get(harness({ seed: () => ({ profiles: [], household_bands: [] }) }), 'household')).json();
  assert.deepEqual([body.household_set, body.renter_mode, body.locale, 'unavailable' in body], [false, false, 'en', false]);
});

test('household: reads that fail keep the default answer but say it is not the household\'s real one', async (t) => {
  const logged = muteConsoleError(t);
  const bands = await get(harness({ tables: without('household_bands') }), 'household');
  assert.equal(bands.status, 200);
  const bandsBody = await bands.json();
  assert.deepEqual([bandsBody.household_set, bandsBody.household.has_pregnant, bandsBody.unavailable, bandsBody.reason], [false, false, true, 'household_unavailable']);
  assert.equal(bandsBody.locale, 'en', 'the preferences that could be read are still there');
  assert.ok(loggedText(logged).includes(bands.headers.get('x-request-id')));

  const prefs = await (await get(harness({ tables: without('profiles') }), 'household', 'bob')).json();
  assert.deepEqual([prefs.household.has_toddler, prefs.renter_mode, prefs.unavailable, prefs.reason], [true, false, true, 'preferences_unavailable']);

  const both = await (await get(harness({ tables: {} }), 'household')).json();
  assert.equal(both.reason, 'household_unavailable', 'the household is named first when both are down');
});

test('household keeps its owner filters and ignores ids in the request', async () => {
  const h = harness();
  const res = await h.call('/api/household', 'GET', { as: 'alice', url: `/api/household?profile_id=${h.identities.bob.id}&id=${h.identities.bob.id}&user_id=${h.identities.bob.id}` });
  assert.equal((await res.json()).household.has_toddler, false);
  const bands = h.db.queryLog.find((q) => q.table === 'household_bands');
  const profile = h.db.queryLog.find((q) => q.table === 'profiles');
  assert.ok(bands.filters.some((f) => f.op === 'eq' && f.column === 'profile_id' && f.value === h.identities.alice.id));
  assert.ok(profile.filters.some((f) => f.op === 'eq' && f.column === 'id' && f.value === h.identities.alice.id));
});

test('household: a missing session is a 401 envelope that echoes a client request id; an unexpected failure is a 500 envelope', async (t) => {
  const h = harness();
  await expectEnvelope(await h.call('/api/household', 'GET', {}), { status: 401, code: 'auth_required' });
  await expectEnvelope(await h.call('/api/household', 'GET', { headers: { 'x-request-id': 'client-trace-0001' } }), { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });
  assert.equal((await get(h, 'household', 'alice', { 'x-request-id': 'client-trace-0001' })).headers.get('x-request-id'), 'client-trace-0001');
  const logged = muteConsoleError(t);
  breakReads(h, 'household_bands');
  const body = await expectEnvelope(await get(h, 'household'), { status: 500, code: 'internal_error' });
  assert.equal(body.error, 'Something went wrong on our side. Please try again.');
  assert.doesNotMatch(JSON.stringify(body), /secret database detail/);
  assert.ok(loggedText(logged).includes(body.request_id));
});
