import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/routeLoader.mjs'; // registers the module hooks, so lib files load as ESM without the typeless-package warning

const { PUSH_HOSTS, parsePushSubscription, parsePushEndpointForRemoval } = await import('../lib/pushInput.js');

const keys = { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) };
const codeFor = (endpoint) => parsePushSubscription({ endpoint, keys }).fieldErrors?.map((e) => e.code);

test('the host list is one constant: the five browser Web Push services', () => {
  assert.deepEqual(PUSH_HOSTS, ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com']);
});

test('a host matches itself or a subdomain of it, and nothing that merely ends with the same letters', () => {
  for (const host of [...PUSH_HOSTS, 'updates.push.services.mozilla.com', 'web.push.apple.com', 'wns2-par02p.notify.windows.com', 'a.b.fcm.googleapis.com']) {
    assert.equal(parsePushSubscription({ endpoint: `https://${host}/x`, keys }).ok, true, host);
  }
  for (const host of ['evilfcm.googleapis.com', 'fcm.googleapis.com.example.com', 'googleapis.com', 'apple.com', 'windows.com', 'mozilla.com', 'notify.windows.com.']) {
    assert.deepEqual(codeFor(`https://${host}/x`), ['endpoint_host_not_allowed'], host);
  }
});

test('a valid subscription comes back with exactly endpoint, p256dh and auth, as sent', () => {
  const endpoint = 'https://FCM.googleapis.com/fcm/send/Token_1-2';
  assert.deepEqual(parsePushSubscription({ endpoint, expirationTime: null, extra: 1, keys: { ...keys, other: 1 } }), { ok: true, value: { endpoint, ...keys } });
});

test('removal checks the shape of the endpoint but not its host', () => {
  assert.deepEqual(parsePushEndpointForRemoval({ endpoint: 'https://legacy.example.test/x' }), { ok: true, value: { endpoint: 'https://legacy.example.test/x' } });
  assert.deepEqual(parsePushEndpointForRemoval({}).fieldErrors.map((e) => [e.field, e.code, e.message]), [['endpoint', 'endpoint_required', 'Send { endpoint }.']]);
  assert.deepEqual(parsePushEndpointForRemoval({ endpoint: 'http://legacy.example.test/x' }).fieldErrors.map((e) => e.code), ['invalid_endpoint']);
});
