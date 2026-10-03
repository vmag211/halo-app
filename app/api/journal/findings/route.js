import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { journalFindings } from '@/lib/journalAnalysis';
import { fetchHistory } from '@/lib/journalHistory';
import { localDate, addDays } from '@/lib/localDate';
import { requestIdFor, internalError } from '@/lib/apiErrors';

/**
 * GET /api/journal/findings
 *
 * Either a not-ready response (with counts + what's still needed) or findings
 * with co-occurrence rates + the permanent disclaimer (§14.6). Excludes
 * illness-flagged days and enforces the minimum-data thresholds. Uses the
 * household's local dates, the same ones readings and entries are stored under.
 *
 * Takes no input: the window is always the last 90 local days, and nothing in the
 * query string is read.
 */
export async function GET(request) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);

    // 90-day window of environmental history + all symptom entries in it.
    const to = localDate();
    const from = addDays(to, -89);

    const [history, { data: entries, error: eErr }] = await Promise.all([
      fetchHistory(supabaseAdmin, userId, from, to),
      supabaseAdmin
        .from('symptom_logs')
        .select('entry_date, symptoms, possibly_illness')
        .eq('profile_id', userId)
        .gte('entry_date', from)
        .lte('entry_date', to),
    ]);
    if (eErr) throw new Error(eErr.message);

    return NextResponse.json(journalFindings({ entries: entries || [], history }), {
      headers: { 'X-Request-Id': requestId },
    });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`journal findings failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
