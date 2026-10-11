import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./frontend-test-loader.mjs', import.meta.url);
const { contourRecordDensity, geographicContourSeed } = await import('../lib/frontend/map-visuals.ts');

test('irregular contours are bounded, additive and geographically seeded', () => {
  const source = { x: 100, y: 100, seed: geographicContourSeed(-80, 35) };
  const one = contourRecordDensity([source], 200, 200, 60, 0, 4);
  const two = contourRecordDensity([source, source], 200, 200, 60, 0, 4);
  for (let i = 0; i < one.field.length; i++) assert.equal(two.field[i], one.field[i] * 2);
  assert.equal(one.field[25 * 50 + 25], 1);
  for (let phase = 0; phase < 7; phase += 1) {
    const field = contourRecordDensity([source], 200, 200, 60, phase, 4).field;
    for (let y = 0; y < 50; y++) for (let x = 0; x < 50; x++) if (Math.hypot(x * 4 - 100, y * 4 - 100) >= 60) assert.equal(field[y * 50 + x], 0);
  }
  assert.notDeepEqual(Array.from(one.field), Array.from(contourRecordDensity([source], 200, 200, 60, 2, 4).field));
});

test('contours are empty without records and preserve phase-zero pan invariance', () => {
  assert.ok(contourRecordDensity([], 50, 50, 60).field.every(value => value === 0));
  const a = contourRecordDensity([{ x: 100, y: 100, seed: 1 }], 200, 200, 60);
  const b = contourRecordDensity([{ x: 120, y: 100, seed: 1 }], 200, 200, 60);
  for (let y = 0; y < 50; y++) for (let x = 0; x < 45; x++) assert.equal(a.field[y * 50 + x], b.field[y * 50 + x + 5]);
});
