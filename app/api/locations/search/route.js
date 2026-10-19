import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse } from '@/lib/serverAuth';
import { parseLocationQuery, searchPlaces } from '@/lib/places';
import { requestIdFor, validationError, internalError } from '@/lib/apiErrors';

/**
 * GET /api/locations/search?query=Wake&state=NC (operation `locations.search`)
 *
 * The places a household can choose as its Explore area: North Carolina's
 * counties from the repo's public-domain gazetteer (B05 Ruling D4, lib/places.js).
 * No table is read and no provider is called; signing in is required, as for
 * every household-facing route.
 *
 * A malformed `query` or `state` is a 400 with field errors. Nothing matching is
 * a 200 with `{ candidates: [] }`, which the client shows as "no matching area".
 * The body is bare `{ candidates }`, never wrapped in `data` (Ruling D10).
 */
export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    await requireUser(request);
    const parsed = parseLocationQuery(new URL(request.url).searchParams);
    if (!parsed.ok) return validationError(parsed.fieldErrors, requestId);
    return NextResponse.json({ candidates: searchPlaces(parsed.value) }, { headers });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`Location search failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
