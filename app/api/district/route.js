import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { readLayer, buildLayer, storeLayer } from '@/lib/mapBuild';
import { householdCounty } from '@/lib/districtView';

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
 */
export async function GET(request) {
  try {
    const { userId } = await requireUser(request);

    let view = await readLayer(supabaseAdmin, 'district');
    let prebuilt = true;
    if (!view) {
      prebuilt = false;
      view = await buildLayer(supabaseAdmin, 'district');
      storeLayer(supabaseAdmin, 'district', view).catch((e) => console.error('Storing district failed:', e.message));
    }

    const { data: profile } = await supabaseAdmin.from('profiles').select('county').eq('id', userId).maybeSingle();
    // The full statewide ranking stays server-side; the response carries the
    // household's own county.
    const { county_rankings, ...rest } = view;

    return NextResponse.json({ ...rest, household_county: householdCounty(view, profile?.county ?? null), prebuilt });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
