import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { readLayer, loadUtilities } from '@/lib/mapBuild';
import { assembleWaterFeatures, contaminantsInQuarter } from '@/lib/mapData';
import { parseEnum } from '@/lib/validate';
import { parseMapQuarter } from '@/lib/mapQuarter';
import { comparisonRecords, parseComparisonIds } from '@/lib/mapComparison';
import { ERROR_CODES, apiError, validationError, internalError } from '@/lib/apiErrors';
import { publicMapRead } from '@/lib/publicAccess';

/**
 * GET /api/map/comparison?layer=water&quarter=latest&ids=["NC0101010",...]
 * (operation `map.comparison`, B05 ruling D3)
 *
 * The public records the map's comparison sheet sets side by side. Every
 * record is honestly degraded (lib/mapComparison.js): no method, no source
 * version, every value `unknown`, coverage `partial`, so every pair renders
 * "Not comparable" with its reasons and nothing can render "Aligned evidence".
 *
 * Same access rule as /api/map (B05 ruling D1, then Task 6): without an
 * Authorization header the read is public, limited and shared-cacheable
 * (lib/publicAccess.js), and any Authorization header is checked exactly as
 * before. Every source below is already cache-only (a stored layer or the
 * UCMR 5 table, never a fetch), so the anonymous body is the signed-in body;
 * only the cache headers differ. `layer` is one of the four map layers,
 * `quarter` goes through the same parser as /api/map (ruling D2: `latest` is no
 * quarter), and `ids` is one JSON array of 1 to 2,000 record ids (finding F4).
 * Anything else is a 400 with a field error, before anything is read.
 *
 * Sources, never a live upstream build and never an outbound call:
 * - water, latest: the stored water layer; with none stored (or one too old),
 *   the UCMR 5 table, assembled without any geography lookup;
 * - water, a quarter: the UCMR 5 table restricted to that quarter, likewise;
 * - air: the stored air layer only, else a 503;
 * - facilities and radon supply no comparable numeric observation:
 *   `{ records: [] }`, nothing read.
 *
 * Only requested ids that exist are returned. The body is bare `{ records }`,
 * never wrapped in `data` (ruling D10). No household table is read.
 */
const LAYERS = ['water', 'air', 'facilities', 'radon'];

function unavailable(layer, requestId) {
  return apiError({
    status: 503,
    code: ERROR_CODES.UPSTREAM_UNAVAILABLE,
    message: `The ${layer} records are not available for comparison right now. Try again shortly.`,
    requestId,
  });
}

/** The water features for one quarter (or the latest), from the UCMR 5 table, with no geography. */
async function waterFromUtilities(quarter) {
  const utilities = await loadUtilities(supabaseAdmin);
  const source = quarter
    ? utilities
        .map((u) => ({ ...u, contaminants: contaminantsInQuarter(u.contaminants, quarter) }))
        .filter((u) => Object.keys(u.contaminants).length > 0)
    : utilities;
  return assembleWaterFeatures(source);
}

const read = publicMapRead(async (request, { anonymous, requestId }) => {
  const headers = { 'X-Request-Id': requestId };
  try {
    if (!anonymous) await requireUser(request);
    const { searchParams } = new URL(request.url);
    const parsedLayer = parseEnum(searchParams.get('layer'), LAYERS);
    if (!parsedLayer.ok) {
      return validationError(
        [{ field: 'layer', code: parsedLayer.code, message: 'layer must be one of: water, air, facilities, radon.' }],
        requestId,
      );
    }
    const layer = parsedLayer.value;
    const parsedQuarter = parseMapQuarter(searchParams.get('quarter'), layer);
    if (!parsedQuarter.ok) {
      return validationError([{ field: 'quarter', code: parsedQuarter.code, message: parsedQuarter.message }], requestId);
    }
    const { quarter } = parsedQuarter;
    const parsedIds = parseComparisonIds(searchParams.get('ids'));
    if (!parsedIds.ok) {
      return validationError([{ field: 'ids', code: parsedIds.code, message: parsedIds.message }], requestId);
    }
    const { ids } = parsedIds;

    if (layer === 'facilities' || layer === 'radon') return NextResponse.json({ records: [] }, { headers });

    let features;
    if (layer === 'air') {
      const stored = await readLayer(supabaseAdmin, 'air');
      if (!stored) return unavailable(layer, requestId);
      features = stored.features;
    } else {
      const stored = quarter ? null : await readLayer(supabaseAdmin, 'water');
      if (stored) {
        features = stored.features;
      } else {
        try {
          features = await waterFromUtilities(quarter);
        } catch (err) {
          console.error(`Map comparison water read failed (request ${requestId}):`, err);
          return unavailable(layer, requestId);
        }
      }
    }

    const records = comparisonRecords(layer, features).filter((record) => ids.has(record.id));
    return NextResponse.json({ records }, { headers });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`Map comparison failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
});

/** Next.js calls GET; the policy lives in `read` (lib/publicAccess.js). */
export async function GET(request) {
  return read(request);
}
