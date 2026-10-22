// The water curve and the Homeguard composite (lib/scoring.js), recalibrated 2026-10-22.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getHomeGuardScore, getRadonRisk, getWaterRisk, limitRatioRisk, HOMEGUARD_SCORE_FLOOR } from '../lib/scoring.js';
import { hazardIndex } from '../lib/mapData.js';

test('a reading at its limit is half risk, twice the limit 75, and the curve never reaches 100', () => {
  assert.equal(limitRatioRisk(0), 0);
  assert.equal(limitRatioRisk(1), 50);
  assert.equal(limitRatioRisk(2), 75);
  assert.equal(limitRatioRisk(4), 93.75);
  assert.ok(limitRatioRisk(10) < 100);
  assert.equal(limitRatioRisk(-3), 0, 'a nonsense negative reading is clamped, not scored as clean beyond zero');
  assert.equal(limitRatioRisk(Number.NaN), null);
});

test('each compound is scored against its own limit, and the blend stays the root of the summed squares', () => {
  const water = getWaterRisk({ PFOS: [{ value_ppt: 7.3, date: '7/1/2025' }], PFHxS: [{ value_ppt: 3.4, date: '7/1/2025' }] });
  assert.deepEqual(water.scored.map((c) => [c.contaminant, c.risk]), [['PFOS', 71.78], ['PFHxS', 21]]);
  assert.equal(water.risk, 74.78);
  assert.equal(water.coverage, 'complete');
  assert.equal(getWaterRisk({ PFOA: [{ value_ppt: 4 }] }).risk, 50, 'PFOA at its 4 ppt limit');
  assert.equal(getWaterRisk({ PFBS: [{ value_ppt: 2000 }] }).risk, 50, 'guidance benchmarks use the same curve');
});

test('a Concord-like home with PFOS at 1.8 times its limit scores 20, not the floor', () => {
  const water = getWaterRisk({ PFOS: [{ value_ppt: 7.3 }], PFHxS: [{ value_ppt: 3.4 }] });
  const score = getHomeGuardScore({ waterRisk: water.risk, radonRisk: getRadonRisk(3), waterCoverage: water.coverage });
  assert.equal(score.display_score, 20);
  assert.equal(score.floored, false);
});

test('missing inputs are still left out, never scored as zero, and the floor still holds', () => {
  const waterOnly = getHomeGuardScore({ waterRisk: 50, radonRisk: null, waterCoverage: 'complete' });
  assert.equal(waterOnly.display_score, 50);
  assert.deepEqual(waterOnly.missing_inputs, ['radon']);
  assert.equal(getHomeGuardScore({ waterRisk: 100, radonRisk: 80 }).display_score, HOMEGUARD_SCORE_FLOOR);
  assert.equal(getHomeGuardScore({}).display_score, null);
});

test('the map hazard index uses the same curve', () => {
  const hi = hazardIndex({ PFHxS: [{ value_ppt: 5, date: '2025-07-01' }], PFNA: [{ value_ppt: 5, date: '2025-07-01' }] });
  assert.equal(hi.value, 1);
  assert.equal(hi.severity, 'elevated', 'a hazard index of 1 is risk 50');
});
