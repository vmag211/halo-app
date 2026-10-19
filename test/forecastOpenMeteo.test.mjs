// B10 Task 4: the Open-Meteo adapter (plan rulings F3, F5, F17; review R1, N1 to N6).
// Every call goes through a stubbed getJson; global fetch is blocked and must never be reached.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blockedFetch } from './helpers/sandbox.mjs';
import { wireHeaders } from './helpers/forecastWire.mjs';
import {
  GFS_HOURLY_UNTIL_HOURS,
  OPEN_METEO_MAX_BYTES,
  OPEN_METEO_MODEL,
  RUN_UNKNOWN_RETRY_MS,
  fetchOpenMeteo,
  metaUrls,
  openMeteoUrl,
  parseForecast,
  parseMeta,
} from '../lib/forecast/openMeteo.js';

const attempted = [];
globalThis.fetch = blockedFetch(attempted);

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/forecast/${name}`, import.meta.url), 'utf8'));
const response = (name) => fixture(name).response;

const RECORDED = response('open-meteo-forecast-charlotte.json');
const META013 = response('open-meteo-meta-gfs013.json');
const META025 = response('open-meteo-meta-gfs025.json');
const LAG013 = response('open-meteo-meta-lagging-gfs013.json');
const LAG025 = response('open-meteo-meta-lagging-gfs025.json');
const INIT = META013.last_run_initialisation_time;
const LATER_AVAILABLE_MS = Math.max(META013.last_run_availability_time, META025.last_run_availability_time) * 1000;
const EARLIER_AVAILABLE_MS = Math.min(META013.last_run_availability_time, META025.last_run_availability_time) * 1000;
const minutesAfterAvailability = (minutes) => LATER_AVAILABLE_MS + minutes * 60 * 1000;
const CHARLOTTE = { lat: 35.2271, lng: -80.8431 };
const URL013 = 'https://api.open-meteo.com/data/ncep_gfs013/static/meta.json';
const URL025 = 'https://api.open-meteo.com/data/ncep_gfs025/static/meta.json';

/** A getJson stub answering from per-URL queues and recording every call. */
function stubGetJson({ meta013 = [], meta025 = [], forecast = [] } = {}) {
  const calls = [];
  const queues = { meta013: [...meta013], meta025: [...meta025], forecast: [...forecast] };
  const getJson = async (url, options) => {
    const kind = url === URL013 ? 'meta013' : url === URL025 ? 'meta025' : url.startsWith('https://api.open-meteo.com/v1/forecast?') ? 'forecast' : 'other';
    calls.push({ kind, url, options });
    const next = queues[kind]?.shift();
    if (!next) return { ok: false, reason: 'unexpected_call' };
    return typeof next === 'function' ? next() : next;
  };
  return { getJson, calls };
}
const ok = (json) => ({ ok: true, status: 200, json });
const agreeing = (forecast = ok(RECORDED)) => ({ meta013: [ok(META013), ok(META013)], meta025: [ok(META025), ok(META025)], forecast: [forecast] });
const FULL_SEQUENCE = ['meta013', 'meta025', 'forecast', 'meta013', 'meta025'];

test('the recorded metadata pair agrees on one run, and the lagging pair does not', () => {
  assert.equal(META025.last_run_initialisation_time, INIT);
  assert.notEqual(META013.last_run_availability_time, META025.last_run_availability_time, 'the grids arrive apart');
  assert.ok(LAG013.last_run_initialisation_time > LAG025.last_run_initialisation_time, '0.11 degree ahead of 0.25 degree');
});

test('the URL carries exactly the pinned parameters, unixtime among them, at 2 decimals', () => {
  const url = new URL(openMeteoUrl(CHARLOTTE));
  assert.equal(`${url.origin}${url.pathname}`, 'https://api.open-meteo.com/v1/forecast');
  assert.deepEqual([...url.searchParams], [
    ['latitude', '35.23'],
    ['longitude', '-80.84'],
    ['hourly', 'temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,uv_index'],
    ['models', 'ncep_gfs_global'],
    ['timezone', 'auto'],
    ['timeformat', 'unixtime'],
    ['forecast_days', '8'],
    ['temperature_unit', 'fahrenheit'],
    ['wind_speed_unit', 'mph'],
    ['precipitation_unit', 'inch'],
  ]);
  // Precipitation probability is a GEFS ensemble product from another run, so it is never requested.
  assert.ok(!url.search.includes('precipitation_probability'));
  assert.equal(OPEN_METEO_MODEL, 'ncep_gfs_global');
  assert.deepEqual(metaUrls(), [URL013, URL025]);
  assert.equal(GFS_HOURLY_UNTIL_HOURS, 120);
});

test('the URL never sends more precision than 2 decimals, and refuses a non-point', () => {
  assert.match(openMeteoUrl({ lat: 35.123456, lng: -80.987654 }), /latitude=35\.12&longitude=-80\.99&/);
  assert.match(openMeteoUrl({ lat: '35.2', lng: '-80.8' }), /latitude=35\.20&longitude=-80\.80&/);
  for (const bad of [null, {}, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: Number.NaN, lng: 0 }, { lat: '', lng: '' }, { lat: true, lng: 1 }]) {
    assert.throws(() => openMeteoUrl(bad), TypeError);
  }
});

test('the recorded forecast parses: seconds become milliseconds, one array index per hour', () => {
  const parsed = parseForecast(RECORDED);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.timezone, 'America/New_York');
  const { time } = RECORDED.hourly;
  assert.equal(parsed.hours.length, time.length);
  assert.equal(parsed.hours.length, 192);
  assert.equal(RECORDED.hourly_units.precipitation, 'inch');
  parsed.hours.forEach((hour, i) => {
    assert.deepEqual(Object.keys(hour), ['t', 'temperatureF', 'apparentF', 'precipPct', 'precipIn', 'weatherCode', 'windMph', 'uv']);
    assert.equal(hour.t, time[i] * 1000);
    assert.equal(hour.temperatureF, RECORDED.hourly.temperature_2m[i]);
    assert.equal(hour.apparentF, RECORDED.hourly.apparent_temperature[i]);
    assert.equal(hour.precipIn, RECORDED.hourly.precipitation[i]);
    assert.equal(hour.weatherCode, RECORDED.hourly.weather_code[i]);
    assert.equal(hour.windMph, RECORDED.hourly.wind_speed_10m[i]);
    assert.equal(hour.uv, RECORDED.hourly.uv_index[i]);
    assert.equal(hour.precipPct, null, 'not requested, so missing, never 0');
  });
  assert.equal(new Date(parsed.hours[0].t).toISOString(), '2026-10-19T04:00:00.000Z');
});

test('generationtime_ms is ignored: changing or removing it changes nothing', () => {
  const base = parseForecast(RECORDED);
  const without = { ...RECORDED };
  delete without.generationtime_ms;
  assert.deepEqual(parseForecast(without), base);
  assert.deepEqual(parseForecast({ ...RECORDED, generationtime_ms: 'not a number' }), base);
  assert.ok(!JSON.stringify(base).includes('generation'));
});

test('a null value stays null, never 0, and its neighbours are untouched', () => {
  const source = response('open-meteo-forecast-null-values.json');
  const parsed = parseForecast(source);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.hours.length, 24);
  assert.equal(parsed.hours[13].temperatureF, null);
  assert.equal(parsed.hours[14].uv, null);
  assert.equal(parsed.hours[13].uv, source.hourly.uv_index[13]);
  assert.equal(parsed.hours[14].temperatureF, source.hourly.temperature_2m[14]);
  // A real modelled UV of 0 at night stays 0, and so does a real 0 in of rain.
  assert.equal(parsed.hours[0].uv, 0);
  assert.equal(parsed.hours[0].precipIn, source.hourly.precipitation[0]);
  const rainless = structuredClone(source);
  rainless.hourly.precipitation[5] = null;
  assert.equal(parseForecast(rainless).hours[5].precipIn, null);
});

test('malformed forecasts are invalid: each hand-edited fixture, the error body, and non-JSON', () => {
  for (const name of [
    'open-meteo-forecast-unequal-lengths.json',
    'open-meteo-forecast-no-hourly.json',
    'open-meteo-forecast-timezone-number.json',
    'open-meteo-forecast-offsetless-time.json',
    'open-meteo-forecast-empty-arrays.json',
    'open-meteo-forecast-unknown-model.json',
    'open-meteo-error-400.json',
  ]) {
    assert.deepEqual(parseForecast(response(name)), { ok: false, reason: 'invalid' }, name);
  }
  for (const notJson of ['<html><body>502 Bad Gateway</body></html>', '', null, undefined, 42, [], [RECORDED]]) {
    assert.deepEqual(parseForecast(notJson), { ok: false, reason: 'invalid' }, String(notJson));
  }
});

test('each missing or mistyped field is invalid on its own', () => {
  const base = response('open-meteo-forecast-24h.json');
  assert.equal(parseForecast(base).ok, true, 'the control parses');
  const broken = {
    'a missing variable array': (b) => { delete b.hourly.uv_index; },
    'no precipitation array': (b) => { delete b.hourly.precipitation; },
    'missing hourly_units': (b) => { delete b.hourly_units; },
    'a missing unit': (b) => { delete b.hourly_units.wind_speed_10m; },
    'Celsius where Fahrenheit was asked': (b) => { b.hourly_units.temperature_2m = '°C'; },
    'millimetres where inches were asked': (b) => { b.hourly_units.precipitation = 'mm'; },
    'a UV index the model does not serve': (b) => { b.hourly_units.uv_index = 'undefined'; },
    'negative precipitation': (b) => { b.hourly.precipitation[3] = -0.01; },
    'a string value': (b) => { b.hourly.temperature_2m[3] = '61.2'; },
    'a fractional weather code': (b) => { b.hourly.weather_code[3] = 2.5; },
    'a null timestamp': (b) => { b.hourly.time[3] = null; },
    'a fractional timestamp': (b) => { b.hourly.time[3] += 0.5; },
    'a gap of two hours': (b) => { b.hourly.time = b.hourly.time.map((t, i) => (i >= 3 ? t + 3600 : t)); },
    'an empty timezone': (b) => { b.timezone = '  '; },
    'an error flag': (b) => { b.error = true; },
  };
  for (const [what, mutate] of Object.entries(broken)) {
    const body = structuredClone(base);
    mutate(body);
    assert.deepEqual(parseForecast(body), { ok: false, reason: 'invalid' }, what);
  }
  // A one-hour series has no step to check, so the timestamp's own type must be.
  const oneHour = structuredClone(base);
  for (const key of Object.keys(oneHour.hourly)) oneHour.hourly[key] = oneHour.hourly[key].slice(0, 1);
  assert.equal(parseForecast(oneHour).ok, true, 'a one-hour control parses');
  for (const t of ['2026-10-19T00:00', null, 1.5, -3600]) {
    oneHour.hourly.time = [t];
    assert.deepEqual(parseForecast(oneHour), { ok: false, reason: 'invalid' }, `a lone timestamp ${t}`);
  }
});

test('parseMeta reads the run fields and refuses anything incomplete or implausible', () => {
  assert.deepEqual(parseMeta(META013), { initialisation: INIT, availability: META013.last_run_availability_time });
  assert.deepEqual(parseMeta(META025), { initialisation: INIT, availability: META025.last_run_availability_time });
  for (const [what, body] of Object.entries({
    'no initialisation time': { ...META013, last_run_initialisation_time: undefined },
    'no availability time': { ...META013, last_run_availability_time: undefined },
    'a string time': { ...META013, last_run_initialisation_time: String(INIT) },
    'a fractional time': { ...META013, last_run_availability_time: META013.last_run_availability_time + 0.5 },
    'availability before initialisation': { ...META013, last_run_availability_time: INIT - 1 },
    'times of 0 (1970)': { ...META013, last_run_initialisation_time: 0, last_run_availability_time: 0 },
    'an initialisation of 0': { ...META013, last_run_initialisation_time: 0 },
    'negative times': { ...META013, last_run_initialisation_time: -21600, last_run_availability_time: -1 },
    'the forecast error body': response('open-meteo-error-400.json'),
    'an empty object': {},
    'non-JSON text': '<html>not json</html>',
    'null': null,
    'an array': [META013],
  })) {
    assert.equal(parseMeta(body), null, what);
  }
});

test('parseMeta refuses an availability later than the moment it is read', () => {
  const availableMs = META013.last_run_availability_time * 1000;
  assert.equal(parseMeta(META013, { now: availableMs - 1000 }), null);
  assert.deepEqual(parseMeta(META013, { now: availableMs }), { initialisation: INIT, availability: META013.last_run_availability_time });
});

test('fetchOpenMeteo: both grids, forecast, both grids; issuedAt is the shared run, never the retrieval time', async () => {
  const now = minutesAfterAvailability(11);
  const { getJson, calls } = stubGetJson(agreeing());
  const result = await fetchOpenMeteo(CHARLOTTE, { getJson, now: () => now });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result), ['ok', 'timezone', 'model', 'runInitialisedAt', 'runAvailableAt', 'fetchedAt', 'hours']);
  assert.equal(result.model, 'ncep_gfs_global');
  assert.equal(result.timezone, 'America/New_York');
  assert.equal(result.runInitialisedAt, new Date(INIT * 1000).toISOString());
  assert.equal(result.runAvailableAt, new Date(LATER_AVAILABLE_MS).toISOString(), 'the later grid, when the whole run was in place');
  assert.equal(result.fetchedAt, new Date(now).toISOString());
  assert.notEqual(result.runInitialisedAt, result.fetchedAt);
  assert.deepEqual(result.hours, parseForecast(RECORDED).hours);
  for (const value of [result.runInitialisedAt, result.runAvailableAt, result.fetchedAt]) assert.match(value, /Z$/);

  assert.deepEqual(calls.map((c) => c.kind), FULL_SEQUENCE);
  assert.equal(calls[2].url, openMeteoUrl(CHARLOTTE));
  assert.match(calls[2].url, /latitude=35\.23&longitude=-80\.84&/);
  assert.deepEqual(calls.map((c) => c.options.timeoutMs), [3000, 3000, 6000, 3000, 3000]);
  for (const c of calls) {
    assert.equal(c.options.maxBytes, OPEN_METEO_MAX_BYTES);
    assert.deepEqual(wireHeaders(c.options.headers), { accept: 'application/json' }, 'what reaches fetch through Task 3');
  }
  assert.equal(OPEN_METEO_MAX_BYTES, 2 * 1024 * 1024);
});

test('inside the wait window the run is unknown, with the exact time left, and the forecast is not fetched', async () => {
  const { getJson, calls } = stubGetJson(agreeing());
  assert.deepEqual(await fetchOpenMeteo(CHARLOTTE, { getJson, now: () => minutesAfterAvailability(9) }), { ok: false, reason: 'run_unknown', retryAfterMs: 60_000 });
  assert.deepEqual(calls.map((c) => c.kind), ['meta013', 'meta025']);

  // Long past the earlier grid's wait but only 5 minutes after the later grid: the later grid decides.
  const earlyNow = minutesAfterAvailability(5);
  assert.ok(earlyNow > EARLIER_AVAILABLE_MS + 10 * 60 * 1000, 'the recorded grids arrived more than 15 minutes apart');
  const second = stubGetJson(agreeing());
  assert.deepEqual(await fetchOpenMeteo(CHARLOTTE, { getJson: second.getJson, now: earlyNow }), { ok: false, reason: 'run_unknown', retryAfterMs: 5 * 60 * 1000 });
  assert.equal(second.calls.length, 2);
});

test('exactly 10 minutes after the later availability is enough (the documented wait, not more)', async () => {
  const { getJson } = stubGetJson(agreeing());
  const result = await fetchOpenMeteo(CHARLOTTE, { getJson, now: minutesAfterAvailability(10) });
  assert.equal(result.ok, true);
});

test('the recorded lag window (0.11 degree on 12Z, 0.25 degree on 06Z) is run_unknown with a retry hint', async () => {
  const now = Date.parse('2026-10-19T19:34:00Z');
  const { getJson, calls } = stubGetJson({ meta013: [ok(LAG013)], meta025: [ok(LAG025)], forecast: [ok(RECORDED)] });
  assert.deepEqual(await fetchOpenMeteo(CHARLOTTE, { getJson, now }), { ok: false, reason: 'run_unknown', retryAfterMs: RUN_UNKNOWN_RETRY_MS });
  assert.deepEqual(calls.map((c) => c.kind), ['meta013', 'meta025'], 'no forecast from a mix of runs');
  assert.equal(RUN_UNKNOWN_RETRY_MS, 60_000);
});

test('metadata that changes during the forecast call, on either grid, means the run is unknown', async () => {
  const now = () => minutesAfterAvailability(60);
  const nextRun = (meta) => ({ ...meta, last_run_initialisation_time: INIT + 21600, last_run_availability_time: meta.last_run_availability_time + 21600 });
  const republished = (meta) => ({ ...meta, last_run_availability_time: meta.last_run_availability_time + 60 });
  for (const [what, after013, after025] of [
    ['0.11 degree moves to a new run', nextRun(META013), META025],
    ['0.25 degree moves to a new run', META013, nextRun(META025)],
    ['0.11 degree re-published', republished(META013), META025],
    ['0.25 degree re-published', META013, republished(META025)],
  ]) {
    const { getJson, calls } = stubGetJson({ meta013: [ok(META013), ok(after013)], meta025: [ok(META025), ok(after025)], forecast: [ok(RECORDED)] });
    assert.deepEqual(await fetchOpenMeteo(CHARLOTTE, { getJson, now }), { ok: false, reason: 'run_unknown', retryAfterMs: RUN_UNKNOWN_RETRY_MS }, what);
    assert.deepEqual(calls.map((c) => c.kind), FULL_SEQUENCE, what);
  }
});

test('a metadata failure on either grid, before or after, means the run is unknown', async () => {
  const now = () => minutesAfterAvailability(60);
  const failures = [
    { ok: false, reason: 'timeout' },
    { ok: false, reason: 'http_503' },
    { ok: false, reason: 'network' },
    ok(response('open-meteo-error-400.json')),
    ok('not json'),
    ok(null),
    ok({ ...META013, last_run_initialisation_time: 0, last_run_availability_time: 0 }),
  ];
  const unknown = { ok: false, reason: 'run_unknown', retryAfterMs: RUN_UNKNOWN_RETRY_MS };
  for (const failure of failures) {
    for (const grid of ['meta013', 'meta025']) {
      const before = agreeing();
      before[grid] = [failure, ok(grid === 'meta013' ? META013 : META025)];
      const first = stubGetJson(before);
      assert.deepEqual(await fetchOpenMeteo(CHARLOTTE, { getJson: first.getJson, now }), unknown);
      assert.deepEqual(first.calls.map((c) => c.kind), ['meta013', 'meta025'], 'no forecast call without a known run');

      const after = agreeing();
      after[grid] = [ok(grid === 'meta013' ? META013 : META025), failure];
      const second = stubGetJson(after);
      assert.deepEqual(await fetchOpenMeteo(CHARLOTTE, { getJson: second.getJson, now }), unknown);
      assert.deepEqual(second.calls.map((c) => c.kind), FULL_SEQUENCE);
    }
  }
});

test('an availability later than the call start is refused, not waited for', async () => {
  // Both grids claim availability one hour after "now": a clock or metadata error, so no exact wait is offered.
  const future = (meta) => ({ ...meta, last_run_availability_time: meta.last_run_availability_time + 3600 });
  const now = LATER_AVAILABLE_MS + 60 * 1000;
  const { getJson, calls } = stubGetJson({ meta013: [ok(future(META013))], meta025: [ok(future(META025))], forecast: [ok(RECORDED)] });
  assert.deepEqual(await fetchOpenMeteo(CHARLOTTE, { getJson, now }), { ok: false, reason: 'run_unknown', retryAfterMs: RUN_UNKNOWN_RETRY_MS });
  assert.equal(calls.length, 2);
});

test('a failed forecast call reports its reason; a bad body is invalid; neither waits for the second metadata read', async () => {
  const now = () => minutesAfterAvailability(60);
  for (const [answer, reason] of [
    [{ ok: false, reason: 'timeout' }, 'timeout'],
    [{ ok: false, reason: 'network' }, 'network'],
    [{ ok: false, reason: 'http_503' }, 'http_503'],
    [{ ok: false, reason: 'http_400' }, 'http_400'],
    [{ ok: false, reason: 'too_large' }, 'too_large'],
    [{ ok: false, reason: 'no_timeout' }, 'no_timeout'],
    [{ ok: false, reason: 'bad_headers' }, 'bad_headers'],
    [{ ok: false, reason: 'invalid' }, 'invalid'],
    [ok(response('open-meteo-error-400.json')), 'invalid'],
    [ok(response('open-meteo-forecast-no-hourly.json')), 'invalid'],
    [ok('<html>oops</html>'), 'invalid'],
    [{ ok: false, reason: 'https://api.open-meteo.com/v1/forecast?latitude=35.23 failed' }, 'invalid'],
  ]) {
    const { getJson, calls } = stubGetJson(agreeing(answer));
    assert.deepEqual(await fetchOpenMeteo(CHARLOTTE, { getJson, now }), { ok: false, reason });
    assert.deepEqual(calls.map((c) => c.kind), ['meta013', 'meta025', 'forecast']);
  }
});

test('a throwing getJson, a missing getJson or a bad point never throws and never calls out', async () => {
  const thrower = async () => { throw new Error('boom'); };
  assert.deepEqual(await fetchOpenMeteo(CHARLOTTE, { getJson: thrower, now: minutesAfterAvailability(60) }), { ok: false, reason: 'run_unknown', retryAfterMs: RUN_UNKNOWN_RETRY_MS });
  assert.deepEqual(await fetchOpenMeteo(CHARLOTTE, {}), { ok: false, reason: 'invalid' });
  const { getJson, calls } = stubGetJson(agreeing());
  assert.deepEqual(await fetchOpenMeteo({ lat: 'x', lng: 1 }, { getJson }), { ok: false, reason: 'invalid' });
  assert.equal(calls.length, 0);
});

test('no network was attempted by any test in this file', () => {
  assert.deepEqual(attempted, []);
});
