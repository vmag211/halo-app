/**
 * B05 Task 6: the public, cache-only read for the map routes (BE-047, AC-148;
 * lib/publicAccess.js). Vibhav approved it on 2026-10-19 and set the numbers:
 * 60 requests a minute per visitor, keyed by a digest of the forwarded client
 * address; a 10-minute shared-cache lifetime on anonymous answers; the limiter
 * fails open.
 *
 * What is proved, against the REAL handlers on the isolated harness:
 *
 *   - who is anonymous: no Authorization header at all. Every Authorization
 *     header, empty, malformed or unknown, is `requireUser` exactly as before
 *     (a 401, never downgraded), and an auth outage stays the auth outage;
 *   - what an anonymous read may do: answer from what is stored (map_layers,
 *     the UCMR 5 table, a warm geography cache) and nothing else. No outbound
 *     call, ever; no live build; no store; no household table. With nothing
 *     stored it is a 503 in the contract's terms. District reads no profiles
 *     row and carries no household_county;
 *   - the cache headers: a public shared-cache lifetime only on a successful
 *     anonymous answer, `private, no-store` on everything else;
 *   - the limiter: a 429 with Retry-After before anything is read, keyed by a
 *     digest that never contains the address, never consulted for a signed-in
 *     read, and failing open;
 *   - the client: the frontend's own credential-free runtime
 *     (lib/frontend/production/runtime.ts, as components/production/
 *     PublicFrontend.tsx builds it for /map) over these handlers, with the
 *     client's parsers (test/helpers/frontendB05.mjs) on every answer.
 *
 * No network: the harness's fetch rejects and records every call, or, where a
 * test says so, answers the ArcGIS boundary service only and counts the calls.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRouteHarness, muteConsoleError, LIMITER_UNAVAILABLE } from './helpers/routeHarness.mjs';
import { expectEnvelope, loggedText } from './helpers/envelope.mjs';
import { haloTables } from './helpers/tables.mjs';
import { loadFrontend } from './frontend-test-loader.mjs';
import { parseMapComparisons, parseMapDistrict, parseMapLayer } from './helpers/frontendB05.mjs';
import { airPayload, districtPayload, facilitiesPayload, radonPayload, waterPayload } from '../lib/mapBuild.js';
import { ARCGIS_WATER_BOUNDARIES, _resetWaterGeoCache } from '../lib/waterGeo.js';

// After the harness has registered its module hooks (lib/operations.js, under
// lib/recovery.js, imports through the @/ alias).
const { PRIVATE_CACHE_CONTROL, PUBLIC_CACHE_CONTROL } = await import('@/lib/publicAccess');
const { hashToken } = await import('@/lib/account');
const { createProductionRuntime } = await loadFrontend('production/runtime');

// ------------------------------------------------------------------- fixtures

const reading = (date, ppt) => [{ date, value_ppt: ppt }];
const utilitiesFor = (prefix) => [
  { pwsid: `${prefix}01`, pws_name: 'Public Test Water A', status: 'Final', contaminants: { PFOS: reading('8/20/2024', 7.7), PFOA: reading('8/20/2024', 1.2) } },
  { pwsid: `${prefix}02`, pws_name: 'Public Test Water B', status: 'Final', contaminants: { PFOA: reading('3/15/2024', 2.1) } },
];
const POINT = { lat: 34.985, lng: -80.549, population: 34000 }; // Union County, in NC-08
const geoFor = (utilities) => new Map(utilities.map((u) => [u.pwsid, POINT]));
const AIRNOW = [
  { FullAQSCode: '370000011', SiteName: 'Public Station A', Latitude: 34.97, Longitude: -80.54, UTC: '2026-10-18T10:00', Parameter: 'PM2.5', AQI: 61, AgencyName: 'Example Agency' },
  { FullAQSCode: '370000012', SiteName: 'Public Station B', Latitude: 35.41, Longitude: -80.58, UTC: '2026-10-18T10:00', Parameter: 'PM2.5', AQI: 44, AgencyName: 'Example Agency' },
];
const ECHO = async (url) => {
  const facilities = [{ RegistryID: '110000000011', FacName: 'Example Plant', FacLat: '34.985', FacLong: '-80.549', FacCounty: 'UNION', FacComplianceStatus: 'No Violation Identified', NPDESFlag: 'Y' }];
  return { ok: true, json: async () => (String(url).includes('.get_facilities?') ? { Results: { QueryID: 'q1', QueryRows: '1' } } : { Results: { Facilities: facilities } }) };
};
const stored = (layer, payload) => ({ layer, assembled_at: new Date().toISOString(), payload });
/** Every layer and the district view, stored, built by the real payload builders with injected sources. */
async function storedLayers(utilities) {
  const air = await airPayload({ fetchImpl: async () => ({ ok: true, json: async () => AIRNOW }), apiKey: 'test-key', now: new Date('2026-10-18T11:00:00Z') });
  return [
    stored('water', waterPayload(utilities, geoFor(utilities))),
    stored('district', districtPayload(utilities, geoFor(utilities))),
    stored('radon', radonPayload()),
    stored('air', air),
    stored('facilities', await facilitiesPayload({ fetchImpl: ECHO })),
  ];
}

/** Answers the ArcGIS boundary service only, and counts every call. */
function arcgisFor(utilities) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(String(url));
    if (!String(url).startsWith(`${ARCGIS_WATER_BOUNDARIES}?`)) throw new TypeError('unexpected host');
    return new Response(JSON.stringify({
      features: utilities.map((u) => ({ attributes: { PWSID: u.pwsid, Population_Served_Count: POINT.population }, centroid: { x: POINT.lng, y: POINT.lat } })),
    }));
  };
  return { fetch, calls };
}

const TABLES = haloTables('profiles', 'map_layers', 'ucmr5_utilities');
function harness({ tables = TABLES, layers = [], utilities = utilitiesFor('NC06000'), fetch, rateLimit } = {}) {
  return createRouteHarness({
    tables,
    ...(fetch ? { fetch } : {}),
    ...(rateLimit ? { rateLimit } : {}),
    seed: ({ alice, bob }) => Object.fromEntries(Object.entries({
      profiles: [{ id: alice.id, county: 'Union County' }, { id: bob.id, county: 'Wake County' }],
      map_layers: layers,
      ucmr5_utilities: utilities,
    }).filter(([table]) => table in tables)),
  });
}
/** One GET. `as: null` (the default) sends no Authorization header: the public read. */
const get = (h, url, { as = null, headers = {} } = {}) => h.call(url.split('?')[0], 'GET', { as, url, headers });
const tablesRead = (h) => [...new Set(h.db.queryLog.map((q) => q.table))].sort();
const settle = () => new Promise((resolve) => setImmediate(resolve));
const ids = (list) => `ids=${encodeURIComponent(JSON.stringify(list))}`;

function assertPublic(res, label) {
  assert.equal(res.headers.get('cache-control'), PUBLIC_CACHE_CONTROL, `${label}: a 10-minute shared-cache lifetime`);
  assert.equal(res.headers.get('vary'), 'Authorization', label);
}
function assertPrivate(res, label) {
  assert.equal(res.headers.get('cache-control'), PRIVATE_CACHE_CONTROL, `${label}: never kept by a shared cache`);
  assert.equal(res.headers.get('vary'), 'Authorization', label);
}

const LAYERS = ['water', 'radon', 'facilities', 'air'];
const ROUTES = ['/api/map?layer=water', '/api/district', `/api/map/comparison?layer=water&quarter=latest&${ids(['NC0600001'])}`];

// --------------------------------------------------------- the numbers

test('the numbers are Vibhav\'s: 60 a minute, a 600-second shared lifetime and no browser lifetime', async () => {
  const source = await readFile(new URL('../lib/ratelimit.js', import.meta.url), 'utf8');
  assert.match(source, /export const publicMapLimiter = new Ratelimit\(\{\s*redis: redis,\s*limiter: Ratelimit\.slidingWindow\(60, '1 m'\),/);
  assert.equal(PUBLIC_CACHE_CONTROL, 'public, max-age=0, s-maxage=600');
  assert.equal(PRIVATE_CACHE_CONTROL, 'private, no-store');
});

// --------------------------------------------------------- /api/map

test('anonymous map: every stored layer is the signed-in body, read from map_layers alone with no fetch, shared-cacheable for 10 minutes; the signed-in answer stays private', async () => {
  const utilities = utilitiesFor('NC06100');
  const layers = await storedLayers(utilities);
  for (const layer of LAYERS) {
    for (const query of [`?layer=${layer}`, `?layer=${layer}&quarter=latest`]) {
      const visitor = harness({ utilities, layers });
      const anonymous = await get(visitor, `/api/map${query}`);
      assert.equal(anonymous.status, 200, query);
      assertPublic(anonymous, `anonymous ${query}`);
      const body = await anonymous.json();
      assert.equal(body.prebuilt, true);
      assert.deepEqual(tablesRead(visitor), ['map_layers'], `${query}: the layer store alone`);
      assert.deepEqual(visitor.blockedFetches, [], `${query}: no outbound call`);

      const owner = harness({ utilities, layers });
      const signedIn = await get(owner, `/api/map${query}`, { as: 'alice' });
      assertPrivate(signedIn, `signed in ${query}`);
      assert.deepEqual(body, await signedIn.json(), `${query}: the visitor sees exactly the signed-in body`);
    }
  }
});

test('anonymous map: with nothing stored every layer is a 503 that names the layer, and nothing is built, stored or fetched', async (t) => {
  muteConsoleError(t);
  for (const layer of LAYERS) {
    const h = harness();
    const res = await get(h, `/api/map?layer=${layer}`, { headers: { 'x-request-id': 'public-map-0001' } });
    const body = await expectEnvelope(res, { status: 503, code: 'upstream_unavailable', retryable: true, extraKeys: ['layer'], requestId: 'public-map-0001' });
    assert.equal(body.layer, layer);
    assert.equal(body.error, `The ${layer} layer is not available to view right now. Try again shortly.`);
    assert.equal(res.headers.get('retry-after'), null);
    assertPrivate(res, `anonymous ${layer} 503`);
    await settle();
    assert.deepEqual(h.db.rows('map_layers'), [], `${layer}: an anonymous request stores nothing`);
    assert.deepEqual(h.blockedFetches, [], `${layer}: and calls no provider`);
    assert.deepEqual(tablesRead(h), ['map_layers']);
  }
  // The contrast: a signed-in caller still gets the live build, and it is stored.
  const owner = harness();
  const radon = await get(owner, '/api/map?layer=radon', { as: 'alice' });
  assert.deepEqual([radon.status, (await radon.json()).prebuilt], [200, false]);
  await settle();
  assert.deepEqual(owner.db.rows('map_layers').map((row) => row.layer), ['radon']);
});

test('anonymous water quarter: a cold geography cache is a 503 with no ArcGIS call; once warm the visitor gets the signed-in answer, complete, still with no call (N3)', async () => {
  _resetWaterGeoCache();
  const utilities = utilitiesFor('NC06200');
  const arcgis = arcgisFor(utilities);
  const h = harness({ utilities, fetch: arcgis.fetch });

  const cold = await get(h, '/api/map?layer=water&quarter=2024Q3');
  const refused = await expectEnvelope(cold, { status: 503, code: 'upstream_unavailable', extraKeys: ['layer'] });
  assert.equal(refused.layer, 'water');
  assertPrivate(cold, 'cold anonymous quarter');
  assert.deepEqual(arcgis.calls, [], 'a cache-only miss never reaches ArcGIS');

  // A signed-in request (or the daily job) warms the cache.
  const signedIn = await get(h, '/api/map?layer=water&quarter=2024Q3', { as: 'alice' });
  assert.equal(signedIn.status, 200);
  assert.equal(arcgis.calls.length, 1);
  const { assembled_at: atA, ...owner } = await signedIn.json();

  const warm = await get(h, '/api/map?layer=water&quarter=2024Q3');
  assert.equal(warm.status, 200);
  assertPublic(warm, 'warm anonymous quarter');
  const { assembled_at: atB, ...visitor } = await warm.json();
  assert.ok(atA && atB);
  assert.deepEqual(visitor, owner, 'the same answer the signed-in caller got');
  assert.equal(arcgis.calls.length, 1, 'the visitor caused no lookup');
  assert.deepEqual([visitor.located, 'geography_complete' in visitor, 'meta' in visitor], [1, false, false], 'complete, so not marked partial');
  assert.equal(parseMapLayer(visitor, 'water', true).partial, false);

  // A warm cache for some other set of systems is a miss, never a partial answer.
  const other = harness({ utilities: utilitiesFor('NC06201'), fetch: arcgis.fetch });
  await expectEnvelope(await get(other, '/api/map?layer=water&quarter=2024Q3'), { status: 503, code: 'upstream_unavailable', extraKeys: ['layer'] });
  assert.equal(arcgis.calls.length, 1);
});

// --------------------------------------------------------- /api/district

test('anonymous district: the stored view with no household_county and no county_rankings, from map_layers alone, without the profiles table even existing', async (t) => {
  muteConsoleError(t);
  const utilities = utilitiesFor('NC06300');
  const layers = await storedLayers(utilities);
  const h = harness({ utilities, layers });
  const res = await get(h, '/api/district');
  assert.equal(res.status, 200);
  assertPublic(res, 'anonymous district');
  const body = await res.json();
  assert.equal('household_county' in body, false, 'no household, so no key at all (null would say "not ranked")');
  assert.equal('county_rankings' in body, false, 'the statewide ranking stays server side');
  assert.equal(body.prebuilt, true);
  assert.equal(parseMapDistrict(body).scope, 'NC-08');
  assert.deepEqual(tablesRead(h), ['map_layers'], 'no profiles row is read');
  assert.deepEqual(h.blockedFetches, []);

  const signedIn = await get(h, '/api/district', { as: 'alice' });
  assertPrivate(signedIn, 'signed-in district');
  const { household_county: own, ...shared } = await signedIn.json();
  assert.equal(own.county, 'Union County');
  assert.deepEqual(body, shared, 'the visitor gets the shared view the household gets, minus its own county');

  // With no profiles table at all the visitor is still answered; a household is not.
  const noProfiles = harness({ utilities, layers, tables: haloTables('map_layers', 'ucmr5_utilities') });
  assert.equal((await get(noProfiles, '/api/district')).status, 200);
  assert.equal((await get(noProfiles, '/api/district', { as: 'alice' })).status, 500);
});

test('anonymous district: with no stored view it is a 503, reads no profile, builds nothing, stores nothing and fetches nothing', async (t) => {
  muteConsoleError(t);
  _resetWaterGeoCache();
  const h = harness({ utilities: utilitiesFor('NC06400') });
  const res = await get(h, '/api/district', { headers: { 'x-request-id': 'public-map-0002' } });
  const body = await expectEnvelope(res, { status: 503, code: 'upstream_unavailable', retryable: true, requestId: 'public-map-0002' });
  assert.equal(body.error, 'The district view is not available to view right now. Try again shortly.');
  assertPrivate(res, 'anonymous district 503');
  await settle();
  assert.deepEqual(tablesRead(h), ['map_layers']);
  assert.deepEqual(h.blockedFetches, []);
  assert.deepEqual(h.db.rows('map_layers'), []);
  // The contrast: a signed-in caller tries the live build (and here the lookup is refused).
  await get(h, '/api/district', { as: 'alice' });
  assert.ok(h.blockedFetches.some((url) => String(url).startsWith(ARCGIS_WATER_BOUNDARIES)), 'the signed-in path really would build');
  assert.ok(tablesRead(h).includes('profiles'));
});

// --------------------------------------------------------- /api/map/comparison

test('anonymous comparison: the signed-in records, shared-cacheable; air with nothing stored is a 503 that is not', async () => {
  const utilities = utilitiesFor('NC06500');
  const h = harness({ utilities, layers: await storedLayers(utilities) });
  for (const [layer, list] of [['water', utilities.map((u) => u.pwsid)], ['air', AIRNOW.map((s) => s.FullAQSCode)], ['radon', ['Union County']]]) {
    const url = `/api/map/comparison?layer=${layer}&quarter=latest&${ids(list)}`;
    const anonymous = await get(h, url);
    assert.equal(anonymous.status, 200, layer);
    assertPublic(anonymous, `anonymous ${layer} comparison`);
    const body = await anonymous.json();
    assert.deepEqual(body, await (await get(h, url, { as: 'alice' })).json(), `${layer}: the same records`);
    if (layer !== 'radon') assert.equal(parseMapComparisons(body.records, list).length, list.length);
  }
  // Water with no stored layer answers from the UCMR 5 table, as signed in, with no geography lookup.
  const table = harness({ utilities });
  const water = await get(table, `/api/map/comparison?layer=water&quarter=2024Q3&${ids(utilities.map((u) => u.pwsid))}`);
  assert.equal(water.status, 200);
  assert.deepEqual(tablesRead(table), ['ucmr5_utilities']);

  const air = await get(harness(), `/api/map/comparison?layer=air&quarter=latest&${ids(['370000011'])}`);
  await expectEnvelope(air, { status: 503, code: 'upstream_unavailable' });
  assertPrivate(air, 'anonymous air comparison 503');
  for (const each of [h, table]) assert.deepEqual(each.blockedFetches, []);
});

// --------------------------------------------------------- who is anonymous

test('any Authorization header is checked exactly as before: empty, malformed or unknown is a 401 on all three routes, reads nothing, is private and never counts as a visitor', async () => {
  const keys = [];
  const h = harness({ layers: await storedLayers(utilitiesFor('NC06600')), rateLimit: (key) => { keys.push(key); return true; } });
  for (const route of ROUTES) {
    for (const [authorization, error] of [
      ['', 'Sign-in required.'], ['Basic dXNlcjpwYXNz', 'Sign-in required.'], ['Bearer', 'Sign-in required.'], ['bearer   ', 'Sign-in required.'],
      ['Bearer test-token:nobody', 'Your session has expired. Please reload the app.'], [`Bearer ${h.identities.alice.token}x`, 'Your session has expired. Please reload the app.'],
    ]) {
      const res = await get(h, route, { headers: { authorization } });
      const body = await expectEnvelope(res, { status: 401, code: 'auth_required', retryable: false });
      assert.equal(body.error, error, `${route} with ${JSON.stringify(authorization)}`);
      assertPrivate(res, `${route} 401`);
    }
  }
  assert.deepEqual(h.db.queryLog, [], 'a refused header is answered before any table is read');
  assert.deepEqual(keys, [], 'the visitor limiter is never consulted for a request that carries a header');
});

test('an auth outage behind a real bearer stays the retryable auth outage, never an anonymous answer', async () => {
  for (const route of ROUTES) {
    const h = harness({ layers: await storedLayers(utilitiesFor('NC06700')) });
    h.forceAuthOutage();
    const res = await get(h, route, { as: 'alice' });
    await expectEnvelope(res, { status: 503, code: 'auth_unavailable', retryable: true });
    assert.equal(res.headers.get('retry-after'), '2');
    assertPrivate(res, `${route} auth outage`);
  }
});

// --------------------------------------------------------- the limiter

test('the visitor limiter: a 429 with Retry-After 60 before anything is read, on all three routes, keyed by a digest that never holds the address', async () => {
  const keys = [];
  const h = harness({
    layers: await storedLayers(utilitiesFor('NC06800')),
    rateLimit: (key) => { keys.push(key); return !key.startsWith('public-map:client:'); },
  });
  for (const route of ROUTES) {
    const res = await get(h, route, { headers: { 'x-forwarded-for': '198.51.100.9, 203.0.113.7', 'x-request-id': 'public-map-0003' } });
    const body = await expectEnvelope(res, { status: 429, code: 'rate_limited', retryable: true, requestId: 'public-map-0003' });
    assert.equal(body.error, 'Too many map requests from this device. Please wait a minute and try again.');
    assert.equal(res.headers.get('retry-after'), '60');
    assertPrivate(res, `${route} 429`);
  }
  assert.deepEqual(h.db.queryLog, [], 'shed before anything is read');
  // The nearest hop of the forwarded chain, hashed, as the public recovery routes key a client.
  assert.deepEqual(keys, ROUTES.map(() => `public-map:client:${hashToken('203.0.113.7')}`));
  assert.ok(keys.every((key) => !key.includes('203.0.113') && !key.includes('198.51.100')));

  // A signed-in read is not counted, as before: the same denying limiter answers it.
  const before = keys.length;
  for (const route of ROUTES) assert.equal((await get(h, route, { as: 'alice', headers: { 'x-forwarded-for': '203.0.113.7' } })).status, 200, route);
  assert.equal(keys.length, before, 'no visitor key for a signed-in read');
});

test('the visitor limiter counts per visitor across the three routes: one address is refused on its 61st request while another is still answered', async () => {
  const counts = new Map();
  const counting = (key) => {
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts.get(key) <= 60;
  };
  const h = harness({ layers: await storedLayers(utilitiesFor('NC06900')), rateLimit: counting });
  const one = { 'x-vercel-forwarded-for': '203.0.113.20' };
  for (let n = 0; n < 60; n += 1) assert.equal((await get(h, ROUTES[n % ROUTES.length], { headers: one })).status, 200, `request ${n + 1}`);
  assert.equal((await get(h, ROUTES[0], { headers: one })).status, 429, 'the 61st');
  assert.equal((await get(h, ROUTES[1], { headers: { 'x-vercel-forwarded-for': '203.0.113.21' } })).status, 200, 'another visitor');
});

test('the visitor limiter fails open: during a limiter outage the visitor is answered, and the log says so', async (t) => {
  const logged = muteConsoleError(t);
  const h = harness({ layers: await storedLayers(utilitiesFor('NC07000')), rateLimit: () => LIMITER_UNAVAILABLE });
  for (const route of ROUTES) {
    const res = await get(h, route);
    assert.equal(res.status, 200, route);
    assertPublic(res, `${route} during a limiter outage`);
  }
  assert.match(loggedText(logged), /public map limiter unavailable .*; allowing the call\./);
});

// --------------------------------------------------------- the client

/** Routes the frontend runtime's fetch to the real handlers, recording the headers it sent. */
function bridge(h) {
  const sent = [];
  const fetcher = async (path, init) => {
    sent.push({ path, headers: { ...init.headers } });
    return h.call(new URL(path, 'http://halo.test').pathname, init.method, { url: path, headers: init.headers });
  };
  return { fetcher, sent };
}
/** The runtime PublicFrontend.tsx builds for /map: no identity, publicAccess, no credential. */
function publicRuntime(fetcher) {
  let credentials = 0;
  const runtime = createProductionRuntime({ identityId: null, homeContextId: null, publicAccess: true, credential: async () => { credentials += 1; return null; }, fetcher });
  return { runtime, credentials: () => credentials };
}

test('the public /map runtime over the real handlers: layer, district and comparison all render from the visitor\'s requests, with no credential sent', async () => {
  const utilities = utilitiesFor('NC07100');
  const h = harness({ utilities, layers: await storedLayers(utilities) });
  const { fetcher, sent } = bridge(h);
  const { runtime, credentials } = publicRuntime(fetcher);
  const { parseMapLayer: realParseMapLayer, parseMapDistrict: realParseMapDistrict } = await loadFrontend('map-service');

  // As MapPreview.tsx:119 asks for a layer, and parses it in public mode.
  for (const layer of LAYERS) {
    const value = await runtime.request('map.layer', { layer });
    const snapshot = parseMapLayer(value, layer, true);
    assert.deepEqual(realParseMapLayer(value, layer, true), snapshot, `${layer}: the shipped parser agrees with the transcription`);
    assert.equal(snapshot.partial, false, layer);
    assert.ok(snapshot[layer].length > 0, `${layer}: there is something to draw`);
    assert.equal(snapshot.ownHome, null);
  }
  // As LiveDistrictPanel.tsx:10 asks for the district.
  const district = await runtime.request('map.district', { scope: 'NC-08' });
  assert.equal(parseMapDistrict(district).scope, 'NC-08');
  assert.equal(realParseMapDistrict(district).total_systems, parseMapDistrict(district).total_systems);
  // As LiveMapComparison.tsx:15 asks for the comparison of the visible ids.
  const water = utilities.map((u) => u.pwsid);
  const compared = await runtime.request('map.comparison', { layer: 'water', quarter: 'latest', ids: water });
  assert.deepEqual(parseMapComparisons(compared.records, water).map((r) => r.id).sort(), [...water].sort());

  assert.equal(credentials(), 0, 'the public runtime never asks for a credential');
  assert.ok(sent.length === LAYERS.length + 2);
  for (const { path, headers } of sent) {
    assert.equal(Object.keys(headers).some((name) => name.toLowerCase() === 'authorization'), false, `${path}: no Authorization header`);
    assert.equal('X-Halo-Home-Context' in headers, false);
  }
  assert.deepEqual(h.blockedFetches, []);
});

test('the public /map runtime with nothing stored: each surface gets the honest unavailable state, and a limited visitor is told to wait', async (t) => {
  muteConsoleError(t);
  const { runtime } = publicRuntime(bridge(harness()).fetcher);
  // MapPreview.tsx:121 and LiveDistrictPanel.tsx:10 catch these and show "This
  // layer's data couldn't load" and "District information could not load";
  // LiveMapComparison.tsx:15 marks the sheet blocked. None shows a stand-in.
  for (const [operation, input] of [
    ['map.layer', { layer: 'water' }], ['map.layer', { layer: 'radon' }], ['map.layer', { layer: 'water', quarter: '2024Q3' }],
    ['map.district', { scope: 'NC-08' }], ['map.comparison', { layer: 'air', quarter: 'latest', ids: ['370000011'] }],
  ]) {
    await assert.rejects(runtime.request(operation, input), (error) => error.code === 'unavailable', `${operation} ${JSON.stringify(input)}`);
  }

  const limited = publicRuntime(bridge(harness({ layers: await storedLayers(utilitiesFor('NC07200')), rateLimit: () => false })).fetcher).runtime;
  await assert.rejects(limited.request('map.layer', { layer: 'water' }), (error) => error.code === 'rate_limited' && error.retryAfter === 60);
});
