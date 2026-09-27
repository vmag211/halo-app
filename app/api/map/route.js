import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { LAYERS, readLayer, buildLayer, storeLayer, loadUtilities, waterPayload } from '@/lib/mapBuild';
import { getWaterGeo } from '@/lib/waterGeo';

// A cold, un-prebuilt layer falls back to a live build (ArcGIS ~20s, ECHO ~20s);
// the daily job pre-builds every layer so that is rare.
export const maxDuration = 60;

/**
 * GET /api/map?layer=water|radon|facilities|air[&quarter=2024Q3]
 *
 * Served from the daily pre-build (map_layers, migration 0011). A missing or
 * stale layer is built live and stored. `quarter` (water only) returns the
 * water layer as of that sampling quarter, for the time slider; the available
 * quarters are listed in `quarters`.
 *
 * Water features: overall + per-compound severity, rescission flags, ISO
 * dates, the PFAS hazard index, service-area centroid and population served.
 * `counts` describes exactly the features returned (statewide).
 * Facilities: EPA ECHO active majors + repeat violators inside NC-08.
 * Air: AirNow monitoring sites around NC-08, latest hour.
 */
const QUARTER_RE = /^\d{4}Q[1-4]$/;

export async function GET(request) {
  try {
    await requireUser(request);
    const { searchParams } = new URL(request.url);
    const layer = searchParams.get('layer') || 'water';
    const quarter = searchParams.get('quarter');

    if (!LAYERS.includes(layer) || layer === 'district') {
      return NextResponse.json({ error: 'layer must be one of: water, radon, facilities, air.' }, { status: 400 });
    }

    if (quarter) {
      if (layer !== 'water') return NextResponse.json({ error: 'quarter applies to the water layer only.' }, { status: 400 });
      if (!QUARTER_RE.test(quarter)) return NextResponse.json({ error: 'quarter looks like 2024Q3.' }, { status: 400 });
      const utilities = await loadUtilities(supabaseAdmin);
      const g = await getWaterGeo(utilities.map((u) => u.pwsid));
      return NextResponse.json(waterPayload(utilities, g.geo, { quarter }));
    }

    const stored = await readLayer(supabaseAdmin, layer);
    if (stored) return NextResponse.json({ ...stored, prebuilt: true });

    let payload;
    try {
      payload = await buildLayer(supabaseAdmin, layer);
    } catch (err) {
      console.error(`Map layer ${layer} build failed:`, err.message);
      return NextResponse.json(
        { error: `The ${layer} layer's source is unavailable right now. Try again shortly.`, layer },
        { status: 503 },
      );
    }
    storeLayer(supabaseAdmin, layer, payload).catch((e) => console.error('Storing map layer failed:', e.message));
    return NextResponse.json({ ...payload, prebuilt: false });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
