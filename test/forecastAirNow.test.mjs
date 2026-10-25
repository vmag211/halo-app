// B10 Task 5: the AirNow daily forecast adapter (plan ruling F6). Request, field
// mapping and sources: docs/backend/decisions/airnow-forecast-docs.md. Every
// call goes through a stubbed getJson on recorded-shape fixtures; global fetch
// is blocked and must never be reached. "No forecast here" and "could not
// check" must stay distinct, and an unknown AQI must never read as a low one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blockedFetch } from './helpers/sandbox.mjs';
import {
  AIRNOW_FORECAST_ENDPOINT,
  AIRNOW_TIMEOUT_MS,
  airNowForecastUrl,
  airNowKey,
  fetchAirNowForecast,
  parseAirNowForecast,
} from '../lib/forecast/airnow.js';
import { airNowAdapter, _setAirNowAdapter } from '../lib/forecast/airNowSlot.js';

const attempted = [];
globalThis.fetch = blockedFetch(attempted);

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/forecast/${name}`, import.meta.url), 'utf8'));
const NAPA = fixture('airnow-forecast-napa-recorded.json').response;
const NO_AREA = fixture('airnow-forecast-no-reporting-area.json').response;
const CHARLOTTE_ROWS = fixture('airnow-forecast-charlotte-shaped.json').response;
const CHARLOTTE = { lat: 35.2271, lng: -80.8431 };
// A made-up key; the real one lives only in the deployment's AIRNOW_API_KEY.
const KEY = 'FAKE-AIRNOW-KEY-0000-test';
const ENV = { AIRNOW_API_KEY: KEY };
const NOW = Date.parse('2026-10-19T20:07:00Z');

function stubGetJson(answers) {
  const calls = [];
  const queue = [...answers];
  const getJson = async (url, options) => {
    calls.push({ url, options });
    const next = queue.shift();
    if (!next) return { ok: false, reason: 'unexpected_call' };
    return typeof next === 'function' ? next() : next;
  };
  return { getJson, calls };
}
const ok = (json) => ({ ok: true, status: 200, json });
const fetchFor = (answers, env = ENV) => {
  const stub = stubGetJson(answers);
  return { stub, run: () => fetchAirNowForecast(CHARLOTTE, { getJson: stub.getJson, env, now: () => NOW }) };
};

test('the URL is the Current Forecasts service with the 2-decimal point and the key, no date and no distance', () => {
  const url = new URL(airNowForecastUrl(CHARLOTTE, ENV));
  assert.equal(`${url.origin}${url.pathname}`, 'https://www.airnowapi.org/aq/forecast/current/');
  assert.equal(AIRNOW_FORECAST_ENDPOINT, 'https://www.airnowapi.org/aq/forecast/current/');
  assert.deepEqual([...url.searchParams.entries()], [['format', 'application/json'], ['latitude', '35.23'], ['longitude', '-80.84'], ['API_KEY', KEY]]);
  for (const bad of [null, {}, { lat: 95, lng: 0 }]) assert.throws(() => airNowForecastUrl(bad, ENV), TypeError);
  assert.throws(() => airNowForecastUrl(CHARLOTTE, {}), TypeError);
});

test('the key: unset, empty, whitespace or with URL-breaking characters is no key', () => {
  assert.equal(airNowKey(ENV), KEY);
  assert.equal(airNowKey({ AIRNOW_API_KEY: `  ${KEY}  ` }), KEY);
  for (const env of [{}, undefined, null, { AIRNOW_API_KEY: '' }, { AIRNOW_API_KEY: '   ' }, { AIRNOW_API_KEY: 'short' }, { AIRNOW_API_KEY: 'abc&format=xml1234' }, { AIRNOW_API_KEY: 42 }]) {
    assert.equal(airNowKey(env), null, JSON.stringify(env));
  }
});

test('key missing: no_key and no call at all, so air is honestly "not checked"', async () => {
  for (const env of [{}, { AIRNOW_API_KEY: '' }]) {
    const { stub, run } = fetchFor([ok(CHARLOTTE_ROWS)], env);
    assert.deepEqual(await run(), { ok: false, reason: 'no_key' });
    assert.equal(stub.calls.length, 0);
  }
  assert.deepEqual(attempted, []);
});

test('the recorded Napa answer: one output row per received row, camelCase read, aqi -1 is null with its category kept', () => {
  const parsed = parseAirNowForecast(NAPA);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.rows.length, NAPA.length, 'nothing averaged, merged or spread across hours');
  assert.deepEqual(parsed.rows[0], { dateIssue: '2026-09-09', dateForecast: '2026-09-09', reportingArea: 'Napa', stateCode: 'CA', parameter: 'OZONE', aqi: 61, category: 'Moderate', actionDay: false });
  const unknown = parsed.rows.filter((r) => r.aqi === null);
  assert.equal(unknown.length, 4);
  for (const row of unknown) assert.equal(row.category, 'Good', 'a category was issued, a number was not');
  assert.deepEqual(parsed.rows.map((r) => r.dateForecast), ['2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14']);
});

test('dates with trailing spaces parse; impossible or malformed dates are null, never guessed', () => {
  const parsed = parseAirNowForecast(CHARLOTTE_ROWS);
  assert.equal(parsed.rows[0].dateIssue, '2026-10-19');
  assert.equal(parsed.rows[0].dateForecast, '2026-10-20');
  const odd = parseAirNowForecast([{ ...CHARLOTTE_ROWS[0], dateValid: '2026-02-30' }, { ...CHARLOTTE_ROWS[0], dateValid: '10/20/2026' }, { ...CHARLOTTE_ROWS[0], dateValid: undefined }]);
  assert.deepEqual(odd.rows.map((r) => r.dateForecast), [null, null, null]);
});

test('multiple pollutants for one date each survive with their own number and category; an action day is kept', () => {
  const rows = parseAirNowForecast(CHARLOTTE_ROWS).rows;
  const tomorrow = rows.filter((r) => r.dateForecast === '2026-10-20');
  assert.deepEqual(tomorrow.map((r) => [r.parameter, r.aqi, r.category]), [['OZONE', 55, 'Moderate'], ['PM2.5', null, 'Good']]);
  const action = rows.filter((r) => r.dateForecast === '2026-10-21');
  assert.deepEqual(action.map((r) => [r.parameter, r.aqi, r.category, r.actionDay]), [['OZONE', 105, 'Unhealthy for Sensitive Groups', true], ['PM2.5', 48, 'Good', true]]);
});

test('the retired service\'s PascalCase shape reads the same (DateForecast, Category.Name, AQI)', () => {
  const legacy = [{ DateIssue: '2026-10-19 ', DateForecast: '2026-10-20 ', ReportingArea: 'Charlotte', StateCode: 'NC', Latitude: 35.21, Longitude: -80.83, ParameterName: 'O3', AQI: -1, Category: { Number: 2, Name: 'Moderate' }, ActionDay: true, Discussion: '' }];
  assert.deepEqual(parseAirNowForecast(legacy).rows, [{ dateIssue: '2026-10-19', dateForecast: '2026-10-20', reportingArea: 'Charlotte', stateCode: 'NC', parameter: 'O3', aqi: null, category: 'Moderate', actionDay: true }]);
});

test('an unknown AQI is null whatever form it takes; 0 is a reading', () => {
  const aqis = [-1, -999, null, undefined, '55', Number.NaN, Number.POSITIVE_INFINITY, 0, 501];
  const rows = parseAirNowForecast(aqis.map((aqi) => ({ ...CHARLOTTE_ROWS[0], aqi }))).rows;
  assert.deepEqual(rows.map((r) => r.aqi), [null, null, null, null, null, null, null, 0, 501]);
});

test('a category outside AirNow\'s six names (number 7 Unavailable, a typo, a number) is not a category; letter case is not a difference', () => {
  const names = ['Unavailable', 'Fine', '', 3, 'Hazardous', 'moderate', 'Unhealthy for sensitive  groups'];
  const rows = parseAirNowForecast(names.map((categoryName) => ({ ...CHARLOTTE_ROWS[0], categoryName }))).rows;
  assert.deepEqual(rows.map((r) => r.category), [null, null, null, null, 'Hazardous', 'Moderate', 'Unhealthy for Sensitive Groups']);
  assert.equal(rows.length, names.length, 'a row without a category is still returned, never dropped');
});

test('a reporting area far from the point is named as received; no distance is computed or claimed', () => {
  // The new service does not return the area's point (the retired one did); the adapter keeps no coordinates.
  const far = [{ ...CHARLOTTE_ROWS[0], reportingArea: 'Coastal Plain', stateCode: 'NC', latitude: 34.2, longitude: -77.9 }];
  const [row] = parseAirNowForecast(far).rows;
  assert.equal(row.reportingArea, 'Coastal Plain');
  assert.deepEqual(Object.keys(row), ['dateIssue', 'dateForecast', 'reportingArea', 'stateCode', 'parameter', 'aqi', 'category', 'actionDay']);
});

test('an empty array and AirNow\'s "no reporting area" answer are a real "no forecast here", not a failure', async () => {
  assert.deepEqual(parseAirNowForecast([]), { ok: true, rows: [] });
  assert.deepEqual(parseAirNowForecast(NO_AREA), { ok: true, rows: [] });
  const { run } = fetchFor([ok(NO_AREA)]);
  assert.deepEqual(await run(), { ok: true, fetchedAt: new Date(NOW).toISOString(), rows: [] });
});

test('any other WebServiceError, a shapeless body or an unreadable row is a failure, never "no forecast"', () => {
  assert.deepEqual(parseAirNowForecast({ WebServiceError: [{ Message: 'Request not authenticated.' }] }), { ok: false, reason: 'provider_error' });
  assert.deepEqual(parseAirNowForecast({ WebServiceError: [] }), { ok: false, reason: 'provider_error' });
  assert.deepEqual(parseAirNowForecast({ WebServiceError: [{ Message: 'Error - There is no reporting area at your searched location' }, { Message: 'Limit reached' }] }), { ok: false, reason: 'provider_error' });
  for (const body of [null, {}, 'Moderate', 42, { rows: [] }]) assert.deepEqual(parseAirNowForecast(body), { ok: false, reason: 'invalid' }, JSON.stringify(body));
  assert.deepEqual(parseAirNowForecast([CHARLOTTE_ROWS[0], null]), { ok: false, reason: 'invalid' }, 'a row that cannot be read might be the worst pollutant');
  assert.deepEqual(parseAirNowForecast([CHARLOTTE_ROWS[0], ['x']]), { ok: false, reason: 'invalid' });
});

test('a fetch: one call with the timeout and body cap, the fixed shape out, fetchedAt from the clock', async () => {
  const { stub, run } = fetchFor([ok(CHARLOTTE_ROWS)]);
  const answer = await run();
  assert.equal(answer.ok, true);
  assert.equal(answer.fetchedAt, '2026-10-19T20:07:00.000Z');
  assert.equal(answer.rows.length, 4);
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0].url, airNowForecastUrl(CHARLOTTE, ENV));
  assert.equal(stub.calls[0].options.timeoutMs, AIRNOW_TIMEOUT_MS);
  assert.equal(stub.calls[0].options.timeoutMs, 6000, 'F8');
  assert.equal(stub.calls[0].options.maxBytes, 2 * 1024 * 1024);
  assert.deepEqual(attempted, []);
});

test('errors: a 401, a timeout, an HTML error page, a network failure and a throwing helper are failures whose reason has no key', async () => {
  for (const [answer, reason] of [
    [{ ok: false, reason: 'http_401' }, 'http_401'],
    [{ ok: false, reason: 'timeout' }, 'timeout'],
    [{ ok: false, reason: 'invalid' }, 'invalid'],
    [{ ok: false, reason: 'network' }, 'network'],
    [{ ok: false, reason: 'http_500' }, 'http_500'],
    [{ ok: false, reason: `failed at ${airNowForecastUrl(CHARLOTTE, ENV)}` }, 'invalid'],
    [() => { throw new Error(airNowForecastUrl(CHARLOTTE, ENV)); }, 'invalid'],
    [() => null, 'invalid'],
  ]) {
    const { run } = fetchFor([answer]);
    const result = await run();
    assert.deepEqual(result, { ok: false, reason }, JSON.stringify(answer));
    assert.equal(JSON.stringify(result).includes(KEY), false);
  }
});

test('no getJson or no usable point: invalid, and no call', async () => {
  assert.deepEqual(await fetchAirNowForecast(CHARLOTTE, { env: ENV }), { ok: false, reason: 'invalid' });
  const stub = stubGetJson([ok(CHARLOTTE_ROWS)]);
  assert.deepEqual(await fetchAirNowForecast({ lat: 'x', lng: 1 }, { getJson: stub.getJson, env: ENV }), { ok: false, reason: 'invalid' });
  assert.equal(stub.calls.length, 0);
});

test('the slot holds the real adapter; null empties it (not connected) and undefined restores it', () => {
  assert.equal(airNowAdapter(), fetchAirNowForecast);
  _setAirNowAdapter(null);
  assert.equal(airNowAdapter(), null);
  _setAirNowAdapter(undefined);
  assert.equal(airNowAdapter(), fetchAirNowForecast);
  assert.throws(() => _setAirNowAdapter('fetchAirNowForecast'), TypeError);
});
