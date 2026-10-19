/**
 * The public, cache-only read for the map routes (B05 Task 6; BE-047, AC-148).
 *
 * BE-047 asks for "a separately reviewed read-only cache, abuse and quota
 * policy" before any route answers without a session. This file is that
 * policy for exactly three routes: GET /api/map, GET /api/district and
 * GET /api/map/comparison. Vibhav approved it on 2026-10-19 (open question 1,
 * option A) and set its numbers.
 *
 * WHO IS ANONYMOUS. A request with no Authorization header at all. Any
 * Authorization header, however malformed, empty or expired, goes through
 * `requireUser` exactly as before (the route calls it), so a bad bearer is
 * still a 401 and is never quietly downgraded to an anonymous read. The
 * frontend's public runtime sends no Authorization header (runtime.ts sets it
 * only `if(credential)`, and `credential` is null under `publicAccess`), so
 * this is the line the client already draws.
 *
 * WHAT AN ANONYMOUS READ MAY DO. Read what is already stored: the pre-built
 * layer or district view in `map_layers`, the UCMR 5 table, and the geography
 * caches through `getWaterGeo(ids, { cacheOnly: true })`. Never an upstream
 * fetch, never a live build, never a store, and never a household table: the
 * district answer reads no `profiles` row and carries no `household_county`.
 * When nothing is stored the answer is a 503, in the contract's own terms.
 *
 * ABUSE. 60 requests a minute per visitor across the three routes
 * (`publicMapLimiter`), keyed by the digest of the forwarded client address
 * (`clientDigest`, the rule the public recovery routes use), answered 429 with
 * `Retry-After`. It fails OPEN: a cache-only read costs no provider spend, so a
 * limiter outage lets it through rather than blanking the public map. Signed-in
 * reads are not counted, as before.
 *
 * CACHING. A successful anonymous answer is the same for every visitor, so it
 * carries a public shared-cache lifetime of 10 minutes (`s-maxage=600`) and no
 * browser lifetime (`max-age=0`). Every other answer from these routes, every
 * signed-in answer and every anonymous refusal, is `private, no-store`, so a
 * shared cache never keeps a household's district view or pins a 503 or 429.
 * `Vary: Authorization` is sent on all of them. Whether the CDN in front of the
 * deployment honours this is a staging check for a person (YOUR_TODO.md).
 */
import { checkLimit, publicMapLimiter } from './ratelimit.js';
import { clientDigest } from './recovery.js';
import { ERROR_CODES, apiError, requestIdFor } from './apiErrors.js';

/** The shared-cache lifetime of an anonymous answer, in seconds (Vibhav, 2026-10-19). */
export const PUBLIC_CACHE_SECONDS = 600;
/** Retry-After on a 429: the limiter's whole window, so a client never retries into it. */
export const PUBLIC_RETRY_AFTER_SECONDS = 60;

export const PUBLIC_CACHE_CONTROL = `public, max-age=0, s-maxage=${PUBLIC_CACHE_SECONDS}`;
export const PRIVATE_CACHE_CONTROL = 'private, no-store';

/** The limiter key prefix; the rest is a digest, never an address. */
export const PUBLIC_MAP_CLIENT_KEY = 'public-map:client:';

const LIMITED_MESSAGE = 'Too many map requests from this device. Please wait a minute and try again.';

/** No Authorization header at all. An empty or malformed one is not anonymous. */
export function isAnonymous(request) {
  return !request.headers.has('authorization');
}

function tooManyRequests(requestId) {
  return apiError({
    status: 429,
    code: ERROR_CODES.RATE_LIMITED,
    message: LIMITED_MESSAGE,
    retryAfterSeconds: PUBLIC_RETRY_AFTER_SECONDS,
    requestId,
  });
}

/** Sets the cache headers on a response from one of the three routes. */
export function withCachePolicy(response, { anonymous }) {
  const shared = anonymous && response.status === 200;
  response.headers.set('Cache-Control', shared ? PUBLIC_CACHE_CONTROL : PRIVATE_CACHE_CONTROL);
  response.headers.set('Vary', 'Authorization');
  return response;
}

/**
 * Wraps a map route's handler. `handler(request, { anonymous, requestId })`
 * answers the request, and calls `requireUser` itself when `anonymous` is
 * false, inside its own error handling. This decides anonymity, sheds an
 * anonymous flood before anything is read, and applies the cache policy to
 * whatever is answered.
 *
 * @param {(request: Request, ctx: { anonymous: boolean, requestId: string }) => Promise<Response>} handler
 */
export function publicMapRead(handler) {
  return async function GET(request) {
    const requestId = requestIdFor(request);
    const anonymous = isAnonymous(request);
    if (anonymous) {
      const allowed = await checkLimit(publicMapLimiter, `${PUBLIC_MAP_CLIENT_KEY}${clientDigest(request)}`, {
        fallback: true,
        label: 'public map limiter',
      });
      if (!allowed) return withCachePolicy(tooManyRequests(requestId), { anonymous });
    }
    return withCachePolicy(await handler(request, { anonymous, requestId }), { anonymous });
  };
}
