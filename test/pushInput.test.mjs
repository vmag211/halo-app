import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Url } from 'node:url';
import { AUTH, BYPASS_ENDPOINTS, FOREIGN_HOST_ENDPOINTS, GENUINE_ENDPOINTS, P256DH, keysFor } from './helpers/pushKeys.mjs';
import './helpers/routeLoader.mjs'; // registers the module hooks, so lib files load as ESM without the typeless-package warning

const { PUSH_HOSTS, parsePushSubscription, parsePushEndpointForRemoval, isSendableEndpoint } = await import('../lib/pushInput.js');

const keys = { p256dh: P256DH, auth: AUTH };
const codeFor = (endpoint) => parsePushSubscription({ endpoint, keys }).fieldErrors?.map((e) => e.code);
const keyCodes = (value) => parsePushSubscription({ endpoint: GENUINE_ENDPOINTS[0], keys: value }).fieldErrors?.map((e) => `${e.field}:${e.code}`);

test('the host list is one constant: the five browser Web Push services', () => {
  assert.deepEqual(PUSH_HOSTS, ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com']);
});

test('a host matches itself or a subdomain of it, and nothing that merely ends with the same letters', () => {
  for (const host of [...PUSH_HOSTS, 'updates.push.services.mozilla.com', 'web.push.apple.com', 'wns2-par02p.notify.windows.com', 'a.b.fcm.googleapis.com']) {
    assert.equal(parsePushSubscription({ endpoint: `https://${host}/x`, keys }).ok, true, host);
  }
  for (const host of ['evilfcm.googleapis.com', 'fcm.googleapis.com.example.com', 'googleapis.com', 'apple.com', 'windows.com', 'mozilla.com', 'xn--fcm-9na.googleapis.com', '127.0.0.1', 'localhost']) {
    assert.deepEqual(codeFor(`https://${host}/x`), ['endpoint_host_not_allowed'], host);
  }
});

test('every genuine browser endpoint form is accepted, whichever way the host is spelled', () => {
  for (const endpoint of GENUINE_ENDPOINTS) assert.deepEqual(parsePushSubscription({ endpoint, keys }), { ok: true, value: { endpoint, ...keys } }, endpoint);
});

test('every bypass vector is refused as a malformed endpoint, for a new subscription and for removal', () => {
  for (const [label, endpoint] of BYPASS_ENDPOINTS) {
    assert.deepEqual(codeFor(endpoint), ['invalid_endpoint'], `${label}: ${endpoint}`);
    assert.deepEqual(parsePushEndpointForRemoval({ endpoint }).fieldErrors?.map((e) => e.code), ['invalid_endpoint'], `removal of ${label}`);
    assert.equal(isSendableEndpoint(endpoint), false, `send time: ${label}`);
  }
});

test('an allowed host name tucked after another host is refused by the allowlist, not as malformed', () => {
  for (const [label, endpoint] of FOREIGN_HOST_ENDPOINTS) {
    assert.deepEqual(codeFor(endpoint), ['endpoint_host_not_allowed'], label);
    assert.equal(isSendableEndpoint(endpoint), false, label);
    assert.equal(parsePushEndpointForRemoval({ endpoint }).ok, true, `${label}: removal only needs a well formed endpoint`);
  }
});

test('an endpoint is refused when the legacy parser (the one web-push sends with) reads a different host, whatever the text and WHATWG say', (t) => {
  assert.equal(parsePushSubscription({ endpoint: GENUINE_ENDPOINTS[0], keys }).ok, true, 'accepted while the parsers agree');
  const original = Url.prototype.parse;
  t.mock.method(Url.prototype, 'parse', function parse(...args) {
    const parsed = original.apply(this, args);
    this.hostname = 'other.example';
    return parsed;
  });
  assert.deepEqual(codeFor(GENUINE_ENDPOINTS[0]), ['invalid_endpoint']);
  assert.equal(isSendableEndpoint(GENUINE_ENDPOINTS[0]), false);
  assert.equal(parsePushEndpointForRemoval({ endpoint: GENUINE_ENDPOINTS[0] }).ok, false, 'removal is checked the same way');
});

test('a valid subscription comes back with exactly endpoint, p256dh and auth, as sent', () => {
  const endpoint = 'https://FCM.googleapis.com/fcm/send/Token_1-2';
  assert.deepEqual(parsePushSubscription({ endpoint, expirationTime: null, extra: 1, keys: { ...keys, other: 1 } }), { ok: true, value: { endpoint, ...keys } });
});

test('p256dh must be a browser\'s: 87 characters (one optional =) of base64url that decode to 65 bytes starting 0x04', () => {
  assert.equal(parsePushSubscription({ endpoint: GENUINE_ENDPOINTS[0], keys: { p256dh: `${P256DH}=`, auth: AUTH } }).ok, true);
  assert.equal(parsePushSubscription({ endpoint: GENUINE_ENDPOINTS[0], keys: keysFor('Tag_-9') }).ok, true);
  for (const bad of [P256DH.slice(0, 86), `${P256DH}A`, `${P256DH}==`, `C${P256DH.slice(1)}`, `A${P256DH.slice(1)}`, `${P256DH.slice(0, 85)}+/`, `${P256DH.slice(0, 86)} `, '']) {
    assert.deepEqual(keyCodes({ p256dh: bad, auth: AUTH }), ['keys.p256dh:invalid_key'], JSON.stringify(bad));
  }
});

test('auth must be a browser\'s: 22 characters (optionally ==) of base64url that decode to 16 bytes', () => {
  assert.equal(parsePushSubscription({ endpoint: GENUINE_ENDPOINTS[0], keys: { p256dh: P256DH, auth: `${AUTH}==` } }).ok, true);
  for (const bad of [AUTH.slice(0, 21), `${AUTH}A`, `${AUTH}=`, `${AUTH}===`, `${AUTH.slice(0, 20)}+/`, `${AUTH.slice(0, 21)}\n`, '']) {
    assert.deepEqual(keyCodes({ p256dh: P256DH, auth: bad }), ['keys.auth:invalid_key'], JSON.stringify(bad));
  }
});

test('removal checks the shape of the endpoint but not its host', () => {
  assert.deepEqual(parsePushEndpointForRemoval({ endpoint: 'https://legacy.example.test/x' }), { ok: true, value: { endpoint: 'https://legacy.example.test/x' } });
  assert.deepEqual(parsePushEndpointForRemoval({}).fieldErrors.map((e) => [e.field, e.code, e.message]), [['endpoint', 'endpoint_required', 'Send { endpoint }.']]);
  assert.deepEqual(parsePushEndpointForRemoval({ endpoint: 'http://legacy.example.test/x' }).fieldErrors.map((e) => e.code), ['invalid_endpoint']);
});

test('isSendableEndpoint is the same endpoint rule the subscribe route applies, and says no to anything that is not a string', () => {
  for (const endpoint of GENUINE_ENDPOINTS) assert.equal(isSendableEndpoint(endpoint), true, endpoint);
  for (const endpoint of ['https://legacy.example.test/x', 'http://fcm.googleapis.com/x', '', null, undefined, 5, ['https://fcm.googleapis.com/x'], {}]) {
    assert.equal(isSendableEndpoint(endpoint), false, String(endpoint));
  }
});
