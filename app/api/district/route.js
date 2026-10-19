import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { readLayer, buildLayer, storeLayer, GeographyIncompleteError } from '@/lib/mapBuild';
import { householdCounty } from '@/lib/districtView';
import { ERROR_CODES, apiError, internalError } from '@/lib/apiErrors';
import { publicMapRead } from '@/lib/publicAccess';

// Falls back to a live build (~20s ArcGIS geography) when not pre-built.
export const maxDuration = 60;

/**
 * GET /api/district — NC-08's water picture from public data only (§20).
 *
 * Scoped to NC-08: each system is placed by its service-area centroid against
 * the Census Bureau's district and county boundaries. Returns the district
 * totals (systems over each limit, affected population), exceedance lines using
 * systems TESTED as the denominator, per-county rows for the nine NC-08
 * counties, a district-vs-state comparison, and household_county — the
 * caller's county ranked among North Carolina's counties (filled per request
 * from their profile; the rest is the daily pre-build, map_layers 'district').
 *
 * A failed read of the household's profile is a 500, never a view with no
 * household county: that would look like "your county is not ranked".
 *
 * With no stored view and a service-area lookup that did not complete, the
 * answer is a 503 and nothing is stored. The view's counts are all required
 * integers, so a partial placement would read as "0 systems" with a complete
 * population; no district totals are better than false ones.
 *
 * Without an Authorization header the read is public and cache-only (B05
 * Task 6, lib/publicAccess.js): the stored view only, else a 503. There is no
 * household, so no `profiles` row is read and the answer carries no
 * `household_county` key at all (not null, which would say "your county is not
 * ranked"). Nothing is built, stored or fetched. Any Authorization header is
 * checked exactly as before.
 */

/** The view without the full statewide ranking, which stays server side on every path. */
function sharedView(view) {
  const rest = { ...view };
  delete rest.county_rankings;
  return rest;
}

const read = publicMapRead(async (request, { anonymous, requestId }) => {
  const headers = { 'X-Request-Id': requestId };
  try {
    if (anonymous) {
      const view = await readLayer(supabaseAdmin, 'district');
      if (!view) {
        return apiError({
          status: 503,
          code: ERROR_CODES.UPSTREAM_UNAVAILABLE,
          message: 'The district view is not available to view right now. Try again shortly.',
          requestId,
        });
      }
      return NextResponse.json({ ...sharedView(view), prebuilt: true }, { headers });
    }

    const { userId } = await requireUser(request);

    // Read first, so a failure costs nothing (no live build, no store).
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('county')
      .eq('id', userId)
      .maybeSingle();
    if (profileError) throw new Error(`Could not read profile: ${profileError.message}`);

    let view = await readLayer(supabaseAdmin, 'district');
    let prebuilt = true;
    if (!view) {
      prebuilt = false;
      try {
        view = await buildLayer(supabaseAdmin, 'district');
      } catch (err) {
        if (!(err instanceof GeographyIncompleteError)) throw err;
        console.error(`District was not built: the geography lookup was incomplete (request ${requestId}).`);
        return apiError({
          status: 503,
          code: ERROR_CODES.UPSTREAM_UNAVAILABLE,
          message: 'The district view needs the water service areas, which could not be looked up right now. Try again shortly.',
          requestId,
        });
      }
      storeLayer(supabaseAdmin, 'district', view).catch((e) => console.error(`Storing district failed (request ${requestId}):`, e.message));
    }

    // The full statewide ranking stays server-side; the response carries the
    // household's own county.
    return NextResponse.json({ ...sharedView(view), household_county: householdCounty(view, profile?.county ?? null), prebuilt }, { headers });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`District failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
});

/** Next.js calls GET; the policy lives in `read` (lib/publicAccess.js). */
export async function GET(request) {
  return read(request);
}
