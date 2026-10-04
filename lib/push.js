/**
 * Browser push for alerts (§19.5; punch list v3 item 16).
 *
 * Uses the standard `web-push` library (message encryption + VAPID signing).
 * Disabled — never an error — until VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and
 * VAPID_SUBJECT are set. The browser subscribes with NEXT_PUBLIC_VAPID_PUBLIC_KEY
 * (the same public key). Sending is injectable so the logic is unit-tested.
 */
import webpush from 'web-push';

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
 * @returns {Promise<{sent:number, failed:number, expired:string[]}>} expired = endpoints to delete
 */
export async function sendAlertPushes({ subscriptions = [], alerts = [], sendImpl = defaultSend }) {
  let sent = 0;
  let failed = 0;
  const expired = new Set();
  for (const sub of subscriptions) {
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
  return { sent, failed, expired: [...expired] };
}
