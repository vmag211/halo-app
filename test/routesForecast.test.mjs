/**
 * GET /api/forecast (B10 Task 8) on the isolated route harness: synthetic
 * identities, an in-memory database, a fetch stub per host (Open-Meteo forecast
 * and metadata, NWS alerts, AirNow's forecast host, and a fake Upstash REST
 * server that the real @upstash/redis client talks to), the limiter stub with a
 * recording `rateLimit`, and a fixed clock (`t.mock.timers`, Date only). The
 * world lives in test/helpers/forecastRoute.mjs, shared with Task 9.
 *
 * Provider bodies are the recorded fixtures in test/fixtures/forecast/, and
 * AirNow-shaped rows for the real AirNow adapter (Task 5), wired through
 * lib/forecast/airNowSlot.js; one test runs with the slot empty and one
 * without AIRNOW_API_KEY, both of which say air was not checked.
 *
 * Every snapshot body is run through the client's own validator, transcribed in
 * test/helpers/frontendB10.mjs (WeekSources.tsx:14-17), and what the screen
 * then shows is asserted where the plan names it.
 */
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIMITER_UNAVAILABLE } from './helpers/routeHarness.mjs';
import { expectEnvelope } from './helpers/envelope.mjs';
import { productionForecast, forecastScreenText, forecastIssued, outdoorDecisions } from './helpers/frontendB10.mjs';
import {
  FIXTURES,
  FORECAST_NOW as NOW,
  HOUR,
  FORECAST_DATE as DATE,
  FORECAST_RUN as RUN,
  airNowForecastAdapter,
  forecastWorld,
  forecastHarness as harness,
  callForecast,
  captureLogs,
} from './helpers/forecastRoute.mjs';
import { _resetForecastCache, lastConfirmedKey } from '../lib/forecast/cache.js';
import { _setAirNowAdapter } from '../lib/forecast/airNowSlot.js';
import { RUN_UNKNOWN_RETRY_MS } from '../lib/forecast/openMeteo.js';
import { WARNINGS_UNAVAILABLE } from '../lib/forecast/copy.js';

const EM_DASH = String.fromCharCode(0x2014);
const META013 = FIXTURES.meta013;
const META025 = FIXTURES.meta025;

beforeEach(() => {
  _resetForecastCache();
  _setAirNowAdapter(airNowForecastAdapter);
});
after(() => _setAirNowAdapter(null));

/** The client's validator accepts the body: data is the body itself and there is no error. */
function screenAccepts(body) {
  const read = productionForecast({ data: body, error: null, loading: false });
  assert.equal(read.error, null, 'the client shows no verification error');
  assert.equal(read.data, body);
  return read;
}

function noUnexpected(h, w) {
  assert.deepEqual(w.unexpected, [], 'no fetch to any other host');
  assert.deepEqual(h.blockedFetches, [], 'nothing reached the default blocked fetch');
}

function onlyReads(h) {
  for (const entry of h.db.queryLog) assert.equal(entry.operation, 'select', `no write: ${entry.table} ${entry.operation}`);
}

const everyString = (value, out = []) => {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) everyString(v, out);
  return out;
};

// ----------------------------------------------------------------- the tests

test('maxDuration is 15 (F8), under the client\'s 20 s', async () => {
  const route = await import('../app/api/forecast/route.js');
  assert.equal(route.maxDuration, 15);
  const source = readFileSync(new URL('../app/api/forecast/route.js', import.meta.url), 'utf8');
  assert.match(source, /^export const maxDuration = 15;$/m);
  assert.equal(source.includes(EM_DASH), false);
});

test('401 without a session: nothing read, no limiter, no fetch', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const w = forecastWorld();
  const h = harness(w);
  const res = await callForecast(h, { as: null });
  await expectEnvelope(res, { status: 401, code: 'auth_required' });
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.equal(h.db.queryLog.length, 0);
  assert.deepEqual(w.calls, []);
  assert.deepEqual(w.limits, []);
  noUnexpected(h, w);
});

test('400 for a missing, non-calendar or compact date, a 101-character place and a control character, each before any read, limiter or fetch', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const w = forecastWorld();
  const h = harness(w);
  const cases = [
    ['missing date', '?place=', 'date'],
    ['2026-02-30', `?${new URLSearchParams({ date: '2026-02-30', place: '' })}`, 'date'],
    ['20261024', `?${new URLSearchParams({ date: '20261024', place: '' })}`, 'date'],
    ['101 characters', `?${new URLSearchParams({ date: DATE, place: 'C'.repeat(101) })}`, 'place'],
    ['control character', `?${new URLSearchParams({ date: DATE, place: 'Charlotte\u0007' })}`, 'place'],
    ['line break', `?${new URLSearchParams({ date: DATE, place: 'Charlotte\nNC' })}`, 'place'],
  ];
  for (const [what, query, field] of cases) {
    const res = await callForecast(h, { query });
    const body = await expectEnvelope(res, { status: 400, code: 'validation_failed' });
    assert.equal(body.field_errors[0].field, field, what);
    assert.equal(res.headers.get('cache-control'), 'private, no-store', what);
    assert.equal(JSON.stringify(body).includes('Charlotte'), false, `${what}: the place is not echoed`);
  }
  // Exactly 100 characters is accepted (the input's own maxLength).
  const hundred = await callForecast(h, { place: 'C'.repeat(100) });
  assert.equal(hundred.status, 200);
  assert.equal(h.db.queryLog.length, 0);
  assert.deepEqual(w.calls, []);
  assert.deepEqual(w.limits, []);
  noUnexpected(h, w);
});

test('a household with a home gets a populated snapshot; the providers get the 2-decimal point; only its own profile is read', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const w = forecastWorld();
  const h = harness(w);
  const res = await callForecast(h, { headers: { 'x-request-id': 'forecast-test-0001' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.equal(res.headers.get('x-request-id'), 'forecast-test-0001');
  const body = await res.json();
  screenAccepts(body);
  assert.equal(Object.hasOwn(body, 'data'), false);
  assert.equal(Object.hasOwn(body, 'changedMessage'), false);
  assert.deepEqual(body.periods.map((p) => p.name), ['Morning', 'Afternoon', 'Evening']);
  assert.equal(body.issuedAt, RUN, 'issuedAt is the model run, never the fetch');
  assert.equal(body.zone, 'America/New_York', 'the home zone from Open-Meteo');
  assert.equal(body.expiresAt, new Date(NOW + 90 * 60_000).toISOString());
  for (const value of Object.values(body.coverage)) assert.ok(value.startsWith('For your home area:'), value);
  assert.match(body.source, /^Open-Meteo, EPA AirNow and the National Weather Service, for your home area$/);
  assert.match(body.warningStatus, /^No National Weather Service alerts are active for this area as of /);
  for (const text of everyString(body)) assert.equal(text.includes(EM_DASH), false, text);

  // F3: every provider URL carries 35.23,-80.84 and nothing more precise.
  assert.deepEqual(w.counts(), { forecast: 1, meta: 4, airnow: 1, nws: 1 });
  const forecastUrl = new URL(w.calls.find((c) => c.kind === 'forecast').url);
  assert.equal(forecastUrl.searchParams.get('latitude'), '35.23');
  assert.equal(forecastUrl.searchParams.get('longitude'), '-80.84');
  assert.equal(new URL(w.calls.find((c) => c.kind === 'nws').url).searchParams.get('point'), '35.23,-80.84');
  const air = new URL(w.calls.find((c) => c.kind === 'airnow').url);
  assert.equal(`${air.origin}${air.pathname}`, 'https://www.airnowapi.org/aq/forecast/current/', 'the Current Forecasts service, not the retired latLong one');
  assert.deepEqual([...air.searchParams.keys()], ['format', 'latitude', 'longitude', 'API_KEY'], 'no date and no distance');
  assert.deepEqual([air.searchParams.get('format'), air.searchParams.get('latitude'), air.searchParams.get('longitude')], ['application/json', '35.23', '-80.84']);
  assert.equal(air.searchParams.get('API_KEY'), 'FAKE-AIRNOW-KEY-7c1e', 'AIRNOW_API_KEY, the same variable the observation call uses');
  for (const call of w.calls) assert.equal(/35\.227|80\.843/.test(call.url), false, 'the stored 3-decimal point never leaves');
  assert.equal(w.calls.find((c) => c.kind === 'nws').headers['user-agent'], '(HALO, forecast-ops@halo.test)', 'NWS_CONTACT, never a literal address');

  // Owner scoping on the one query: the caller's profiles row, by id, and nothing else.
  const { alice } = h.identities;
  assert.deepEqual(h.db.queryLog.map((q) => [q.table, q.operation, q.filters]), [
    ['profiles', 'select', [{ type: 'cmp', column: 'id', op: 'eq', value: alice.id }]],
  ]);
  onlyReads(h);
  noUnexpected(h, w);

  // What the screen then shows: three periods, Issued is the run, coverage names the home area.
  const live = { ...productionForecast({ data: body, error: null }), production: true };
  const shown = forecastScreenText(live, body.periods[1]);
  assert.equal(shown.issued, forecastIssued(RUN, body.zone));
  assert.equal(shown.cells.airLabel, 'Air, daily', 'AirNow is daily, so no number per period (F6)');
  assert.equal(shown.cells.air, 'Moderate, PM2.5', 'the worst category as received, its number unknown');
  assert.match(shown.coverage.Air, /ozone Good \(AQI 41\)/);
  assert.match(shown.coverage.Air, /PM2\.5 Moderate \(category only, no AQI number issued\)/);
});

test('one rounding for keys and URLs: a home on a half hundredth goes out as roundForProvider gives it, never as toFixed would', async (t) => {
  // 35.205 and -80.845 are 35.2049999... and -80.8449999... in binary: toFixed(2) gives 35.20 and -80.84,
  // roundForProvider (on the decimal digits) gives 35.21 and -80.85. The key and every URL use the latter.
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const w = forecastWorld();
  const h = harness(w);
  await h.db.from('profiles').update({ lat: 35.205, lng: -80.845 }).eq('id', h.identities.carol.id);
  assert.equal((await callForecast(h, { as: 'carol' })).status, 200);
  const forecastUrl = new URL(w.calls.find((c) => c.kind === 'forecast').url);
  assert.deepEqual([forecastUrl.searchParams.get('latitude'), forecastUrl.searchParams.get('longitude')], ['35.21', '-80.85']);
  assert.equal(new URL(w.calls.find((c) => c.kind === 'nws').url).searchParams.get('point'), '35.21,-80.85');
  for (const key of w.upstash.data.keys()) assert.ok(key.includes(':35.21,-80.85:'), key);
});

test('a foreign X-Halo-Home-Context changes nothing: the same body, the same owner-scoped read', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const w = forecastWorld();
  const h = harness(w);
  const plain = await (await callForecast(h)).json();
  const foreign = await (await callForecast(h, { headers: { 'x-halo-home-context': '00000000-0000-4000-8000-0000000000bb' } })).json();
  assert.deepEqual(foreign, plain);
  const { alice } = h.identities;
  for (const q of h.db.queryLog) assert.deepEqual(q.filters, [{ type: 'cmp', column: 'id', op: 'eq', value: alice.id }]);
  assert.equal(h.db.queryLog.length, 2);
});

test('no saved home and an empty place: the empty snapshot, zero fetches, no limiter token', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const w = forecastWorld();
  const h = harness(w);
  for (const place of ['', '   ']) {
    const res = await callForecast(h, { as: 'carol', place });
    assert.equal(res.status, 200);
    const body = await res.json();
    screenAccepts(body);
    assert.deepEqual(body.periods, []);
    assert.equal(body.warningStatus, WARNINGS_UNAVAILABLE);
    assert.equal(body.expiresAt, new Date(NOW + 24 * HOUR).toISOString());
    for (const value of Object.values(body.coverage)) {
      assert.match(value, /^For your home area: No forecast was made\. No home location is saved\./);
    }
  }
  assert.deepEqual(w.calls, []);
  assert.deepEqual(w.limits, []);
  noUnexpected(h, w);
});

test('a profile with only one coordinate is no home too (no_home), never a provider call', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const w = forecastWorld();
  const h = harness(w);
  await h.db.from('profiles').update({ lat: 35.5, lng: null }).eq('id', h.identities.carol.id);
  const body = await (await callForecast(h, { as: 'carol' })).json();
  assert.deepEqual(body.periods, []);
  assert.match(body.coverage.Weather, /No home location is saved/);
  assert.deepEqual(w.calls, []);
});

test('unmatched, ambiguous and outside places answer at once: empty snapshot, no read, no limiter, no fetch', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const w = forecastWorld();
  const h = harness(w);
  const cases = [
    ['Char', /did not match a North Carolina county, city, town or ZIP code/],
    ['29201', /is not a North Carolina ZIP code/],
    ['Fairview', /more than one North Carolina place: Fairview \(Buncombe County\), NC and Fairview \(Union County\), NC/],
    ['Greenville, SC', /outside North Carolina/],
  ];
  for (const [place, why] of cases) {
    const body = await (await callForecast(h, { place })).json();
    screenAccepts(body);
    assert.deepEqual(body.periods, [], place);
    assert.match(body.coverage.Weather, why, place);
    // The screen shows forecastUnavailable for an empty in-horizon date.
    const live = { ...productionForecast({ data: body, error: null }), production: true };
    const d = outdoorDecisions({ live, draft: { date: DATE, place, period: 'Morning', key: 'k' }, today: '2026-10-19', review: { forecast: 'live' }, state: null, now: NOW, acknowledged: null, pauseForecast: false, validActionDate: () => true, dayAdd: () => '', forecastFixture: () => [] });
    assert.equal(d.far, false);
    assert.deepEqual(d.periods, []);
  }
  assert.equal(h.db.queryLog.length, 0);
  assert.deepEqual(w.calls, []);
  assert.deepEqual(w.limits, []);
  noUnexpected(h, w);
});

test('trap 18: twelve keystrokes make one provider round and spend the household once; a second household is free; the next hour fetches again', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const w = forecastWorld();
  const h = harness(w);
  const keystrokes = ['C', 'Ch', 'Cha', 'Char', 'Charl', 'Charlo', 'Charlot', 'Charlott', 'Charlotte', 'Charlotte,', 'Charlotte, N', 'Charlotte, NC'];
  const bodies = [];
  for (const place of keystrokes) {
    const res = await callForecast(h, { place });
    assert.equal(res.status, 200, place);
    const body = await res.json();
    screenAccepts(body);
    bodies.push(body);
  }
  assert.deepEqual(w.counts(), { forecast: 1, meta: 4, airnow: 1, nws: 1 }, 'one provider round, four metadata reads');
  const { alice, bob } = h.identities;
  assert.deepEqual(w.limits.filter((k) => k === `forecast:${alice.id}`), [`forecast:${alice.id}`], 'the household budget is spent once');
  assert.equal(w.limits.some((k) => k.startsWith('daily-score')), false, 'never the daily-score limiter');
  assert.deepEqual(w.limits.filter((k) => k.startsWith('forecast:') && !k.includes(alice.id)).sort(), ['forecast:airnow:hour', 'forecast:nws:hour', 'forecast:open-meteo:day', 'forecast:open-meteo:minute']);
  assert.equal(w.unexpected.some((u) => u.includes('mapbox')), false, 'never Mapbox');
  assert.equal(h.db.queryLog.length, 0, 'a typed place reads no profile');
  // The settled answers are one forecast for Charlotte, not for the typed words.
  const charlotte = bodies.slice(8);
  for (const body of charlotte) {
    assert.ok(body.periods.length === 3);
    assert.ok(body.coverage.Weather.startsWith('For Charlotte, NC (Census internal point):'));
    assert.equal(body.version, charlotte[0].version, 'the same content keeps its version');
  }
  assert.equal(new URL(w.calls.find((c) => c.kind === 'forecast').url).searchParams.get('latitude'), '35.21');

  // A second household asking for Charlotte in the same hour: no provider call, no household token.
  w.reset();
  const bobs = await (await callForecast(h, { as: 'bob', place: 'Charlotte' })).json();
  assert.equal(bobs.version, charlotte[0].version);
  assert.deepEqual(w.calls, []);
  assert.deepEqual(w.limits, [], `no limiter at all for ${bob.name}`);

  // The next hour: new keys, new calls.
  t.mock.timers.setTime(NOW + HOUR);
  w.reset();
  const later = await callForecast(h, { as: 'bob', place: 'Charlotte' });
  assert.equal(later.status, 200);
  assert.deepEqual(w.counts(), { forecast: 1, meta: 4, airnow: 1, nws: 1 });
  assert.deepEqual(w.limits.filter((k) => k === `forecast:${bob.id}`), [`forecast:${bob.id}`]);
  noUnexpected(h, w);
});

test('a failing Open-Meteo answers 503 with Retry-After, never its reason; a second request within 60 s calls nothing', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const logs = captureLogs(t);
  const w = forecastWorld();
  w.status.forecast = 500;
  const h = harness(w);
  const res = await callForecast(h, { place: 'Charlotte' });
  const body = await expectEnvelope(res, { status: 503, code: 'upstream_unavailable', retryable: true });
  assert.equal(res.headers.get('retry-after'), '60');
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.equal(JSON.stringify(body).includes('http_500'), false, 'the reason is a log token only');
  assert.equal(JSON.stringify(body).includes('open_meteo'), false);
  assert.ok(logs.some((l) => l === 'Forecast unavailable: open_meteo_http_500'), logs.join('\n'));
  assert.deepEqual(w.counts(), { forecast: 1, meta: 2, airnow: 1, nws: 1 }, 'the after-reads are skipped once the forecast failed');

  w.reset();
  t.mock.timers.setTime(NOW + 59_000);
  const again = await callForecast(h, { place: 'Charlotte' });
  assert.equal(again.status, 503);
  assert.ok(Number(again.headers.get('retry-after')) > 0);
  assert.deepEqual(w.calls, [], 'the failure is remembered for 60 s; AirNow and NWS are cached');
  assert.deepEqual(w.limits, [], 'a remembered failure costs no household token');

  // The client maps 503 to its unavailable message with Retry forecast (runtime.ts:144).
  t.mock.timers.setTime(NOW + 61_000);
  w.status.forecast = 0;
  const recovered = await callForecast(h, { place: 'Charlotte' });
  assert.equal(recovered.status, 200, 'retried after the negative window');
});

test('AirNow failing gives 200 with the Air coverage saying air was not checked', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  captureLogs(t);
  const w = forecastWorld();
  w.status.airnow = 401;
  const h = harness(w);
  const res = await callForecast(h, { place: 'Charlotte' });
  assert.equal(res.status, 200);
  const body = await res.json();
  screenAccepts(body);
  assert.match(body.coverage.Air, /^For Charlotte, NC \(Census internal point\): Air was not checked\. The EPA AirNow forecast could not be reached\./);
  assert.equal(body.source, 'Open-Meteo and the National Weather Service, for Charlotte, NC', 'a provider that gave nothing is not named');
  for (const p of body.periods) assert.match(p.tradeoff, /Air was not checked for this date\.$/);
});

test('AirNow slot empty: no AirNow call, coverage says the connection is not set up', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  _setAirNowAdapter(null);
  const w = forecastWorld();
  const h = harness(w);
  const body = await (await callForecast(h, { place: 'Charlotte' })).json();
  screenAccepts(body);
  assert.match(body.coverage.Air, /Air was not checked\. HALO's AirNow forecast connection is not set up\./);
  assert.deepEqual(w.counts(), { forecast: 1, meta: 4, airnow: 0, nws: 1 });
  assert.equal(w.limits.includes('forecast:airnow:hour'), false, 'no AirNow budget spent');
});

test('NWS failing gives 200 with the frontend\'s own Official notices fallback', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  captureLogs(t);
  const w = forecastWorld();
  w.status.nws = 503;
  const h = harness(w);
  const res = await callForecast(h, { place: 'Charlotte' });
  assert.equal(res.status, 200);
  const body = await res.json();
  screenAccepts(body);
  assert.equal(body.warningStatus, 'Warnings unavailable. Check the official site.');
  assert.equal(body.source, 'Open-Meteo and EPA AirNow, for Charlotte, NC');
});

test('the Open-Meteo budget refused gives 503 with no Open-Meteo call at all', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const logs = captureLogs(t);
  for (const refused of ['forecast:open-meteo:day', 'forecast:open-meteo:minute']) {
    _resetForecastCache();
    const w = forecastWorld();
    w.decide = (key) => key !== refused;
    const h = harness(w);
    const res = await callForecast(h, { place: 'Charlotte' });
    await expectEnvelope(res, { status: 503, code: 'upstream_unavailable' });
    assert.equal(res.headers.get('retry-after'), '60');
    assert.equal(w.count('forecast') + w.count('meta'), 0, `${refused}: no request to api.open-meteo.com`);
  }
  assert.ok(logs.includes('Forecast unavailable: open_meteo_budget'));
});

test('the AirNow and NWS budgets refused degrade their own rows only', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const logs = captureLogs(t);
  const w = forecastWorld();
  w.decide = (key) => key !== 'forecast:airnow:hour' && key !== 'forecast:nws:hour';
  const h = harness(w);
  const body = await (await callForecast(h, { place: 'Charlotte' })).json();
  screenAccepts(body);
  assert.match(body.coverage.Air, /HALO's hourly limit for AirNow requests was reached/);
  assert.equal(body.warningStatus, WARNINGS_UNAVAILABLE);
  assert.deepEqual(w.counts(), { forecast: 1, meta: 4, airnow: 0, nws: 0 });
  assert.deepEqual(logs.sort(), ['Forecast provider airnow not used: budget', 'Forecast provider nws-alerts not used: budget']);
});

test('the household limiter refused gives 429 with Retry-After and calls no provider', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const w = forecastWorld();
  const h = harness(w);
  const { alice } = h.identities;
  w.decide = (key) => key !== `forecast:${alice.id}`;
  const res = await callForecast(h, { place: 'Charlotte' });
  await expectEnvelope(res, { status: 429, code: 'rate_limited', retryable: true });
  assert.equal(res.headers.get('retry-after'), '120');
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(w.calls, []);
  assert.deepEqual(w.limits, [`forecast:${alice.id}`], 'no global budget is spent either');
});

test('Redis throwing on every call still answers from the providers', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const logs = captureLogs(t);
  const w = forecastWorld();
  w.upstash.fail = true;
  const h = harness(w);
  const res = await callForecast(h, { place: 'Charlotte' });
  assert.equal(res.status, 200);
  screenAccepts(await res.json());
  assert.deepEqual(w.counts(), { forecast: 1, meta: 4, airnow: 1, nws: 1 });
  assert.ok(w.upstash.commands.length === 0, 'every command was refused before it ran');
  assert.ok(logs.some((l) => l.startsWith('Forecast cache store unavailable, treated as a miss:')));
  for (const line of logs) assert.equal(/halo:forecast|35\.21|-80\.83/.test(line), false, line);
});

test('the store is shared: after a memory reset (another instance) the answer comes from Upstash with no provider call', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const w = forecastWorld();
  const h = harness(w);
  const first = await (await callForecast(h, { place: 'Charlotte' })).json();
  assert.deepEqual([...w.upstash.data.keys()].sort(), [
    'halo:forecast:v1:airnow:35.21,-80.83:2026101920',
    'halo:forecast:v1:nws-alerts:35.21,-80.83:2026101920:0',
    'halo:forecast:v1:open-meteo:35.21,-80.83:2026101920',
    'halo:forecast:v1:open-meteo:35.21,-80.83:last',
  ], 'F9 keys: the hour, the NWS ten-minute slot, and the hour-free last confirmed forecast');
  for (const value of w.upstash.data.values()) {
    const entry = JSON.parse(value);
    assert.equal(entry.kind, 'good');
    assert.equal(Object.hasOwn(entry.result, 'profileId') || JSON.stringify(entry).includes(h.identities.alice.id), false, 'no household id in a value');
  }
  _resetForecastCache();
  w.reset();
  const second = await (await callForecast(h, { as: 'bob', place: 'Charlotte' })).json();
  assert.deepEqual(second, first);
  assert.deepEqual(w.calls, []);
  assert.deepEqual(w.limits, []);
});

test('Upstash down (every limiter throws): the global budgets refuse, the household one allows', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const logs = captureLogs(t);
  const w = forecastWorld();
  w.decide = () => LIMITER_UNAVAILABLE;
  const h = harness(w);
  const res = await callForecast(h, { place: 'Charlotte' });
  await expectEnvelope(res, { status: 503, code: 'upstream_unavailable' });
  assert.deepEqual(w.calls, [], 'no provider is reached without its global budget');
  assert.ok(logs.some((l) => l.startsWith('Forecast household budget unavailable') && l.endsWith('allowing the call.')), logs.join('\n'));
  for (const label of ['Forecast Open-Meteo daily budget', 'Forecast AirNow budget', 'Forecast NWS alerts budget']) {
    assert.ok(logs.some((l) => l.startsWith(label) && l.endsWith('skipping the call.')), label);
  }
});

test('the place text never appears in a log line, a cache key, a cache value or a limiter key', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const logs = captureLogs(t);
  const w = forecastWorld();
  w.status.airnow = 500; // a failure path logs too
  const h = harness(w);
  const typed = ['Freedom Park, Charlotte', 'Zyxwvut Meadow', 'Environmental Learning Center, Charlotte, NC 28202'];
  for (const place of typed) await callForecast(h, { place });
  t.mock.timers.setTime(NOW + 2 * 60_000);
  w.status.forecast = 503;
  _resetForecastCache();
  await callForecast(h, { place: 'Freedom Park, Charlotte' });
  const markers = ['Freedom', 'Park', 'Zyxwvut', 'Meadow', 'Environmental', 'Learning', 'Charlotte'];
  const stored = [...w.upstash.data.entries()].flat();
  const commands = w.upstash.commands.map((c) => c.join(' '));
  assert.ok(stored.length > 0 && logs.length > 0, 'something was stored and logged, so the check is not vacuous');
  for (const text of [...logs, ...stored, ...commands, ...w.limits]) {
    for (const marker of markers) assert.equal(text.includes(marker), false, `${marker} in ${text.slice(0, 120)}`);
  }
  for (const key of w.upstash.data.keys()) assert.match(key, /^halo:forecast:v1:[a-z-]+:-?\d+\.\d{2},-?\d+\.\d{2}:(\d{10}(:\d)?|last)$/);
  onlyReads(h);
  noUnexpected(h, w);
});

// ------------------------------------------------------------ F18-S stale serving

/** The 0.11 degree grid already holds the 18Z run while the 0.25 degree grid still holds 12Z: run_unknown. */
function gridsDisagree(w) {
  w.meta013.last_run_initialisation_time = META013.last_run_initialisation_time + 6 * 3600;
  w.meta013.last_run_availability_time = META013.last_run_availability_time + 6 * 3600;
  w.meta013.last_run_modification_time = META013.last_run_modification_time + 6 * 3600;
}

test('stale serving: while the run is unknown the last confirmed forecast is served, marked, expiring in 30 minutes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const logs = captureLogs(t);
  const w = forecastWorld();
  const h = harness(w);
  const fresh = await (await callForecast(h, { place: 'Charlotte' })).json();
  assert.ok(w.upstash.data.has(lastConfirmedKey('open-meteo', { lat: 35.21, lng: -80.83 })), 'kept under the hour-free key');

  // Two hours later, another instance (memory empty), and the grids disagree.
  const later = NOW + 2 * HOUR;
  t.mock.timers.setTime(later);
  _resetForecastCache();
  gridsDisagree(w);
  w.reset();
  const res = await callForecast(h, { place: 'Charlotte' });
  assert.equal(res.status, 200);
  const body = await res.json();
  screenAccepts(body);
  assert.equal(w.count('forecast'), 0, 'the unknown run is never fetched');
  assert.equal(w.count('meta'), 2);
  assert.equal(body.issuedAt, RUN, 'the served run keeps its own issue time');
  assert.equal(body.expiresAt, new Date(later + 30 * 60_000).toISOString());
  assert.match(body.coverage.Weather, /A newer model run is not yet confirmed, so this is the last confirmed run\./);
  assert.equal(body.version, fresh.version, 'the same content keeps its version (stale is not content)');
  assert.ok(body.periods.length > 0);
  // The screen: not expired, Refresh available until expiresAt.
  const live = { ...productionForecast({ data: body, error: null }), production: true };
  const d = outdoorDecisions({ live, draft: { date: DATE, place: 'Charlotte', period: 'Afternoon', key: 'k' }, today: '2026-10-19', review: { forecast: 'live' }, state: null, now: later, acknowledged: null, pauseForecast: false, validActionDate: () => true, dayAdd: () => '', forecastFixture: () => [] });
  assert.equal(d.expired, false);
  assert.equal(d.needsReview, false);
  assert.deepEqual(logs, ['Forecast provider open-meteo not used: run_unknown'], 'served, but the unknown run is logged as a token');

  // Only an unknown run is bridged: Open-Meteo failing outright is a 503 even with a confirmed forecast kept.
  t.mock.timers.setTime(later + HOUR);
  w.meta013 = structuredClone(META013);
  w.status.forecast = 500;
  const failed = await callForecast(h, { place: 'Charlotte' });
  assert.equal(failed.status, 503);
});

test('stale serving is refused once the last confirmed forecast is more than 8 hours old: 503 with Retry-After', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const logs = captureLogs(t);
  const w = forecastWorld();
  const h = harness(w);
  assert.equal((await callForecast(h, { place: 'Charlotte' })).status, 200);
  gridsDisagree(w);

  // 7 h 59 min after the fetch it is still served.
  t.mock.timers.setTime(NOW + 8 * HOUR - 60_000);
  assert.equal((await callForecast(h, { place: 'Charlotte' })).status, 200);

  // Past 8 hours it is not.
  t.mock.timers.setTime(NOW + 8 * HOUR + 60_000);
  const res = await callForecast(h, { place: 'Charlotte' });
  await expectEnvelope(res, { status: 503, code: 'upstream_unavailable' });
  assert.equal(res.headers.get('retry-after'), String(RUN_UNKNOWN_RETRY_MS / 1000));
  assert.ok(logs.includes('Forecast unavailable: open_meteo_run_unknown_stale'), logs.join('\n'));
});

test('no confirmed forecast at all while the run is unknown: 503 with Retry-After from the adapter\'s retryAfterMs', async (t) => {
  // One minute after the 0.25 degree grid became available: nine minutes of the documented wait remain.
  const availability = META025.last_run_availability_time * 1000;
  t.mock.timers.enable({ apis: ['Date'], now: availability + 60_000 });
  const logs = captureLogs(t);
  const w = forecastWorld();
  const h = harness(w);
  const res = await callForecast(h, { place: 'Charlotte' });
  await expectEnvelope(res, { status: 503, code: 'upstream_unavailable' });
  assert.equal(res.headers.get('retry-after'), '540');
  assert.equal(w.count('forecast'), 0);
  assert.ok(logs.includes('Forecast unavailable: open_meteo_run_unknown'));
  assert.equal(w.upstash.data.has(lastConfirmedKey('open-meteo', { lat: 35.21, lng: -80.83 })), false, 'nothing unconfirmed is kept as confirmed');
});

test('the profile read failing (profiles absent) is a 503 with Retry-After, never a 500, and calls no provider', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const logs = captureLogs(t);
  const w = forecastWorld();
  const h = harness(w, { tables: {} });
  const res = await callForecast(h);
  await expectEnvelope(res, { status: 503, code: 'upstream_unavailable' });
  assert.equal(res.headers.get('retry-after'), '60');
  assert.deepEqual(w.calls, []);
  assert.deepEqual(logs, ['Forecast profile read failed: PGRST205']);
  // A typed place needs no profile, so it still works.
  assert.equal((await callForecast(h, { place: 'Charlotte' })).status, 200);
});

test('a past date and a date past the horizon are 200 with no periods and full metadata', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const w = forecastWorld();
  const h = harness(w);
  for (const date of ['2026-10-18', '2026-11-30']) {
    const body = await (await callForecast(h, { place: 'Charlotte', date })).json();
    screenAccepts(body);
    assert.deepEqual(body.periods, [], date);
    assert.equal(body.horizonStart, '2026-10-19');
    assert.equal(body.horizonEnd, '2026-10-25');
  }
  assert.deepEqual(w.counts(), { forecast: 1, meta: 4, airnow: 1, nws: 1 }, 'the horizon does not depend on the date, so one round serves both');
});
