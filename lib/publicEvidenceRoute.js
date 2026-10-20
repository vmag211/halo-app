/**
 * The shared GET handler of the four B12 public evidence routes
 * (lib/publicEvidence.js; docs/backend/plans/b12-public-evidence.md).
 *
 * SESSION. Required: the wiring table lists all four as Public "No"
 * (HALO_BACKEND_WIRING_CURRENT.md:312-315) and the runtime registers none of
 * them `public:true`, so it always sends a bearer. `requireUser` decides who is
 * asking; nothing else in the request does. `X-Halo-Home-Context` and any
 * profile id in the query are ignored, because the answer is the same for
 * every household and reads no table.
 *
 * ABUSE. `publicEvidenceLimiter`, 120 a minute per identity across the four
 * routes, fail-OPEN (no provider is called; see lib/ratelimit.js item 18),
 * answered 429 with Retry-After 60.
 *
 * CACHING. A 200 is `private, max-age=600` with `Vary: Authorization`: the
 * files change only when the build is re-run. Every error is
 * `private, no-store`, so a 503 or 429 is never kept.
 *
 * ERRORS. 400 for a wrong `resource` or a malformed food id (field errors,
 * after the limiter, before anything is read); 401 without a session; 503 when the data file
 * fails its own shape check, never an empty stand-in. Logs carry the
 * operation name and a fixed reason only: no ids, no query text.
 */
import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse } from './serverAuth.js';
import { checkLimit, publicEvidenceLimiter } from './ratelimit.js';
import { ERROR_CODES, apiError, internalError, loggableError, requestIdFor, validationError } from './apiErrors.js';
import { parseEvidenceQuery, readEvidence } from './publicEvidence.js';

export const EVIDENCE_CACHE_CONTROL = 'private, max-age=600';
export const EVIDENCE_ERROR_CACHE_CONTROL = 'private, no-store';
export const EVIDENCE_RETRY_AFTER_SECONDS = 60;
export const EVIDENCE_LIMIT_KEY = 'public-evidence:';

const UNAVAILABLE = 'This information is not available right now. Try again later.';
const LIMITED = 'Too many requests. Please wait a minute and try again.';

function withHeaders(response, ok) {
  response.headers.set('Cache-Control', ok ? EVIDENCE_CACHE_CONTROL : EVIDENCE_ERROR_CACHE_CONTROL);
  response.headers.set('Vary', 'Authorization');
  return response;
}

/** @param {'food.search'|'fish.read'|'water.read'|'growers.search'} operation */
export function evidenceRead(operation) {
  return async function GET(request) {
    const requestId = requestIdFor(request);
    try {
      const { userId } = await requireUser(request);
      // Every signed-in request spends a token, refused queries included, so a stream of cheap
      // invalid queries is shed like any other.
      const allowed = await checkLimit(publicEvidenceLimiter, `${EVIDENCE_LIMIT_KEY}${userId}`, { fallback: true, label: 'public evidence limiter' });
      if (!allowed) {
        return withHeaders(apiError({ status: 429, code: ERROR_CODES.RATE_LIMITED, message: LIMITED, retryAfterSeconds: EVIDENCE_RETRY_AFTER_SECONDS, requestId }), false);
      }
      const parsed = parseEvidenceQuery(operation, new URL(request.url).searchParams);
      if (!parsed.ok) return withHeaders(validationError(parsed.fieldErrors, requestId), false);
      const body = readEvidence(parsed.value);
      if (body === null) {
        console.error(`Public evidence unavailable (${operation}): data file failed its shape check.`);
        return withHeaders(apiError({ status: 503, code: ERROR_CODES.UPSTREAM_UNAVAILABLE, message: UNAVAILABLE, requestId }), false);
      }
      return withHeaders(NextResponse.json(body, { status: 200, headers: { 'X-Request-Id': requestId } }), true);
    } catch (err) {
      const authResponse = authErrorResponse(err, requestId);
      if (authResponse) return withHeaders(authResponse, false);
      console.error(`Public evidence read failed (${operation}): ${loggableError(err)}`);
      return withHeaders(internalError(requestId), false);
    }
  };
}
