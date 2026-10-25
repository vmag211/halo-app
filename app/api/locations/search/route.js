import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse } from '@/lib/serverAuth';
import { parseLocationQuery, searchPlaces } from '@/lib/places';
import { requestIdFor, validationError, internalError } from '@/lib/apiErrors';

/**
 * GET /api/locations/search?query=Wake&state=NC (operation `locations.search`)
 *
 * The places a household can choose as its Explore area: North Carolina's
 * counties, Census places (cities, towns, villages, CDPs) and ZIP codes (ZCTAs)
 * from the repo's public-domain Census gazetteers (B05 Ruling D4 and Task 8,
 * lib/places.js).
 * No table is read and no provider is called; signing in is required, as for
 * every household-facing route.
 *
 * A malformed `query` or `state` is a 400 with field errors. Nothing matching is
 * a 200 with `{ candidates: [] }`. Coverage is North Carolina only, so an empty answer is often a
 * real place elsewhere (Seattle, 98101): the client says no North Carolina area matched and that
 * lookup covers North Carolina for now, never that the input was invalid.
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
