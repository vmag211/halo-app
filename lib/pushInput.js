/**
 * Input rules for /api/push/subscribe.
 *
 * The daily job POSTs a notification to every stored endpoint, so an endpoint is
 * an address this server will send requests to. Storing whatever URL a caller
 * names would let an anonymous account aim the job at any host (a server-side
 * request risk), so a new subscription must point at a known Web Push service.
 *
 *   endpoint   a string of at most 2048 characters (printable ASCII, no spaces
 *              and no backslash, so every URL parser reads it the same way), an
 *              https URL on the default port with no user or password, whose host
 *              is one of PUSH_HOSTS or a subdomain of one of them
 *              (updates.push.services.mozilla.com, web.push.apple.com,
 *              wns2-par02p.notify.windows.com). An IP address never matches, and a
 *              host such as evilfcm.googleapis.com or fcm.googleapis.com.example.com
 *              is not a subdomain of fcm.googleapis.com. A trailing dot is not
 *              accepted: browsers do not send one.
 *   keys       `{ p256dh, auth }` as a browser's PushSubscription.toJSON() gives
 *              them: base64url text (letters, digits, `-` and `_`, optionally
 *              padded with `=`) of 16 to 200 characters. A real p256dh is 87
 *              characters and a real auth 22; the range only keeps out nonsense.
 *
 * Removing a device (`parsePushEndpointForRemoval`) checks the endpoint the same way
 * except for the host: it is only a lookup key for the caller's own row, nothing is
 * sent to it, and a household must still be able to remove a device that was stored
 * before the allowlist existed.
 *
 * Pure module.
 */

/** Hosts of the browsers' Web Push services. A host matches itself or any subdomain. */
export const PUSH_HOSTS = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
];

export const ENDPOINT_MAX = 2048;
export const KEY_MIN = 16;
export const KEY_MAX = 200;

const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

const fail = (field, code, message) => ({ ok: false, fieldErrors: [{ field, code, message }] });

/** True when `host` is one of PUSH_HOSTS or a subdomain of one. */
function isPushHost(host) {
  return PUSH_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

/**
 * @param {unknown} value
 * @param {{ requireKnownHost?: boolean }} [options] false skips the host allowlist (removal)
 * @returns {{ ok: true, value: string } | { ok: false, fieldErrors: { field: string, code: string, message: string }[] }}
 */
function parseEndpoint(value, { requireKnownHost }) {
  if (typeof value !== 'string' || value === '') {
    return fail('endpoint', 'invalid_endpoint', 'A push subscription needs an https endpoint.');
  }
  if (Array.from(value).length > ENDPOINT_MAX) {
    return fail('endpoint', 'endpoint_too_long', `The push endpoint must be ${ENDPOINT_MAX} characters or fewer.`);
  }
  const malformed = () => fail('endpoint', 'invalid_endpoint', 'The push endpoint must be a plain https URL.');
  if (!PRINTABLE_ASCII.test(value) || value.includes('\\')) return malformed();

  let url;
  try {
    url = new URL(value);
  } catch {
    return malformed();
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return malformed();

  if (requireKnownHost && !isPushHost(url.hostname)) {
    return fail('endpoint', 'endpoint_host_not_allowed', 'That push service is not supported.');
  }
  return { ok: true, value };
}

/** One key: base64url text of a sane length, or a field error. */
function parseKey(value, field) {
  const keysMessage = 'A push subscription needs keys.p256dh and keys.auth.';
  if (typeof value !== 'string' || value === '') return { error: { field, code: 'invalid_key', message: keysMessage } };
  if (value.length < KEY_MIN || value.length > KEY_MAX || !BASE64URL.test(value)) {
    return { error: { field, code: 'invalid_key', message: `${field} must be base64url text of ${KEY_MIN} to ${KEY_MAX} characters.` } };
  }
  return { value };
}

/**
 * A browser's PushSubscription as sent to POST. Unknown keys (`expirationTime`) are ignored.
 *
 * @param {object} body the parsed JSON object
 * @returns {{ ok: true, value: { endpoint: string, p256dh: string, auth: string } }
 *   | { ok: false, fieldErrors: { field: string, code: string, message: string }[] }}
 */
export function parsePushSubscription(body) {
  const fieldErrors = [];

  const endpoint = parseEndpoint(body.endpoint, { requireKnownHost: true });
  if (!endpoint.ok) fieldErrors.push(...endpoint.fieldErrors);

  const keys = body.keys ?? {}; // anything but an object has no p256dh or auth, so it reports both as missing
  const p256dh = parseKey(keys.p256dh, 'keys.p256dh');
  const auth = parseKey(keys.auth, 'keys.auth');
  if (p256dh.error) fieldErrors.push(p256dh.error);
  if (auth.error) fieldErrors.push(auth.error);

  if (fieldErrors.length > 0) return { ok: false, fieldErrors };
  return { ok: true, value: { endpoint: endpoint.value, p256dh: p256dh.value, auth: auth.value } };
}

/**
 * The `{ endpoint }` of a DELETE. The host is not checked (see the header).
 *
 * @param {object} body the parsed JSON object
 */
export function parsePushEndpointForRemoval(body) {
  if (typeof body.endpoint !== 'string') return fail('endpoint', 'endpoint_required', 'Send { endpoint }.');
  const endpoint = parseEndpoint(body.endpoint, { requireKnownHost: false });
  if (!endpoint.ok) return endpoint;
  return { ok: true, value: { endpoint: endpoint.value } };
}
