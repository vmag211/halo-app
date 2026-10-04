import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BYPASS_ENDPOINTS, FOREIGN_HOST_ENDPOINTS } from './helpers/pushKeys.mjs';
import './helpers/routeLoader.mjs'; // registers the module hooks, so lib files load as ESM without the typeless-package warning

const { buildPushPayload, isExpiredPushError, sendAlertPushes, pushConfigured } = await import('../lib/push.js');

const OK = 'https://fcm.googleapis.com/fcm/send/ok';
const GONE = 'https://updates.push.services.mozilla.com/wpush/v2/gone';

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
    if (sub.endpoint === GONE) throw Object.assign(new Error('gone'), { statusCode: 410 });
  };
  const r = await sendAlertPushes({
    subscriptions: [{ endpoint: OK }, { endpoint: GONE }],
    alerts: [{ type: 'radon_season' }, { type: 'air_quality_change' }],
    sendImpl,
  });
  assert.equal(r.sent, 2);
  assert.deepEqual(r.expired, [GONE]);
  assert.equal(calls.filter(([e]) => e === GONE).length, 1, 'stops sending to an expired endpoint');
});

test('a stored endpoint outside the allowlist is skipped, counted, never sent to and never reported for removal', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const calls = [];
  const sendImpl = async (sub) => { calls.push(sub.endpoint); };
  const unsafe = [
    'https://legacy.example.test/send/old-device', // stored before the allowlist existed
    'http://fcm.googleapis.com/fcm/send/not-https',
    ...BYPASS_ENDPOINTS.map(([, endpoint]) => endpoint), // stored through the parser differential
    ...FOREIGN_HOST_ENDPOINTS.map(([, endpoint]) => endpoint),
    '', null, undefined, 5, {},
  ];
  const r = await sendAlertPushes({
    subscriptions: [{ endpoint: OK }, ...unsafe.map((endpoint) => ({ endpoint })), { endpoint: GONE }],
    alerts: [{ type: 'radon_season' }, { type: 'air_quality_change' }],
    sendImpl,
  });
  assert.deepEqual(calls, [OK, OK, GONE, GONE], 'only the two allowed devices are sent to, once per alert');
  assert.deepEqual([r.sent, r.failed, r.skipped, r.expired], [4, 0, unsafe.length, []]);
  assert.equal(warn.mock.callCount(), 1, 'one line for the whole run');
  assert.doesNotMatch(String(warn.mock.calls[0].arguments[0]), /legacy|evil|example|https?:/, 'the log line carries a count, not an address');
});

test('with every endpoint allowed nothing is skipped and nothing is logged', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const r = await sendAlertPushes({ subscriptions: [{ endpoint: OK }], alerts: [{ type: 'radon_season' }], sendImpl: async () => {} });
  assert.deepEqual([r.sent, r.failed, r.skipped, r.expired], [1, 0, 0, []]);
  assert.equal(warn.mock.callCount(), 0);
});

test('push is disabled until all three VAPID settings exist', () => {
  assert.equal(pushConfigured({}), false);
  assert.equal(pushConfigured({ VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b', VAPID_SUBJECT: 'https://x' }), true);
});
