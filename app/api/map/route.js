import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { LAYERS, readLayer, buildLayer, storeLayer, loadUtilities, waterPayload } from '@/lib/mapBuild';
import { getWaterGeo } from '@/lib/waterGeo';
import { parseEnum } from '@/lib/validate';
import { ERROR_CODES, apiError, requestIdFor, validationError, internalError } from '@/lib/apiErrors';

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
 *
 * `layer` (default water; `district` is served by /api/district) and `quarter`
 * are validated: anything else is a 400 with a field error, before anything is
 * read. A well formed quarter with no readings is a true empty answer (0
 * features, and `quarters` names the ones that exist). A layer that cannot be
 * built live is a 503; a layer is never answered with an empty stand-in.
 */
const QUARTER_RE = /^\d{4}Q[1-4]$/;
const PUBLIC_LAYERS = LAYERS.filter((layer) => layer !== 'district');

/** The 503 for a layer whose source failed: the envelope plus the legacy `layer` field. */
async function layerUnavailable(layer, requestId) {
  const envelope = apiError({
    status: 503,
    code: ERROR_CODES.UPSTREAM_UNAVAILABLE,
    message: `The ${layer} layer's source is unavailable right now. Try again shortly.`,
    requestId,
  });
  return NextResponse.json({ ...(await envelope.json()), layer }, { status: 503, headers: envelope.headers });
}

export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    await requireUser(request);
    const { searchParams } = new URL(request.url);
    const parsedLayer = parseEnum(searchParams.get('layer'), PUBLIC_LAYERS, { fallback: 'water' });
    if (!parsedLayer.ok) {
      return validationError(
        [{ field: 'layer', code: parsedLayer.code, message: 'layer must be one of: water, radon, facilities, air.' }],
        requestId,
      );
    }
    const layer = parsedLayer.value;
    const quarter = searchParams.get('quarter');

    if (quarter) {
      if (layer !== 'water') {
        return validationError(
          [{ field: 'quarter', code: 'quarter_not_applicable', message: 'quarter applies to the water layer only.' }],
          requestId,
        );
      }
      if (!QUARTER_RE.test(quarter)) {
        return validationError([{ field: 'quarter', code: 'invalid_quarter', message: 'quarter looks like 2024Q3.' }], requestId);
      }
      const utilities = await loadUtilities(supabaseAdmin);
      const g = await getWaterGeo(utilities.map((u) => u.pwsid));
      return NextResponse.json(waterPayload(utilities, g.geo, { quarter }), { headers });
    }

    const stored = await readLayer(supabaseAdmin, layer);
    if (stored) return NextResponse.json({ ...stored, prebuilt: true }, { headers });

    let payload;
    try {
      payload = await buildLayer(supabaseAdmin, layer);
    } catch (err) {
      console.error(`Map layer ${layer} build failed (request ${requestId}):`, err);
      return layerUnavailable(layer, requestId);
    }
    storeLayer(supabaseAdmin, layer, payload).catch((e) => console.error(`Storing map layer failed (request ${requestId}):`, e.message));
    return NextResponse.json({ ...payload, prebuilt: false }, { headers });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`Map failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
