import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { fullContextRow, registerHomeContextRpcs } from './helpers/fakeHomeContext.mjs';
import { registerSaveHousehold } from './helpers/fakeSaveHousehold.mjs';
import { localDate } from './helpers/isolationSeed.mjs';

const contract = JSON.parse(await readFile(new URL('../docs/backend/contracts/b01.openapi.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema({ $id: 'urn:halo:b01', components: contract.components });
const operations = new Map(Object.entries(contract.paths).flatMap(([path, verbs]) => Object.entries(verbs).map(([method, op]) => [op.operationId, { ...op, path, method: method.toUpperCase() }])));
const validators = new Map();
function validate(operationId, status, body) {
  const op = operations.get(operationId);
  assert.ok(op, `unknown operation ${operationId}`);
  const response = op.responses[String(status)];
  assert.ok(response, `${operationId}: undocumented status ${status}`);
  const schema = response.content['application/json'].schema;
  const key = schema.$ref;
  if (!validators.has(key)) validators.set(key, ajv.compile({ $ref: `urn:halo:b01${key}` }));
  const check = validators.get(key);
  assert.equal(check(body), true, `${operationId} ${status}: ${ajv.errorsText(check.errors)}`);
}
const directory = new URL('../docs/backend/contracts/fixtures/b01/', import.meta.url);
const fixtures = await Promise.all((await readdir(directory)).filter((name) => name.endsWith('.json')).sort().map(async (name) => ({ name, ...JSON.parse(await readFile(new URL(name, directory), 'utf8')) })));
for (const fixture of fixtures) {
  test(`B01 fixture: ${fixture.name}`, () => validate(fixture.operationId, fixture.status, fixture.body));
}
test('B01 contract and fixtures cover every operation, auth outage, success and supported failure', () => {
  assert.equal(contract.openapi, '3.1.0');
  assert.equal(contract.info.version, 'b01-1');
  assert.equal(operations.size, 6);
  for (const [id, op] of operations) {
    for (const status of Object.keys(op.responses)) {
      assert.ok(fixtures.some((item) => item.operationId === id && String(item.status) === status), `${id} missing ${status} fixture`);
    }
    assert.ok(fixtures.some((item) => item.operationId === id && item.status === 503 && item.body.code === 'auth_unavailable' && item.body.retryable === true));
  }
});
test('B01 schemas reject drift in added fields and accidental owner disclosure', () => {
  const good = fixtures.find((fixture) => fixture.name === 'getHomeContext-success.json').body;
  const check = ajv.compile({ $ref: 'urn:halo:b01#/components/schemas/HomeContextResponse' });
  assert.equal(check({ context: { ...good.context, profile_id: 'private-owner' } }), false);
  const bad = structuredClone(good); delete bad.context.revision;
  assert.equal(check(bad), false);
  const history = structuredClone(fixtures.find((fixture) => fixture.name === 'getHistory-success.json').body);
  history.history[0].comparability = 'same_everywhere';
  assert.equal(ajv.compile({ $ref: 'urn:halo:b01#/components/schemas/HistoryResponse' })(history), false);
});

const HOME = 'a11ce000-2222-4000-8000-000000000001';
const MISSING = '99999999-9999-4999-8999-999999999999';
const REQUEST_ID = 'b01-conformance-0001';
function harness({ empty = false, tables = ['profiles', 'home_contexts', 'daily_scores', 'household_bands'], rateLimit } = {}) {
  const h = createRouteHarness({
    tables: haloTables(...tables), env: { MAPBOX_TOKEN: 'pk.synthetic-contract' }, rateLimit,
    seed: ({ alice, bob }) => { const rows = {
      profiles: [{ id: alice.id }, { id: bob.id }],
      home_contexts: empty ? [] : [fullContextRow({ id: HOME, profile_id: alice.id, sequence: 1, revision: 1, origin: 'onboard', lat: 35.4, lng: -80.5, water_source: 'well', home_year: 1990, effective_from: '2026-10-01T12:00:00Z' })],
      daily_scores: empty ? [] : [{ profile_id: alice.id, home_context_id: HOME, date: localDate(), score: 75, aqi: 30, uv_index: 4, pollen_level: '{"tree":1}', mold_risk: null, created_at: new Date().toISOString() }],
    }; return Object.fromEntries(Object.entries(rows).filter(([name]) => tables.includes(name))); },
    fetch: async (url) => {
      if (String(url).startsWith('https://api.mapbox.com/')) return Response.json({ features: [{ center: [-80.5, 35.4], context: [{ id: 'district.1', text: 'Example County' }, { id: 'region.1', short_code: 'US-NC' }] }] });
      if (String(url).startsWith('https://services.arcgis.com/')) return Response.json({ features: [] });
      throw new Error(`Unexpected contract-test network request: ${url}`);
    },
  });
  registerHomeContextRpcs(h.db); registerSaveHousehold(h.db);
  return h;
}
const normal = {
  listHomeContexts: {}, getHomeContext: { params: { id: HOME } },
  patchHomeContext: { params: { id: HOME }, body: { expected_revision: 1, water_source: 'well' } },
  getHistory: {}, putHousehold: { body: { has_adult: true, renter_mode: false, locale: 'en' } },
  onboard: { body: { address: '123 Example Street', water_source: 'well', home_year: 1990 } },
};
// The two response headers this contract documents. Conformance checks both directions on every
// response the tests below exercise: a documented header must really be sent by some response for
// that operation and status, and a header that is sent must be documented there.
const CHECKED_HEADERS = ['x-request-id', 'retry-after'];
const seenHeaders = new Map();
function documentedHeaders(id, status) {
  const headers = operations.get(id).responses[String(status)].headers ?? {};
  return new Set(Object.keys(headers).map((name) => name.toLowerCase()));
}
function recordHeaders(id, res) {
  const key = `${id} ${res.status}`;
  const documented = documentedHeaders(id, res.status);
  if (!seenHeaders.has(key)) seenHeaders.set(key, new Set());
  for (const name of CHECKED_HEADERS) {
    if (res.headers.get(name) === null) continue;
    seenHeaders.get(key).add(name);
    assert.ok(documented.has(name), `${key}: the response sends ${name} but the contract does not document it`);
  }
}
async function call(h, id, overrides = {}, expected = 200) {
  const op = operations.get(id);
  const route = op.path.replace('{id}', '[id]');
  const res = await h.call(route, op.method, { as: 'alice', ...normal[id], ...overrides, headers: { 'x-request-id': REQUEST_ID, ...overrides.headers } });
  assert.equal(res.status, expected, `${id} expected ${expected}`);
  assert.equal(res.headers.get('x-request-id'), REQUEST_ID);
  recordHeaders(id, res);
  const body = await res.json();
  validate(id, res.status, body);
  if (expected >= 400) assert.equal(body.request_id, REQUEST_ID);
  return { body, res };
}
for (const [id] of operations) {
  test(`B01 handler conformance: ${id} success and authentication failures`, async (t) => {
    muteConsoleError(t);
    const h = harness();
    await call(h, id);
    const absent = await call(h, id, { as: null }, 401);
    assert.equal(absent.body.retryable, false);
    h.forceAuthOutage();
    const down = await call(h, id, {}, 503);
    assert.equal(down.body.code, 'auth_unavailable');
    assert.equal(down.body.retryable, true);
    assert.equal(down.res.headers.get('retry-after'), '2');
  });
}
const invalid = {
  getHomeContext: { params: { id: 'wrong' } }, patchHomeContext: { body: { expected_revision: 0, water_source: 'well' } },
  getHistory: { url: '/api/history?days=-1' }, putHousehold: { body: { has_child: 'yes' } }, onboard: { body: { address: '' } },
};
for (const [id, options] of Object.entries(invalid)) {
  test(`B01 handler conformance: ${id} field validation`, async () => {
    const { body } = await call(harness(), id, options, 400);
    assert.equal(body.code, 'validation_failed');
    assert.ok(body.field_errors.length);
  });
}
test('B01 handler conformance: empty lists and full household replacement', async () => {
  const h = harness({ empty: true });
  assert.deepEqual((await call(h, 'listHomeContexts')).body.items, []);
  assert.deepEqual((await call(h, 'getHistory')).body.history, []);
  const { body } = await call(h, 'putHousehold', { body: {} });
  assert.ok(Object.values(body.household).every((value) => value === false));
  assert.equal(body.transactional, true);
  assert.equal('locale' in body, false);
});
test('B01 handler conformance: missing contexts and foreign contexts share a 404', async () => {
  const h = harness();
  for (const id of ['getHomeContext', 'patchHomeContext', 'getHistory']) {
    const missing = await call(h, id, id === 'getHistory' ? { url: `/api/history?context=${MISSING}` } : { params: { id: MISSING } }, 404);
    assert.equal(missing.body.code, 'not_found');
  }
  const own = h.db.rows('home_contexts')[0];
  h.db.seed('home_contexts', [{ ...own, id: MISSING, profile_id: h.identities.bob.id }]);
  const foreign = await call(h, 'getHomeContext', { params: { id: MISSING } }, 404);
  assert.equal(foreign.body.code, 'not_found');
});
test('B01 handler conformance: stale edits retain current revision and closed contexts refuse writes', async () => {
  const h = harness();
  const { body } = await call(h, 'patchHomeContext', { body: { expected_revision: 5, home_year: 1990 } }, 409);
  assert.equal(body.revision, 1);
  assert.equal(body.reason, 'stale_revision');
  await h.db.from('home_contexts').update({ effective_to: '2026-10-02T12:00:00Z', closed_reason: 'moved' }).eq('id', HOME);
  const closed = await call(h, 'patchHomeContext', {}, 409);
  assert.equal(closed.body.reason, 'context_closed');
});
for (const id of ['patchHomeContext', 'putHousehold', 'onboard']) {
  test(`B01 handler conformance: ${id} oversized body`, async () => {
    const { body } = await call(harness(), id, { rawBody: JSON.stringify({ padding: 'x'.repeat(5000) }) }, 413);
    assert.equal(body.code, 'payload_too_large');
  });
}
test('B01 handler conformance: unavailable home migration is distinct from empty', async () => {
  const h = harness({ empty: true, tables: ['profiles', 'daily_scores', 'household_bands'] });
  for (const id of ['listHomeContexts', 'getHomeContext', 'getHistory']) {
    const { body } = await call(h, id, id === 'getHistory' ? { url: `/api/history?context=${HOME}` } : {}, 503);
    assert.equal(body.code, 'feature_unavailable');
    assert.equal(body.retryable, false);
  }
});
test('B01 handler conformance: onboard quota, identity mismatch and no geocoder result', async (t) => {
  muteConsoleError(t);
  const limited = await call(harness({ rateLimit: () => false }), 'onboard', {}, 429);
  assert.equal(limited.body.code, 'rate_limited');
  assert.equal(limited.res.headers.get('retry-after'), null, 'a rate limit does not send Retry-After; only the auth outage does');
  const h = harness();
  await call(h, 'onboard', { body: { address: '123 Example Street', profile_id: h.identities.bob.id } }, 403);
  await call(h, 'onboard', { fetch: async () => Response.json({ features: [] }) }, 404);
});
// Runs last (tests in one file run in order). Only operation and status pairs exercised above are
// compared, so statuses the harness cannot reach (a real 500, say) are not claimed as checked.
test('B01 contract headers: every documented header is sent for the operations and statuses the tests exercise', () => {
  assert.ok(seenHeaders.size > 0, 'no conformance responses were recorded');
  for (const [key, seen] of seenHeaders) {
    const [id, status] = key.split(' ');
    for (const name of documentedHeaders(id, status)) {
      if (CHECKED_HEADERS.includes(name)) assert.ok(seen.has(name), `${key}: the contract documents ${name} but no exercised response sent it`);
    }
  }
});
