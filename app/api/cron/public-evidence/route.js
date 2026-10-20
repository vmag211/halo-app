import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/serverAuth';
import { isCronAuthorized } from '@/lib/cronAuth';
import { featureEnabled } from '@/lib/features';
import { ERROR_CODES, apiError, internalError, loggableError, requestIdFor } from '@/lib/apiErrors';
import { runPublicWaterImport } from '@/lib/publicWaterImport';

// Both fetches stop at 20 seconds (lib/publicWaterImport.js), leaving the rest to store the copies.
export const maxDuration = 60;

/**
 * GET|POST /api/cron/public-evidence: the weekly import of water.read's two
 * public sources (B19 plan, docs/backend/plans/b19-public-evidence-refresh.md;
 * migration 0033; lib/publicWaterImport.js).
 *
 * Protected by CRON_SECRET (lib/cronAuth.js), exactly as /api/cron/daily.
 * Vercel Cron calls it with GET and `Authorization: Bearer <CRON_SECRET>` on
 * Thursdays at 18:00 UTC (vercel.json), after the U.S. Drought Monitor's
 * Thursday release. Fish advisories are not imported: their text needs a
 * person's review.
 *
 * FALLBACK: if the Vercel plan refuses a third cron entry, remove this entry
 * from vercel.json and call `runPublicWaterImport({ supabase: supabaseAdmin })`
 * from /api/cron/daily on Thursdays only. Nothing else changes.
 *
 * Answers:
 *   401  no or wrong secret; nothing is read or fetched
 *   503  feature_unavailable, not retryable: HALO_FEATURE_PUBLIC_IMPORT is off,
 *        or migration 0033 is not applied; nothing is fetched or stored
 *   500  internal_error: a database failure (logged by its code only)
 *   200  `{ok: true, results: [{source, outcome, reason, rows}]}`: per source,
 *        'stored' or 'failed', a fixed reason code and a row count, never a
 *        URL, a body or a value.
 */
export async function GET(request) {
  return run(request);
}

export async function POST(request) {
  return run(request);
}

const unavailable = (requestId) => apiError({
  status: 503,
  code: ERROR_CODES.FEATURE_UNAVAILABLE,
  message: 'The public water import is not available yet. Nothing was fetched or changed.',
  retryable: false,
  requestId,
});

async function run(request) {
  if (!isCronAuthorized(request.headers, request.url)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const requestId = requestIdFor(request);
  if (!featureEnabled('publicImport')) return unavailable(requestId);
  try {
    const result = await runPublicWaterImport({ supabase: supabaseAdmin });
    if (result.unavailable) return unavailable(requestId);
    return NextResponse.json({ ok: true, results: result.results }, { headers: { 'X-Request-Id': requestId } });
  } catch (error) {
    console.error('Public water import failed:', loggableError({ code: error?.code, message: error?.name === 'PublicImportStoreError' ? error.message : 'unexpected error' }));
    return internalError(requestId);
  }
}
