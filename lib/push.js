/**
 * Browser push for alerts (§19.5; punch list v3 item 16).
 *
 * Uses the standard `web-push` library (message encryption + VAPID signing).
 * Disabled — never an error — until VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and
 * VAPID_SUBJECT are set. The browser subscribes with NEXT_PUBLIC_VAPID_PUBLIC_KEY
 * (the same public key). Sending is injectable so the logic is unit-tested.
 */
import webpush from 'web-push';
import { isSendableEndpoint } from './pushInput.js';

/** Where tapping a notification of each type should land. */
const URL_FOR = {
  air_quality_change: '/today',
  weather_advisory: '/today',
  new_water_results: '/home?risk=water',
  radon_season: '/home?risk=radon',
  season_summary: '/journal?mode=trends',
};

export function pushConfigured(env = process.env) {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

/** The JSON a service worker receives: { id, type, title, message, url }. */
export function buildPushPayload(alert) {
  return {
    id: alert.id ?? null,
    type: alert.type,
    title: alert.title,
    message: alert.message,
    url: URL_FOR[alert.type] || '/today',
  };
}

/** 404/410 from a push service means the subscription is gone for good. */
export function isExpiredPushError(err) {
  const code = err?.statusCode ?? err?.status;
  return code === 404 || code === 410;
}

let configured = false;
function defaultSend(sub, payload) {
  if (!configured) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    configured = true;
  }
  return webpush.sendNotification(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    JSON.stringify(payload),
    { TTL: 60 * 60 * 24 },
  );
}

/**
 * Send each alert to each of the household's subscriptions.
 *
 * A stored endpoint is an address this server sends a request to, so each one is checked
 * with the rule a new subscription must pass (lib/pushInput.js) before anything is sent.
 * A row stored before that rule existed, or past an earlier version of it, is skipped and
 * counted in `skipped`; it is never sent to and never reported in `expired`, so the row stays.
 *
 * @returns {Promise<{sent:number, failed:number, skipped:number, expired:string[]}>}
 *   skipped = subscriptions not sent to because their endpoint is not an allowed Web Push address;
 *   expired = endpoints to delete
 */
export async function sendAlertPushes({ subscriptions = [], alerts = [], sendImpl = defaultSend }) {
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const expired = new Set();
  for (const sub of subscriptions) {
    if (!isSendableEndpoint(sub.endpoint)) {
      skipped += 1;
      continue;
    }
    for (const alert of alerts) {
      if (expired.has(sub.endpoint)) break;
      try {
        await sendImpl(sub, buildPushPayload(alert));
        sent += 1;
      } catch (err) {
        if (isExpiredPushError(err)) expired.add(sub.endpoint);
        else failed += 1;
      }
    }
  }
  // A count only: the address of a stored endpoint is not something to write into a log.
  if (skipped > 0) console.warn(`push: skipped ${skipped} stored subscription(s) whose endpoint is not an allowed Web Push address`);
  return { sent, failed, skipped, expired: [...expired] };
}
