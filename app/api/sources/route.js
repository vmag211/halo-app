import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { buildSources } from '@/lib/sources';
import { waterGeoRefreshedAt } from '@/lib/waterGeo';
import { LEAD_INVENTORY_SOURCE } from '@/lib/leadInventory';
import { LEARN_CONTENT } from '@/lib/learnContent';
import { requestIdFor, internalError } from '@/lib/apiErrors';

/**
 * GET /api/sources → { sources: [ { name, provides, last_retrieved } ] }
 *
 * For Settings → About and the health card (§16.4, §15.6). Reading sources
 * report when HALO last got data for this household; reference datasets report
 * when they were loaded. Unknown is null, never a guess.
 *
 * A read that fails would otherwise look the same as "never retrieved" (null),
 * so the answer then also carries `unavailable: true` and a `reason`
 * (`readings_unavailable`, else `reference_data_unavailable`). A household with
 * no readings yet, or no loaded reference data, gets plain nulls.
 */
export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);
    const [{ data: readings, error: readingsError }, { data: newestLoad, error: loadError }, waterGeoAt] = await Promise.all([
      supabaseAdmin
        .from('daily_scores')
        .select('created_at, aqi_source, uv_index, pollen_level, mold_risk')
        .eq('profile_id', userId)
        .order('created_at', { ascending: false })
        .limit(60),
      supabaseAdmin.from('ucmr5_utilities').select('created_at').order('created_at', { ascending: false }).limit(1),
      waterGeoRefreshedAt(),
    ]);
    if (readingsError) console.error(`Sources readings read failed (request ${requestId}):`, readingsError.message);
    if (loadError) console.error(`Sources reference data read failed (request ${requestId}):`, loadError.message);
    const unavailableReason = readingsError ? 'readings_unavailable' : loadError ? 'reference_data_unavailable' : null;

    const learnRetrieved = LEARN_CONTENT.pfas?.sources?.[0]?.retrieved ?? null;
    return NextResponse.json(
      {
        ...buildSources({
          readings: readings || [],
          waterDataLoadedAt: newestLoad?.[0]?.created_at ?? null,
          waterGeoAt,
          leadInventoryRetrieved: LEAD_INVENTORY_SOURCE.retrieved,
          learnRetrieved,
        }),
        ...(unavailableReason && { unavailable: true, reason: unavailableReason }),
      },
      { headers },
    );
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`Sources failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
