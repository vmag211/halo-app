import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope, loggedText, UUID } from './helpers/envelope.mjs';
import { localDate } from './helpers/isolationSeed.mjs';

const { LEARN_CONTENT, LEARN_TOPICS } = await import('../lib/learnContent.js');

const ORGS = [
  { name: 'Cabarrus Water Watch', counties: ['Cabarrus County'], causes: ['water', 'pfas'], url: 'https://orgs.example.test/cabarrus' },
  { name: 'Union Air Group', counties: ['Union County'], causes: ['air'], url: 'https://orgs.example.test/union' },
  { name: 'Statewide Advocates', counties: ['statewide'], causes: ['advocacy', 'water'], url: 'https://orgs.example.test/state' },
];
const DAY = localDate();
const reading = (profileId, extra = {}) => ({ profile_id: profileId, date: DAY, aqi: 41, aqi_source: 'airnow', uv_index: 3, mold_risk: 'low', created_at: '2026-09-30T10:00:00Z', ...extra });

// A table that is not in `tables` is not seeded either, so it answers like an unapplied migration (PGRST205).
function harness({ tables = haloTables('profiles', 'household_bands', 'learn_content', 'volunteer_orgs', 'daily_scores', 'ucmr5_utilities'), seed = () => ({}), fetch } = {}) {
  return createRouteHarness({
    tables,
    fetch,
    seed: (ids) => {
      const base = {
        profiles: [{ id: ids.alice.id, county: 'Cabarrus County' }, { id: ids.bob.id, county: 'Union County' }],
        household_bands: [{ profile_id: ids.alice.id, has_pregnant: true }, { profile_id: ids.bob.id, has_toddler: true }],
        volunteer_orgs: ORGS,
        daily_scores: [reading(ids.alice.id), reading(ids.bob.id, { created_at: '2026-10-01T10:00:00Z' })],
        ucmr5_utilities: [{ pwsid: 'NC9990001', pws_name: 'W', status: 'Final', contaminants: {}, created_at: '2026-01-15T00:00:00Z' }],
        learn_content: [],
        ...seed(ids),
      };
      return Object.fromEntries(Object.entries(base).filter(([table]) => table in tables));
    },
  });
}
const withoutTables = (...names) => haloTables(...Object.keys(haloTables('profiles', 'household_bands', 'learn_content', 'volunteer_orgs', 'daily_scores', 'ucmr5_utilities')).filter((name) => !names.includes(name)));
const get = (h, route, query = '', as = 'alice', headers) => h.call(`/api/${route}`, 'GET', { as, url: `/api/${route}${query}`, headers });
const breakReads = (h, table) => { // every read of `table` throws, like a database that fell over mid request
  const from = h.db.from.bind(h.db);
  h.db.from = (name) => { if (name === table) throw new Error('secret database detail'); return from(name); };
};

// -------------------------------------------------------------- volunteer

test('volunteer legacy request: county and causes filter the directory, every old field is there, plus a request id header', async () => {
  const res = await get(harness(), 'volunteer', '?county=Cabarrus%20County&causes=water,pfas');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['causes', 'count', 'county', 'orgs']);
  assert.deepEqual([body.county, body.causes, body.count], ['Cabarrus County', ['water', 'pfas'], 2]);
  assert.deepEqual(body.orgs.map((org) => [org.name, org.match_count]), [['Cabarrus Water Watch', 2], ['Statewide Advocates', 1]]);
});

test('volunteer: no county means the household\'s own county, read for the caller only', async () => {
  const h = harness();
  const alice = await (await get(h, 'volunteer')).json();
  assert.deepEqual([alice.county, alice.orgs.map((org) => org.name)], ['Cabarrus County', ['Cabarrus Water Watch', 'Statewide Advocates']]);
  assert.equal((await (await get(h, 'volunteer', '', 'bob')).json()).county, 'Union County');
  const read = h.db.queryLog.filter((q) => q.table === 'profiles');
  assert.ok(read.every((q) => q.filters.some((f) => f.op === 'eq' && f.column === 'id')));
  assert.equal((await (await get(h, 'volunteer', '?county=')).json()).county, 'Cabarrus County', 'a blank county is "not given"');
  assert.equal((await (await get(h, 'volunteer', '?county=%20Union%20County%20')).json()).county, 'Union County', 'a county is trimmed');
});

test('volunteer: a true empty result is a plain 200 with no note and no unavailable marker', async () => {
  const body = await (await get(harness(), 'volunteer', '?county=Wake%20County&causes=radon')).json();
  assert.deepEqual(body, { county: 'Wake County', causes: ['radon'], count: 0, orgs: [] });
});

test('volunteer: a directory that cannot be read keeps its 200 and its note, and now says it is unavailable', async (t) => {
  const logged = muteConsoleError(t);
  const h = harness({ tables: withoutTables('volunteer_orgs') });
  const res = await get(h, 'volunteer', '?county=Cabarrus%20County&causes=water');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  assert.deepEqual(await res.json(), {
    county: 'Cabarrus County', causes: ['water'], count: 0, orgs: [],
    note: 'Volunteer directory not available yet.', unavailable: true, reason: 'directory_unavailable',
  });
  assert.ok(loggedText(logged).includes(res.headers.get('x-request-id')), 'the failure is logged with the request id');
});

const BAD_VOLUNTEER = [
  ['a county over 100 characters', `county=${'a'.repeat(101)}`, [['county', 'text_too_long']]],
  ['a county with a line break', 'county=Cabarrus%0ACounty', [['county', 'invalid_characters']]],
  ['a county with a null byte', 'county=Cabarrus%00', [['county', 'invalid_characters']]],
  ['a cause that is not a tag', 'causes=water,%3Cscript%3E', [['causes', 'invalid_cause']]],
  ['a cause with a space', 'causes=well%20water', [['causes', 'invalid_cause']]],
  ['13 causes', `causes=${Array.from({ length: 13 }, (_, i) => `c${i}`).join(',')}`, [['causes', 'too_many_causes']]],
  ['a very long causes list', `causes=${'water,'.repeat(200)}`, [['causes', 'text_too_long']]],
  ['both fields', `county=${'a'.repeat(101)}&causes=%3C`, [['county', 'text_too_long'], ['causes', 'invalid_cause']]],
];
for (const [label, query, expected] of BAD_VOLUNTEER) {
  test(`volunteer with ${label} is a 400 with field errors and reads nothing`, async () => {
    const h = harness();
    const body = await expectEnvelope(await get(h, 'volunteer', `?${query}`), { status: 400, code: 'validation_failed', retryable: false });
    assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), expected);
    assert.equal(body.error, body.field_errors[0].message);
    assert.equal(h.db.queryLog.length, 0);
  });
}

test('volunteer: a tag the directory has no organization for is fine (no match), and tags match in any case', async () => {
  const none = await (await get(harness(), 'volunteer', '?county=Cabarrus%20County&causes=lead')).json();
  assert.deepEqual([none.count, 'unavailable' in none], [0, false]);
  assert.equal((await (await get(harness(), 'volunteer', '?county=Cabarrus%20County&causes=PFAS')).json()).count, 1);
});

test('volunteer: a failed profile read is a 500 envelope, never a list for every county', async (t) => {
  const logged = muteConsoleError(t);
  const h = harness({ tables: withoutTables('profiles') });
  const body = await expectEnvelope(await get(h, 'volunteer'), { status: 500, code: 'internal_error', retryable: true });
  assert.doesNotMatch(JSON.stringify(body), /schema cache|profiles|PGRST/);
  assert.ok(loggedText(logged).includes(body.request_id));
  assert.equal((await get(h, 'volunteer', '?county=Cabarrus%20County')).status, 200, 'with a county given the profile is not needed');
});

test('volunteer: missing session is a 401 envelope that echoes a client request id; an unexpected failure is a 500 envelope', async (t) => {
  const h = harness();
  await expectEnvelope(await h.call('/api/volunteer', 'GET', {}), { status: 401, code: 'auth_required' });
  await expectEnvelope(await h.call('/api/volunteer', 'GET', { headers: { 'x-request-id': 'client-trace-0001' } }), { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });
  assert.equal((await get(h, 'volunteer', '?county=Union%20County', 'alice', { 'x-request-id': 'client-trace-0001' })).headers.get('x-request-id'), 'client-trace-0001');
  const logged = muteConsoleError(t);
  breakReads(h, 'volunteer_orgs');
  const body = await expectEnvelope(await get(h, 'volunteer', '?county=Union%20County'), { status: 500, code: 'internal_error' });
  assert.doesNotMatch(JSON.stringify(body), /secret database detail/);
  assert.ok(loggedText(logged).includes('secret database detail'));
});

// ------------------------------------------------------------------ learn

const LEARN_KEYS = ['household_note', 'locale', 'protect', 'sources', 'title', 'topic', 'what_it_is', 'why_yours'];

test('learn legacy request: the old fields are all there, composed from the code module, plus a request id header', async () => {
  const res = await get(harness(), 'learn', '?topic=pfas&locale=en&contaminant=PFOA&value=7&limit=4');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), LEARN_KEYS);
  assert.deepEqual([body.topic, body.locale, body.title], ['pfas', 'en', 'PFAS']);
  assert.equal(body.what_it_is, LEARN_CONTENT.pfas.what_it_is);
  assert.equal(body.household_note, LEARN_CONTENT.pfas.household.has_pregnant, 'alice is pregnant, bob has a toddler');
  assert.match(body.why_yours, /PFOA at 7 ppt/);
  assert.equal((await (await get(harness(), 'learn', '?topic=pfas', 'bob')).json()).household_note, LEARN_CONTENT.pfas.household.has_toddler);
});

test('learn: a topic in any case works, and reviewed database content wins over the code module', async () => {
  const h = harness({ seed: () => ({ learn_content: [{ topic: 'pfas', locale: 'es', what_it_is: 'Texto revisado', protect: ['Filtre el agua'], household: {}, sources: [] }] }) });
  const es = await (await get(h, 'learn', '?topic=PFAS&locale=ES')).json();
  assert.deepEqual([es.locale, es.what_it_is, es.protect, es.title, es.household_note], ['es', 'Texto revisado', ['Filtre el agua'], 'PFAS', null]);
  assert.equal('unavailable' in es, false);
  const noRow = await (await get(h, 'learn', '?topic=radon&locale=es')).json();
  assert.equal(noRow.locale, 'en', 'no Spanish row: the English code content, and the locale field says so');
  assert.equal('unavailable' in noRow, false, 'having no translation yet is not a failure');
});

const BAD_LEARN = [
  ['no topic', '', [['topic', 'invalid_option']]],
  ['an unknown topic', '?topic=bogus', [['topic', 'invalid_option']]],
  ['two topics', '?topic=pfas,radon', [['topic', 'invalid_option']]],
  ['an unknown locale', '?topic=uv&locale=fr', [['locale', 'invalid_option']]],
  ['a regional locale', '?topic=uv&locale=en-US', [['locale', 'invalid_option']]],
  ['a county over 100 characters', `?topic=radon&county=${'a'.repeat(101)}&zone=1`, [['county', 'text_too_long']]],
  ['a pollutant with a line break', '?topic=air&value=40&pollutant=PM2.5%0Ax', [['pollutant', 'invalid_characters']]],
  ['topic and locale together', '?topic=nope&locale=zz', [['topic', 'invalid_option'], ['locale', 'invalid_option']]],
];
for (const [label, query, expected] of BAD_LEARN) {
  test(`learn with ${label} is a 400 with field errors and reads nothing`, async () => {
    const h = harness();
    const body = await expectEnvelope(await get(h, 'learn', query), { status: 400, code: 'validation_failed', retryable: false });
    assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), expected);
    assert.equal(body.error, body.field_errors[0].message);
    assert.equal(h.db.queryLog.length, 0);
  });
}

test('learn: every topic has English content in the code module, so the "Content not available" 404 cannot be reached by a valid topic', () => {
  for (const topic of LEARN_TOPICS) assert.ok(LEARN_CONTENT[topic]?.what_it_is, topic);
});

test('learn: the unknown topic sentence is the legacy one', async () => {
  const body = await expectEnvelope(await get(harness(), 'learn', '?topic=nope'), { status: 400, code: 'validation_failed' });
  assert.equal(body.error, 'Unknown topic. One of: pfas, radon, lead, air, pollen, uv, mold');
});

test('learn: content the database could not be read for is still answered from the code module, and says so', async (t) => {
  const logged = muteConsoleError(t);
  const res = await get(harness({ tables: withoutTables('learn_content') }), 'learn', '?topic=pfas');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), [...LEARN_KEYS, 'reason', 'unavailable'].sort());
  assert.deepEqual([body.unavailable, body.reason, body.what_it_is], [true, 'learn_content_unavailable', LEARN_CONTENT.pfas.what_it_is]);
  assert.equal(body.household_note, LEARN_CONTENT.pfas.household.has_pregnant, 'the household branch still works');
  assert.ok(loggedText(logged).includes(res.headers.get('x-request-id')));
});

test('learn: a household composition that could not be read is not mistaken for "no note for your household"', async (t) => {
  muteConsoleError(t);
  const body = await (await get(harness({ tables: withoutTables('household_bands') }), 'learn', '?topic=pfas')).json();
  assert.deepEqual([body.household_note, body.unavailable, body.reason], [null, true, 'household_unavailable']);
  assert.equal(body.what_it_is, LEARN_CONTENT.pfas.what_it_is);

  const both = await (await get(harness({ tables: withoutTables('household_bands', 'learn_content') }), 'learn', '?topic=pfas')).json();
  assert.equal(both.reason, 'learn_content_unavailable', 'the content is named first when both are down');

  const none = await (await get(harness({ seed: () => ({ household_bands: [] }) }), 'learn', '?topic=pfas')).json();
  assert.deepEqual([none.household_note, 'unavailable' in none], [null, false], 'a household with no composition row is a true empty');
});

test('learn: the composition read is the caller\'s own; missing session is a 401 envelope; an unexpected failure is a 500 envelope', async (t) => {
  const h = harness();
  await get(h, 'learn', '?topic=uv');
  const read = h.db.queryLog.find((q) => q.table === 'household_bands');
  assert.ok(read.filters.some((f) => f.op === 'eq' && f.column === 'profile_id' && f.value === h.identities.alice.id));
  await expectEnvelope(await h.call('/api/learn', 'GET', { url: '/api/learn?topic=uv' }), { status: 401, code: 'auth_required' });
  await expectEnvelope(await h.call('/api/learn', 'GET', { url: '/api/learn?topic=uv', headers: { 'x-request-id': 'client-trace-0001' } }), { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });
  const logged = muteConsoleError(t);
  breakReads(h, 'learn_content');
  const body = await expectEnvelope(await get(h, 'learn', '?topic=uv'), { status: 500, code: 'internal_error' });
  assert.doesNotMatch(JSON.stringify(body), /secret database detail/);
  assert.ok(loggedText(logged).includes(body.request_id));
});

// ---------------------------------------------------------------- sources

test('sources legacy request: the same ten sources with name, provides and last_retrieved, plus a request id header', async () => {
  const res = await get(harness(), 'sources');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ['sources']);
  assert.equal(body.sources.length, 10);
  assert.ok(body.sources.every((s) => Object.keys(s).sort().join() === 'last_retrieved,name,provides'));
  const byName = Object.fromEntries(body.sources.map((s) => [s.name, s.last_retrieved]));
  assert.equal(byName['AirNow (EPA)'], '2026-09-30T10:00:00.000Z', 'alice\'s newest reading, not bob\'s newer one');
  assert.equal(byName['EPA UCMR 5'], '2026-01-15T00:00:00.000Z');
});

test('sources: a household with no readings yet gets nulls and no unavailable marker (unknown is null, a true empty)', async () => {
  const body = await (await get(harness({ seed: () => ({ daily_scores: [] }) }), 'sources')).json();
  assert.equal(body.sources.find((s) => s.name === 'AirNow (EPA)').last_retrieved, null);
  assert.deepEqual(Object.keys(body), ['sources']);
});

test('sources: readings that could not be read are marked, not passed off as "never retrieved"', async (t) => {
  const logged = muteConsoleError(t);
  const res = await get(harness({ tables: withoutTables('daily_scores') }), 'sources');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual([body.unavailable, body.reason], [true, 'readings_unavailable']);
  assert.equal(body.sources.length, 10);
  assert.equal(body.sources.find((s) => s.name === 'AirNow (EPA)').last_retrieved, null);
  assert.ok(loggedText(logged).includes(res.headers.get('x-request-id')));
});

test('sources: reference data that could not be read is marked too, and readings win when both fail', async (t) => {
  muteConsoleError(t);
  const ref = await (await get(harness({ tables: withoutTables('ucmr5_utilities') }), 'sources')).json();
  assert.deepEqual([ref.unavailable, ref.reason], [true, 'reference_data_unavailable']);
  assert.equal(ref.sources.find((s) => s.name === 'AirNow (EPA)').last_retrieved, '2026-09-30T10:00:00.000Z', 'the readings that could be read are still there');
  const both = await (await get(harness({ tables: withoutTables('daily_scores', 'ucmr5_utilities') }), 'sources')).json();
  assert.equal(both.reason, 'readings_unavailable');
});

test('sources keeps its owner filter, answers a missing session as a 401 envelope and an unexpected failure as a 500 envelope', async (t) => {
  const h = harness();
  await get(h, 'sources');
  const read = h.db.queryLog.find((q) => q.table === 'daily_scores');
  assert.ok(read.filters.some((f) => f.op === 'eq' && f.column === 'profile_id' && f.value === h.identities.alice.id));
  await expectEnvelope(await h.call('/api/sources', 'GET', {}), { status: 401, code: 'auth_required' });
  await expectEnvelope(await h.call('/api/sources', 'GET', { headers: { 'x-request-id': 'client-trace-0001' } }), { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });
  assert.equal((await get(h, 'sources', '', 'alice', { 'x-request-id': 'client-trace-0001' })).headers.get('x-request-id'), 'client-trace-0001');
  const logged = muteConsoleError(t);
  breakReads(h, 'daily_scores');
  const body = await expectEnvelope(await get(h, 'sources'), { status: 500, code: 'internal_error' });
  assert.doesNotMatch(JSON.stringify(body), /secret database detail/);
  assert.ok(loggedText(logged).includes(body.request_id));
});
