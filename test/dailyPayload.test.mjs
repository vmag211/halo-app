import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDailyPayload, toIsoUtc } from '../lib/dailyPayload.js';

const base = {
  aqi: 44, aqiSource: 'airnow', aqiIsMeasured: true, dominantPollutant: 'O3',
  uvIndex: 5.2, uvPeakWindow: { start: '11:00', end: '17:00', max: 6.2 },
  pollen: { tree: 1, grass: 4, weed: null },
  mold: { risk: 'moderate', basis: { humidity_pct: 65, precip_pct: 0 } },
  cached: false, retrievedAt: '2026-09-27T15:00:00.000Z',
};

test('keeps every legacy field (additive only)', () => {
  const p = formatDailyPayload(base);
  for (const k of ['aqi', 'status', 'source', 'is_measured', 'severity', 'sentence']) assert.ok(k in p.air, `air.${k}`);
  for (const k of ['index', 'status', 'severity', 'sentence']) assert.ok(k in p.uv, `uv.${k}`);
  for (const k of ['tree', 'grass', 'weed', 'status', 'dominant', 'severity', 'sentence']) assert.ok(k in p.pollen, `pollen.${k}`);
  for (const k of ['risk', 'is_proxy', 'severity', 'sentence']) assert.ok(k in p.mold, `mold.${k}`);
  assert.ok('display_score' in p.score && 'missing_inputs' in p.score && 'cached' in p);
});

test('new fields: dominant pollutant, peak window, categories, mold basis, retrieved_at', () => {
  const p = formatDailyPayload(base);
  assert.equal(p.air.dominant_pollutant, 'O3');
  assert.deepEqual(p.uv.peak_window, { start: '11:00', end: '17:00', max: 6.2 });
  assert.deepEqual(p.pollen.categories.grass, { value: 4, severity: 'high' });
  assert.deepEqual(p.pollen.categories.weed, { value: null, severity: 'no_data' });
  assert.deepEqual(p.mold.basis, { humidity_pct: 65, precip_pct: 0 });
  assert.equal(p.retrieved_at, '2026-09-27T15:00:00.000Z');
});

test('score.severity is the worst included input', () => {
  const p = formatDailyPayload(base);
  assert.equal(p.score.severity, 'high'); // pollen grass 4 → high beats the rest
});

test('NWS failure: mold null/no_data and listed as missing — not "low"', () => {
  const p = formatDailyPayload({ ...base, mold: { risk: null, basis: null } });
  assert.equal(p.mold.risk, null);
  assert.equal(p.mold.severity, 'no_data');
  assert.equal(p.mold.basis, null);
  assert.ok(p.score.missing_inputs.includes('mold'));
});

test('total outage: no score, a reason, and a null severity — not a near-perfect day', () => {
  const p = formatDailyPayload({
    aqi: null, uvIndex: null, pollen: { tree: null, grass: null, weed: null },
    mold: { risk: null, basis: null }, cached: false, retrievedAt: 'x',
  });
  assert.equal(p.score.display_score, null);
  assert.ok(p.score.reason);
  assert.equal(p.score.severity, null);
  assert.equal(p.air.dominant_pollutant, null);
});

test('DB timestamps without a zone are read as UTC', () => {
  assert.equal(toIsoUtc('2026-09-27T03:57:23.523146'), '2026-09-27T03:57:23.523Z');
  assert.equal(toIsoUtc('2026-09-27T03:57:23+00:00'), '2026-09-27T03:57:23.000Z');
  assert.equal(toIsoUtc(null), null);
});
