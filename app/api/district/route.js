import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { computeDistrict, exceedanceLine, REGULATED } from '@/lib/district';

/**
 * GET /api/district — the whole district's contamination picture, from public
 * UCMR5 data only, no household data (§20). Powers the district panel and the
 * map's "38 of 412 systems exceed the limit for PFOS" line (§13.4).
 *
 * NOTE (data gap, §20): the UCMR5 dataset has no population served or per-county
 * fields, so `affected_population` is null and there is no per-county breakdown
 * here — those need a separate geographic/SDWIS source.
 */
export async function GET(request) {
  try {
    await requireUser(request);

    const { data, error } = await supabaseAdmin
      .from('ucmr5_utilities')
      .select('pwsid, contaminants')
      .limit(2000);
    if (error) throw new Error(error.message);

    const district = computeDistrict(data || []);
    const lines = {};
    for (const c of REGULATED) lines[c] = exceedanceLine(district, c);

    return NextResponse.json({
      ...district,
      exceedance_lines: lines,
      assembled_at: new Date().toISOString(),
    });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
