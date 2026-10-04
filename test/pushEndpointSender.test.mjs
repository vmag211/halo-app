import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import https from 'node:https';
import url, { Url } from 'node:url';
import { EventEmitter } from 'node:events';
import webpush from 'web-push'; // the real library: this file registers no module hooks
import { AUTH, BYPASS_ENDPOINTS, FOREIGN_HOST_ENDPOINTS, GENUINE_ENDPOINTS, P256DH } from './helpers/pushKeys.mjs';
import './helpers/routeLoader.mjs'; // registers the module hooks AFTER web-push is loaded, so lib/pushInput.js loads as ESM

// This file calls the legacy `url.parse` on purpose, as web-push does (web-push-lib.js sendNotification):
// the allowlist is only as good as its agreement with the parser that picks the host to connect to.
// Node prints a deprecation warning for it, which is the point of this file and not output we want.
process.noDeprecation = true;

const { parsePushSubscription } = await import('../lib/pushInput.js');
const keys = { p256dh: P256DH, auth: AUTH };
const accepted = (endpoint) => parsePushSubscription({ endpoint, keys }).ok;

test('every endpoint the route accepts has the same host for WHATWG URL and for the legacy url.parse that web-push sends with', () => {
  assert.ok(GENUINE_ENDPOINTS.every(accepted), 'the table of genuine endpoints is all accepted');
  for (const endpoint of GENUINE_ENDPOINTS) {
    const whatwg = new URL(endpoint).hostname;
    assert.equal(url.parse(endpoint).hostname, whatwg, endpoint);
    assert.match(whatwg, /^[a-z0-9-]+(\.[a-z0-9-]+)*$/, 'a plain lower case host name');
  }
});

test('whatever follows an allowed host, an endpoint is only accepted when WHATWG, url.parse and the text name the same host', () => {
  // Every accepted string among the allowed host followed by up to three characters from a set of
  // the characters URL parsers treat specially. If a Node or web-push upgrade makes the two parsers
  // read any of them differently, an accepted string here fails and the allowlist needs another look.
  const specials = ['@', ':', ';', ',', '?', '#', '/', '%', '{', '}', '`', '[', ']', '.', '-', '!', '$', '&', "'", '(', ')', '*', '+', '=', '|', '^', '<', '>', '"', 'a', '0'];
  const prefixes = ['https://fcm.googleapis.com', 'https://fcm.googleapis.com:443', 'HTTPS://FCM.googleapis.com', 'https://a-b.0.fcm.googleapis.com'];
  let suffixes = [''];
  let acceptedCount = 0;
  let checked = 0;
  for (let length = 0; length <= 3; length += 1) {
    for (const prefix of prefixes) {
      for (const suffix of suffixes) {
        const endpoint = prefix + suffix;
        checked += 1;
        if (!accepted(endpoint)) continue;
        acceptedCount += 1;
        const host = new URL(endpoint).hostname;
        assert.equal(url.parse(endpoint).hostname, host, endpoint);
        assert.equal(host, prefix.replace(/^https:\/\//i, '').replace(/:443$/, '').toLowerCase(), `the suffix ${JSON.stringify(suffix)} did not change the host`);
      }
    }
    suffixes = suffixes.flatMap((suffix) => specials.map((character) => suffix + character));
  }
  assert.ok(checked > 10_000 && acceptedCount > 100, `${checked} checked, ${acceptedCount} accepted: the enumeration is not empty`);
});

test('the legacy parser the check uses (new Url().parse) reads the same host as url.parse, which web-push calls', () => {
  for (const endpoint of [...GENUINE_ENDPOINTS, ...BYPASS_ENDPOINTS.map(([, value]) => value), ...FOREIGN_HOST_ENDPOINTS.map(([, value]) => value)]) {
    const direct = new Url();
    direct.parse(endpoint, false, false);
    const viaParse = url.parse(endpoint);
    assert.deepEqual([direct.hostname, direct.port, direct.path], [viaParse.hostname, viaParse.port, viaParse.path], endpoint);
  }
});

test('every accepted endpoint is https on the default port with no user info for the legacy parser too', () => {
  for (const endpoint of GENUINE_ENDPOINTS) {
    const legacy = url.parse(endpoint);
    assert.equal(legacy.protocol, 'https:', endpoint);
    assert.ok(legacy.port === null || legacy.port === '443', `${endpoint} port ${legacy.port}`);
    assert.equal(legacy.auth, null, `${endpoint} has no user info`);
  }
});

test('the real sender connects to the validated host for every accepted endpoint, and no bypass vector is accepted', async (t) => {
  const { publicKey, privateKey } = webpush.generateVAPIDKeys(); // throwaway keys made for this test
  webpush.setVapidDetails('mailto:push-test@example.test', publicKey, privateKey);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const real = { p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
  assert.equal(parsePushSubscription({ endpoint: GENUINE_ENDPOINTS[0], keys: real }).ok, true, 'a real browser style key pair passes the key rules');

  t.mock.method(console, 'warn', () => {}); // web-push warns about the GCM endpoint that has no GCM key
  const connections = [];
  t.mock.method(https, 'request', (options) => {
    connections.push(options.hostname);
    const request = new EventEmitter();
    Object.assign(request, { write() {}, setTimeout() {}, end: () => request.emit('error', new Error('captured: nothing is sent')) });
    return request;
  });
  for (const endpoint of GENUINE_ENDPOINTS) {
    connections.length = 0;
    await webpush.sendNotification({ endpoint, keys: real }, '{}').catch(() => {});
    assert.deepEqual(connections, [new URL(endpoint).hostname], endpoint);
  }
  for (const [label, endpoint] of [...BYPASS_ENDPOINTS, ...FOREIGN_HOST_ENDPOINTS]) assert.equal(accepted(endpoint), false, `${label}: ${endpoint}`);
});
