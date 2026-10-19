// B10 Task 4: the Open-Meteo adapter (plan rulings F3, F5, F17). Every call goes
// through a stubbed getJson; global fetch is blocked and must never be reached.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blockedFetch } from './helpers/sandbox.mjs';
import {
  OPEN_METEO_MAX_BYTES,
  OPEN_METEO_META_URL,
  OPEN_METEO_MODEL,
  fetchOpenMeteo,
  metaUrl,
  openMeteoUrl,
  parseForecast,
  parseMeta,
} from '../lib/forecast/openMeteo.js';

const attempted = [];
globalThis.fetch = blockedFetch(attempted);

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/forecast/${name}`, import.meta.url), 'utf8'));
const response = (name) => fixture(name).response;

const RECORDED = response('open-meteo-forecast-charlotte.json');
const META = response('open-meteo-meta-gfs013.json');
const AVAILABLE_MS = META.last_run_availability_time * 1000;
const minutesAfterAvailability = (minutes) => AVAILABLE_MS + minutes * 60 * 1000;
const CHARLOTTE = { lat: 35.2271, lng: -80.8431 };

/** A getJson stub answering from per-kind queues and recording every call. */
function stubGetJson({ meta = [], forecast = [] } = {}) {
  const calls = [];
  const queues = { meta: [...meta], forecast: [...forecast] };
  const getJson = async (url, options) => {
    const kind = url === OPEN_METEO_META_URL ? 'meta' : url.startsWith('https://api.open-meteo.com/v1/forecast?') ? 'forecast' : 'other';
    calls.push({ kind, url, options });
    const next = queues[kind]?.shift();
    if (!next) return { ok: false, reason: 'unexpected_call' };
    return typeof next === 'function' ? next() : next;
  };
  return { getJson, calls };
}
const ok = (json) => ({ ok: true, status: 200, json });
const metaWith = (changes) => ok({ ...META, ...changes });

test('the URL carries exactly the pinned parameters, unixtime among them, at 2 decimals', () => {
  const url = new URL(openMeteoUrl(CHARLOTTE));
  assert.equal(`${url.origin}${url.pathname}`, 'https://api.open-meteo.com/v1/forecast');
  assert.deepEqual([...url.searchParams], [
    ['latitude', '35.23'],
    ['longitude', '-80.84'],
    ['hourly', 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,uv_index'],
    ['models', 'ncep_gfs013'],
    ['timezone', 'auto'],
    ['timeformat', 'unixtime'],
    ['forecast_days', '8'],
    ['temperature_unit', 'fahrenheit'],
    ['wind_speed_unit', 'mph'],
  ]);
  // Deliberate deviation from F5: precipitation probability comes from the GEFS ensemble, another run.
  assert.ok(!url.search.includes('precipitation_probability'));
  assert.equal(OPEN_METEO_MODEL, 'ncep_gfs013');
  assert.equal(metaUrl(), 'https://api.open-meteo.com/data/ncep_gfs013/static/meta.json');
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
  parsed.hours.forEach((hour, i) => {
    assert.deepEqual(Object.keys(hour), ['t', 'temperatureF', 'apparentF', 'precipPct', 'weatherCode', 'windMph', 'uv']);
    assert.equal(hour.t, time[i] * 1000);
    assert.equal(hour.temperatureF, RECORDED.hourly.temperature_2m[i]);
    assert.equal(hour.apparentF, RECORDED.hourly.apparent_temperature[i]);
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
  // A real modelled UV of 0 at night stays 0.
  assert.equal(parsed.hours[0].uv, 0);
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
    'missing hourly_units': (b) => { delete b.hourly_units; },
    'a missing unit': (b) => { delete b.hourly_units.wind_speed_10m; },
    'Celsius where Fahrenheit was asked': (b) => { b.hourly_units.temperature_2m = '°C'; },
    'a UV index the model does not serve': (b) => { b.hourly_units.uv_index = 'undefined'; },
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

test('parseMeta reads the run fields and refuses anything incomplete', () => {
  assert.deepEqual(parseMeta(META), { initialisation: 1792389600, availability: 1792409766 });
  assert.equal(new Date(META.last_run_initialisation_time * 1000).toISOString(), '2026-10-19T06:00:00.000Z');
  for (const [what, body] of Object.entries({
    'no initialisation time': { ...META, last_run_initialisation_time: undefined },
    'no availability time': { ...META, last_run_availability_time: undefined },
    'a string time': { ...META, last_run_initialisation_time: '1792389600' },
    'a fractional time': { ...META, last_run_availability_time: 1792409766.5 },
    'availability before initialisation': { ...META, last_run_availability_time: META.last_run_initialisation_time - 1 },
    'the forecast error body': response('open-meteo-error-400.json'),
    'an empty object': {},
    'non-JSON text': '<html>not json</html>',
    'null': null,
    'an array': [META],
  })) {
    assert.equal(parseMeta(body), null, what);
  }
});

test('fetchOpenMeteo: metadata, forecast, metadata; issuedAt is the run, never the retrieval time', async () => {
  const now = minutesAfterAvailability(11);
  const { getJson, calls } = stubGetJson({ meta: [ok(META), ok(META)], forecast: [ok(RECORDED)] });
  const result = await fetchOpenMeteo(CHARLOTTE, { getJson, now: () => now });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result), ['ok', 'timezone', 'model', 'runInitialisedAt', 'runAvailableAt', 'fetchedAt', 'hours']);
  assert.equal(result.model, 'ncep_gfs013');
  assert.equal(result.timezone, 'America/New_York');
  assert.equal(result.runInitialisedAt, '2026-10-19T06:00:00.000Z');
  assert.equal(result.runAvailableAt, '2026-10-19T11:36:06.000Z');
  assert.equal(result.fetchedAt, new Date(now).toISOString());
  assert.notEqual(result.runInitialisedAt, result.fetchedAt);
  assert.deepEqual(result.hours, parseForecast(RECORDED).hours);
  for (const value of [result.runInitialisedAt, result.runAvailableAt, result.fetchedAt]) assert.match(value, /Z$/);

  assert.deepEqual(calls.map((c) => c.kind), ['meta', 'forecast', 'meta']);
  assert.equal(calls[1].url, openMeteoUrl(CHARLOTTE));
  assert.match(calls[1].url, /latitude=35\.23&longitude=-80\.84&/);
  assert.equal(calls[0].options.timeoutMs, 3000);
  assert.equal(calls[1].options.timeoutMs, 6000);
  assert.equal(calls[2].options.timeoutMs, 3000);
  for (const c of calls) assert.equal(c.options.maxBytes, OPEN_METEO_MAX_BYTES);
  assert.equal(OPEN_METEO_MAX_BYTES, 2 * 1024 * 1024);
});

test('a run made available 9 minutes ago is unknown, and the forecast is not even fetched', async () => {
  const { getJson, calls } = stubGetJson({ meta: [ok(META), ok(META)], forecast: [ok(RECORDED)] });
  assert.deepEqual(await fetchOpenMeteo(CHARLOTTE, { getJson, now: () => minutesAfterAvailability(9) }), { ok: false, reason: 'run_unknown' });
  assert.deepEqual(calls.map((c) => c.kind), ['meta']);
});

test('exactly 10 minutes after availability is enough (the documented wait, not more)', async () => {
  const { getJson } = stubGetJson({ meta: [ok(META), ok(META)], forecast: [ok(RECORDED)] });
  const result = await fetchOpenMeteo(CHARLOTTE, { getJson, now: minutesAfterAvailability(10) });
  assert.equal(result.ok, true);
});

test('metadata that changes during the forecast call means the run is unknown', async () => {
  const now = () => minutesAfterAvailability(60);
  const nextRun = { last_run_initialisation_time: META.last_run_initialisation_time + 21600, last_run_availability_time: META.last_run_availability_time + 21600 };
  for (const [what, after] of Object.entries({
    'a new run': metaWith(nextRun),
    'the same run re-published': metaWith({ last_run_availability_time: META.last_run_availability_time + 60 }),
  })) {
    const { getJson, calls } = stubGetJson({ meta: [ok(META), after], forecast: [ok(RECORDED)] });
    assert.deepEqual(await fetchOpenMeteo(CHARLOTTE, { getJson, now }), { ok: false, reason: 'run_unknown' }, what);
    assert.deepEqual(calls.map((c) => c.kind), ['meta', 'forecast', 'meta'], what);
  }
});

test('a metadata failure, before or after, means the run is unknown', async () => {
  const now = () => minutesAfterAvailability(60);
  const failures = [{ ok: false, reason: 'timeout' }, { ok: false, reason: 'http_503' }, ok(response('open-meteo-error-400.json')), ok('not json'), ok(null)];
  for (const failure of failures) {
    const first = stubGetJson({ meta: [failure, ok(META)], forecast: [ok(RECORDED)] });
    assert.deepEqual(await fetchOpenMeteo(CHARLOTTE, { getJson: first.getJson, now }), { ok: false, reason: 'run_unknown' });
    assert.deepEqual(first.calls.map((c) => c.kind), ['meta'], 'no forecast call without a known run');

    const second = stubGetJson({ meta: [ok(META), failure], forecast: [ok(RECORDED)] });
    assert.deepEqual(await fetchOpenMeteo(CHARLOTTE, { getJson: second.getJson, now }), { ok: false, reason: 'run_unknown' });
    assert.deepEqual(second.calls.map((c) => c.kind), ['meta', 'forecast', 'meta']);
  }
});

test('a failed forecast call reports its reason; a bad body is invalid; neither waits for the second metadata read', async () => {
  const now = () => minutesAfterAvailability(60);
  for (const [answer, reason] of [
    [{ ok: false, reason: 'timeout' }, 'timeout'],
    [{ ok: false, reason: 'http_503' }, 'http_503'],
    [{ ok: false, reason: 'http_400' }, 'http_400'],
    [{ ok: false, reason: 'invalid' }, 'invalid'],
    [ok(response('open-meteo-error-400.json')), 'invalid'],
    [ok(response('open-meteo-forecast-no-hourly.json')), 'invalid'],
    [ok('<html>oops</html>'), 'invalid'],
    [{ ok: false, reason: 'https://api.open-meteo.com/v1/forecast?latitude=35.23 failed' }, 'invalid'],
  ]) {
    const { getJson, calls } = stubGetJson({ meta: [ok(META), ok(META)], forecast: [answer] });
    assert.deepEqual(await fetchOpenMeteo(CHARLOTTE, { getJson, now }), { ok: false, reason });
    assert.deepEqual(calls.map((c) => c.kind), ['meta', 'forecast']);
  }
});

test('a throwing getJson, a missing getJson or a bad point never throws and never calls out', async () => {
  const thrower = async () => { throw new Error('boom'); };
  assert.deepEqual(await fetchOpenMeteo(CHARLOTTE, { getJson: thrower, now: minutesAfterAvailability(60) }), { ok: false, reason: 'run_unknown' });
  assert.deepEqual(await fetchOpenMeteo(CHARLOTTE, {}), { ok: false, reason: 'invalid' });
  const { getJson, calls } = stubGetJson({ meta: [ok(META)] });
  assert.deepEqual(await fetchOpenMeteo({ lat: 'x', lng: 1 }, { getJson }), { ok: false, reason: 'invalid' });
  assert.equal(calls.length, 0);
});

test('no network was attempted by any test in this file', () => {
  assert.deepEqual(attempted, []);
});
