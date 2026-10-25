/**
 * GET /api/forecast with the REAL AirNow forecast adapter (lib/forecast/airnow.js,
 * B10 Task 5) wired through lib/forecast/airNowSlot.js, end to end on the
 * isolated route harness of test/helpers/forecastRoute.mjs. Nothing stands in
 * for the adapter: the world's fetch stub answers AirNow's host with the
 * recorded-shape bodies in test/fixtures/forecast/airnow-forecast-*.json (or
 * rows edited per test), and every other host is refused and recorded.
 *
 * Each scenario asserts the body, what the screen then shows (the "Air" or
 * "Air, daily" cell and the Air coverage, through the transcribed screen logic
 * in test/helpers/frontendB10.mjs), that no unexpected host was reached, and
 * that the body validates against docs/backend/contracts/b10.openapi.json the
 * way test/contractsB10.test.mjs validates it.
 */
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { productionForecast, forecastScreenText } from './helpers/frontendB10.mjs';
import {
  FORECAST_ENV,
  FORECAST_NOW as NOW,
  HOUR,
  FORECAST_DATE as DATE,
  forecastWorld,
  forecastHarness as harness,
  callForecast,
  captureLogs,
} from './helpers/forecastRoute.mjs';
import { _resetForecastCache } from '../lib/forecast/cache.js';
import { _setAirNowAdapter } from '../lib/forecast/airNowSlot.js';

const EM_DASH = String.fromCharCode(0x2014);
const KEY = FORECAST_ENV.AIRNOW_API_KEY;
const NEXT_DATE = '2026-10-21';
const CHARLOTTE_PREFIX = 'For Charlotte, NC (Census internal point):';

const recorded = (name) => JSON.parse(readFileSync(new URL(`./fixtures/forecast/${name}`, import.meta.url), 'utf8')).response;
const CHARLOTTE_SHAPED = recorded('airnow-forecast-charlotte-shaped.json');
const NO_REPORTING_AREA = recorded('airnow-forecast-no-reporting-area.json');

// ------------------------------------------------------------- the contract

const contract = JSON.parse(readFileSync(new URL('../docs/backend/contracts/b10.openapi.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema({ $id: 'urn:halo:b10', components: contract.components });
const OP = contract.paths['/api/forecast'].get;
const compiled = new Map();
function contractAccepts(status, body) {
  const response = OP.responses[String(status)];
  assert.ok(response, `undocumented status ${status}`);
  const ref = response.content['application/json'].schema.$ref;
  if (!compiled.has(ref)) compiled.set(ref, ajv.compile({ $ref: `urn:halo:b10${ref}` }));
  const check = compiled.get(ref);
  assert.equal(check(body), true, `forecastRead ${status}: ${ajv.errorsText(check.errors)}`);
}

// ------------------------------------------------------------------ helpers

beforeEach(() => {
  _resetForecastCache();
  _setAirNowAdapter(undefined); // the real adapter, as production wires it
});
after(() => _setAirNowAdapter(undefined));

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

const everyString = (value, out = []) => {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) everyString(v, out);
  return out;
};

/** One 200 answer, checked by the contract and the client; returns the body and what the screen shows. */
async function read(h, options) {
  const res = await callForecast(h, options);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const body = await res.json();
  contractAccepts(200, body);
  screenAccepts(body);
  for (const text of everyString(body)) assert.equal(text.includes(EM_DASH), false, text);
  assert.equal(JSON.stringify(body).includes(KEY), false, 'the AirNow key never reaches the body');
  const live = { ...productionForecast({ data: body, error: null }), production: true };
  const screens = body.periods.map((p) => forecastScreenText(live, p));
  return { body, screens, shown: screens[0] ?? forecastScreenText(live, null) };
}

/** Every period carries `air: null` and the same daily string; every screen cell shows it. */
function dailyEverywhere(body, screens, daily) {
  assert.ok(body.periods.length > 0, 'periods are present, so the check is not vacuous');
  for (const p of body.periods) {
    assert.equal(p.air, null, 'AirNow is daily: no number per period (F6)');
    assert.equal(p.airDaily, daily);
  }
  for (const s of screens) {
    assert.equal(s.cells.airLabel, daily === null ? 'Air' : 'Air, daily');
    assert.equal(s.cells.air, daily === null ? 'Unavailable' : daily);
  }
}

const row = (over) => ({
  dateIssue: '2026-10-19', dateValid: DATE, reportingArea: 'Charlotte', reportingAreaCode: 'nc-test', stateCode: 'NC',
  parameterName: 'OZONE', aqi: 50, forecastAgency: 'Test agency', categoryNumber: 1, categoryName: 'Good', actionDay: false, discussion: '',
  ...over,
});

// ---------------------------------------------------------------- the tests

test('happy path, charlotte-shaped rows: the worst category and its pollutant, area provenance, the 2-decimal request, the key in no log or body', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const logs = captureLogs(t);
  const w = forecastWorld();
  w.airnow = structuredClone(CHARLOTTE_SHAPED);
  const h = harness(w);
  const { body, screens, shown } = await read(h, { place: 'Charlotte' });

  assert.equal(body.periods.length, 3);
  dailyEverywhere(body, screens, 'Moderate (AQI 55), ozone');
  assert.equal(body.source, 'Open-Meteo, EPA AirNow and the National Weather Service, for Charlotte, NC');
  const air = shown.coverage.Air;
  assert.ok(air.startsWith(`${CHARLOTTE_PREFIX} EPA AirNow forecast for the Charlotte, NC reporting area, issued 2026-10-19, for 2026-10-20 as a whole day:`), air);
  assert.match(air, /ozone Moderate \(AQI 55\) and PM2\.5 Good \(category only, no AQI number issued\)\./);
  assert.match(air, /This is the forecast for the reporting area, not your exact location\./);
  assert.match(air, /AirNow forecast dates for this area: 2026-10-20 and 2026-10-21\./);
  assert.equal(/action day/.test(air), false, 'no action day on 2026-10-20');
  for (const p of body.periods) {
    assert.match(p.tradeoff, /Air is a daily AirNow forecast, the same for every period: ozone Moderate \(AQI 55\) and PM2\.5 Good \(category only, no AQI number issued\)\.$/);
    assert.match(p.version, /; AirNow 2026-10-19$/);
  }

  // The request: Current Forecasts, exactly four query keys, the 2-decimal gazetteer point.
  assert.deepEqual(w.counts(), { forecast: 1, meta: 4, airnow: 1, nws: 1 });
  const call = w.calls.find((c) => c.kind === 'airnow');
  const url = new URL(call.url);
  assert.equal(url.origin, 'https://www.airnowapi.org');
  assert.equal(url.pathname, '/aq/forecast/current/');
  assert.deepEqual([...url.searchParams.keys()], ['format', 'latitude', 'longitude', 'API_KEY']);
  assert.equal(url.searchParams.get('format'), 'application/json');
  assert.match(url.searchParams.get('latitude'), /^-?\d+\.\d{2}$/);
  assert.match(url.searchParams.get('longitude'), /^-?\d+\.\d{2}$/);
  assert.deepEqual([url.searchParams.get('latitude'), url.searchParams.get('longitude')], ['35.21', '-80.83']);
  assert.equal(url.searchParams.get('API_KEY'), KEY);
  assert.equal(call.headers.accept, 'application/json');

  // The key travels in that one URL only: no log line, cache key, cache value or limiter key carries it.
  for (const other of w.calls.filter((c) => c.kind !== 'airnow')) assert.equal(other.url.includes(KEY), false, other.url);
  for (const line of logs) assert.equal(line.includes(KEY), false, line);
  for (const text of [...w.upstash.data.keys(), ...w.upstash.data.values(), ...w.upstash.commands.map((c) => c.join(' ')), ...w.limits]) {
    assert.equal(text.includes(KEY), false, text.slice(0, 120));
  }
  noUnexpected(h, w);
});

test('AQI -1 only (category-only rows): the category with no number, never an invented AQI', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const cases = [
    {
      what: 'one category-only row is the worst',
      rows: [row({ parameterName: 'OZONE', aqi: -1, categoryName: 'Moderate', categoryNumber: 2 }), row({ parameterName: 'PM2.5', aqi: -1, categoryName: 'Good' })],
      daily: 'Moderate, ozone',
    },
    {
      what: 'two category-only rows tie on the worst category: both named, no number',
      rows: [row({ parameterName: 'OZONE', aqi: -1, categoryName: 'Moderate', categoryNumber: 2 }), row({ parameterName: 'PM2.5', aqi: -1, categoryName: 'Moderate', categoryNumber: 2 })],
      daily: 'Moderate, ozone and PM2.5',
    },
    {
      what: 'a numbered row ties with a category-only row: the unknown number may be higher, so no number',
      rows: [row({ parameterName: 'OZONE', aqi: 60, categoryName: 'Moderate', categoryNumber: 2 }), row({ parameterName: 'PM2.5', aqi: -1, categoryName: 'Moderate', categoryNumber: 2 })],
      daily: 'Moderate, ozone and PM2.5',
    },
  ];
  for (const { what, rows, daily } of cases) {
    _resetForecastCache();
    const w = forecastWorld();
    w.airnow = rows;
    const h = harness(w);
    const { body, screens, shown } = await read(h, { place: 'Charlotte' });
    dailyEverywhere(body, screens, daily);
    for (const s of screens) assert.equal(/AQI\s*-?\d/.test(s.cells.air), false, `${what}: ${s.cells.air}`);
    assert.match(shown.coverage.Air, /\(category only, no AQI number issued\)/, what);
    assert.equal(/AQI -1/.test(shown.coverage.Air), false, `${what}: -1 is never shown as a number`);
    noUnexpected(h, w);
  }
});

test('several pollutants and an action day (2026-10-21 rows of the charlotte-shaped fixture): the worst wins, is named, and the day is said', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const w = forecastWorld();
  w.airnow = structuredClone(CHARLOTTE_SHAPED);
  const h = harness(w);
  const { body, screens, shown } = await read(h, { place: 'Charlotte', date: NEXT_DATE });
  assert.ok(body.horizonEnd >= NEXT_DATE, `2026-10-21 is in the horizon (${body.horizonEnd})`);
  assert.equal(body.periods.length, 3);
  dailyEverywhere(body, screens, 'Unhealthy for Sensitive Groups (AQI 105), ozone, air quality action day');
  for (const s of screens) assert.ok(s.cells.air.endsWith(', air quality action day'));
  assert.match(shown.coverage.Air, /for 2026-10-21 as a whole day: ozone Unhealthy for Sensitive Groups \(AQI 105\) and PM2\.5 Good \(AQI 48\)\./);
  assert.match(shown.coverage.Air, /An air quality action day is declared\./);
  assert.equal(shown.coverage.Air.includes('Ozone action day.'), false, 'the discussion text is not used (F6)');

  // A worse PM2.5 than ozone on the same date: the pollutant named is the one that set the category.
  _resetForecastCache();
  const w2 = forecastWorld();
  w2.airnow = [
    row({ parameterName: 'OZONE', aqi: 45, categoryName: 'Good' }),
    row({ parameterName: 'PM2.5', aqi: 160, categoryName: 'Unhealthy', categoryNumber: 4 }),
    row({ parameterName: 'PM10', aqi: 90, categoryName: 'Moderate', categoryNumber: 2 }),
  ];
  const h2 = harness(w2);
  const second = await read(h2, { place: 'Charlotte' });
  dailyEverywhere(second.body, second.screens, 'Unhealthy (AQI 160), PM2.5');
  assert.match(second.shown.coverage.Air, /ozone Good \(AQI 45\), PM2\.5 Unhealthy \(AQI 160\) and PM10 Moderate \(AQI 90\)/);
  noUnexpected(h, w);
  noUnexpected(h2, w2);
});

test('a reporting area far from the point is named as received, with no distance claimed', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const w = forecastWorld();
  w.airnow = [row({ reportingArea: 'Coastal Plain', aqi: 38 })];
  const h = harness(w);
  const { body, screens, shown } = await read(h, { place: 'Charlotte' });
  dailyEverywhere(body, screens, 'Good (AQI 38), ozone');
  assert.match(shown.coverage.Air, /EPA AirNow forecast for the Coastal Plain, NC reporting area, issued 2026-10-19/);
  assert.match(shown.coverage.Air, /not your exact location/);
  assert.equal(/\b(mile|miles|km|kilometres?|kilometers?|distance|nearby|nearest|away)\b/i.test(shown.coverage.Air), false, shown.coverage.Air);
  assert.equal(shown.coverage.Air.includes('Charlotte'), true, 'only in the place prefix');
  assert.equal(shown.coverage.Air.indexOf('Charlotte'), shown.coverage.Air.lastIndexOf('Charlotte'), 'the area is not relabelled as the place');
  noUnexpected(h, w);
});

test('an empty array and the recorded no-reporting-area answer: no forecast for this area, distinct from not checked', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const logs = captureLogs(t);
  for (const [what, served] of [['empty array', []], ['no reporting area (recorded)', NO_REPORTING_AREA]]) {
    _resetForecastCache();
    const w = forecastWorld();
    w.airnow = structuredClone(served);
    const h = harness(w);
    const { body, screens, shown } = await read(h, { place: 'Charlotte' });
    dailyEverywhere(body, screens, null);
    assert.equal(shown.coverage.Air, `${CHARLOTTE_PREFIX} EPA AirNow has no air forecast for this area. Check AirNow before going.`, what);
    assert.equal(/not checked|could not be reached/.test(shown.coverage.Air), false, what);
    for (const p of body.periods) assert.match(p.tradeoff, /No air forecast for this date\.$/, what);
    assert.equal(body.source, 'Open-Meteo and the National Weather Service, for Charlotte, NC', `${what}: AirNow gave nothing, so it is not named`);
    assert.equal(w.count('airnow'), 1, what);
    noUnexpected(h, w);
  }
  assert.deepEqual(logs, [], 'a definitive "no forecast here" is not a provider failure');
});

test('AirNow errors (HTTP 401, HTTP 500, a WebServiceError other than no reporting area): air not checked, other providers unaffected, remembered for 60 s', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const logs = captureLogs(t);
  const cases = [
    ['HTTP 401', (w) => { w.status.airnow = 401; }, 'http_401'],
    ['HTTP 500', (w) => { w.status.airnow = 500; }, 'http_500'],
    ['WebServiceError, not authenticated', (w) => { w.airnow = { WebServiceError: [{ Message: 'Request not authenticated.' }] }; }, 'provider_error'],
    ['WebServiceError, no reporting area mixed with another', (w) => { w.airnow = { WebServiceError: [{ Message: 'Error - There is no reporting area at your searched location' }, { Message: 'Hourly request limit reached.' }] }; }, 'provider_error'],
  ];
  for (const [what, arrange, token] of cases) {
    t.mock.timers.setTime(NOW);
    _resetForecastCache();
    logs.length = 0;
    const w = forecastWorld();
    arrange(w);
    const h = harness(w);
    const { body, screens, shown } = await read(h, { place: 'Charlotte' });
    dailyEverywhere(body, screens, null);
    assert.equal(shown.coverage.Air, `${CHARLOTTE_PREFIX} Air was not checked. The EPA AirNow forecast could not be reached. Check AirNow before going.`, what);
    assert.equal(/has no air forecast/.test(shown.coverage.Air), false, `${what}: never read as "no forecast here"`);
    assert.equal(body.source, 'Open-Meteo and the National Weather Service, for Charlotte, NC', `${what}: AirNow is not named`);
    assert.match(body.warningStatus, /^No National Weather Service alerts are active for this area as of /, `${what}: NWS unaffected`);
    assert.ok(shown.coverage.Weather.startsWith(`${CHARLOTTE_PREFIX} Open-Meteo GFS Global model forecast`), `${what}: Open-Meteo unaffected`);
    for (const p of body.periods) assert.match(p.tradeoff, /Air was not checked for this date\.$/, what);
    assert.deepEqual(logs, [`Forecast provider airnow not used: ${token}`], what);
    for (const line of logs) assert.equal(line.includes(KEY) || line.includes('airnowapi'), false, `${what}: no URL or key in a log`);
    assert.equal(w.count('airnow'), 1, what);

    // Within 60 s: the failure is remembered, no new AirNow call (and nothing else either).
    w.reset();
    t.mock.timers.setTime(NOW + 59_000);
    const again = await read(h, { place: 'Charlotte' });
    assert.equal(again.shown.coverage.Air, shown.coverage.Air, what);
    assert.deepEqual(w.counts(), { forecast: 0, meta: 0, airnow: 0, nws: 0 }, `${what}: negative cache`);
    assert.deepEqual(w.limits, [], `${what}: a remembered failure costs no token`);

    // After the window, AirNow is asked again (same hour, so the others stay cached).
    w.reset();
    t.mock.timers.setTime(NOW + 61_000);
    await read(h, { place: 'Charlotte' });
    assert.deepEqual(w.counts(), { forecast: 0, meta: 0, airnow: 1, nws: 0 }, `${what}: retried after 60 s`);
    noUnexpected(h, w);
  }
});

test('the AirNow budget refused: zero AirNow calls and the hourly-limit coverage', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const logs = captureLogs(t);
  const w = forecastWorld();
  w.airnow = structuredClone(CHARLOTTE_SHAPED);
  w.decide = (key) => key !== 'forecast:airnow:hour';
  const h = harness(w);
  const { body, screens, shown } = await read(h, { place: 'Charlotte' });
  dailyEverywhere(body, screens, null);
  assert.equal(shown.coverage.Air, `${CHARLOTTE_PREFIX} Air was not checked. HALO's hourly limit for AirNow requests was reached. Check AirNow before going.`);
  assert.deepEqual(w.counts(), { forecast: 1, meta: 4, airnow: 0, nws: 1 });
  assert.equal(w.limits.filter((k) => k === 'forecast:airnow:hour').length, 1);
  assert.equal(body.source, 'Open-Meteo and the National Weather Service, for Charlotte, NC');
  assert.deepEqual(logs, ['Forecast provider airnow not used: budget']);
  noUnexpected(h, w);
});

test('AIRNOW_API_KEY missing or empty: zero AirNow calls, the connection is not set up', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const logs = captureLogs(t);
  const { AIRNOW_API_KEY: _unused, ...withoutKey } = FORECAST_ENV;
  const envs = [
    ['unset', withoutKey],
    ['empty', { ...withoutKey, AIRNOW_API_KEY: '' }],
    ['blank', { ...withoutKey, AIRNOW_API_KEY: '   ' }],
  ];
  for (const [what, env] of envs) {
    _resetForecastCache();
    logs.length = 0;
    const w = forecastWorld();
    w.airnow = structuredClone(CHARLOTTE_SHAPED);
    const h = harness(w, { env });
    const { body, screens, shown } = await read(h, { place: 'Charlotte' });
    dailyEverywhere(body, screens, null);
    assert.equal(shown.coverage.Air, `${CHARLOTTE_PREFIX} Air was not checked. HALO's AirNow forecast connection is not set up. Check AirNow before going.`, what);
    assert.deepEqual(w.counts(), { forecast: 1, meta: 4, airnow: 0, nws: 1 }, what);
    assert.equal(body.source, 'Open-Meteo and the National Weather Service, for Charlotte, NC', what);
    // Without a key there is no AirNow provider at all: no AirNow token, no cache entry, no log line.
    assert.equal(w.limits.includes('forecast:airnow:hour'), false, `${what}: no AirNow budget spent`);
    assert.equal([...w.upstash.data.keys()].some((k) => k.includes(':airnow:')), false, `${what}: nothing cached for AirNow`);
    assert.deepEqual(logs, [], what);
    noUnexpected(h, w);
  }
});

test('one AirNow call serves every validity date: two dates in the same hour, one call, each its own daily cell', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const w = forecastWorld();
  w.airnow = structuredClone(CHARLOTTE_SHAPED);
  const h = harness(w);
  const first = await read(h, { place: 'Charlotte', date: DATE });
  t.mock.timers.setTime(NOW + 20 * 60_000);
  const second = await read(h, { place: 'Charlotte', date: NEXT_DATE });
  assert.equal(w.count('airnow'), 1, 'one call for both dates');
  dailyEverywhere(first.body, first.screens, 'Moderate (AQI 55), ozone');
  dailyEverywhere(second.body, second.screens, 'Unhealthy for Sensitive Groups (AQI 105), ozone, air quality action day');
  assert.notEqual(first.body.version, second.body.version);

  // A date the agency issued nothing for, from the same cached answer: no forecast for that date, not "not checked".
  const later = await read(h, { place: 'Charlotte', date: '2026-10-22' });
  assert.equal(w.count('airnow'), 1);
  dailyEverywhere(later.body, later.screens, null);
  assert.equal(later.shown.coverage.Air, `${CHARLOTTE_PREFIX} EPA AirNow issued no air forecast for 2026-10-22 for the Charlotte, NC reporting area. AirNow forecast dates for this area: 2026-10-20 and 2026-10-21. Check AirNow before going.`);

  // The next hour is a new key: one more call.
  t.mock.timers.setTime(NOW + HOUR);
  await read(h, { place: 'Charlotte', date: DATE });
  assert.equal(w.count('airnow'), 2);
  noUnexpected(h, w);
});

test('the slot emptied: no AirNow call and no AirNow token, the connection is not set up', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  _setAirNowAdapter(null);
  const w = forecastWorld();
  w.airnow = structuredClone(CHARLOTTE_SHAPED);
  const h = harness(w);
  const { body, screens, shown } = await read(h, { place: 'Charlotte' });
  dailyEverywhere(body, screens, null);
  assert.match(shown.coverage.Air, /Air was not checked\. HALO's AirNow forecast connection is not set up\./);
  assert.deepEqual(w.counts(), { forecast: 1, meta: 4, airnow: 0, nws: 1 });
  assert.equal(w.limits.includes('forecast:airnow:hour'), false);
  noUnexpected(h, w);
});

test('the saved home goes out at its own 2-decimal point and the snapshot validates', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const w = forecastWorld();
  w.airnow = structuredClone(CHARLOTTE_SHAPED);
  const h = harness(w);
  const { body, screens, shown } = await read(h, {});
  dailyEverywhere(body, screens, 'Moderate (AQI 55), ozone');
  assert.ok(shown.coverage.Air.startsWith('For your home area: EPA AirNow forecast for the Charlotte, NC reporting area'));
  const url = new URL(w.calls.find((c) => c.kind === 'airnow').url);
  assert.deepEqual([url.searchParams.get('latitude'), url.searchParams.get('longitude')], ['35.23', '-80.84']);
  assert.equal(/35\.227|80\.843/.test(url.href), false, 'the stored 3-decimal point never leaves');
  noUnexpected(h, w);
});
