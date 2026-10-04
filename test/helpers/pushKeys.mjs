/**
 * Fixtures for the push subscription tests: keys shaped like a browser's, and the
 * endpoints the allowlist must accept or refuse.
 *
 * A browser's PushSubscription holds an unpadded base64url `p256dh` of 87 characters
 * (an uncompressed P-256 point: 65 bytes, the first one 0x04) and an `auth` of 22
 * characters (16 bytes). `keysFor(tag)` gives a valid, distinct pair with a readable
 * tag inside, for tests that need to tell two registrations apart.
 */

export const P256DH = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
export const AUTH = 'tBHItJI5svbpez7KI4CCXg';

/** A valid key pair whose characters spell `tag` (letters, digits, `-` and `_`, at most 20). */
export function keysFor(tag) {
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(tag)) throw new Error(`keysFor: ${tag} is not a short base64url tag`);
  return { p256dh: `BA${tag}${'A'.repeat(85 - tag.length)}`, auth: `${tag}${'A'.repeat(22 - tag.length)}` };
}

/** The forms real browsers' push services hand out (and the host spellings a client might send). */
export const GENUINE_ENDPOINTS = [
  'https://fcm.googleapis.com/fcm/send/dXyZ:APA91bHexample-Token_123',
  'https://FCM.GOOGLEAPIS.COM/fcm/send/upper-case-host',
  'https://fcm.googleapis.com:443/fcm/send/explicit-port',
  'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB%2bMjQ',
  'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABexampletoken',
  'https://web.push.apple.com/QOnlyToken',
  'https://android.googleapis.com/gcm/send/token-b',
  'https://push.services.mozilla.com/wpush/v2/token-c',
  'https://push.apple.com/token-d',
  'https://notify.windows.com/w/?token=token-e',
  'HTTPS://fcm.googleapis.com/fcm/send/upper-case-scheme',
  'https://fcm.googleapis.com?channel=1',
  'https://fcm.googleapis.com',
];

/**
 * Endpoints that carry an allowed host name in a form WHATWG `new URL` reads as an allowed
 * host but the legacy `url.parse` that web-push sends with reads as another host (or the
 * reverse), plus the other tricks around a host. Every one must be refused as malformed.
 */
export const BYPASS_ENDPOINTS = [
  ['a semicolon ending the host', 'https://evil.test;.fcm.googleapis.com/x'],
  ['a semicolon after a metadata address', 'https://169.254.169.254;.fcm.googleapis.com/x'],
  ['a comma ending the host', 'https://evil.test,.fcm.googleapis.com/x'],
  ['an opening brace ending the host', 'https://evil.test{.fcm.googleapis.com/x'],
  ['a closing brace ending the host', 'https://evil.test}.fcm.googleapis.com/x'],
  ['a backtick ending the host', 'https://evil.test`.fcm.googleapis.com/x'],
  ['an exclamation mark ending the host', 'https://evil.test!.fcm.googleapis.com/x'],
  ['a dollar sign ending the host', 'https://evil.test$.fcm.googleapis.com/x'],
  ['an asterisk ending the host', 'https://evil.test*.fcm.googleapis.com/x'],
  ['an ampersand ending the host', 'https://evil.test&.fcm.googleapis.com/x'],
  ['an equals sign ending the host', 'https://evil.test=.fcm.googleapis.com/x'],
  ['an underscore ending the host', 'https://evil.test_.fcm.googleapis.com/x'],
  ['a tilde ending the host', 'https://evil.test~.fcm.googleapis.com/x'],
  ['a quote ending the host', "https://evil.test'.fcm.googleapis.com/x"],
  ['a parenthesis ending the host', 'https://evil.test(.fcm.googleapis.com/x'],
  ['a percent-encoded dot inside the allowed host (read as host "fcm")', 'https://fcm%2Egoogleapis.com/x'],
  ['a percent-encoded dot after the allowed host', 'https://fcm.googleapis.com%2eevil.test/'],
  ['a percent-encoded slash', 'https://evil.test%2f.fcm.googleapis.com/'],
  ['a percent-encoded hash', 'https://evil.test%23.fcm.googleapis.com/'],
  ['a percent-encoded at sign', 'https://evil.test%40fcm.googleapis.com/'],
  ['a percent-encoded colon before an at sign', 'https://evil.test%3a443@fcm.googleapis.com/'],
  ['a percent-encoded NUL', 'https://fcm.googleapis.com%00.evil.test/'],
  ['no slashes after the scheme (host read as null, so localhost)', 'https:fcm.googleapis.com/x'],
  ['one slash after the scheme', 'https:/fcm.googleapis.com/x'],
  ['three slashes after the scheme', 'https:///fcm.googleapis.com/x'],
  ['the allowed host as the user name', 'https://fcm.googleapis.com@evil.test/x'],
  ['a subdomain of an allowed host as the user name', 'https://x.push.apple.com@evil.test/'],
  ['a decimal IPv4 address (folded to 127.0.0.1 by WHATWG)', 'https://2130706433/x'],
  ['a hex IPv4 address (folded to 127.0.0.1 by WHATWG)', 'https://0x7f.1/x'],
  ['an IPv6 address', 'https://[::1]/x'],
  ['a trailing dot after the allowed host', 'https://fcm.googleapis.com./x'],
  ['a trailing dot after a port', 'https://fcm.googleapis.com.:443/x'],
  ['a port other than 443', 'https://fcm.googleapis.com:8443/x'],
  ['an empty port', 'https://fcm.googleapis.com:/x'],
  ['a user and password', 'https://user:secret@fcm.googleapis.com/x'],
];

/**
 * Well formed endpoints on a host that is not allowed, with an allowed host name tucked into
 * the part after it. Both parsers agree the host is evil.test, so these are refused by the
 * allowlist (`endpoint_host_not_allowed`), not as malformed.
 */
export const FOREIGN_HOST_ENDPOINTS = [
  ['an at sign in the query', 'https://evil.test?@fcm.googleapis.com/'],
  ['an at sign after a hash', 'https://evil.test#@fcm.googleapis.com/'],
  ['an at sign in the path', 'https://evil.test/@fcm.googleapis.com/'],
];
