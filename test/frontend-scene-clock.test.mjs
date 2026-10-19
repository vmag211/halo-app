import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';
const { sceneClockAt } = await loadFrontend('scene-clock');
const { readPreviewPreferences } = await loadFrontend('factor-preview');
const at = (h, m = 0) => new Date(2026, 8, 30, h, m);

test('local clock lighting follows dawn, daylight, dusk and midnight', () => {
  assert.equal(sceneClockAt(at(6, 30)).phase, 'dawn');
  assert.equal(sceneClockAt(at(12)).daylight, 1);
  assert.equal(sceneClockAt(at(18, 30)).phase, 'dusk');
  assert.equal(sceneClockAt(at(0)).daylight, 0);
  assert.equal(sceneClockAt(at(23, 59)).daylight, 0);
  for (let minute = 0; minute < 1440; minute++) {
    const { daylight, warmth } = sceneClockAt(at(0, minute));
    assert.ok(daylight >= 0 && daylight <= 1);
    assert.ok(warmth >= 0 && warmth <= 1);
  }
});
test('lighting interpolates smoothly and manual review phases ignore clock hour', () => {
  assert.ok(sceneClockAt(at(6, 31)).daylight > sceneClockAt(at(6, 30)).daylight);
  assert.ok(sceneClockAt(at(19, 1)).daylight < sceneClockAt(at(19)).daylight);
  assert.deepEqual(sceneClockAt(at(1), 'day'), sceneClockAt(at(23), 'day'));
  assert.equal(sceneClockAt(at(12), 'night').daylight, 0);
});
test('review preferences preserve old motion URLs without mixing lighting and appearance', () => {
  assert.equal(readPreviewPreferences({ motion: 'false' }).motion, 'system');
  assert.equal(readPreviewPreferences({ motion: 'true' }).motion, 'reduce');
  assert.equal(readPreviewPreferences({ motion: 'full' }).motion, 'full');
  assert.equal(readPreviewPreferences({ motion: 'invalid' }).motion, 'system');
  assert.equal(readPreviewPreferences({ appearance: 'dark' }).time, 'live');
  assert.equal(readPreviewPreferences({ appearance: 'light', time: 'night' }).time, 'night');
});
