import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { assembleWaterFeatures } from '@/lib/mapData';
import { ncRadonZones } from '@/lib/radonData';
import { radonZoneSeverity } from '@/lib/severity';

/**
 * GET /api/map?layer=water|radon
 *
 * Per-layer feature data. Each water feature carries every regulated compound's
 * severity so the contaminant selector re-colours from data already in memory
 * (§13.10). Assembled on the fly here; the daily cron (§23) is the place to
 * pre-assemble it into a cached static dataset once that's wired.
 *
 * NOTE (data gap, §13): water features have no coordinates/population in the
 * UCMR5 dataset (lat/lng/population are null) — join a geographic source before
 * this can be geographically drawn. The `air` and `facilities` layers likewise
 * need external sources and are not built here.
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
      const features = assembleWaterFeatures(data || []);
      return NextResponse.json({
        layer: 'water',
        count: features.length,
        features,
        assembled_at: new Date().toISOString(),
        note: 'Features carry per-contaminant severity but no coordinates/population (not in UCMR5) — join a geographic source to draw them.',
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
