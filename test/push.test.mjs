import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPushPayload, isExpiredPushError, sendAlertPushes, pushConfigured } from '../lib/push.js';

test('payload carries the page to open for each alert type', () => {
  assert.deepEqual(buildPushPayload({ id: 'a1', type: 'new_water_results', title: 'T', message: 'M' }),
    { id: 'a1', type: 'new_water_results', title: 'T', message: 'M', url: '/home?risk=water' });
  assert.equal(buildPushPayload({ type: 'season_summary' }).url, '/journal?mode=trends');
  assert.equal(buildPushPayload({ type: 'unknown' }).url, '/today');
});

test('404/410 mean expired; other errors do not', () => {
  assert.equal(isExpiredPushError({ statusCode: 410 }), true);
  assert.equal(isExpiredPushError({ statusCode: 404 }), true);
  assert.equal(isExpiredPushError({ statusCode: 500 }), false);
});

test('sends every alert to every live subscription; expired ones are reported for removal', async () => {
  const calls = [];
  const sendImpl = async (sub, payload) => {
    calls.push([sub.endpoint, payload.type]);
    if (sub.endpoint === 'https://gone') throw Object.assign(new Error('gone'), { statusCode: 410 });
  };
  const r = await sendAlertPushes({
    subscriptions: [{ endpoint: 'https://ok' }, { endpoint: 'https://gone' }],
    alerts: [{ type: 'radon_season' }, { type: 'air_quality_change' }],
    sendImpl,
  });
  assert.equal(r.sent, 2);
  assert.deepEqual(r.expired, ['https://gone']);
  assert.equal(calls.filter(([e]) => e === 'https://gone').length, 1, 'stops sending to an expired endpoint');
});

test('push is disabled until all three VAPID settings exist', () => {
  assert.equal(pushConfigured({}), false);
  assert.equal(pushConfigured({ VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b', VAPID_SUBJECT: 'https://x' }), true);
});
