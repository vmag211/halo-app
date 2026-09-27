import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { buildSources } from '@/lib/sources';
import { waterGeoRefreshedAt } from '@/lib/waterGeo';
import { LEAD_INVENTORY_SOURCE } from '@/lib/leadInventory';
import { LEARN_CONTENT } from '@/lib/learnContent';

/**
 * GET /api/sources → { sources: [ { name, provides, last_retrieved } ] }
 *
 * For Settings → About and the health card (§16.4, §15.6). Reading sources
 * report when HALO last got data for this household; reference datasets report
 * when they were loaded. Unknown is null, never a guess.
 */
export async function GET(request) {
  try {
    const { userId } = await requireUser(request);
    const [{ data: readings }, { data: newestLoad }, waterGeoAt] = await Promise.all([
      supabaseAdmin
        .from('daily_scores')
        .select('created_at, aqi_source, uv_index, pollen_level, mold_risk')
        .eq('profile_id', userId)
        .order('created_at', { ascending: false })
        .limit(60),
      supabaseAdmin.from('ucmr5_utilities').select('created_at').order('created_at', { ascending: false }).limit(1),
      waterGeoRefreshedAt(),
    ]);
    const learnRetrieved = LEARN_CONTENT.pfas?.sources?.[0]?.retrieved ?? null;
    return NextResponse.json(
      buildSources({
        readings: readings || [],
        waterDataLoadedAt: newestLoad?.[0]?.created_at ?? null,
        waterGeoAt,
        leadInventoryRetrieved: LEAD_INVENTORY_SOURCE.retrieved,
        learnRetrieved,
      }),
    );
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
