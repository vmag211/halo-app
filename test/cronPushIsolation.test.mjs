/**
 * The daily job pushes each household's new alerts to that household's own devices.
 * The job serves every household in one run and hands the push service one list of
 * subscriptions, so the route has to split it per household (`s.profile_id === pid`).
 * These tests run the real route with the `web-push` stand-in (test/helpers/stubs/webPush.mjs)
 * and check what each device is sent. The VAPID values below are made up for the test
 * and given through the harness `env`, the way the sandbox lets a test configure a route.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quiet, setup } from './helpers/isolationKit.mjs';
import { PROFILE } from './helpers/isolationSeed.mjs';

const SECRET = 'cron-secret-for-tests';
const VAPID = {
  VAPID_PUBLIC_KEY: 'test-vapid-public-key-not-a-real-key',
  VAPID_PRIVATE_KEY: 'test-vapid-private-key-not-a-real-key',
  VAPID_SUBJECT: 'mailto:push-test@example.test',
};

// Three devices on allowlisted push hosts: alice has two, bob one. Keys are unique per device.
const DEVICE = {
  alicePhone: { who: 'alice', endpoint: 'https://fcm.googleapis.com/fcm/send/alice-phone-token', p256dh: 'ALICE-PHONE-P256DH', auth: 'ALICE-PHONE-AUTH' },
  aliceLaptop: { who: 'alice', endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/alice-laptop-token', p256dh: 'ALICE-LAPTOP-P256DH', auth: 'ALICE-LAPTOP-AUTH' },
  bobPhone: { who: 'bob', endpoint: 'https://web.push.apple.com/bob-iphone-token', p256dh: 'BOB-PHONE-P256DH', auth: 'BOB-PHONE-AUTH' },
};

// A flood advisory at alice's point and a heat advisory at bob's: each household gets exactly
// one new alert, and its text names the household's own county.
const weather = ({ url }) => {
  if (!url.startsWith('https://api.weather.gov/alerts/active')) return null;
  const at = (who) => url.includes(`point=${PROFILE[who].lat},`);
  const advisory = (id, event) => ({ id, properties: { id, event, status: 'Actual' } });
  if (at('alice')) return Response.json({ features: [advisory('urn:nws:test:alice-flood', 'Flood Warning')] });
  if (at('bob')) return Response.json({ features: [advisory('urn:nws:test:bob-heat', 'Excessive Heat Warning')] });
  return null;
};

function twoDevicesAndOne(t, { vapid = VAPID } = {}) {
  quiet(t);
  // Mid July: no season summary, no radon season, no baseline water change, and without
  // today's cached reading no air alert. Only the weather advisories fire.
  const now = new Date('2026-07-15T15:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now });
  const ctx = setup({
    env: { CRON_SECRET: SECRET, ...vapid },
    provider: weather,
    seed: {
      now,
      readingToday: false,
      adjust: (rows, { alice, bob }) => {
        const id = { alice: alice.id, bob: bob.id };
        rows.push_subscriptions = Object.values(DEVICE).map(({ who, endpoint, p256dh, auth }) => ({ profile_id: id[who], endpoint, p256dh, auth }));
        for (const prefs of rows.notification_prefs) prefs.weather_advisory = true;
      },
    },
  });
  const subscriptions = () => ctx.h.db.rows('push_subscriptions');
  return { ctx, before: subscriptions(), subscriptions };
}

const runCron = (ctx) => ctx.h.call('/api/cron/daily', 'GET', { headers: { authorization: `Bearer ${SECRET}` } });
// The seed already holds older alerts (one of them a weather advisory); the ones this run creates are keyed on the NWS ids above.
const newAlert = (ctx, who) => ctx.h.db.rows('alerts').filter((alert) => alert.profile_id === ctx.id(who) && alert.dedupe_key.startsWith('weather_advisory:urn:nws:test:'));
const endpointsOf = (who) => Object.values(DEVICE).filter((device) => device.who === who).map((device) => device.endpoint);
/** endpoint -> the messages pushed to it, so "each device got exactly its own household's text" is one comparison. */
const deliveries = (ctx) => {
  const byEndpoint = {};
  for (const send of ctx.h.webPush.sent) (byEndpoint[send.endpoint] ??= []).push(send.payload.message);
  return byEndpoint;
};

test('each household\'s devices are pushed only that household\'s alert, with that device\'s own keys', async (t) => {
  const { ctx, before, subscriptions } = twoDevicesAndOne(t);
  const res = await runCron(ctx);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).push, { configured: true, sent: 3, failed: 0, expired_removed: 0 });

  const [aliceAlert] = newAlert(ctx, 'alice');
  const [bobAlert] = newAlert(ctx, 'bob');
  assert.equal(newAlert(ctx, 'alice').length + newAlert(ctx, 'bob').length, 2, 'one new alert per household');
  assert.ok(aliceAlert.message.includes(PROFILE.alice.county) && bobAlert.message.includes(PROFILE.bob.county));
  assert.ok(!aliceAlert.message.includes(PROFILE.bob.county) && !bobAlert.message.includes(PROFILE.alice.county), 'the two alerts really do differ');

  assert.deepEqual(deliveries(ctx), {
    [DEVICE.alicePhone.endpoint]: [aliceAlert.message],
    [DEVICE.aliceLaptop.endpoint]: [aliceAlert.message],
    [DEVICE.bobPhone.endpoint]: [bobAlert.message],
  });
  for (const send of ctx.h.webPush.sent) {
    const device = Object.values(DEVICE).find((entry) => entry.endpoint === send.endpoint);
    assert.deepEqual(send.keys, { p256dh: device.p256dh, auth: device.auth }, 'each send uses its own device\'s keys');
    const own = device.who === 'alice' ? aliceAlert : bobAlert;
    assert.deepEqual([send.payload.id, send.payload.type, send.payload.title], [own.id, own.type, own.title]);
  }
  const toBob = JSON.stringify(ctx.h.webPush.sent.filter((send) => endpointsOf('bob').includes(send.endpoint)));
  const toAlice = JSON.stringify(ctx.h.webPush.sent.filter((send) => endpointsOf('alice').includes(send.endpoint)));
  assert.ok(!toBob.includes(PROFILE.alice.county) && !toBob.includes(aliceAlert.id) && !toBob.includes('ALICE-'), 'nothing of alice\'s reached bob\'s device');
  assert.ok(!toAlice.includes(PROFILE.bob.county) && !toAlice.includes(bobAlert.id) && !toAlice.includes('BOB-'), 'nothing of bob\'s reached alice\'s devices');

  assert.deepEqual(subscriptions(), before, 'a clean run removes no subscription');
  // The fake VAPID values reached the library; no real key exists anywhere in this run.
  // (lib/push.js configures the library once per process, so this is the first test's to see.)
  assert.deepEqual(ctx.h.webPush.vapid, [{ subject: VAPID.VAPID_SUBJECT, publicKey: VAPID.VAPID_PUBLIC_KEY, privateKey: VAPID.VAPID_PRIVATE_KEY }]);
});

for (const gone of ['alicePhone', 'bobPhone']) {
  test(`a 410 for ${DEVICE[gone].who}'s device removes only that device's row, and the other devices are still pushed`, async (t) => {
    const { ctx, before, subscriptions } = twoDevicesAndOne(t);
    ctx.h.webPush.failWith(DEVICE[gone].endpoint, 410);
    const res = await runCron(ctx);
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).push, { configured: true, sent: 2, failed: 0, expired_removed: 1 });

    assert.deepEqual(subscriptions(), before.filter((row) => row.endpoint !== DEVICE[gone].endpoint), 'only the gone device\'s row was deleted; every other row is untouched');
    const [aliceAlert] = newAlert(ctx, 'alice');
    const [bobAlert] = newAlert(ctx, 'bob');
    const expected = {
      [DEVICE.alicePhone.endpoint]: [aliceAlert.message],
      [DEVICE.aliceLaptop.endpoint]: [aliceAlert.message],
      [DEVICE.bobPhone.endpoint]: [bobAlert.message],
    };
    assert.deepEqual(deliveries(ctx), expected, 'the 410 device was tried once; everyone else got their own alert');
  });
}

for (const failing of ['alice', 'bob']) {
  test(`${failing}'s push service failing (a 503, then a dropped connection) does not stop the other household's push and removes nothing`, async (t) => {
    const other = failing === 'alice' ? 'bob' : 'alice';
    const { ctx, before, subscriptions } = twoDevicesAndOne(t);
    const [first, ...rest] = endpointsOf(failing);
    ctx.h.webPush.failWith(first, 503);
    for (const endpoint of rest) ctx.h.webPush.failNetwork(endpoint);

    const res = await runCron(ctx);
    assert.equal(res.status, 200);
    const push = (await res.json()).push;
    assert.deepEqual([push.configured, push.sent, push.failed, push.expired_removed], [true, endpointsOf(other).length, endpointsOf(failing).length, 0]);

    const [otherAlert] = newAlert(ctx, other);
    const got = deliveries(ctx);
    for (const endpoint of endpointsOf(other)) assert.deepEqual(got[endpoint], [otherAlert.message], `${other}'s device ${endpoint} still got its alert`);
    assert.deepEqual(subscriptions(), before, 'a failure that is not "gone" deletes nothing');
  });
}

test('a stored endpoint outside the allowlist is never pushed to by the daily job and its row is kept', async (t) => {
  const { ctx, subscriptions } = twoDevicesAndOne(t);
  // Rows stored before the allowlist existed, or through the parser differential it closed.
  const stray = [
    { profile_id: ctx.id('alice'), endpoint: 'https://legacy.example.test/send/old-device', p256dh: 'ALICE-OLD-P256DH', auth: 'ALICE-OLD-AUTH' },
    { profile_id: ctx.id('bob'), endpoint: 'https://evil.test;.fcm.googleapis.com/x', p256dh: 'BOB-STRAY-P256DH', auth: 'BOB-STRAY-AUTH' },
  ];
  ctx.h.db.seed('push_subscriptions', stray);
  const before = subscriptions();
  const res = await runCron(ctx);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).push, { configured: true, sent: 3, failed: 0, expired_removed: 0 });
  assert.deepEqual(Object.keys(deliveries(ctx)).sort(), Object.values(DEVICE).map((device) => device.endpoint).sort(), 'only the allowed devices were pushed to');
  assert.ok(ctx.h.webPush.sent.every((send) => !stray.some((row) => row.endpoint === send.endpoint)));
  assert.deepEqual(subscriptions(), before, 'the stray rows are skipped, not deleted');
});

test('without VAPID values push is off: nothing is sent and no subscription is touched', async (t) => {
  const { ctx, before, subscriptions } = twoDevicesAndOne(t, { vapid: {} });
  const res = await runCron(ctx);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).push, { configured: false });
  assert.deepEqual(ctx.h.webPush.sent, []);
  assert.deepEqual(subscriptions(), before);
  assert.equal(newAlert(ctx, 'alice').length + newAlert(ctx, 'bob').length, 2, 'the alerts themselves are still created');
});
