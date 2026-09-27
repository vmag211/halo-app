import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validPwsids,
  geoQueryParams,
  parseGeoResponse,
  fetchWaterGeo,
  withGeo,
  getWaterGeo,
  _resetWaterGeoCache,
} from '../lib/waterGeo.js';

const feature = (pwsid, x, y, pop) => ({
  attributes: { PWSID: pwsid, Population_Served_Count: pop },
  centroid: x === null ? undefined : { x, y },
});

test('only well-formed PWSIDs reach the where clause (no injection)', () => {
  assert.deepEqual(validPwsids(['NC0113010', "NC1' OR '1'='1", 'nc0113010', null, 'NC0113010']), ['NC0113010']);
  const where = geoQueryParams(['NC0113010', "X' OR 1=1 --"]).get('where');
  assert.equal(where, "PWSID IN ('NC0113010')");
});

test('query asks for centroids in WGS84 and never the polygon', () => {
  const p = geoQueryParams(['NC0113010']);
  assert.equal(p.get('returnGeometry'), 'false');
  assert.equal(p.get('returnCentroid'), 'true');
  assert.equal(p.get('outSR'), '4326');
});

test('parse maps centroid x/y to lng/lat and keeps population', () => {
  const g = parseGeoResponse({ features: [feature('NC0113010', -80.6, 35.38, 116088)] });
  assert.deepEqual(g.get('NC0113010'), { lat: 35.38, lng: -80.6, population: 116088 });
});

test('multi-polygon systems: first centroid wins, largest population wins', () => {
  const g = parseGeoResponse({
    features: [feature('NC1', null, null, 10), feature('NC1', -80, 35, 50), feature('NC1', -81, 36, 20)],
  });
  assert.deepEqual(g.get('NC1'), { lat: 35, lng: -80, population: 50 });
});

test('missing or negative population stays null, never 0', () => {
  const g = parseGeoResponse({ features: [feature('NC2', -80, 35, undefined), feature('NC3', -80, 35, -1)] });
  assert.equal(g.get('NC2').population, null);
  assert.equal(g.get('NC3').population, null);
});

test('fetch batches requests and tolerates a failed batch', async () => {
  const ids = Array.from({ length: 5 }, (_, i) => `NC000000${i}`);
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    const where = new URL(url).searchParams.get('where');
    if (where.includes('NC0000004')) return { ok: false, status: 500, json: async () => ({}) };
    const found = [...where.matchAll(/'([A-Z0-9]+)'/g)].map((m) => m[1]);
    return { ok: true, json: async () => ({ features: found.map((p) => feature(p, -80, 35, 100)) }) };
  };
  const r = await fetchWaterGeo(ids, { fetchImpl, batchSize: 2 });
  assert.equal(calls, 3);
  assert.equal(r.requested, 5);
  assert.equal(r.found, 4); // the batch holding NC0000004 failed
  assert.equal(r.failedBatches, 1);
});

test('an ArcGIS error payload counts as a failed batch', async () => {
  const r = await fetchWaterGeo(['NC0113010'], {
    fetchImpl: async () => ({ ok: true, json: async () => ({ error: { message: 'bad where' } }) }),
  });
  assert.equal(r.found, 0);
  assert.equal(r.failedBatches, 1);
});

test('withGeo fills known systems and leaves unknown ones null', () => {
  const geo = new Map([['NC1', { lat: 35, lng: -80, population: 5 }]]);
  const out = withGeo([{ pwsid: 'NC1', lat: null }, { pwsid: 'NC9', lat: null }], geo);
  assert.deepEqual([out[0].lat, out[0].lng, out[0].population], [35, -80, 5]);
  assert.deepEqual([out[1].lat, out[1].lng, out[1].population], [null, null, null]);
});

test('cache: reused within 24h, refreshed after, and partial results never cached', async () => {
  _resetWaterGeoCache();
  let calls = 0;
  let fail = false;
  const fetchImpl = async () => {
    calls += 1;
    if (fail) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, json: async () => ({ features: [feature('NC0113010', -80.6, 35.38, 1)] }) };
  };
  const t0 = 1_000_000;
  await getWaterGeo(['NC0113010'], { fetchImpl, now: t0 });
  const hit = await getWaterGeo(['NC0113010'], { fetchImpl, now: t0 + 60_000 });
  assert.equal(hit.cached, true);
  assert.equal(calls, 1);
  await getWaterGeo(['NC0113010'], { fetchImpl, now: t0 + 25 * 3600_000 });
  assert.equal(calls, 2);

  _resetWaterGeoCache();
  fail = true;
  await getWaterGeo(['NC0113010'], { fetchImpl, now: t0 });
  fail = false;
  const retry = await getWaterGeo(['NC0113010'], { fetchImpl, now: t0 + 1000 });
  assert.equal(retry.cached, false, 'a failed lookup must not be pinned for a day');
  assert.equal(retry.found, 1);
});

// --- shared store (Redis in production; a fake here) -------------------------
function fakeStore() {
  const m = new Map();
  return {
    data: m,
    sets: 0,
    async get(k) { return m.get(k) ?? null; },
    async set(k, v, opts) { this.sets += 1; this.lastOpts = opts; m.set(k, JSON.parse(JSON.stringify(v))); },
  };
}
const oneFeature = async () => ({ ok: true, json: async () => ({ features: [feature('NC0113010', -80.6, 35.38, 7)] }) });

test('shared store: a second instance reuses the stored lookup instead of calling ArcGIS', async () => {
  _resetWaterGeoCache();
  const store = fakeStore();
  let calls = 0;
  const fetchImpl = async (...a) => { calls += 1; return oneFeature(...a); };
  const first = await getWaterGeo(['NC0113010'], { fetchImpl, store });
  assert.equal(first.source, 'arcgis');
  assert.equal(store.sets, 1);
  assert.equal(store.lastOpts.ex, 7 * 24 * 60 * 60);

  _resetWaterGeoCache(); // simulate a fresh server instance: memory is empty
  const second = await getWaterGeo(['NC0113010'], { fetchImpl, store });
  assert.equal(second.source, 'shared');
  assert.equal(calls, 1);
  assert.deepEqual(second.geo.get('NC0113010'), { lat: 35.38, lng: -80.6, population: 7 });
});

test('shared store: an entry for a different set of systems is not reused', async () => {
  _resetWaterGeoCache();
  const store = fakeStore();
  await getWaterGeo(['NC0113010'], { fetchImpl: oneFeature, store });
  _resetWaterGeoCache();
  let calls = 0;
  const r = await getWaterGeo(['NC0113010', 'NC0000001'], {
    fetchImpl: async (...a) => { calls += 1; return oneFeature(...a); },
    store,
  });
  assert.equal(r.source, 'arcgis');
  assert.equal(calls, 1);
});

test('force bypasses both caches and refreshes the store (the cron warm-up)', async () => {
  _resetWaterGeoCache();
  const store = fakeStore();
  let calls = 0;
  const fetchImpl = async (...a) => { calls += 1; return oneFeature(...a); };
  await getWaterGeo(['NC0113010'], { fetchImpl, store });
  const r = await getWaterGeo(['NC0113010'], { fetchImpl, store, force: true });
  assert.equal(r.source, 'arcgis');
  assert.equal(calls, 2);
  assert.equal(store.sets, 2);
});

test('a broken shared store falls through to ArcGIS instead of failing', async () => {
  _resetWaterGeoCache();
  const store = { get: async () => { throw new Error('redis down'); }, set: async () => { throw new Error('redis down'); } };
  const r = await getWaterGeo(['NC0113010'], { fetchImpl: oneFeature, store });
  assert.equal(r.source, 'arcgis');
  assert.equal(r.found, 1);
});
