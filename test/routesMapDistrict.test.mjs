import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope, loggedText, UUID } from './helpers/envelope.mjs';

const NOW = new Date().toISOString();
const PFOA = (date, ppt) => ({ PFOA: [{ date, value_ppt: ppt }] });
const UTILITIES = [
  { pwsid: 'NC9990001', pws_name: 'Quarter One Water', status: 'Final', contaminants: PFOA('3/15/2024', 2.1), created_at: '2026-01-15T00:00:00Z' },
  { pwsid: 'NC9990002', pws_name: 'Quarter Three Water', status: 'Final', contaminants: PFOA('8/20/2024', 7.7), created_at: '2026-01-15T00:00:00Z' },
];
const DISTRICT_LAYER = {
  layer: 'district',
  assembled_at: NOW,
  payload: {
    layer: 'district',
    scope: 'NC-08',
    ranked_counties: 100,
    county_rankings: [{ county: 'Cabarrus County', water_rank: 12, share_over: 0.2 }],
    assembled_at: NOW,
  },
};
const WATER_LAYER = { layer: 'water', assembled_at: NOW, payload: { layer: 'water', count: 3, features: [{ pwsid: 'NC9990001' }], assembled_at: NOW } };

/** ArcGIS answers with no service areas: every system is unlocated, which the payload says itself. */
const emptyGeo = async () => new Response(JSON.stringify({ features: [] }), { status: 200 });

const TABLES = haloTables('profiles', 'map_layers', 'ucmr5_utilities');
// A table that is not in `tables` is not seeded either, so it answers like an unapplied migration (PGRST205).
const harness = ({ layers = [], utilities = [], profile = { county: 'Cabarrus County' }, tables = TABLES, fetch = emptyGeo } = {}) =>
  createRouteHarness({
    tables,
    fetch,
    seed: ({ alice }) => Object.fromEntries(Object.entries({
      map_layers: layers,
      ucmr5_utilities: utilities,
      profiles: profile ? [{ id: alice.id, ...profile }] : [],
    }).filter(([table]) => table in tables)),
  });
const map = (h, query = '', as = 'alice', headers) => h.call('/api/map', 'GET', { as, url: `/api/map${query}`, headers });
const district = (h, as = 'alice', headers) => h.call('/api/district', 'GET', { as, headers });

// ------------------------------------------------------------------- map

test('map legacy request: the stored water layer keeps every old field, plus prebuilt and a request id header', async () => {
  const h = harness({ layers: [WATER_LAYER] });
  for (const query of ['', '?layer=water']) {
    const res = await map(h, query);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('x-request-id'), UUID);
    const body = await res.json();
    assert.deepEqual(body, { ...WATER_LAYER.payload, prebuilt: true });
    assert.equal('request_id' in body, false, 'success bodies do not carry request_id');
  }
});

test('map: a layer that is not stored is built live and stored, prebuilt false (radon needs no provider)', async () => {
  const h = harness();
  const res = await map(h, '?layer=radon');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  const body = await res.json();
  assert.deepEqual([body.layer, body.prebuilt, body.count > 0, Array.isArray(body.features)], ['radon', false, true, true]);
  await new Promise((resolve) => setImmediate(resolve)); // storeLayer is fire and forget
  assert.deepEqual(h.db.rows('map_layers').map((row) => row.layer), ['radon']);
});

const BAD_LAYERS = ['bogus', 'district', 'Water', 'water%20', 'water,radon', "water'--", 'x'.repeat(5000)];
for (const layer of BAD_LAYERS) {
  test(`map layer=${layer.slice(0, 24)} is a 400 with the legacy sentence in the envelope and reads nothing`, async () => {
    const h = harness({ layers: [WATER_LAYER] });
    const body = await expectEnvelope(await map(h, `?layer=${layer}`), { status: 400, code: 'validation_failed', retryable: false });
    assert.equal(body.error, 'layer must be one of: water, radon, facilities, air.');
    assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), [['layer', 'invalid_option']]);
    assert.equal(h.db.queryLog.length, 0);
  });
}

test('map: an empty layer still means water', async () => {
  const h = harness({ layers: [WATER_LAYER] });
  assert.equal((await (await map(h, '?layer=')).json()).layer, 'water');
});

const BAD_QUARTERS = ['2024Q5', '2024Q0', '2024q3', '24Q3', '2024Q', '2024Q3%20', '2024-Q3', '20245Q3', 'abc', "2024Q3'"];
for (const quarter of BAD_QUARTERS) {
  test(`map quarter=${quarter} is a 400 (quarter looks like 2024Q3) and reads nothing`, async () => {
    const h = harness({ utilities: UTILITIES });
    const body = await expectEnvelope(await map(h, `?layer=water&quarter=${quarter}`), { status: 400, code: 'validation_failed', retryable: false });
    assert.equal(body.error, 'quarter looks like 2024Q3.');
    assert.deepEqual(body.field_errors.map((e) => [e.field, e.code]), [['quarter', 'invalid_quarter']]);
    assert.equal(h.db.queryLog.length, 0);
  });
}

test('map: quarter applies to the water layer only, and the layer is judged first', async () => {
  const h = harness({ utilities: UTILITIES });
  const radon = await expectEnvelope(await map(h, '?layer=radon&quarter=2024Q3'), { status: 400, code: 'validation_failed' });
  assert.equal(radon.error, 'quarter applies to the water layer only.');
  assert.deepEqual(radon.field_errors.map((e) => [e.field, e.code]), [['quarter', 'quarter_not_applicable']]);
  const both = await expectEnvelope(await map(h, '?layer=nope&quarter=bad'), { status: 400, code: 'validation_failed' });
  assert.deepEqual(both.field_errors.map((e) => e.field), ['layer']);
  assert.equal(h.db.queryLog.length, 0);
  assert.equal((await map(h, '?layer=radon&quarter=')).status, 200, 'an empty quarter is "not given", as before');
});

test('map quarter: only the systems with readings in that quarter, with the old fields and the quarters that exist', async () => {
  const h = harness({ utilities: UTILITIES });
  const res = await map(h, '?layer=water&quarter=2024Q3');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  const body = await res.json();
  for (const key of ['layer', 'quarter', 'quarters', 'count', 'located', 'counts', 'features', 'population_source', 'assembled_at', 'note']) assert.ok(key in body, key);
  assert.equal(body.quarter, '2024Q3');
  assert.deepEqual(body.features.map((f) => f.pwsid), ['NC9990002']);
  assert.deepEqual(body.quarters, ['2024Q1', '2024Q3']);
  assert.equal('prebuilt' in body, false);
});

test('map quarter that is well formed but has no readings stays an honest empty list that names the quarters that exist', async () => {
  const h = harness({ utilities: UTILITIES });
  const body = await (await map(h, '?layer=water&quarter=1999Q1')).json();
  assert.deepEqual([body.count, body.features, body.quarters], [0, [], ['2024Q1', '2024Q3']]);
  assert.equal('unavailable' in body, false, 'no data in a quarter is a true empty result');
});

test('map: a layer whose source is down is a 503 envelope that keeps its sentence and its layer field', async (t) => {
  const logged = muteConsoleError(t);
  const water = await map(harness({ tables: haloTables('map_layers') })); // ucmr5_utilities missing: PGRST205
  const body = await expectEnvelope(water, { status: 503, code: 'upstream_unavailable', retryable: true, extraKeys: ['layer'] });
  assert.equal(body.error, "The water layer's source is unavailable right now. Try again shortly.");
  assert.equal(body.layer, 'water');
  assert.doesNotMatch(JSON.stringify(body), /schema cache|ucmr5|PGRST/);
  assert.ok(loggedText(logged).includes(body.request_id), 'the log line carries the request id');

  const down = harness({ fetch: async () => new Response('', { status: 503 }) }); // the EPA ECHO service answers 503
  const facilities = await expectEnvelope(await map(down, '?layer=facilities'), { status: 503, code: 'upstream_unavailable', extraKeys: ['layer'] });
  assert.equal(facilities.layer, 'facilities');
  assert.equal(down.db.rows('map_layers').length, 0, 'a failed build stores nothing');
});

test('map: a database failure behind the quarter view is a 500 envelope with no database text; the real error is logged with the request id', async (t) => {
  const logged = muteConsoleError(t);
  const res = await map(harness({ tables: haloTables('map_layers') }), '?layer=water&quarter=2024Q3');
  const body = await expectEnvelope(res, { status: 500, code: 'internal_error', retryable: true });
  assert.equal(body.error, 'Something went wrong on our side. Please try again.');
  assert.doesNotMatch(JSON.stringify(body), /schema cache|ucmr5|PGRST/);
  assert.ok(loggedText(logged).includes(body.request_id));
  assert.ok(loggedText(logged).includes('Could not find the table'));
});

test('map: a missing session is a 401 envelope that echoes a client request id', async () => {
  const h = harness();
  const none = await expectEnvelope(await h.call('/api/map', 'GET', {}), { status: 401, code: 'auth_required' });
  assert.equal(none.error, 'Sign-in required.');
  await expectEnvelope(await h.call('/api/map', 'GET', { headers: { 'x-request-id': 'client-trace-0001' } }), { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });
  const ok = await map(harness({ layers: [WATER_LAYER] }), '', 'alice', { 'x-request-id': 'client-trace-0001' });
  assert.equal(ok.headers.get('x-request-id'), 'client-trace-0001');
  assert.equal(h.db.queryLog.length, 0);
});

test('map reads no household table: only the layer store and the public utilities', async () => {
  const h = harness({ utilities: UTILITIES });
  await map(h, '?layer=water&quarter=2024Q3');
  await map(h, '?layer=radon');
  assert.deepEqual([...new Set(h.db.queryLog.map((q) => q.table))].sort(), ['map_layers', 'ucmr5_utilities']);
});

// -------------------------------------------------------------- district

test('district legacy request: the pre-built view keeps its fields, the statewide ranking stays server side, plus a request id header', async () => {
  const h = harness({ layers: [DISTRICT_LAYER] });
  const res = await district(h);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  const body = await res.json();
  assert.deepEqual(body, {
    layer: 'district',
    scope: 'NC-08',
    ranked_counties: 100,
    assembled_at: NOW,
    household_county: { county: 'Cabarrus County', water_rank: 12, of: 100, share_over: 0.2 },
    prebuilt: true,
  });
  assert.equal('county_rankings' in body, false);
});

test('district: no stored view is built live from the utilities, prebuilt false', async () => {
  const h = harness({ utilities: UTILITIES });
  const res = await district(h);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.prebuilt, false);
  assert.equal(body.scope, 'NC-08');
  assert.ok(Array.isArray(body.counties) && 'household_county' in body);
  assert.equal(body.unlocated_systems, 2, 'systems with no mapped service area are counted, not hidden');
});

test('district: a household with no county on file, or no profile row at all, is a true "not ranked" (null), not an error', async () => {
  for (const profile of [{ county: null }, null]) {
    const res = await district(harness({ layers: [DISTRICT_LAYER], profile }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.household_county, null);
    assert.equal('unavailable' in body, false);
  }
});

test('district: a failed profile read is a 500 envelope, never an empty household; the real error is logged with the request id', async (t) => {
  const logged = muteConsoleError(t);
  const res = await district(harness({ layers: [DISTRICT_LAYER], tables: haloTables('map_layers') })); // profiles missing: PGRST205
  const body = await expectEnvelope(res, { status: 500, code: 'internal_error', retryable: true });
  assert.equal(body.error, 'Something went wrong on our side. Please try again.');
  assert.doesNotMatch(JSON.stringify(body), /schema cache|profiles|PGRST/);
  assert.ok(loggedText(logged).includes(body.request_id));
  assert.ok(loggedText(logged).includes('Could not find the table'));
});

test('district: a failed live build is a 500 envelope with no database text, and a missing layer store still answers from a live build', async (t) => {
  const logged = muteConsoleError(t);
  const broken = await district(harness({ tables: haloTables('map_layers', 'profiles') })); // ucmr5_utilities missing
  const body = await expectEnvelope(broken, { status: 500, code: 'internal_error' });
  assert.doesNotMatch(JSON.stringify(body), /schema cache|ucmr5|PGRST/);
  assert.ok(loggedText(logged).includes(body.request_id));

  const noStore = await district(harness({ utilities: UTILITIES, tables: haloTables('profiles', 'ucmr5_utilities') })); // map_layers missing
  assert.equal(noStore.status, 200);
  assert.equal((await noStore.json()).prebuilt, false);
  assert.ok(loggedText(logged).includes('Storing district failed'), 'the failed store is logged');
});

test('district: a missing session is a 401 envelope that echoes a client request id', async () => {
  const h = harness({ layers: [DISTRICT_LAYER] });
  await expectEnvelope(await h.call('/api/district', 'GET', {}), { status: 401, code: 'auth_required' });
  await expectEnvelope(await h.call('/api/district', 'GET', { headers: { 'x-request-id': 'client-trace-0001' } }), { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });
  assert.equal((await district(h, 'alice', { 'x-request-id': 'client-trace-0001' })).headers.get('x-request-id'), 'client-trace-0001');
});

test('district keeps its owner filter: the household county comes from the caller\'s own profile row', async () => {
  const h = createRouteHarness({
    tables: TABLES,
    seed: ({ alice, bob }) => ({
      map_layers: [{ ...DISTRICT_LAYER, payload: { ...DISTRICT_LAYER.payload, county_rankings: [
        { county: 'Cabarrus County', water_rank: 12, share_over: 0.2 }, { county: 'Mecklenburg County', water_rank: 41, share_over: 0.5 }] } }],
      profiles: [{ id: alice.id, county: 'Cabarrus County' }, { id: bob.id, county: 'Mecklenburg County' }],
    }),
  });
  assert.equal((await (await district(h, 'alice')).json()).household_county.county, 'Cabarrus County');
  assert.equal((await (await district(h, 'bob')).json()).household_county.county, 'Mecklenburg County');
  const read = h.db.queryLog.filter((q) => q.table === 'profiles');
  assert.equal(read.length, 2);
  assert.ok(read.every((q) => q.filters.some((f) => f.op === 'eq' && f.column === 'id')));
});
