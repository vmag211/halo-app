import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSources } from '../lib/sources.js';

test('each reading source reports the newest time it supplied data; unknown is null', () => {
  const { sources } = buildSources({
    readings: [
      { created_at: '2026-09-27T10:00:00', aqi_source: 'open-meteo', uv_index: 4, pollen_level: '{"tree":null,"grass":2,"weed":null}', mold_risk: 'low' },
      { created_at: '2026-09-26T10:00:00', aqi_source: 'airnow', uv_index: null, pollen_level: '{}', mold_risk: null },
    ],
    waterDataLoadedAt: '2026-08-01T00:00:00+00:00',
    leadInventoryRetrieved: '2026-09-27',
  });
  const by = Object.fromEntries(sources.map((s) => [s.name, s.last_retrieved]));
  assert.equal(by['AirNow (EPA)'], '2026-09-26T10:00:00.000Z');
  assert.equal(by['Open-Meteo'], '2026-09-27T10:00:00.000Z');
  assert.equal(by['Google Pollen'], '2026-09-27T10:00:00.000Z');
  assert.equal(by['National Weather Service'], '2026-09-27T10:00:00.000Z');
  assert.equal(by['EPA UCMR 5'], '2026-08-01T00:00:00.000Z');
  assert.equal(by['EPA Map of Radon Zones'], null);
  assert.equal(by['EPA Water System Service Area Boundaries'], null);
});

test('every source names what it provides', () => {
  for (const s of buildSources({}).sources) {
    assert.ok(s.name && s.provides, s.name);
    assert.ok('last_retrieved' in s);
  }
});
