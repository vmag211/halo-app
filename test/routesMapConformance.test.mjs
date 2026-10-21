/**
 * B05 Task 1: the first conformance test of the SHIPPED map routes against the
 * frontend's own parsers.
 *
 * `test/routesMapDistrict.test.mjs` proves each route is right on its own
 * terms. What it cannot prove is that the client can read the answer. The
 * client's parsers throw `invalid_map_response` on one wrong field and the map
 * renders nothing, so a route can be green in its own suite and still show a
 * person an empty map. This file runs the REAL handlers and hands every body to
 * the client's parser.
 *
 * THE PARSERS USED HERE ARE TRANSCRIBED, not summarised (test/helpers/frontendB05.mjs), from
 * `lib/frontend/map-service.ts` (lines 15-20, 24-56, 58-65, 82-96) and the
 * helpers they use from `lib/frontend/stage-values.ts`, on
 * `origin/codex/october15-review-refinement` (read with `git show`; the files
 * are not checked out here). TypeScript to JavaScript with the types stripped
 * and nothing else changed. `parseMapComparisons` is included because
 * `parseMapLayer` calls it. A transcription that accepted everything would pass
 * every body in this file, so `the transcribed parsers reject what the client
 * rejects` shows that it does not (precedent: test/contractsB03.test.mjs).
 *
 * Contradiction 9.9 (the district no-population branch fails
 * `parseMapDistrict`) is decided here: the section `9.9 reachability` drives
 * every real producer of a district view and pins that none of them can reach
 * that branch. Nothing in lib/district.js is changed.
 *
 * No network: every harness fetch either rejects and records (the default) or
 * is a stub that answers the ArcGIS boundary service only, the one host the
 * existing live-build tests already stub, and records every other host as
 * unexpected. Air and facilities are served from stored layers built by the
 * real payload builders with an injected fetch, never the global one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { expectEnvelope, loggedText } from './helpers/envelope.mjs';
import { createFakeSupabase } from './helpers/fakeSupabase.mjs';
import { quiet, setup } from './helpers/isolationKit.mjs';
import { haloTables } from './helpers/tables.mjs';
import { waterPayload, districtPayload, facilitiesPayload, airPayload, buildAndStoreAll } from '../lib/mapBuild.js';
import { ARCGIS_WATER_BOUNDARIES, getWaterGeo } from '../lib/waterGeo.js';
import { computeDistrict, REGULATED } from '../lib/district.js';
import { buildDistrictView } from '../lib/districtView.js';
import { inNc08 } from '../lib/geoContainment.js';
// The client's parsers, transcribed once for every B05 suite (see the helper's header).
import { parseMapLayer, parseMapDistrict } from './helpers/frontendB05.mjs';
import { ECHO_METADATA } from './helpers/echoMetadata.mjs';

// ------------------------------------------------------------------- fixtures

const NOW = new Date().toISOString();
const reading = (date, ppt) => [{ date, value_ppt: ppt }];
/** Systems placed by the geography below: two in NC-08 (one over the PFOS limit), one in Wake County. */
const utilitiesFor = (prefix) => [
  { pwsid: `${prefix}0001`, pws_name: 'Monroe Test Water', status: 'Final', contaminants: { PFOS: reading('8/20/2024', 7.7), PFOA: reading('8/20/2024', 1.2) } },
  { pwsid: `${prefix}0002`, pws_name: 'Albemarle Test Water', status: 'Final', contaminants: { PFOA: reading('3/15/2024', 2.1), 'HFPO-DA (GenX)': reading('3/15/2024', 12) } },
  { pwsid: `${prefix}0003`, pws_name: 'Raleigh Test Water', status: 'Final', contaminants: { PFNA: reading('5/2/2024', 3) } },
];
const POINTS = [
  { lat: 34.985, lng: -80.549, population: 34000 }, // Union County, in NC-08
  { lat: 35.35, lng: -80.2, population: null }, // Stanly County, in NC-08, population not reported
  { lat: 35.78, lng: -78.64, population: 480000 }, // Wake County, outside NC-08
];
const geoMapFor = (utilities) => new Map(utilities.map((u, i) => [u.pwsid, POINTS[i]]));
const arcgisBody = (utilities) => ({
  features: utilities.map((u, i) => ({
    attributes: { PWSID: u.pwsid, ...(POINTS[i].population === null ? {} : { Population_Served_Count: POINTS[i].population }) },
    centroid: { x: POINTS[i].lng, y: POINTS[i].lat },
  })),
});

/**
 * A fetch that answers the ArcGIS boundary service only, as the existing
 * live-build tests do, and records every call. Any other host is unexpected:
 * it is recorded there and rejected like a dead network.
 */
function arcgisStub(answer) {
  const calls = [];
  const unexpected = [];
  const fetch = async (url) => {
    const href = String(url);
    if (!href.startsWith(`${ARCGIS_WATER_BOUNDARIES}?`)) {
      unexpected.push(href);
      throw new TypeError('fetch failed: unexpected host in a map conformance test');
    }
    calls.push(href);
    return answer(href);
  };
  return { fetch, calls, unexpected };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

const TABLES = haloTables('profiles', 'map_layers', 'ucmr5_utilities');
const stored = (layer, payload) => ({ layer, assembled_at: payload.assembled_at, payload });
function harness({ layers = [], utilities = [], fetch } = {}) {
  return createRouteHarness({
    tables: TABLES,
    ...(fetch ? { fetch } : {}),
    seed: ({ alice }) => ({ map_layers: layers, ucmr5_utilities: utilities, profiles: [{ id: alice.id, county: 'Union County' }] }),
  });
}
const get = async (h, url) => {
  const res = await h.call(url.split('?')[0], 'GET', { as: 'alice', url });
  assert.equal(res.status, 200, `${url} answered ${res.status}`);
  const body = await res.json();
  assertBare(body);
  return body;
};
/** D10 and the em dash rule, on every body this file reads. */
function assertBare(body) {
  assert.equal(Object.hasOwn(body, 'data'), false, 'no top-level data key: the client would parse body.data instead (F: runtime.ts:149-153)');
  const text = JSON.stringify(body);
  assert.equal(text.includes('\u2014'), false, 'no U+2014 in any readable string');
  assert.equal(text.includes('\\u2014'), false, 'no escaped U+2014 either');
}
const noFetches = (h) => assert.deepEqual(h.blockedFetches, [], 'the route made no outbound call');

/** The water layer conformance rule: every feature parsed, nothing marked partial. */
function assertWaterParses(body) {
  const parsed = parseMapLayer(body, 'water');
  assert.equal(parsed.water.length, body.features.length);
  assert.equal(parsed.partial, false);
  assert.ok(parsed.assembledAt, 'the client needs a timestamp to merge pages on (F: map-service.ts:67-68)');
  return parsed;
}
const DISTRICT_COUNTERS = ['over_limit_population_unknown', 'affected_population_complete'];
/** The counters the no-population branch omits, and the parser requires (9.9). */
function assertDistrictCounters(body) {
  for (const field of DISTRICT_COUNTERS) assert.ok(Object.hasOwn(body, field), field);
  for (const name of REGULATED) {
    assert.ok(Object.hasOwn(body.by_contaminant[name], 'over_population_unknown'), `${name}.over_population_unknown`);
    assert.ok(Object.hasOwn(body.by_contaminant[name], 'population_over'), `${name}.population_over`);
  }
}

test('fixtures: the geography really places two systems inside NC-08 and one outside', () => {
  assert.deepEqual(POINTS.map((p) => inNc08(p.lat, p.lng)), [true, true, false]);
});

// ------------------------------------------- the transcription rejects things

test('the transcribed parsers reject what the client rejects', () => {
  const water = { layer: 'water', features: [{ pwsid: 'NC1' }], assembled_at: NOW };
  assert.equal(parseMapLayer(water, 'water').water.length, 1);
  assert.throws(() => parseMapLayer(water, 'air'), /invalid_map_response/, 'the layer must be the one asked for');
  assert.throws(() => parseMapLayer({ layer: 'water', features: {} }, 'water'), /invalid_map_response/, 'features must be an array');
  assert.throws(() => parseMapLayer({ layer: 'water' }, 'water'), /invalid_map_response/);
  assert.throws(() => parseMapLayer({ ...water, comparisons: {} }, 'water'), /invalid_map_response/, 'comparisons, when sent, must be an array');
  // Not a throw, but a feature the client drops: the layer is then partial.
  assert.equal(parseMapLayer({ layer: 'water', features: [{ pwsid: 12 }] }, 'water').partial, true, 'a numeric id is not a key');
  assert.equal(parseMapLayer({ layer: 'water', features: [{ pwsid: 'NC1' }, { pwsid: 'NC1' }] }, 'water').partial, true, 'a duplicate is dropped');
  assert.equal(parseMapLayer({ layer: 'water', features: ['NC1'] }, 'water').partial, true, 'a non-object row is dropped');
  assert.equal(parseMapLayer({ layer: 'radon', features: [{ county: 'Union County', zone: 1 }] }, 'radon').radon[0].id, 'Union County', 'radon is keyed by county');
  assert.equal(parseMapLayer({ ...water, next_cursor: 'c2' }, 'water').partial, true, 'a next cursor marks the page partial');
  // A top-level data key replaces the body: the reason D10 forbids one.
  assert.throws(() => parseMapLayer({ ...water, data: { layer: 'air' } }, 'water'), /invalid_map_response/);

  const district = buildDistrictView({ utilities: utilitiesFor('NC9800'), geo: geoMapFor(utilitiesFor('NC9800')) });
  const view = { ...district, assembled_at: NOW };
  assert.equal(parseMapDistrict(view).scope, 'NC-08');
  assert.throws(() => parseMapDistrict({ ...view, scope: 'NC-09' }), /invalid_map_response/);
  assert.throws(() => parseMapDistrict({ ...view, counties: undefined }), /invalid_map_response/);
  assert.throws(() => parseMapDistrict({ ...view, assembled_at: undefined }), /invalid_map_response/, 'no assembled_at');
  assert.throws(() => parseMapDistrict({ ...view, over_limit_population_unknown: undefined }), /invalid_map_response/);
  assert.throws(() => parseMapDistrict({ ...view, systems_tested_any: 1.5 }), /invalid_map_response/, 'counts are integers');
  assert.throws(() => parseMapDistrict({ ...view, systems_over_limit: view.systems_tested_any + 1 }), /invalid_map_response/);
  const without = (name, field) => ({ ...view, by_contaminant: { ...view.by_contaminant, [name]: { ...view.by_contaminant[name], [field]: undefined } } });
  assert.throws(() => parseMapDistrict(without('PFOS', 'over_population_unknown')), /invalid_map_response/);
  assert.throws(() => parseMapDistrict(without('HFPO-DA', 'limit')), /invalid_map_response/);
  assert.throws(() => parseMapDistrict({ ...view, by_contaminant: { ...view.by_contaminant, PFOS: { ...view.by_contaminant.PFOS, over: 5, tested: 1 } } }), /invalid_map_response/);
  assert.equal(parseMapDistrict(without('PFOS', 'population_over')).by_contaminant.PFOS.population_over, null, 'population_over may be null');
  // Contradiction 9.9 itself: the no-population branch of computeDistrict, as a view, is rejected.
  const noPopulation = { ...view, ...computeDistrict(utilitiesFor('NC9800')) };
  assert.equal(Object.hasOwn(noPopulation.by_contaminant.PFOS, 'over_population_unknown'), false);
  assert.throws(() => parseMapDistrict(noPopulation), /invalid_map_response/, 'the 9.9 branch fails the client parser');
});

// ------------------------------------------------- /api/map, all four layers

test('map water, stored layer with populated geography: every feature parses and nothing is partial', async () => {
  const utilities = utilitiesFor('NC9810');
  const payload = waterPayload(utilities, geoMapFor(utilities));
  const h = harness({ layers: [stored('water', payload)] });
  const body = await get(h, '/api/map?layer=water');
  const parsed = assertWaterParses(body);
  assert.equal(body.prebuilt, true);
  assert.deepEqual(parsed.water.map((f) => [f.pwsid, f.lat !== null]), utilities.map((u) => [u.pwsid, true]));
  assert.equal(parsed.water.find((f) => f.pwsid === 'NC98100001').contaminants.PFOS.value_ppt, 7.7);
  noFetches(h);
});

test('map water, live build with the existing empty-geography stub: parses, every system unlocated, nothing partial', async () => {
  const utilities = utilitiesFor('NC9811');
  const stub = arcgisStub(() => json({ features: [] }));
  const h = harness({ utilities, fetch: stub.fetch });
  const body = await get(h, '/api/map?layer=water');
  const parsed = assertWaterParses(body);
  assert.equal(body.prebuilt, false);
  assert.ok(parsed.water.every((f) => f.lat === null && f.lng === null && f.population === null));
  assert.ok(stub.calls.length > 0);
  assert.deepEqual(stub.unexpected, []);
});

test('map water, live build with populated geography: parses with coordinates and population', async () => {
  const utilities = utilitiesFor('NC9812');
  const stub = arcgisStub(() => json(arcgisBody(utilities)));
  const h = harness({ utilities, fetch: stub.fetch });
  const parsed = assertWaterParses(await get(h, '/api/map?layer=water'));
  assert.deepEqual(parsed.water.map((f) => f.population), [34000, null, 480000]);
  assert.ok(parsed.water.every((f) => f.lat !== null && f.lng !== null));
  assert.deepEqual(stub.unexpected, []);
});

test('map water by quarter, and with quarter=latest: both parse, and latest is the unquartered layer', async () => {
  const utilities = utilitiesFor('NC9813');
  const payload = waterPayload(utilities, geoMapFor(utilities));
  const stub = arcgisStub(() => json(arcgisBody(utilities)));
  const h = harness({ layers: [stored('water', payload)], utilities, fetch: stub.fetch });
  const quarter = await get(h, '/api/map?layer=water&quarter=2024Q3');
  const q = assertWaterParses(quarter);
  assert.deepEqual(q.water.map((f) => f.pwsid), ['NC98130001']);
  assert.deepEqual(q.quarters, ['2024Q1', '2024Q2', '2024Q3']);
  const latest = await get(h, '/api/map?layer=water&quarter=latest');
  assertWaterParses(latest);
  assert.deepEqual(latest, { ...payload, prebuilt: true });
  assert.deepEqual(stub.unexpected, []);
});

test('map radon, live build (no provider): every county parses with its zone, nothing partial', async () => {
  const h = harness();
  const body = await get(h, '/api/map?layer=radon');
  const parsed = parseMapLayer(body, 'radon');
  assert.equal(parsed.radon.length, body.features.length);
  assert.ok(parsed.radon.length > 0);
  assert.equal(parsed.partial, false);
  assert.ok(parsed.radon.every((c) => [1, 2, 3].includes(c.zone)), 'every NC county carries its EPA zone');
  assert.deepEqual(parseMapLayer(await get(h, '/api/map?layer=radon&quarter=latest'), 'radon').radon.length, parsed.radon.length);
  noFetches(h);
});

test('map facilities, stored layer from the real ECHO builder: every facility parses, nothing partial', async () => {
  const echoCalls = [];
  const echo = async (url) => {
    echoCalls.push(String(url));
    if (!String(url).startsWith('https://echodata.epa.gov/echo/echo_rest_services.')) throw new TypeError('unexpected host');
    const facilities = [
      { RegistryID: '110000000001', FacName: 'Monroe Test Plant', FacLat: '34.985', FacLong: '-80.549', FacCounty: 'UNION', FacComplianceStatus: 'Significant Violation', NPDESFlag: 'Y', CWAComplianceStatus: 'Violation Identified', FacQtrsWithNC: '6', FacTotalPenalties: '$12,500', FacDateLastInspection: '03/15/2026' },
      { RegistryID: '110000000002', FacName: 'Albemarle Test Works', FacLat: '35.35', FacLong: '-80.2', FacCounty: 'STANLY', FacComplianceStatus: 'No Violation Identified', AIRFlag: 'Y' },
    ];
    const body = String(url).includes('.metadata?')
      ? ECHO_METADATA
      : String(url).includes('.get_facilities?')
        ? { Results: { QueryID: 'q1', QueryRows: '2' } }
        : { Results: { Facilities: facilities } };
    return { ok: true, json: async () => body };
  };
  const payload = await facilitiesPayload({ fetchImpl: echo });
  assert.equal(payload.features.length, 2);
  const h = harness({ layers: [stored('facilities', payload)] });
  const body = await get(h, '/api/map?layer=facilities');
  const parsed = parseMapLayer(body, 'facilities');
  assert.equal(parsed.facilities.length, body.features.length);
  assert.equal(parsed.partial, false);
  assert.deepEqual(parsed.facilities.map((f) => f.compliance_status), ['significant_violation', 'no_violation']);
  assert.equal(parsed.facilities[0].last_inspection, '2026-03-15');
  assert.ok(parsed.sourceNote, 'the selection sentence reaches the client');
  assert.ok(echoCalls.length > 0);
  noFetches(h);
});

test('map air, stored layer from the real AirNow builder: every station parses, and air&quarter=latest is the same layer', async () => {
  const air = async (url) => {
    if (!String(url).startsWith('https://www.airnowapi.org/aq/data/?')) throw new TypeError('unexpected host');
    return {
      ok: true,
      json: async () => [
        { FullAQSCode: '371790003', SiteName: 'Monroe', Latitude: 34.97, Longitude: -80.54, UTC: '2026-10-18T14:00', Parameter: 'PM2.5', AQI: 61, AgencyName: 'North Carolina DAQ' },
        { FullAQSCode: '371790003', SiteName: 'Monroe', Latitude: 34.97, Longitude: -80.54, UTC: '2026-10-18T14:00', Parameter: 'OZONE', AQI: 35, AgencyName: 'North Carolina DAQ' },
        { FullAQSCode: '370250004', SiteName: 'Concord', Latitude: 35.41, Longitude: -80.58, UTC: '2026-10-18T14:00', Parameter: 'OZONE', AQI: 30, AgencyName: 'North Carolina DAQ' },
      ],
    };
  };
  const payload = await airPayload({ fetchImpl: air, apiKey: 'test-key', now: new Date('2026-10-18T15:00:00Z') });
  const h = harness({ layers: [stored('air', payload)] });
  const body = await get(h, '/api/map?layer=air');
  const parsed = parseMapLayer(body, 'air');
  assert.equal(parsed.air.length, body.features.length);
  assert.equal(parsed.air.length, 2);
  assert.equal(parsed.partial, false);
  assert.deepEqual(parsed.air.map((s) => [s.aqi, s.last_reading_at]), [[61, '2026-10-18T14:00:00.000Z'], [30, '2026-10-18T14:00:00.000Z']]);
  assert.deepEqual(parseMapLayer(await get(h, '/api/map?layer=air&quarter=latest'), 'air'), parsed);
  noFetches(h);
});

// ------------------------------------------------------------ /api/district

test('district, stored view from the real builder: parses, with every counter the client requires', async () => {
  const utilities = utilitiesFor('NC9820');
  const view = districtPayload(utilities, geoMapFor(utilities));
  const h = harness({ layers: [stored('district', view)] });
  const body = await get(h, '/api/district');
  assert.equal(body.prebuilt, true);
  assertDistrictCounters(body);
  const parsed = parseMapDistrict(body);
  assert.deepEqual([parsed.total_systems, parsed.systems_tested_any, parsed.systems_over_limit], [2, 2, 2]);
  assert.deepEqual([parsed.affected_population, parsed.affected_population_complete, parsed.over_limit_population_unknown], [34000, false, 1]);
  assert.deepEqual([parsed.by_contaminant.PFOS.over, parsed.by_contaminant.PFOS.population_over], [1, 34000]);
  assert.deepEqual([parsed.by_contaminant['HFPO-DA'].over, parsed.by_contaminant['HFPO-DA'].over_population_unknown], [1, 1]);
  assert.equal(parsed.counties.length, 9);
  assert.equal(parsed.unlocated_systems, 0);
  // Found by this file: the boundary source lines carried U+2014 into every district response.
  assert.equal(body.boundaries.district, 'U.S. Census Bureau TIGERweb: 119th Congressional Districts (layer 4), simplified to ~100 m');
  assert.equal(body.boundaries.counties, 'U.S. Census Bureau TIGERweb: Counties, simplified to ~200 m');
  noFetches(h);
});

test('district, live build with populated geography: parses, and the household county is filled', async () => {
  const utilities = utilitiesFor('NC9821');
  const stub = arcgisStub(() => json(arcgisBody(utilities)));
  const h = harness({ utilities, fetch: stub.fetch });
  const body = await get(h, '/api/district');
  assert.equal(body.prebuilt, false);
  assertDistrictCounters(body);
  const parsed = parseMapDistrict(body);
  assert.deepEqual([parsed.systems_over_limit, parsed.affected_population, parsed.over_limit_population_unknown], [2, 34000, 1]);
  assert.equal(body.household_county.county, 'Union County');
  assert.ok(stub.calls.length > 0);
  assert.deepEqual(stub.unexpected, []);
});

test('district, live build with an empty geography Map: parses, every system unlocated, the counters truthfully zero', async () => {
  const utilities = utilitiesFor('NC9822');
  const stub = arcgisStub(() => json({ features: [] }));
  const h = harness({ utilities, fetch: stub.fetch });
  const body = await get(h, '/api/district');
  assertDistrictCounters(body);
  const parsed = parseMapDistrict(body);
  assert.equal(parsed.unlocated_systems, 3);
  assert.deepEqual([parsed.total_systems, parsed.systems_over_limit, parsed.over_limit_population_unknown], [0, 0, 0]);
  assert.deepEqual(stub.unexpected, []);
});

// ------------------------------------------------------- 9.9 reachability
//
// computeDistrict omits the population counters only when `geo` is not a Map
// (W: lib/district.js:67,107-115). The tests below show that no real producer
// of a district view can hand it anything else, so the branch the client
// rejects is unreachable through /api/district, and lib/district.js is left
// unchanged. If one of them fails, 9.9 has become reachable and the plan's
// fix (truthful counters in that branch) is due.
//
// The four outcomes in LOOKUP_FAILS are a geography outage. Since the outage
// fix, a live district build then answers 503 instead of a district body (see
// "geography outage" below), so for those the 9.9 question is moot: no body at
// all reaches the client parser.

const GEO_OUTCOMES = {
  'ArcGIS answers with service areas': (utilities) => () => json(arcgisBody(utilities)),
  'ArcGIS answers with none': () => () => json({ features: [] }),
  'ArcGIS answers 503': () => () => json({}, 503),
  'ArcGIS answers an error body': () => () => json({ error: { message: 'Invalid query' } }),
  'ArcGIS answers malformed JSON': () => () => new Response('<html>', { status: 200 }),
  'the network fails': () => () => { throw new TypeError('fetch failed'); },
};
const LOOKUP_FAILS = ['ArcGIS answers 503', 'ArcGIS answers an error body', 'ArcGIS answers malformed JSON', 'the network fails'];

let outcomeIndex = 0;
for (const [outcome, answerFor] of Object.entries(GEO_OUTCOMES)) {
  outcomeIndex += 1;
  // A fresh set of systems per outcome, so the geography memory cache never answers for the stub.
  const prefix = `NC97${String(outcomeIndex).padStart(2, '0')}`;
  const fails = LOOKUP_FAILS.includes(outcome);
  if (!fails) {
    test(`9.9 reachability: a live district build when ${outcome} still carries every population counter and parses`, async () => {
      const utilities = utilitiesFor(prefix);
      const stub = arcgisStub(answerFor(utilities));
      const h = harness({ utilities, fetch: stub.fetch });
      const body = await get(h, '/api/district');
      assert.ok(stub.calls.length > 0, 'the outcome was really exercised');
      assert.deepEqual(stub.unexpected, []);
      assertDistrictCounters(body);
      assert.doesNotMatch(body.note, /could not be joined/, 'never the no-population note');
      parseMapDistrict(body);
    });
  } else {
    test(`9.9 reachability: a live district build when ${outcome} is a 503 envelope, never a district body`, async (t) => {
      muteConsoleError(t);
      const utilities = utilitiesFor(prefix);
      const stub = arcgisStub(answerFor(utilities));
      const h = harness({ utilities, fetch: stub.fetch });
      const res = await h.call('/api/district', 'GET', { as: 'alice' });
      assert.ok(stub.calls.length > 0, 'the outcome was really exercised');
      assert.deepEqual(stub.unexpected, []);
      const body = await expectEnvelope(res, { status: 503, code: 'upstream_unavailable', retryable: true });
      assertBare(body);
      assert.equal(Object.hasOwn(body, 'scope'), false, 'no district fields beside the envelope');
    });
  }

  test(`9.9 reachability: getWaterGeo hands the builders a Map when ${outcome}`, async () => {
    const utilities = utilitiesFor(prefix.replace('NC97', 'NC96'));
    const result = await getWaterGeo(utilities.map((u) => u.pwsid), { force: true, store: null, fetchImpl: async (...args) => answerFor(utilities)(...args) });
    assert.ok(result.geo instanceof Map);
    assert.equal(result.complete, !fails, 'and says whether the lookup finished');
  });
}

test('9.9 reachability: getWaterGeo answers from its shared store with a Map, and an empty id list is still a Map', async () => {
  const utilities = utilitiesFor('NC9790');
  const ids = utilities.map((u) => u.pwsid);
  const first = await getWaterGeo(ids, { force: true, store: null, fetchImpl: async () => json(arcgisBody(utilities)) });
  const entries = [...first.geo];
  let saved;
  const store = { get: async () => saved, set: async (_key, value) => { saved = value; } };
  await getWaterGeo(ids, { force: true, store, fetchImpl: async () => json(arcgisBody(utilities)) });
  const shared = await getWaterGeo([...ids].reverse(), { store, now: Date.now() + 25 * 60 * 60 * 1000, fetchImpl: async () => { throw new Error('the store answers'); } });
  assert.equal(shared.source, 'shared');
  assert.ok(shared.geo instanceof Map);
  assert.deepEqual([...shared.geo], entries);
  assert.ok((await getWaterGeo([], { force: true, store: null, fetchImpl: async () => { throw new Error('no ids, no call'); } })).geo instanceof Map);
});

// Named for what it drives: a geography promise that REJECTS. A real ArcGIS
// outage does not take this path (getWaterGeo resolves with an incomplete Map);
// that case is "geography outage: the daily pre-build keeps ..." below.
test('9.9 reachability: the daily pre-build stores a district with every counter, and stores none when the geography promise rejects', async () => {
  const utilities = utilitiesFor('NC9791');
  const db = () => createFakeSupabase({ tables: haloTables('map_layers', 'ucmr5_utilities'), seed: { ucmr5_utilities: utilities } });
  const offline = { fetchImpl: async () => { throw new TypeError('fetch failed'); }, apiKey: 'test-key' };

  const good = db();
  const geo = await getWaterGeo(utilities.map((u) => u.pwsid), { force: true, store: null, fetchImpl: async () => json(arcgisBody(utilities)) });
  const report = await buildAndStoreAll(good, Promise.resolve(geo).then((g) => g.geo), offline);
  assert.equal(report.district.ok, true);
  const view = good.rows('map_layers').find((row) => row.layer === 'district').payload;
  assertDistrictCounters(view);
  parseMapDistrict(view);

  const failed = db();
  const failedReport = await buildAndStoreAll(failed, Promise.reject(new Error('geography refresh failed')), offline);
  assert.equal(failedReport.district.ok, false);
  assert.equal(failed.rows('map_layers').some((row) => row.layer === 'district'), false, 'a failed geography stores no district');
});

test('9.9 reachability: the only producers of a district view are the ones exercised above', async () => {
  // Every call of computeDistrict, buildDistrictView and districtPayload in app/ and lib/.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(m?js|ts|tsx)$/.test(entry.name)) files.push(full);
    }
  };
  await walk(path.join(root, 'app'));
  await walk(path.join(root, 'lib'));
  const sites = [];
  for (const file of files) {
    const lines = (await readFile(file, 'utf8')).split('\n');
    lines.forEach((line) => {
      if (/\b(computeDistrict|buildDistrictView|districtPayload)\(/.test(line) && !/^\s*(\*|\/\/)/.test(line) && !/export function/.test(line)) {
        sites.push(`${path.relative(root, file).replaceAll('\\', '/')}:${line.trim()}`);
      }
    });
  }
  assert.deepEqual(sites.sort(), [
    'lib/districtView.js:const district = computeDistrict(districtUtils, geo);',
    'lib/districtView.js:const state = computeDistrict(utilities, geo);',
    "lib/mapBuild.js:await store('district', districtPayload(utilities, geoMap));",
    'lib/mapBuild.js:return districtPayload(utilities, g.geo);',
    'lib/mapBuild.js:return { ...buildDistrictView({ utilities, geo: geoMap, radonZones: ncRadonZones }), assembled_at: new Date().toISOString() };',
  ].sort());
  // buildAndStoreAll's geography comes from getWaterGeo in the daily job: the
  // whole result, so the pre-build can see whether the lookup finished.
  const cron = await readFile(path.join(root, 'app/api/cron/daily/route.js'), 'utf8');
  assert.match(cron, /buildAndStoreAll\(supabaseAdmin, geoRefresh\)/);
  assert.match(cron, /const geoRefresh = getWaterGeo\(/);
});

// ------------------------------------------------------- geography outage
//
// In an ArcGIS outage getWaterGeo RESOLVES: an empty (or, when only some
// batches fail, a partial) Map, with failedBatches > 0 and complete false.
// An unfinished lookup is not "these systems have no mapped service area", so:
// the daily pre-build keeps the stored water layer and district view, a live
// build is answered but never stored, the water layer says it is incomplete
// (the client's `availability: 'partial'`, F: map-service.ts:31) and why, and
// the district view, which has no field that can say "incomplete"
// (parseMapDistrict reads only integer counts), is a 503 rather than totals the
// lookup could not support.

/** 100 filler systems (Wake County, no readings) so a live build, in batches of 100, needs a second ArcGIS batch. */
const fillers = (prefix) => Array.from({ length: 100 }, (_, i) => ({ pwsid: `${prefix}${String(i).padStart(4, '0')}`, pws_name: `Filler ${i}`, status: 'Final', contaminants: {} }));
const NAMED = ['Monroe Test Water', 'Albemarle Test Water', 'Raleigh Test Water'];
const pointFor = (u) => POINTS[NAMED.indexOf(u.pws_name)] ?? POINTS[2];
/** The ids one ArcGIS request asked for (its where clause). */
const askedIds = (href) => [...new URL(href).searchParams.get('where').matchAll(/'([A-Z0-9]+)'/g)].map((m) => m[1]);
/** The ArcGIS answer for just the systems a batch asked for, as the real service gives. */
function asked(utilities, href) {
  const ids = askedIds(href);
  return json({
    features: utilities
      .filter((u) => ids.includes(u.pwsid))
      .map((u) => {
        const p = pointFor(u);
        return { attributes: { PWSID: u.pwsid, ...(p.population === null ? {} : { Population_Served_Count: p.population }) }, centroid: { x: p.lng, y: p.lat } };
      }),
  });
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** ECHO and AirNow, answered, so the other layers can store during a geography outage. */
async function sources(url) {
  const href = String(url);
  if (href.startsWith('https://echodata.epa.gov/echo/echo_rest_services.')) {
    const facilities = [{ RegistryID: '110000000001', FacName: 'Monroe Test Plant', FacLat: '34.985', FacLong: '-80.549', FacCounty: 'UNION', FacComplianceStatus: 'No Violation Identified', NPDESFlag: 'Y' }];
    const body = href.includes('.metadata?')
      ? ECHO_METADATA
      : href.includes('.get_facilities?')
        ? { Results: { QueryID: 'q1', QueryRows: '1' } }
        : { Results: { Facilities: facilities } };
    return { ok: true, json: async () => body };
  }
  if (href.startsWith('https://www.airnowapi.org/aq/data/?')) {
    return { ok: true, json: async () => [{ FullAQSCode: '371790003', SiteName: 'Monroe', Latitude: 34.97, Longitude: -80.54, UTC: '2026-10-18T14:00', Parameter: 'PM2.5', AQI: 61, AgencyName: 'North Carolina DAQ' }] };
  }
  throw new TypeError('unexpected host');
}
const SOURCES = { fetchImpl: sources, apiKey: 'test-key', now: new Date('2026-10-18T15:00:00Z') };

/** Each outage answers a batch itself, or null to let ArcGIS answer it normally. */
const CRON_OUTAGES = {
  'every batch fails': { batchSize: 100, fetchImpl: async () => json({}, 503) },
  'one batch of three fails': {
    batchSize: 1,
    fetchImpl: async (url) => (askedIds(String(url)).some((id) => id.endsWith('0003')) ? json({}, 503) : null),
  },
};

for (const [label, outage] of Object.entries(CRON_OUTAGES)) {
  test(`geography outage: the daily pre-build keeps yesterday's water and district rows byte for byte when ${label}, and still stores the other layers`, async (t) => {
    const utilities = utilitiesFor(label === 'every batch fails' ? 'NC9300' : 'NC9301');
    const ids = utilities.map((u) => u.pwsid);
    const db = createFakeSupabase({ tables: haloTables('map_layers', 'ucmr5_utilities'), seed: { ucmr5_utilities: utilities } });
    const rowOf = (layer) => db.rows('map_layers').find((row) => row.layer === layer);

    // Day 1: a good lookup, passed exactly as the daily job passes it.
    const day1 = await buildAndStoreAll(db, getWaterGeo(ids, { force: true, store: null, fetchImpl: async (url) => asked(utilities, String(url)) }), SOURCES);
    assert.deepEqual(Object.values(day1).map((r) => r.ok), [true, true, true, true, true]);
    const district1 = rowOf('district');
    assert.deepEqual([district1.payload.total_systems, district1.payload.systems_over_limit, district1.payload.affected_population], [2, 2, 34000]);
    const kept = { water: JSON.stringify(rowOf('water')), district: JSON.stringify(district1) };
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
    assert.equal(day2.water.ok, false);
    assert.equal(day2.district.ok, false);
    for (const layer of ['radon', 'facilities', 'air']) {
      assert.equal(day2[layer].ok, true, `${layer} still stores`);
      assert.ok(rowOf(layer).assembled_at > before[layer], `${layer} is today's copy`);
    }
    assert.equal(logged.mock.callCount(), 1, 'one log line');
    const line = loggedText(logged);
    assert.match(line, /geography lookup was incomplete/);
    assert.ok(ids.every((id) => !line.includes(id)), 'no system ids in the log line');
    assertBare(day2);
  });
}

test('geography outage: the daily pre-build with nothing stored yet stores no water or district at all', async (t) => {
  muteConsoleError(t);
  const utilities = utilitiesFor('NC9302');
  const db = createFakeSupabase({ tables: haloTables('map_layers', 'ucmr5_utilities'), seed: { ucmr5_utilities: utilities } });
  const lookup = getWaterGeo(utilities.map((u) => u.pwsid), { force: true, store: null, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  const report = await buildAndStoreAll(db, lookup, SOURCES);
  assert.deepEqual([report.water.ok, report.district.ok, report.radon.ok], [false, false, true]);
  assert.deepEqual(db.rows('map_layers').map((row) => row.layer).sort(), ['air', 'facilities', 'radon']);
});

// The tests above hand buildAndStoreAll the lookup themselves. This one runs the
// REAL daily job end to end, so it fails if the job ever stops passing the whole
// getWaterGeo result (a bare Map would read as a complete lookup), however the
// call is written. Only the source-text pin in the scan test guarded that before.
test('geography outage: the real daily job, with ArcGIS down, keeps the seeded water and district rows byte for byte', async (t) => {
  quiet(t);
  const SECRET = 'cron-secret-for-tests';
  // Every provider, ArcGIS included, is unanswered and gets a 503.
  const ctx = setup({ env: { CRON_SECRET: SECRET } });
  const rowOf = (layer) => JSON.stringify(ctx.h.db.rows('map_layers').find((row) => row.layer === layer));
  const before = { water: rowOf('water'), district: rowOf('district') };
  assert.ok(before.water && before.district, 'both rows are seeded');

  const res = await ctx.h.call('/api/cron/daily', 'GET', { headers: { authorization: `Bearer ${SECRET}` } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(ctx.outbound.some((entry) => entry.url.startsWith(ARCGIS_WATER_BOUNDARIES)), 'the outage was really exercised');
  assert.equal(body.water_geo.complete, false);
  assert.deepEqual(body.map_layers.water, { ok: false, error: 'geography_incomplete' });
  assert.deepEqual(body.map_layers.district, { ok: false, error: 'geography_incomplete' });
  assert.equal(body.map_layers.radon.ok, true, 'the other layers still run');
  assert.equal(rowOf('water'), before.water, 'the stored water layer is untouched');
  assert.equal(rowOf('district'), before.district, 'the stored district view is untouched');
});

/** Live outages: every failed outcome above, and a partial one (the second of two batches fails). */
const LIVE_OUTAGES = {
  ...Object.fromEntries(LOOKUP_FAILS.map((outcome) => [outcome, { utilities: (p) => utilitiesFor(p), answer: (u) => GEO_OUTCOMES[outcome](u) }])),
  // The ids sort fillers first: batch one (100 fillers) is answered and placed,
  // batch two (the three named systems) fails.
  'the second of two batches fails': {
    utilities: (p) => [...fillers(`${p}0`), ...utilitiesFor(`${p}9`)],
    answer: (u) => (href) => (askedIds(href).includes(u.at(-1).pwsid) ? json({}, 503) : asked(u, href)),
  },
};

let liveIndex = 0;
for (const [outcome, live] of Object.entries(LIVE_OUTAGES)) {
  liveIndex += 1;
  const prefix = `NC94${String(liveIndex).padStart(2, '0')}`;

  test(`geography outage, live: when ${outcome}, the water layer parses as incomplete, says why, and is stored nowhere`, async (t) => {
    muteConsoleError(t);
    const utilities = live.utilities(prefix);
    const stub = arcgisStub(live.answer(utilities));
    const h = harness({ utilities, fetch: stub.fetch });
    for (const url of ['/api/map?layer=water', '/api/map?layer=water&quarter=2024Q3']) {
      const body = await get(h, url);
      const parsed = parseMapLayer(body, 'water');
      assert.equal(parsed.water.length, body.features.length, 'every feature still parses');
      assert.equal(parsed.partial, true, `${url}: the client is told the layer is incomplete`);
      assert.equal(body.geography_complete, false);
      assert.ok(body.located < body.count, 'some systems really are missing their location');
      assert.doesNotMatch(body.note, /no mapped service area/, 'never the false cause');
      // The exact words: in a partial outage some unlocated systems were in a
      // batch that finished, so the note must not blame the lookup for all of them.
      assert.equal(
        body.note,
        `The service-area lookup did not complete. ${body.count - body.located} of ${body.count} systems are shown without coordinates and carry severity; some or all of them may have a service area the lookup could not return.`,
      );
      assert.doesNotMatch(body.note, /\u2014/, 'no em dash in app-facing copy');
    }
    assert.equal(stub.calls.length > 0, true);
    assert.deepEqual(stub.unexpected, []);
    await settle();
    assert.deepEqual(h.db.rows('map_layers'), [], 'an incomplete live build is never stored');
  });

  test(`geography outage, live: when ${outcome}, the district is a 503 envelope and nothing is stored`, async (t) => {
    const logged = muteConsoleError(t);
    const utilities = live.utilities(prefix.replace('NC94', 'NC95'));
    const stub = arcgisStub(live.answer(utilities));
    const h = harness({ utilities, fetch: stub.fetch });
    const res = await h.call('/api/district', 'GET', { as: 'alice' });
    const body = await expectEnvelope(res, { status: 503, code: 'upstream_unavailable', retryable: true });
    assertBare(body);
    assert.equal(body.error, 'The district view needs the water service areas, which could not be looked up right now. Try again shortly.');
    assert.ok(loggedText(logged).includes(body.request_id));
    assert.deepEqual(stub.unexpected, []);
    await settle();
    assert.deepEqual(h.db.rows('map_layers'), [], 'nothing stored');
  });
}

test('geography healthy, live: a finished lookup is stored as before, including one that finds no service areas', async () => {
  for (const [prefix, answer, note] of [
    ['NC9310', (u) => () => json(arcgisBody(u)), /^Every system has a service-area centroid/],
    ['NC9311', () => () => json({ features: [] }), /3 of 3 systems have no mapped service area/],
  ]) {
    const utilities = utilitiesFor(prefix);
    const h = harness({ utilities, fetch: arcgisStub(answer(utilities)).fetch });
    const water = await get(h, '/api/map?layer=water');
    assertWaterParses(water);
    assert.match(water.note, note);
    assert.equal(Object.hasOwn(water, 'geography_complete'), false, 'a healthy body is unchanged');
    assert.equal(Object.hasOwn(water, 'meta'), false);
    const district = await get(h, '/api/district');
    parseMapDistrict(district);
    await settle();
    assert.deepEqual(h.db.rows('map_layers').map((row) => row.layer).sort(), ['district', 'water'], 'both are stored');
  }
});
