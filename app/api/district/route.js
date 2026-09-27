import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { computeDistrict, exceedanceLine, REGULATED } from '@/lib/district';
import { getWaterGeo, POPULATION_SOURCE } from '@/lib/waterGeo';

// A cold cache falls back to a live ArcGIS lookup (~20s); the daily cron keeps
// the shared cache warm so that is rare.
export const maxDuration = 60;

/**
 * GET /api/district — the whole district's contamination picture, from public
 * UCMR5 data only, no household data (§20). Powers the district panel and the
 * map's "38 of 412 systems exceed the limit for PFOS" line (§13.4).
 *
 * Population served is joined by PWSID from EPA's water-system boundary service
 * (lib/waterGeo.js). If that lookup fails, affected_population falls back to
 * null with a note, rather than failing the route. There is no per-county
 * breakdown (the boundary data carries no county field).
 */
export async function GET(request) {
  try {
    await requireUser(request);

    const { data, error } = await supabaseAdmin
      .from('ucmr5_utilities')
      .select('pwsid, contaminants')
      .limit(2000);
    if (error) throw new Error(error.message);

    let geo = null;
    try {
      const g = await getWaterGeo((data || []).map((u) => u.pwsid));
      if (g.found > 0) geo = g.geo;
    } catch (geoErr) {
      console.error('Water geography lookup failed:', geoErr.message);
    }
    const district = computeDistrict(data || [], geo);
    const lines = {};
    for (const c of REGULATED) lines[c] = exceedanceLine(district, c);

    return NextResponse.json({
      ...district,
      exceedance_lines: lines,
      population_source: geo ? POPULATION_SOURCE : null,
      assembled_at: new Date().toISOString(),
    });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
