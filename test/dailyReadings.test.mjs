import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('AirNow: the max sub-index is the AQI and names the dominant pollutant', () => {
  const r = parseAirNow([{ ParameterName: 'O3', AQI: 41 }, { ParameterName: 'PM2.5', AQI: 67 }, { ParameterName: 'PM10', AQI: 12 }]);
  assert.deepEqual(r, { aqi: 67, dominant: 'PM2.5' });
  assert.deepEqual(parseAirNow([]), { aqi: null, dominant: null });
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
