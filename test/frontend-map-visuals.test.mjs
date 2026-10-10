import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';
const { recordDensity, densityRGBA } = await loadFrontend('map-visuals');
const { waterFeatures, waterMapReading, waterSampleDate, observationTime } = await loadFrontend('map-preview');

test('bounded heat accumulation matches the reference kernel, including offscreen sources', () => {
  const sources = [[-4, 8], [12, 16], [18, 14], [120, 120]];
  const { field, cols, rows } = recordDensity(sources, 41, 35, 15);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const expected = sources.reduce((sum, [sx, sy]) => {
      const d2 = ((x * 4 - sx) ** 2 + (y * 4 - sy) ** 2) / 15 ** 2;
      return sum + (d2 < 1 ? (1 - d2) ** 2 : 0);
    }, 0);
    assert.ok(Math.abs(field[y * cols + x] - expected) < .000001);
  }
});
test('record density remains additive and pan invariant with a fixed radius', () => {
  const one = recordDensity([[12, 12]], 32, 32, 8);
  const two = recordDensity([[12, 12], [12, 12]], 32, 32, 8);
  assert.equal(one.field[3 * one.cols + 3], 1);
  assert.equal(two.field[3 * two.cols + 3], 2);
  const moved = recordDensity([[16, 16]], 36, 36, 8);
  assert.equal(moved.field[4 * moved.cols + 4], one.field[3 * one.cols + 3]);
  assert.deepEqual(densityRGBA(2), densityRGBA(20));
});
test('empty and invalid density do not paint a low-value pollution surface', () => {
  assert.ok(recordDensity([], 40, 40, 15).field.every(v => v === 0));
  assert.ok(recordDensity([[10, 10]], 40, 40, 0).field.every(v => v === 0));
  assert.deepEqual(densityRGBA(0), [0, 0, 0, 0]);
  assert.deepEqual(densityRGBA(NaN), [0, 0, 0, 0]);
});
test('point and list readings preserve zero, missing, selected units and index', () => {
  const records = waterFeatures();
  assert.equal(waterMapReading(records[3], 'pfoa'), '0 ppt');
  assert.equal(waterMapReading(records[5], 'pfoa'), 'No detection reported');
  assert.equal(waterMapReading(records[5], 'overall'), 'No comparable result');
  assert.equal(waterMapReading(records[0], 'pfoa'), '5.8 ppt');
  assert.equal(waterMapReading(records[0], 'overall'), '2 over limit');
  assert.equal(waterMapReading({ ...records[0], hazard_index: null }, 'hazard'), 'No index available');
});
test('selected compound dates do not borrow a newer system sample, and station times are explicit', () => {
  const record = waterFeatures()[0];
  const changed = { ...record, latest_sample_iso:'2026-01-01', contaminants:{ ...record.contaminants, PFOA:{...record.contaminants.PFOA, date_iso:'2025-01-01'} } };
  assert.equal(waterSampleDate(changed, 'pfoa'), '2025-01-01');
  assert.equal(waterSampleDate(changed, 'overall'), '2026-01-01');
  assert.equal(waterSampleDate({...changed, contaminants:{}}, 'pfoa'), undefined);
  assert.match(observationTime('2026-10-01T10:00:00Z'), /10:00 AM UTC/);
  assert.equal(observationTime(null), 'No observation time available');
});
