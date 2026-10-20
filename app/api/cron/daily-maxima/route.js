import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/serverAuth';
import { isCronAuthorized } from '@/lib/cronAuth';
import { ERROR_CODES, apiError, internalError, loggableError, requestIdFor } from '@/lib/apiErrors';
import { runRecorder } from '@/lib/dailyMaximaRecorder';

// The recorder's provider calls stop at 45 seconds (E21), leaving the rest to write the rows.
export const maxDuration = 60;

/**
 * GET|POST /api/cron/daily-maxima: the daily maxima recorder (B08 Task 3; plan
 * docs/backend/plans/b08-evidence.md, Rulings E4, E5, E8, E9, E21; lib/dailyMaximaRecorder.js).
 *
 * Protected by CRON_SECRET (lib/cronAuth.js), exactly as /api/cron/daily. Vercel Cron calls it with
 * GET and `Authorization: Bearer <CRON_SECRET>` at 12:00 UTC (vercel.json), 7 to 8 hours after the
 * America/New_York day ends, and it records the three most recent completed days for every
 * current home context. It is a separate cron from /api/cron/daily so a slow ArcGIS or household
 * pass cannot starve it of its 60 seconds, and so a recorder failure cannot cost alerts (E5).
 *
 * FALLBACK (E5, Open question 8): if the Vercel plan refuses a second cron entry, remove this
 * entry from vercel.json and call `runRecorder({ supabase: supabaseAdmin, deadlineMs })` as the
 * FIRST step of /api/cron/daily, with its own shorter deadline (for example 20 seconds), before
 * the geography refresh starts. Nothing else changes: the recorder holds no state of its own
 * outside migration 0025, and a run that stops early is finished by the next.
 *
 * Answers:
 *   401  no or wrong secret; nothing is read
 *   503  feature_unavailable, not retryable: migration 0025 is not applied; no provider is called
 *   500  internal_error: an unexpected database failure (logged by its code only)
 *   200  `{ok: true, stopped, ...counts}`: counts only, never an id, a point or a value.
 *        `stopped` is null, 'budget' or 'deadline'.
 *
 * Env: AIRNOW_API_KEY (without it measured Air stays pending), DAILY_MAXIMA_MAX_POINTS (default 400).
 */
export async function GET(request) {
  return record(request);
}

export async function POST(request) {
  return record(request);
}

async function record(request) {
  if (!isCronAuthorized(request.headers, request.url)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const requestId = requestIdFor(request);
  try {
    const result = await runRecorder({ supabase: supabaseAdmin });
    if (result.unavailable) {
      return apiError({
        status: 503,
        code: ERROR_CODES.FEATURE_UNAVAILABLE,
        message: 'Daily maxima are not available yet.',
        retryable: false,
        requestId,
      });
    }
    return NextResponse.json({ ok: true, stopped: result.stopped, ...result.counts }, { headers: { 'X-Request-Id': requestId } });
  } catch (error) {
    console.error('Daily maxima recorder failed:', loggableError({ code: error?.code, message: error?.name === 'DailyMaximaStoreError' ? error.message : 'unexpected error' }));
    return internalError(requestId);
  }
}
