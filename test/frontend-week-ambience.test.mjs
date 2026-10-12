import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';
const { landscapeCrop, landscapeWave, weekLandscapes, WEEK_SCENE_DWELL_MS } = await loadFrontend('week-ambience');

test('decorative landscapes are independent of household, weather and task data', () => {
  assert.equal(weekLandscapes.length, 3);
  assert.equal(new Set(weekLandscapes.map(scene => scene.src)).size, 3);
  assert.equal(WEEK_SCENE_DWELL_MS, 120000);
  for (const scene of weekLandscapes) {
    assert.match(scene.src, /^\/preview-scenes\/week-(lake|coast|forest)\.webp$/);
    assert.ok(scene.waterline > .4 && scene.waterline < .6);
    assert.ok(scene.water.every(([x, y]) => x >= 0 && x <= 1 && y >= scene.waterline && y <= 1));
  }
});

test('center cover geometry maps source water masks without stretching on phone widths', () => {
  for (const [width, height] of [[430, 214], [320, 214], [430, 321], [320, 300]]) {
    const { scale, x, y } = landscapeCrop(1536, 1024, width, height);
    assert.ok(1536 * scale >= width - .00001);
    assert.ok(1024 * scale >= height - .00001);
    assert.equal(x, (width - 1536 * scale) / 2);
    assert.equal(y, (height - 1024 * scale) / 2);
    const horizon = y + .508 * 1024 * scale;
    assert.ok(horizon >= 0 && horizon < height);
  }
});

test('water displacement varies naturally while staying under two pixels', () => {
  for (let second = 0; second < 120; second += .25) {
    for (let row = 0; row <= 140; row += 7) assert.ok(Math.abs(landscapeWave(row, 140, second)) < 2);
  }
  assert.notEqual(landscapeWave(80, 140, 0), landscapeWave(80, 140, 1));
  assert.notEqual(landscapeWave(60, 140, 1), landscapeWave(80, 140, 1));
});
