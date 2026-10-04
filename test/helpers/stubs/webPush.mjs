/**
 * Stand-in for the `web-push` library, which lib/push.js uses to encrypt and
 * deliver a notification over node `https`. Nothing is sent: each call is
 * recorded on the active harness (`h.webPush.sent`) and a test can make one
 * endpoint answer like a push service would.
 *
 *   h.webPush.failWith(endpoint, 410)   // the service says the subscription is gone
 *   h.webPush.failNetwork(endpoint)     // no HTTP answer at all
 *
 * Only `setVapidDetails` and `sendNotification` exist, because those are the
 * only two lib/push.js calls; test/webPushStub.test.mjs fails if that changes.
 * An attempt is recorded even when it then fails, as the push service would have
 * seen the request either way.
 */
import { currentHarness } from './context.mjs';

/** The record behind `h.webPush`: what was attempted, and which endpoints should fail. */
export function createWebPushState() {
  const failures = new Map();
  return {
    sent: [],
    vapid: [],
    failWith(endpoint, statusCode) {
      failures.set(endpoint, { statusCode });
    },
    failNetwork(endpoint) {
      failures.set(endpoint, { network: true });
    },
    failureFor: (endpoint) => failures.get(endpoint),
  };
}

export function setVapidDetails(subject, publicKey, privateKey) {
  currentHarness().webPush.vapid.push({ subject, publicKey, privateKey });
}

export async function sendNotification(subscription, payload, options) {
  if (typeof payload !== 'string') throw new Error('web-push stub: the payload must be a string, as the real library requires');
  const state = currentHarness().webPush;
  state.sent.push({
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.keys?.p256dh, auth: subscription.keys?.auth },
    payload: JSON.parse(payload),
    options,
  });

  const failure = state.failureFor(subscription.endpoint);
  if (failure?.network) throw Object.assign(new Error('web-push stub: connect ECONNRESET'), { code: 'ECONNRESET' });
  if (failure) {
    throw Object.assign(new Error(`web-push stub: Received unexpected response code ${failure.statusCode}`), {
      name: 'WebPushError',
      statusCode: failure.statusCode,
      endpoint: subscription.endpoint,
    });
  }
  return { statusCode: 201, body: '', headers: {} };
}

const webpush = { setVapidDetails, sendNotification };
export default webpush;
