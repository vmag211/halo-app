/**
 * The shared GET handler of the three B18 participation directory routes
 * (lib/participation.js; docs/backend/plans/b18-participation-directory.md).
 *
 * SESSION. Required: the wiring table lists all three as Public "No"
 * (HALO_BACKEND_WIRING_CURRENT.md:278-280) and the runtime registers none of
 * them `public:true` (runtime.ts:43-45), so it always sends a bearer.
 * `requireUser` decides who is asking and nothing else is read from the
 * caller: `X-Halo-Home-Context` and any profile id in the query are ignored,
 * because the answer is public reference data, the same for every household.
 *
 * ORDER. Session (401), flag (`participation` off: the non-retryable 503,
 * nothing read), limiter (`participationLimiter`, 120 a minute per identity
 * across the three, fail-OPEN because no provider is called, answered 429
 * with Retry-After 60), query (400 with field errors), then the read.
 *
 * ERRORS. A missing 0032 is the same non-retryable 503 (never a 500). Any
 * other failed read is a 500: an unreadable directory is never `items: []`
 * (B05 9.3). Logs carry the operation and the error's code and message only.
 *
 * CACHING. `private, no-store` on every answer: a person can change or
 * withdraw a listing at any moment.
 */
import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from './serverAuth.js';
import { checkLimit, participationLimiter } from './ratelimit.js';
import { ERROR_CODES, apiError, internalError, loggableError, requestIdFor, validationError } from './apiErrors.js';
import { featureEnabled } from './features.js';
import { isParticipationUnavailable, readUnavailable } from './participation.js';

export const PARTICIPATION_CACHE_CONTROL = 'private, no-store';
export const PARTICIPATION_RETRY_AFTER_SECONDS = 60;
export const PARTICIPATION_LIMIT_KEY = 'participation:';
const LIMITED = 'Too many requests. Please wait a minute and try again.';

const withHeaders = (response) => {
  response.headers.set('Cache-Control', PARTICIPATION_CACHE_CONTROL);
  return response;
};

/**
 * @param {'organizations.search'|'opportunities.search'|'opportunities.detail'} operation
 * @param {(searchParams: URLSearchParams) => ({ok: true, value: object} | {ok: false, fieldErrors: object[]})} parse
 * @param {(supabase: object, value: object) => Promise<object|null>} read null answers 404
 * @param {(requestId: string) => Response} [missing] the answer for null
 */
export function participationRead(operation, parse, read, missing) {
  return async function GET(request) {
    const requestId = requestIdFor(request);
    try {
      const { userId } = await requireUser(request);
      if (!featureEnabled('participation')) return withHeaders(readUnavailable(requestId));
      const allowed = await checkLimit(participationLimiter, `${PARTICIPATION_LIMIT_KEY}${userId}`, { fallback: true, label: 'participation limiter' });
      if (!allowed) {
        return withHeaders(apiError({ status: 429, code: ERROR_CODES.RATE_LIMITED, message: LIMITED, retryAfterSeconds: PARTICIPATION_RETRY_AFTER_SECONDS, requestId }));
      }
      const parsed = parse(new URL(request.url).searchParams);
      if (!parsed.ok) return withHeaders(validationError(parsed.fieldErrors, requestId));
      const body = await read(supabaseAdmin, parsed.value);
      if (body === null) return withHeaders(missing(requestId));
      return withHeaders(NextResponse.json(body, { status: 200, headers: { 'X-Request-Id': requestId } }));
    } catch (err) {
      if (isParticipationUnavailable(err)) return withHeaders(readUnavailable(requestId));
      const authResponse = authErrorResponse(err, requestId);
      if (authResponse) return withHeaders(authResponse);
      console.error(`Participation read failed (${operation}, request ${requestId}):`, loggableError(err));
      return withHeaders(internalError(requestId));
    }
  };
}
