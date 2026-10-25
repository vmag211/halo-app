import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizePollutant, parseAirNow, parseOpenMeteoAir, uvPeakWindow, parsePollen, moldFromNws, fetchDailyReadings,
} from '../lib/dailyReadings.js';

test('pollutant names normalize to the closed set', () => {
  assert.equal(normalizePollutant('PM2.5'), 'PM2.5');
  assert.equal(normalizePollutant('pm10'), 'PM10');
  assert.equal(normalizePollutant('O3'), 'O3');
  assert.equal(normalizePollutant('CO'), null);
  assert.equal(normalizePollutant(undefined), null);
});

test('AirNow: the max sub-index is the AQI and names the dominant pollutant (retired PascalCase shape still read)', () => {
  const r = parseAirNow([{ ParameterName: 'O3', AQI: 41 }, { ParameterName: 'PM2.5', AQI: 67 }, { ParameterName: 'PM10', AQI: 12 }]);
  assert.deepEqual(r, { aqi: 67, dominant: 'PM2.5', error: null });
});

const observationFixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')).response;
const NAPA_OBSERVED = observationFixture('airnow-observation-napa-recorded.json');
const NO_OBSERVATIONS = observationFixture('airnow-observation-none-recorded.json');

test('AirNow ziplatlong: the recorded camelCase answer gives the max nowcastAQI and its pollutant (OZONE is O3)', () => {
  assert.deepEqual(parseAirNow(NAPA_OBSERVED), { aqi: 52, dominant: 'PM2.5', error: null });
  const ozone = NAPA_OBSERVED.map((row) => (row.parameterName === 'OZONE' ? { ...row, nowcastAQI: 88 } : row));
  assert.deepEqual(parseAirNow(ozone), { aqi: 88, dominant: 'O3', error: null });
});

test('AirNow ziplatlong: an empty array and the recorded "no observations" answer are no measurement, not a failure', () => {
  assert.deepEqual(parseAirNow([]), { aqi: null, dominant: null, error: null });
  assert.deepEqual(parseAirNow(NO_OBSERVATIONS), { aqi: null, dominant: null, error: null });
  assert.deepEqual(parseAirNow({ WebServiceError: [{ Message: 'Request not authenticated.' }] }), { aqi: null, dominant: null, error: 'provider_error' });
  assert.deepEqual(parseAirNow(null), { aqi: null, dominant: null, error: 'invalid' });
});

test('AirNow ziplatlong: AQI -1 is unknown, never a reading; a lower known value is not hidden by it', () => {
  const unknown = NAPA_OBSERVED.map((row) => ({ ...row, nowcastAQI: -1 }));
  assert.deepEqual(parseAirNow(unknown), { aqi: null, dominant: null, error: null }, 'only -1 values: no measurement');
  const mixed = NAPA_OBSERVED.map((row) => (row.parameterName === 'PM2.5' ? { ...row, nowcastAQI: -1 } : row));
  assert.deepEqual(parseAirNow(mixed), { aqi: 27, dominant: 'O3', error: null });
  assert.deepEqual(parseAirNow([{ parameterName: 'OZONE', nowcastAQI: 0 }]), { aqi: 0, dominant: 'O3', error: null }, '0 is a reading');
  assert.deepEqual(parseAirNow([{ parameterName: 'OZONE', AQI: -1 }]), { aqi: null, dominant: null, error: null });
});

/** A fetch stub: AirNow answers `airnow`, Open-Meteo air answers `modeled`, everything else fails. */
function readingsFetch({ airnow, modeled = { current: { us_aqi: 36, us_aqi_ozone: 36 } }, airnowStatus = 200 }) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const u = new URL(String(url));
    if (u.host === 'www.airnowapi.org') return new Response(JSON.stringify(airnow), { status: airnowStatus });
    if (u.host === 'air-quality-api.open-meteo.com') return Response.json(modeled);
    throw new Error('not stubbed');
  };
  return { calls, fetchImpl };
}

test('fetchDailyReadings: the replacement ziplatlong service, measured AirNow when it reports, else modeled Open-Meteo', async (t) => {
  t.mock.method(console, 'error', () => {});
  const env = { AIRNOW_API_KEY: 'FAKE-AIRNOW-KEY-0000' };
  const measured = readingsFetch({ airnow: NAPA_OBSERVED });
  const r = await fetchDailyReadings({ lat: 35.4, lng: -80.6 }, { fetchImpl: measured.fetchImpl, env });
  assert.deepEqual([r.aqi, r.aqiSource, r.aqiIsMeasured, r.dominantPollutant], [52, 'airnow', true, 'PM2.5']);
  const url = new URL(measured.calls.find((c) => c.includes('airnowapi')));
  assert.equal(`${url.origin}${url.pathname}`, 'https://www.airnowapi.org/aq/observation/current/ziplatlong/');
  assert.deepEqual([...url.searchParams.keys()], ['format', 'latitude', 'longitude', 'API_KEY'], 'no distance: the new service ignores it');
  assert.deepEqual([url.searchParams.get('latitude'), url.searchParams.get('longitude')], ['35.4', '-80.6']);
  assert.equal(measured.calls.some((c) => c.includes('observation/latLong')), false, 'never the retired service');

  for (const [what, airnow, status] of [
    ['empty array', [], 200],
    ['no observations', NO_OBSERVATIONS, 200],
    ['only -1', NAPA_OBSERVED.map((row) => ({ ...row, nowcastAQI: -1 })), 200],
    ['401', { WebServiceError: [{ Message: 'Request not authenticated.' }] }, 401],
  ]) {
    const fallback = readingsFetch({ airnow, airnowStatus: status });
    const m = await fetchDailyReadings({ lat: 35.4, lng: -80.6 }, { fetchImpl: fallback.fetchImpl, env });
    assert.deepEqual([m.aqi, m.aqiSource, m.aqiIsMeasured, m.dominantPollutant], [36, 'open-meteo', false, 'O3'], `${what}: modeled, labelled as modeled`);
  }
});

test('Open-Meteo: dominant from sub-indices, null when they are absent', () => {
  assert.deepEqual(parseOpenMeteoAir({ us_aqi: 36, us_aqi_pm2_5: 14, us_aqi_pm10: 2, us_aqi_ozone: 36 }), { aqi: 36, dominant: 'O3' });
  assert.deepEqual(parseOpenMeteoAir({ us_aqi: 36 }), { aqi: 36, dominant: null });
  assert.deepEqual(parseOpenMeteoAir({}), { aqi: null, dominant: null });
});

test('UV peak window: first hour ≥3 to the end of the last one, with the max', () => {
  const hours = [0, 0.15, 1, 2.4, 3.95, 5.25, 6.05, 6.2, 5.7, 4.6, 3.1, 1.6, 0.4];
  const hourly = { time: hours.map((_, i) => `2026-09-27T${String(i + 7).padStart(2, '0')}:00`), uv_index: hours };
  assert.deepEqual(uvPeakWindow(hourly), { start: '11:00', end: '18:00', max: 6.2 });
});

test('UV peak window is null when UV never reaches 3, or data is malformed', () => {
  assert.equal(uvPeakWindow({ time: ['2026-01-01T12:00'], uv_index: [2.1] }), null);
  assert.equal(uvPeakWindow(null), null);
  assert.equal(uvPeakWindow({ time: ['a'], uv_index: [] }), null);
});

test('pollen parses per category; missing categories stay null, never 0', () => {
  const r = parsePollen({ dailyInfo: [{ pollenTypeInfo: [{ code: 'GRASS', indexInfo: { value: 3 } }, { code: 'TREE' }] }] });
  assert.deepEqual(r, { tree: null, grass: 3, weed: null });
});

test('mold: estimate + the inputs it used; missing humidity → no estimate at all', () => {
  assert.deepEqual(moldFromNws({ relativeHumidity: { value: 82 }, probabilityOfPrecipitation: { value: 40 } }), {
    risk: 'high', basis: { humidity_pct: 82, precip_pct: 40 },
  });
  assert.equal(moldFromNws({ relativeHumidity: { value: 55 }, probabilityOfPrecipitation: { value: 0 } }).risk, 'low');
  assert.deepEqual(moldFromNws({ relativeHumidity: { value: null }, probabilityOfPrecipitation: { value: 10 } }), { risk: null, basis: null });
  assert.deepEqual(moldFromNws(undefined), { risk: null, basis: null });
});

test('total outage: every reading null — mold is NOT defaulted to low', async () => {
  const r = await fetchDailyReadings({ lat: 35.4, lng: -80.6 }, {
    fetchImpl: async () => { throw new Error('network down'); },
    env: {},
  });
  assert.equal(r.aqi, null);
  assert.equal(r.uvIndex, null);
  assert.deepEqual(r.pollen, { tree: null, grass: null, weed: null });
  assert.deepEqual(r.mold, { risk: null, basis: null });
});

test('pollen: types Google marks out of season are listed; their index stays as sent', () => {
  const r = parsePollen({ dailyInfo: [{ pollenTypeInfo: [
    { code: 'TREE', inSeason: false },
    { code: 'GRASS', inSeason: true, indexInfo: { value: 2 } },
    { code: 'WEED', inSeason: false, indexInfo: { value: 0 } },
  ] }] });
  assert.deepEqual(r, { tree: null, grass: 2, weed: 0, out_of_season: ['tree', 'weed'] });
  // No flag from Google means no claim either way.
  assert.equal('out_of_season' in parsePollen({ dailyInfo: [{ pollenTypeInfo: [{ code: 'TREE' }] }] }), false);
});
