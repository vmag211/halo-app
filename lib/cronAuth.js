/**
 * Shared-secret check for the scheduled job (§23).
 *
 * Accepts the secret in any of the three forms a scheduler might send it:
 *   - `Authorization: Bearer <secret>`  — what Vercel Cron sends automatically
 *     when CRON_SECRET is set in the project's environment
 *   - `x-cron-secret: <secret>`          — pg_cron / an external pinger
 *   - `?secret=<secret>`                 — last resort for tools that can't set
 *     headers (it can end up in access logs, so prefer a header)
 *
 * Fails closed: with no CRON_SECRET configured, nothing is authorized. The
 * comparison is constant-time so the secret can't be probed byte by byte.
 *
 * Pure module.
 */
import { timingSafeEqual } from 'node:crypto';

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

/** The secret the request presented, or null. */
export function presentedSecret(headers, url) {
  const auth = headers.get('authorization');
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const header = headers.get('x-cron-secret');
  if (header) return header.trim();
  const query = new URL(url).searchParams.get('secret');
  return query || null;
}

export function isCronAuthorized(headers, url, expected = process.env.CRON_SECRET) {
  if (!expected) return false;
  const got = presentedSecret(headers, url);
  if (!got) return false;
  return safeEqual(got, expected);
}
