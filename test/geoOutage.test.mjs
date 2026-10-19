/**
 * Geography outage: a failed ArcGIS lookup is never stored or served as a
 * complete water map or district view.
 *
 * getWaterGeo RESOLVES when ArcGIS is down: an empty (or, when only some
 * batches fail, a partial) Map with failedBatches > 0 and `complete: false`.
 * An unfinished lookup is not "these systems have no mapped service area", so:
 * - the daily pre-build keeps the stored water layer and district view byte
 *   for byte, and still stores radon, facilities and air;
 * - a live water build is answered marked incomplete
 *   (`geography_complete: false`, `meta.availability: 'partial'`, an honest
 *   note) and is not stored;
 * - a live district build is a 503 (its counts are all required integers, so
 *   it has no way to say "incomplete") and is not stored;
 * - a healthy lookup, including one that finds no service areas, is unchanged.
 *
 * No test reaches the network: every fetch is a stub, and the route harness
 * rejects any fetch the test did not hand it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { createFakeSupabase } from './helpers/fakeSupabase.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope, loggedText } from './helpers/envelope.mjs';
import { quiet, setup } from './helpers/isolationKit.mjs';
import { buildAndStoreAll } from '../lib/mapBuild.js';
import { ARCGIS_WATER_BOUNDARIES, getWaterGeo } from '../lib/waterGeo.js';

// Outside a harness call nothing may reach the network either: every direct
// lookup and pre-build passes its own fetchImpl, and this makes a missed one fail.
globalThis.fetch = async (url) => {
  throw new TypeError(`unexpected outbound fetch in a geography outage test: ${String(url)}`);
};

// ------------------------------------------------------------- fixtures

const POINTS = [
  { lat: 34.985, lng: -80.549, population: 34000 }, // Union County, in NC-08
  { lat: 35.35, lng: -80.2, population: 12000 }, // Stanly County, in NC-08
  { lat: 35.78, lng: -78.64, population: 480000 }, // Wake County, outside NC-08
];
/** Three systems, all over the PFOA limit, with ids `${prefix}0001` to `${prefix}0003` (prefix is NC plus 3 digits). */
const utilitiesFor = (prefix) =>
  [1, 2, 3].map((i) => ({
    pwsid: `${prefix}${String(i).padStart(4, '0')}`,
    pws_name: `Test Water ${i}`,
    status: 'Final',
    contaminants: { PFOA: [{ date: '8/20/2024', value_ppt: 7.7 }] },
  }));
/** 100 filler systems with no readings, sorted before the named ones, so a live build needs a second batch of 100. */
const fillers = (prefix) =>
  Array.from({ length: 100 }, (_, i) => ({ pwsid: `${prefix}${String(i).padStart(4, '0')}`, pws_name: `Filler ${i}`, status: 'Final', contaminants: {} }));

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** The ids one ArcGIS request asked for (its where clause). */
const askedIds = (href) => [...new URL(href).searchParams.get('where').matchAll(/'([A-Z0-9]+)'/g)].map((m) => m[1]);
/** The ArcGIS answer for just the systems a batch asked for, as the real service gives it. */
function asked(utilities, href) {
  const ids = askedIds(href);
  return json({
    features: utilities
      .filter((u) => ids.includes(u.pwsid))
      .map((u) => {
        const p = POINTS[utilities.indexOf(u) % POINTS.length];
        return { attributes: { PWSID: u.pwsid, Population_Served_Count: p.population }, centroid: { x: p.lng, y: p.lat } };
      }),
  });
}

/** Every way a batch can fail. The four 200s are the malformed shapes that used to read as "found none". */
const BATCH_FAILS = {
  'ArcGIS answers 503': () => json({}, 503),
  'ArcGIS answers an error body': () => json({ error: { code: 500, message: 'Unable to complete operation.' } }),
  'ArcGIS answers malformed JSON': () => new Response('<html>', { status: 200 }),
  'the network fails': () => {
    throw new TypeError('fetch failed');
  },
  'ArcGIS answers 200 {}': () => json({}),
  'ArcGIS answers 200 []': () => json([]),
  'ArcGIS answers 200 {features:null}': () => json({ features: null }),
  'ArcGIS answers 200 with exceededTransferLimit': () => json({ features: [], exceededTransferLimit: true }),
};

/** Answers ArcGIS only; any other host is recorded as unexpected and refused. */
function arcgisStub(answer) {
  const calls = [];
  const unexpected = [];
  const fetch = async (url) => {
    const href = String(url);
    if (!href.startsWith(`${ARCGIS_WATER_BOUNDARIES}?`)) {
      unexpected.push(href);
      throw new TypeError('fetch failed: unexpected host in a geography outage test');
    }
    calls.push(href);
    return answer(href);
  };
  return { fetch, calls, unexpected };
}

/** ECHO and AirNow, answered, so the other layers can store during a geography outage. */
async function sources(url) {
  const href = String(url);
  if (href.startsWith('https://echodata.epa.gov/echo/echo_rest_services.')) {
    const facilities = [{ RegistryID: '110000000001', FacName: 'Monroe Test Plant', FacLat: '34.985', FacLong: '-80.549', FacCounty: 'UNION', FacComplianceStatus: 'No Violation Identified', NPDESFlag: 'Y' }];
    const body = href.includes('.get_facilities?') ? { Results: { QueryID: 'q1', QueryRows: '1' } } : { Results: { Facilities: facilities } };
    return json(body);
  }
  if (href.startsWith('https://www.airnowapi.org/aq/data/?')) {
    return json([{ FullAQSCode: '371790003', SiteName: 'Monroe', Latitude: 34.97, Longitude: -80.54, UTC: '2026-10-18T14:00', Parameter: 'PM2.5', AQI: 61, AgencyName: 'North Carolina DAQ' }]);
  }
  throw new TypeError('unexpected host');
}
const SOURCES = { fetchImpl: sources, apiKey: 'test-key', now: new Date('2026-10-18T15:00:00Z') };

const EM_DASH = String.fromCharCode(0x2014);
const settle = () => new Promise((resolve) => setImmediate(resolve));
const PARTIAL_NOTE = (unlocated, count) =>
  `The service-area lookup did not complete. ${unlocated} of ${count} systems are shown without coordinates and carry severity; some or all of them may have a service area the lookup could not return.`;

const TABLES = haloTables('profiles', 'map_layers', 'ucmr5_utilities');
const harness = ({ utilities, fetch }) =>
  createRouteHarness({
    tables: TABLES,
    fetch,
    seed: ({ alice }) => ({ map_layers: [], ucmr5_utilities: utilities, profiles: [{ id: alice.id, county: 'Union County' }] }),
  });

// ------------------------------------------------------- the lookup itself

let lookupIndex = 0;
for (const [outcome, answer] of Object.entries(BATCH_FAILS)) {
  lookupIndex += 1;
  test(`lookup: when ${outcome}, getWaterGeo resolves with a Map and complete false`, async () => {
    const utilities = utilitiesFor(`NC8${String(lookupIndex).padStart(2, '0')}`);
    const r = await getWaterGeo(utilities.map((u) => u.pwsid), { force: true, store: null, fetchImpl: async (url) => answer(String(url)) });
    assert.ok(r.geo instanceof Map, 'an outage resolves, it never rejects');
    assert.deepEqual([r.found, r.failedBatches, r.complete], [0, 1, false]);
  });
}

test('lookup: a partial outage (one batch of three fails) is incomplete even though some systems were found', async () => {
  const utilities = utilitiesFor('NC820');
  const r = await getWaterGeo(utilities.map((u) => u.pwsid), {
    force: true,
    store: null,
    batchSize: 1,
    fetchImpl: async (url) => (askedIds(String(url)).includes(utilities[2].pwsid) ? json({}, 503) : asked(utilities, String(url))),
  });
  assert.deepEqual([r.found, r.failedBatches, r.complete], [2, 1, false]);
});

test('lookup: a healthy lookup is complete, and so is one that truly finds no service areas', async () => {
  const utilities = utilitiesFor('NC821');
  const ids = utilities.map((u) => u.pwsid);
  const healthy = await getWaterGeo(ids, { force: true, store: null, fetchImpl: async (url) => asked(utilities, String(url)) });
  assert.deepEqual([healthy.found, healthy.failedBatches, healthy.complete], [3, 0, true]);
  const none = await getWaterGeo(ids, { force: true, store: null, fetchImpl: async () => json({ features: [] }) });
  assert.deepEqual([none.found, none.failedBatches, none.complete], [0, 0, true]);
});

// ------------------------------------------------- the daily pre-build

const CRON_OUTAGES = {
  'every batch fails': { batchSize: 100, fetchImpl: async () => json({}, 503) },
  'one batch of three fails': {
    batchSize: 1,
    fetchImpl: async (url) => (askedIds(String(url)).some((id) => id.endsWith('0003')) ? json({}, 503) : null),
  },
};

let cronIndex = 0;
for (const [label, outage] of Object.entries(CRON_OUTAGES)) {
  cronIndex += 1;
  test(`pre-build: when ${label}, yesterday's water and district rows survive byte for byte and the other layers still store`, async (t) => {
    const utilities = utilitiesFor(`NC83${cronIndex}`);
    const ids = utilities.map((u) => u.pwsid);
    const db = createFakeSupabase({ tables: haloTables('map_layers', 'ucmr5_utilities'), seed: { ucmr5_utilities: utilities } });
    const rowOf = (layer) => db.rows('map_layers').find((row) => row.layer === layer);

    // Day 1: a good lookup, passed exactly as the daily job passes it.
    const day1 = await buildAndStoreAll(db, getWaterGeo(ids, { force: true, store: null, fetchImpl: async (url) => asked(utilities, String(url)) }), SOURCES);
    for (const layer of ['water', 'district', 'radon', 'facilities', 'air']) assert.equal(day1[layer].ok, true, `day 1 ${layer}`);
    assert.equal(rowOf('water').payload.located, 3);
    const kept = { water: JSON.stringify(rowOf('water')), district: JSON.stringify(rowOf('district')) };
    const before = Object.fromEntries(['radon', 'facilities', 'air'].map((layer) => [layer, rowOf(layer).assembled_at]));
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Day 2: ArcGIS is down. The lookup resolves, it does not reject.
    const logged = muteConsoleError(t);
    const lookup = getWaterGeo(ids, {
      force: true,
      store: null,
      batchSize: outage.batchSize,
      fetchImpl: async (url) => (await outage.fetchImpl(url)) ?? asked(utilities, String(url)),
    });
    const geo = await lookup;
    assert.ok(geo.geo instanceof Map && geo.failedBatches > 0 && geo.complete === false, 'the real outage shape');
    assert.equal(geo.found, label === 'every batch fails' ? 0 : 2);
    const day2 = await buildAndStoreAll(db, lookup, SOURCES);

    assert.equal(JSON.stringify(rowOf('water')), kept.water, 'the stored water layer is untouched');
    assert.equal(JSON.stringify(rowOf('district')), kept.district, 'the stored district view is untouched');
    assert.deepEqual(day2.water, { ok: false, error: 'geography_incomplete' });
    assert.deepEqual(day2.district, { ok: false, error: 'geography_incomplete' });
    for (const layer of ['radon', 'facilities', 'air']) {
      assert.equal(day2[layer].ok, true, `${layer} still stores`);
      assert.ok(rowOf(layer).assembled_at > before[layer], `${layer} is today's copy`);
    }
    assert.equal(logged.mock.callCount(), 1, 'one log line');
    const line = loggedText(logged);
    assert.match(line, /geography lookup was incomplete/);
    assert.ok(ids.every((id) => !line.includes(id)), 'no system ids in the log line');
  });
}

test('pre-build: an outage with nothing stored yet stores no water or district at all', async (t) => {
  muteConsoleError(t);
  const utilities = utilitiesFor('NC840');
  const db = createFakeSupabase({ tables: haloTables('map_layers', 'ucmr5_utilities'), seed: { ucmr5_utilities: utilities } });
  const lookup = getWaterGeo(utilities.map((u) => u.pwsid), { force: true, store: null, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  const report = await buildAndStoreAll(db, lookup, SOURCES);
  assert.deepEqual([report.water.ok, report.district.ok, report.radon.ok], [false, false, true]);
  assert.deepEqual(db.rows('map_layers').map((row) => row.layer).sort(), ['air', 'facilities', 'radon']);
});

// The tests above hand buildAndStoreAll the lookup themselves. These run the
// REAL daily job end to end, so they fail if the job ever stops passing the
// whole getWaterGeo result (a bare Map reads as a complete lookup).
const SECRET = 'cron-secret-for-tests';
const runCron = (ctx) => ctx.h.call('/api/cron/daily', 'GET', { headers: { authorization: `Bearer ${SECRET}` } });

test('daily job, ArcGIS down: the seeded water and district rows survive byte for byte, and radon still stores', async (t) => {
  quiet(t);
  // Every provider, ArcGIS included, is unanswered and gets a 503.
  const ctx = setup({ env: { CRON_SECRET: SECRET } });
  const rowOf = (layer) => JSON.stringify(ctx.h.db.rows('map_layers').find((row) => row.layer === layer));
  const before = { water: rowOf('water'), district: rowOf('district') };
  assert.ok(before.water && before.district, 'both rows are seeded');

  const res = await runCron(ctx);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(ctx.outbound.some((entry) => entry.url.startsWith(ARCGIS_WATER_BOUNDARIES)), 'the outage was really exercised');
  assert.equal(body.water_geo.complete, false);
  assert.deepEqual(body.map_layers.water, { ok: false, error: 'geography_incomplete' });
  assert.deepEqual(body.map_layers.district, { ok: false, error: 'geography_incomplete' });
  assert.equal(body.map_layers.radon.ok, true, 'the other layers still run');
  assert.ok(ctx.h.db.rows('map_layers').some((row) => row.layer === 'radon'), 'radon is stored');
  assert.equal(rowOf('water'), before.water, 'the stored water layer is untouched');
  assert.equal(rowOf('district'), before.district, 'the stored district view is untouched');
});

test('daily job, ArcGIS healthy: water and district are stored as before', async (t) => {
  quiet(t);
  const ctx = setup({
    env: { CRON_SECRET: SECRET },
    provider: (entry) => {
      if (!entry.url.startsWith(`${ARCGIS_WATER_BOUNDARIES}?`)) return null;
      const ids = askedIds(entry.url);
      return json({ features: ids.map((id, i) => ({ attributes: { PWSID: id, Population_Served_Count: POINTS[i % 3].population }, centroid: { x: POINTS[i % 3].lng, y: POINTS[i % 3].lat } })) });
    },
  });
  const rowOf = (layer) => ctx.h.db.rows('map_layers').find((row) => row.layer === layer);
  const before = { water: JSON.stringify(rowOf('water')), district: JSON.stringify(rowOf('district')) };

  const body = await (await runCron(ctx)).json();
  assert.equal(body.water_geo.complete, true);
  assert.equal(body.water_geo.failed_batches, 0);
  assert.equal(body.map_layers.water.ok, true);
  assert.equal(body.map_layers.district.ok, true);
  assert.notEqual(JSON.stringify(rowOf('water')), before.water, 'today\'s water layer replaced yesterday\'s');
  assert.notEqual(JSON.stringify(rowOf('district')), before.district, 'today\'s district view replaced yesterday\'s');
  assert.equal(rowOf('water').payload.located, rowOf('water').payload.count, 'every system placed');
  assert.equal(Object.hasOwn(rowOf('water').payload, 'geography_complete'), false, 'a healthy body is unchanged');
});

// ----------------------------------------------------------- live routes

/** Live outages: every failed batch above, and a partial one (the second of two batches fails). */
const LIVE_OUTAGES = {
  ...Object.fromEntries(Object.entries(BATCH_FAILS).map(([outcome, answer]) => [outcome, { utilities: (p) => utilitiesFor(p), answer: () => answer }])),
  // The ids sort fillers first: batch one (100 fillers) is answered and placed, batch two (the three named systems) fails.
  'the second of two batches fails': {
    utilities: (p) => [...fillers(`${p}0`), ...utilitiesFor(`${p}9`)],
    answer: (u) => (href) => (askedIds(href).includes(u.at(-1).pwsid) ? json({}, 503) : asked(u, href)),
  },
};

let liveIndex = 0;
for (const [outcome, live] of Object.entries(LIVE_OUTAGES)) {
  liveIndex += 1;
  const id = String(liveIndex).padStart(2, '0');

  test(`live water: when ${outcome}, the layer is marked partial with an honest note and is stored nowhere`, async (t) => {
    const logged = muteConsoleError(t);
    const utilities = live.utilities(`NC5${id}`);
    const stub = arcgisStub(live.answer(utilities));
    const h = harness({ utilities, fetch: stub.fetch });
    for (const url of ['/api/map?layer=water', '/api/map?layer=water&quarter=2024Q3']) {
      const res = await h.call('/api/map', 'GET', { as: 'alice', url });
      assert.equal(res.status, 200, url);
      const body = await res.json();
      assert.equal(body.layer, 'water');
      assert.equal(body.geography_complete, false, url);
      assert.deepEqual(body.meta, { availability: 'partial' }, `${url}: the client is told the layer is incomplete`);
      assert.ok(body.located < body.count, 'some systems really are missing their location');
      assert.equal(body.note, PARTIAL_NOTE(body.count - body.located, body.count));
      assert.doesNotMatch(body.note, /no mapped service area/, 'never the false cause');
      assert.equal(JSON.stringify(body).includes(EM_DASH), false, 'no em dash in app-facing copy');
    }
    assert.ok(stub.calls.length > 0, 'the outcome was really exercised');
    assert.deepEqual(stub.unexpected, []);
    await settle();
    assert.deepEqual(h.db.rows('map_layers'), [], 'an incomplete live build is never stored');
    assert.match(loggedText(logged), /incomplete geography lookup and not stored/);
  });

  test(`live district: when ${outcome}, the answer is a 503 envelope with no totals, and nothing is stored`, async (t) => {
    const logged = muteConsoleError(t);
    const utilities = live.utilities(`NC6${id}`);
    const stub = arcgisStub(live.answer(utilities));
    const h = harness({ utilities, fetch: stub.fetch });
    const res = await h.call('/api/district', 'GET', { as: 'alice' });
    const body = await expectEnvelope(res, { status: 503, code: 'upstream_unavailable', retryable: true });
    assert.equal(body.error, 'The district view needs the water service areas, which could not be looked up right now. Try again shortly.');
    assert.equal(JSON.stringify(body).includes(EM_DASH), false, 'no em dash in app-facing copy');
    assert.ok(loggedText(logged).includes(body.request_id), 'the log line carries the request id');
    assert.ok(stub.calls.length > 0, 'the outcome was really exercised');
    assert.deepEqual(stub.unexpected, []);
    await settle();
    assert.deepEqual(h.db.rows('map_layers'), [], 'nothing stored');
  });
}

test('live, healthy: a finished lookup is answered and stored as before, including one that finds no service areas', async () => {
  for (const [prefix, answer, note] of [
    ['NC700', (u) => (href) => asked(u, href), /^Every system has a service-area centroid/],
    ['NC701', () => () => json({ features: [] }), /^3 of 3 systems have no mapped service area/],
  ]) {
    const utilities = utilitiesFor(prefix);
    const stub = arcgisStub(answer(utilities));
    const h = harness({ utilities, fetch: stub.fetch });
    const res = await h.call('/api/map', 'GET', { as: 'alice', url: '/api/map?layer=water' });
    assert.equal(res.status, 200);
    const water = await res.json();
    assert.match(water.note, note);
    assert.equal(Object.hasOwn(water, 'geography_complete'), false, 'a healthy body is unchanged');
    assert.equal(Object.hasOwn(water, 'meta'), false);
    assert.equal(water.prebuilt, false);
    const district = await h.call('/api/district', 'GET', { as: 'alice' });
    assert.equal(district.status, 200);
    const view = await district.json();
    assert.equal(view.prebuilt, false);
    assert.equal(typeof view.total_systems, 'number');
    assert.deepEqual(stub.unexpected, []);
    await settle();
    assert.deepEqual(h.db.rows('map_layers').map((row) => row.layer).sort(), ['district', 'water'], 'both are stored');
  }
});
