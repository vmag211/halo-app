import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { assembleWaterFeatures } from '@/lib/mapData';
import { getWaterGeo, withGeo, POPULATION_SOURCE } from '@/lib/waterGeo';
import { ncRadonZones } from '@/lib/radonData';
import { radonZoneSeverity } from '@/lib/severity';

// A cold cache falls back to a live ArcGIS lookup (~20s); the daily cron keeps
// the shared cache warm so that is rare.
export const maxDuration = 60;

/**
 * GET /api/map?layer=water|radon
 *
 * Per-layer feature data. Each water feature carries every regulated compound's
 * severity so the contaminant selector re-colours from data already in memory
 * (§13.10). Assembled on the fly here; the daily cron (§23) is the place to
 * pre-assemble it into a cached static dataset once that's wired.
 *
 * Water features get lat/lng (service-area centroid) and population served
 * joined by PWSID from EPA's water-system boundary service (lib/waterGeo.js,
 * cached 24h). If that lookup fails, features keep null geometry and the
 * response says so, rather than failing the layer. The `air` and
 * `facilities` layers need external sources and are not built here.
 */
export async function GET(request) {
  try {
    await requireUser(request);
    const { searchParams } = new URL(request.url);
    const layer = searchParams.get('layer') || 'water';

    if (layer === 'water') {
      const { data, error } = await supabaseAdmin
        .from('ucmr5_utilities')
        .select('pwsid, pws_name, status, contaminants')
        .limit(2000);
      if (error) throw new Error(error.message);
      let features = assembleWaterFeatures(data || []);
      let geo = { requested: features.length, found: 0, failedBatches: 0, error: null };
      try {
        const g = await getWaterGeo(features.map((f) => f.pwsid));
        features = withGeo(features, g.geo);
        geo = { requested: g.requested, found: g.found, failedBatches: g.failedBatches, source: g.source, error: null };
      } catch (geoErr) {
        console.error('Water geography lookup failed:', geoErr.message);
        geo.error = 'Geography lookup unavailable; features have no coordinates this time.';
      }
      const located = features.filter((f) => f.lat !== null && f.lng !== null).length;
      return NextResponse.json({
        layer: 'water',
        count: features.length,
        located,
        features,
        geo,
        population_source: POPULATION_SOURCE,
        assembled_at: new Date().toISOString(),
        note:
          located === features.length
            ? 'Every system has a service-area centroid and, where reported, population served.'
            : `${features.length - located} of ${features.length} systems have no mapped service area; they carry severity but no coordinates.`,
      });
    }

    if (layer === 'radon') {
      const features = Object.entries(ncRadonZones).map(([county, zone]) => ({
        county,
        zone,
        severity: radonZoneSeverity(zone),
      }));
      return NextResponse.json({
        layer: 'radon',
        count: features.length,
        features,
        assembled_at: new Date().toISOString(),
      });
    }

    return NextResponse.json(
      { error: `Layer '${layer}' not available. Built layers: water, radon. (air, facilities need external sources.)` },
      { status: 400 }
    );
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
