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

// BE-113 (Vibhav, 2026-10-21): a card score for air, UV and pollen is
// round(100 - that factor's risk); mold stays unscored as a weather estimate.
const scores = (over) => formatDailyPayload({ ...base, ...over }).score;

test('factor_scores is additive: every earlier score field is still there', () => {
  const s = scores({});
  for (const k of ['risk', 'score', 'display_score', 'is_partial', 'missing_inputs', 'included_inputs', 'includes_proxy', 'reason', 'is_measured', 'is_estimate', 'inputs', 'severity']) assert.ok(k in s, `score.${k}`);
  assert.deepEqual(Object.keys(s.factor_scores).sort(), ['air', 'mold', 'pollen', 'uv']);
  assert.deepEqual(s.factor_score_exclusions, { mold: 'weather_estimate' });
});

test('air card score follows the AQI bands, 100 minus the air risk', () => {
  const air = (aqi) => scores({ aqi }).factor_scores.air;
  assert.equal(air(0), 100);
  assert.equal(air(44), 82); // risk 17.6
  assert.equal(air(50), 80);
  assert.equal(air(100), 60);
  assert.equal(air(151), 40); // risk 60.4
  assert.equal(air(300), 5);
  assert.equal(air(500), 0);
  assert.equal(air(900), 0, 'clamped, never negative');
});

test('UV card score: index 0 is 100, 11 and above is 0', () => {
  const uv = (uvIndex) => scores({ uvIndex }).factor_scores.uv;
  assert.equal(uv(0), 100);
  assert.equal(uv(5.2), 53); // risk 47.27
  assert.equal(uv(11), 0);
  assert.equal(uv(14), 0);
});

test('pollen card score uses the worst available category, scaled against 5', () => {
  const pollen = (p) => scores({ pollen: p }).factor_scores.pollen;
  assert.equal(pollen({ tree: 1, grass: 4, weed: null }), 20);
  assert.equal(pollen({ tree: 0, grass: 0, weed: 0 }), 100);
  assert.equal(pollen({ tree: null, grass: null, weed: 3 }), 40);
  assert.equal(pollen({ tree: 7, grass: null, weed: null }), 0);
});

test('a missing input is a null card score, never 100; mold is always null', () => {
  const s = scores({ aqi: null, uvIndex: null, pollen: { tree: null, grass: null, weed: null } });
  assert.deepEqual(s.factor_scores, { air: null, uv: null, pollen: null, mold: null });
  for (const risk of ['low', 'moderate', 'high', null]) assert.equal(scores({ mold: { risk, basis: null } }).factor_scores.mold, null);
  const outage = formatDailyPayload({ aqi: null, uvIndex: null, pollen: { tree: null, grass: null, weed: null }, mold: { risk: null, basis: null }, cached: false, retrievedAt: 'x' }).score;
  assert.deepEqual(outage.factor_scores, { air: null, uv: null, pollen: null, mold: null });
});

test('each card score is the same risk input the composite used', () => {
  const s = scores({});
  for (const key of ['air', 'uv', 'pollen']) {
    assert.equal(s.factor_scores[key], Math.round(100 - s.inputs[key]));
    assert.ok(Number.isInteger(s.factor_scores[key]));
  }
});
