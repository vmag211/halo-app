import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, muteConsoleError } from './helpers/routeHarness.mjs';
import { haloTables } from './helpers/tables.mjs';
import { expectEnvelope, loggedText, UUID } from './helpers/envelope.mjs';

const ENV = {
  UPSTASH_REDIS_REST_URL: 'https://redis.example.test',
  UPSTASH_REDIS_REST_TOKEN: 'test-redis-token-0001',
  AIRNOW_API_KEY: 'test-airnow-key-0001',
  GOOGLE_POLLEN_API_KEY: 'test-pollen-key-0001',
  MAPBOX_TOKEN: 'test-mapbox-token-0001',
};
const NAMES = ['airnow', 'open-meteo-air', 'open-meteo-uv', 'google-pollen', 'nws', 'mapbox-geocoding', 'arcgis-water-boundaries', 'upstash-redis', 'supabase'];

/** A fetch that answers every provider 200 unless a host fragment is given its own handler; `calls` lists the URLs asked. */
function providers(overrides = {}) {
  const calls = [];
  const fetch = async (url) => {
    const target = String(url);
    calls.push(target);
    for (const [fragment, handler] of Object.entries(overrides)) if (target.includes(fragment)) return handler(target);
    return new Response('{}', { status: 200 });
  };
  return { fetch, calls };
}
const harness = ({ overrides, tables = haloTables('ucmr5_utilities'), env = ENV } = {}) => {
  const stub = providers(overrides);
  const h = createRouteHarness({ tables, env, fetch: stub.fetch, seed: () => (tables.ucmr5_utilities ? { ucmr5_utilities: [{ pwsid: 'NC9990001', pws_name: 'W' }] } : {}) });
  return { h, calls: stub.calls };
};
const health = (h, as = 'alice', headers) => h.call('/api/health', 'GET', { as, headers });
const byName = (body) => Object.fromEntries(body.checks.map((check) => [check.name, check]));

test('legacy request: all_ok, checked_at and one check per source with its old fields, plus a request id header', async () => {
  const { h, calls } = harness();
  const res = await health(h);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('x-request-id'), UUID);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['all_ok', 'checked_at', 'checks']);
  assert.equal(body.all_ok, true);
  assert.ok(!Number.isNaN(Date.parse(body.checked_at)));
  assert.deepEqual(body.checks.map((check) => check.name), NAMES);
  for (const check of body.checks.slice(0, 8)) {
    assert.deepEqual(Object.keys(check).sort(), ['name', 'ok', 'ms', 'reachable', 'status'].sort(), check.name);
    assert.deepEqual([check.reachable, check.ok, check.status], [true, true, 200], check.name);
  }
  assert.deepEqual(Object.keys(byName(body).supabase).sort(), ['reachable', 'name', 'ok', 'ms'].sort());
  assert.equal(calls.length, 8, 'eight provider checks; supabase is a table count');
  assert.equal('request_id' in body, false, 'success bodies do not carry request_id');
});

test('all_ok needs ok, not just reachable: a provider that answers 401 is reachable and not ok', async () => {
  const { h } = harness({ overrides: { 'airnowapi.org': () => new Response('{}', { status: 401 }) } });
  const body = await (await health(h)).json();
  assert.deepEqual([byName(body).airnow.reachable, byName(body).airnow.ok, byName(body).airnow.status], [true, false, 401]);
  assert.equal(body.all_ok, false);
});

test('a provider that cannot be reached is reported as unreachable, without the failure text or the keys in the URL', async (t) => {
  const logged = muteConsoleError(t);
  const secret = 'connect ECONNREFUSED https://pollen.googleapis.com/v1/forecast:lookup?key=test-pollen-key-0001';
  const { h } = harness({ overrides: { 'pollen.googleapis.com': () => { throw new TypeError(secret); } } });
  const res = await health(h);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual([byName(body)['google-pollen'].reachable, byName(body)['google-pollen'].error], [false, 'unreachable']);
  assert.equal(body.all_ok, false);
  const text = JSON.stringify(body);
  for (const leak of [secret, 'ECONNREFUSED', 'test-pollen-key-0001', 'test-airnow-key-0001', 'test-mapbox-token-0001', 'test-redis-token-0001']) assert.ok(!text.includes(leak), leak);
  assert.ok(loggedText(logged).includes('ECONNREFUSED'), 'the real error is logged');
  assert.ok(loggedText(logged).includes(res.headers.get('x-request-id')), 'with the request id');
});

test('a provider that times out is reported as a timeout', async (t) => {
  muteConsoleError(t);
  const { h } = harness({ overrides: { 'api.weather.gov': () => { throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }); } } });
  const check = byName(await (await health(h)).json()).nws;
  assert.deepEqual([check.reachable, check.error], [false, 'timeout']);
});

test('without Upstash configured the check says not configured, and all_ok is false', async () => {
  const { h, calls } = harness({ env: Object.fromEntries(Object.entries(ENV).filter(([name]) => !name.startsWith('UPSTASH'))) });
  const body = await (await health(h)).json();
  assert.deepEqual(byName(body)['upstash-redis'], { name: 'upstash-redis', reachable: false, error: 'not configured', ms: 0 });
  assert.equal(body.all_ok, false);
  assert.equal(calls.length, 7);
});

test('a failed database check is reported without database text; the real error is logged with the request id', async (t) => {
  const logged = muteConsoleError(t);
  const { h } = harness({ tables: {} }); // ucmr5_utilities missing: PGRST205
  const res = await health(h);
  const body = await res.json();
  assert.equal(res.status, 200);
  const supabase = byName(body).supabase;
  assert.deepEqual([supabase.reachable, supabase.ok, supabase.error], [false, false, 'query_failed']);
  assert.equal(body.all_ok, false);
  assert.doesNotMatch(JSON.stringify(body), /schema cache|ucmr5|PGRST|Could not find/);
  assert.ok(loggedText(logged).includes('Could not find the table'));
  assert.ok(loggedText(logged).includes(res.headers.get('x-request-id')));

  const { h: broken } = harness();
  const from = broken.db.from.bind(broken.db);
  broken.db.from = (name) => { if (name === 'ucmr5_utilities') throw new Error('secret database detail'); return from(name); };
  const thrown = byName(await (await health(broken)).json()).supabase;
  assert.deepEqual([thrown.reachable, thrown.ok, thrown.error], [false, false, 'unreachable']);
});

// The one point every provider check asks about, written the way each provider's URL carries it.
const FIXED_POINT = [
  ['airnowapi.org', 'latitude=35.4&longitude=-80.5&'],
  ['air-quality-api.open-meteo.com', 'latitude=35.4&longitude=-80.5&'],
  ['api.open-meteo.com', 'latitude=35.4&longitude=-80.5&'],
  ['pollen.googleapis.com', 'location.longitude=-80.5&location.latitude=35.4&'],
  ['api.weather.gov', '/points/35.4,-80.5'],
  ['services.arcgis.com', 'geometry=-80.5,35.4&'],
];

test('it reveals no household data: every provider is asked about the one fixed public point, whatever the household or the query holds', async () => {
  const { h, calls } = harness({ tables: haloTables('ucmr5_utilities', 'profiles') });
  // A household with its own coordinates, and a query that tries to point the checks elsewhere (or at someone else's home).
  h.db.seed('profiles', [{ id: h.identities.alice.id, lat: 35.40881, lng: -80.57952, county: 'Cabarrus County' }]);
  const res = await h.call('/api/health', 'GET', { as: 'alice', url: `/api/health?profile_id=${h.identities.bob.id}&lat=1&lng=2` });
  assert.equal(res.status, 200);

  assert.equal(calls.length, 8);
  for (const [host, point] of FIXED_POINT) {
    const urls = calls.filter((url) => url.includes(host) && !(host === 'api.open-meteo.com' && url.includes('air-quality')));
    assert.equal(urls.length, 1, host);
    assert.ok(urls[0].includes(point), `${host} is asked about the fixed point: ${urls[0].split('?')[0]}`);
  }
  for (const url of calls) {
    for (const forbidden of ['35.40881', '80.57952', 'latitude=1&', 'longitude=2', 'lat=1', 'lng=2', 'Cabarrus', 'alice', h.identities.bob.id]) {
      assert.equal(url.includes(forbidden), false, `${forbidden} must not reach a provider (${url.split('?')[0]})`);
    }
  }
  assert.deepEqual([...new Set(h.db.queryLog.map((q) => q.table))], ['ucmr5_utilities'], 'the household profile is never read');
});

test('a missing session is a 401 envelope that echoes a client request id, and no provider is asked', async () => {
  const { h, calls } = harness();
  const none = await expectEnvelope(await h.call('/api/health', 'GET', {}), { status: 401, code: 'auth_required' });
  assert.equal(none.error, 'Sign-in required.');
  await expectEnvelope(await h.call('/api/health', 'GET', { headers: { 'x-request-id': 'client-trace-0001' } }), { status: 401, code: 'auth_required', requestId: 'client-trace-0001' });
  assert.equal(calls.length, 0);
  assert.equal(h.db.queryLog.length, 0);
  assert.equal((await health(h, 'alice', { 'x-request-id': 'client-trace-0001' })).headers.get('x-request-id'), 'client-trace-0001');
});

test('an unexpected failure is a 500 envelope with no message; the real error is logged with the request id', async (t) => {
  const logged = muteConsoleError(t);
  const { h } = harness();
  const now = Date.now;
  // Throws only for the route's own clock reads, so the harness and the test runner are not disturbed.
  t.mock.method(Date, 'now', () => {
    if (new Error().stack.includes('app/api/health/route.js')) throw new Error('clock exploded: secret detail');
    return now();
  });
  const body = await expectEnvelope(await health(h), { status: 500, code: 'internal_error', retryable: true });
  assert.equal(body.error, 'Something went wrong on our side. Please try again.');
  assert.doesNotMatch(JSON.stringify(body), /clock exploded|secret detail/);
  assert.ok(loggedText(logged).includes('clock exploded'));
  assert.ok(loggedText(logged).includes(body.request_id));
});
