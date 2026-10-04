/**
 * Input rules for /api/push/subscribe, and the check the daily push loop repeats at
 * send time.
 *
 * The daily job POSTs a notification to every stored endpoint, so an endpoint is an
 * address this server will send requests to. Storing whatever URL a caller names
 * would let an anonymous account aim the job at any host (a server-side request
 * risk), so a subscription must point at a known Web Push service.
 *
 *   endpoint   a string of at most 2048 characters, printable ASCII with no space and
 *              no backslash, in exactly this form: `https://` (any case), a plain host
 *              name (letters, digits, hyphens and dots only), an optional `:443`, then
 *              `/`, `?`, `#` or the end. There is no user name or password, no other
 *              port, no percent-encoding or punctuation in the host, no IP address
 *              form that a parser would fold into another one. The host must be one of
 *              PUSH_HOSTS or a subdomain of one (updates.push.services.mozilla.com,
 *              web.push.apple.com, wns2-par02p.notify.windows.com). An IP address never
 *              matches, and a host such as evilfcm.googleapis.com or
 *              fcm.googleapis.com.example.com is not a subdomain of fcm.googleapis.com.
 *              A trailing dot is not accepted: browsers do not send one.
 *
 *              The form is not enough on its own: URL parsers disagree about hosts, and
 *              the one that matters is not the one used to check. web-push sends with the
 *              legacy `url.parse` (web-push-lib.js sendNotification), which reads
 *              `https://evil.test;.fcm.googleapis.com/` as host `evil.test` while the
 *              WHATWG `URL` reads it as an allowed subdomain. So the host that was read
 *              out of the text must also be the host WHATWG `URL` reports AND the host
 *              the legacy parser reports. Anything the two parsers read differently is
 *              refused, whatever the text looks like. (The legacy parser is used through
 *              `new Url().parse`, which is what `url.parse` runs, because `url.parse`
 *              prints a deprecation warning on every process that calls it.)
 *   keys       `{ p256dh, auth }` as a browser's PushSubscription.toJSON() gives them,
 *              and as web-push needs them to send at all (a key it cannot use is a
 *              subscription that fails every day and is never removed):
 *                p256dh  base64url text of exactly 87 characters (a single trailing `=`
 *                        is tolerated) that decodes to 65 bytes with the first one 0x04,
 *                        an uncompressed P-256 point
 *                auth    base64url text of exactly 22 characters (a trailing `==` is
 *                        tolerated) that decodes to 16 bytes, the length RFC 8291 sets
 *                        (web-push itself would take more, no browser sends more)
 *
 * Removing a device (`parsePushEndpointForRemoval`) checks the endpoint the same way
 * except for the host: it is only a lookup key for the caller's own row, nothing is
 * sent to it, and a household must still be able to remove a device that was stored
 * before the allowlist existed.
 *
 * Pure module.
 */

import { Url } from 'node:url';

/** Hosts of the browsers' Web Push services. A host matches itself or any subdomain. */
export const PUSH_HOSTS = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
];

export const ENDPOINT_MAX = 2048;

const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
// https://, a plain host name, an optional :443, then the start of the path, query or fragment.
const STRICT_ENDPOINT = /^https:\/\/([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)(?::443)?(?:[/?#]|$)/i;
const P256DH = /^[A-Za-z0-9_-]{87}=?$/;
const AUTH = /^[A-Za-z0-9_-]{22}(?:==)?$/;

const fail = (field, code, message) => ({ ok: false, fieldErrors: [{ field, code, message }] });

/** True when `host` is one of PUSH_HOSTS or a subdomain of one. */
function isPushHost(host) {
  return PUSH_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

/** The host web-push connects to: what the legacy parser reads out of the endpoint (null when none). */
function legacyHostname(value) {
  const parsed = new Url();
  parsed.parse(value, false, false);
  return parsed.hostname;
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

  const match = STRICT_ENDPOINT.exec(value);
  if (!match) return malformed();
  const host = match[1].toLowerCase();

  // Both parsers must read the same host out of it as the text shows.
  let url;
  try {
    url = new URL(value);
  } catch {
    return malformed();
  }
  if (url.hostname !== host || legacyHostname(value) !== host) return malformed();

  if (requireKnownHost && !isPushHost(host)) {
    return fail('endpoint', 'endpoint_host_not_allowed', 'That push service is not supported.');
  }
  return { ok: true, value };
}

/** One key: base64url text of the exact shape and decoded length, or a field error. */
function parseKey(value, { field, shape, bytes, firstByte }) {
  const invalid = (message) => ({ error: { field, code: 'invalid_key', message } });
  if (typeof value !== 'string' || value === '') return invalid('A push subscription needs keys.p256dh and keys.auth.');
  const decoded = shape.test(value) ? Buffer.from(value, 'base64url') : null;
  if (!decoded || decoded.length !== bytes || (firstByte !== undefined && decoded[0] !== firstByte)) {
    return invalid(`${field} must be the key your browser's push subscription gives.`);
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
  const p256dh = parseKey(keys.p256dh, { field: 'keys.p256dh', shape: P256DH, bytes: 65, firstByte: 0x04 });
  const auth = parseKey(keys.auth, { field: 'keys.auth', shape: AUTH, bytes: 16 });
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

/**
 * Whether a stored endpoint passes the rule a new subscription must pass. The daily push
 * loop asks this before it sends, so a row stored before the allowlist (or past an earlier
 * version of it) is never sent to.
 *
 * @param {unknown} endpoint
 */
export function isSendableEndpoint(endpoint) {
  return parseEndpoint(endpoint, { requireKnownHost: true }).ok;
}
