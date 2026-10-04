import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import realWebPush from 'web-push'; // the real library: this file registers no module hooks
import stub, { createWebPushState } from './helpers/stubs/webPush.mjs';
import { runWithHarness } from './helpers/stubs/context.mjs';

// Self-tests for the `web-push` stand-in the route harness uses (test/helpers/stubs/webPush.mjs).

const subscription = (endpoint) => ({ endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-key' } });
const inHarness = (webPush, work) => runWithHarness({ webPush }, work);

test('drift: every web-push function lib/push.js calls exists on the real library and on the stub', () => {
  const source = readFileSync(new URL('../lib/push.js', import.meta.url), 'utf8');
  const called = [...new Set([...source.matchAll(/\bwebpush\.(\w+)/g)].map((match) => match[1]))].sort();
  assert.deepEqual(called, ['sendNotification', 'setVapidDetails'], 'lib/push.js uses a new web-push function: teach the stub about it');
  for (const name of called) {
    assert.equal(typeof realWebPush[name], 'function', `the real library has ${name}`);
    assert.equal(typeof stub[name], 'function', `the stub has ${name}`);
    assert.equal(stub[name].length, realWebPush[name].length, `${name} takes the same parameters as the real one`);
  }
});

test('a send is recorded with its endpoint, keys, parsed payload and options, and succeeds with 201', async () => {
  const state = createWebPushState();
  const result = await inHarness(state, () => stub.sendNotification(subscription('https://fcm.googleapis.com/fcm/send/one'), JSON.stringify({ title: 'T' }), { TTL: 5 }));
  assert.equal(result.statusCode, 201);
  assert.deepEqual(state.sent, [{ endpoint: 'https://fcm.googleapis.com/fcm/send/one', keys: { p256dh: 'p256dh-key', auth: 'auth-key' }, payload: { title: 'T' }, options: { TTL: 5 } }]);
});

test('setVapidDetails records what it was given', async () => {
  const state = createWebPushState();
  await inHarness(state, () => stub.setVapidDetails('mailto:a@example.test', 'pub', 'priv'));
  assert.deepEqual(state.vapid, [{ subject: 'mailto:a@example.test', publicKey: 'pub', privateKey: 'priv' }]);
});

test('failWith makes only that endpoint answer with the status, and the attempt is still recorded', async () => {
  const state = createWebPushState();
  state.failWith('https://fcm.googleapis.com/fcm/send/gone', 410);
  await assert.rejects(
    inHarness(state, () => stub.sendNotification(subscription('https://fcm.googleapis.com/fcm/send/gone'), '{}')),
    (error) => error.statusCode === 410 && error.name === 'WebPushError',
  );
  await inHarness(state, () => stub.sendNotification(subscription('https://fcm.googleapis.com/fcm/send/fine'), '{}'));
  assert.deepEqual(state.sent.map((entry) => entry.endpoint), ['https://fcm.googleapis.com/fcm/send/gone', 'https://fcm.googleapis.com/fcm/send/fine']);
});

test('failNetwork fails with no HTTP status', async () => {
  const state = createWebPushState();
  state.failNetwork('https://fcm.googleapis.com/fcm/send/down');
  await assert.rejects(
    inHarness(state, () => stub.sendNotification(subscription('https://fcm.googleapis.com/fcm/send/down'), '{}')),
    (error) => error.statusCode === undefined && error.code === 'ECONNRESET',
  );
});

test('a payload that is not a string is refused, like the real library', async () => {
  const state = createWebPushState();
  await assert.rejects(inHarness(state, () => stub.sendNotification(subscription('https://fcm.googleapis.com/fcm/send/x'), { title: 'T' })), /must be a string/);
  assert.deepEqual(state.sent, []);
});

test('outside a harness call the stub refuses to run', async () => {
  await assert.rejects(stub.sendNotification(subscription('https://fcm.googleapis.com/fcm/send/x'), '{}'), /outside a harness call/);
});
