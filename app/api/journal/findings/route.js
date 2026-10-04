import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { journalFindings } from '@/lib/journalAnalysis';
import { fetchHistoryWindow } from '@/lib/journalHistory';
import { localDate, addDays } from '@/lib/localDate';
import { requestIdFor, internalError } from '@/lib/apiErrors';
import { JOURNAL_ROW_LIMIT, isTruncated } from '@/lib/boundedRead';

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
 *
 * `truncated` is true when either read left rows out (the readings at 5000 rows,
 * the entries at 2000, or the database API's own row cap). Both read newest first,
 * so what is left out is the oldest.
 */
export async function GET(request) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);

    // 90-day window of environmental history + all symptom entries in it.
    const to = localDate();
    const from = addDays(to, -89);

    const [{ history, truncated: historyTruncated }, { data, error: eErr, count }] = await Promise.all([
      fetchHistoryWindow(supabaseAdmin, userId, from, to),
      supabaseAdmin
        .from('symptom_logs')
        .select('entry_date, symptoms, possibly_illness', { count: 'exact' })
        .eq('profile_id', userId)
        .gte('entry_date', from)
        .lte('entry_date', to)
        .order('entry_date', { ascending: false })
        .limit(JOURNAL_ROW_LIMIT),
    ]);
    if (eErr) throw new Error(eErr.message);
    const entries = data || [];
    const truncated =
      historyTruncated || isTruncated({ count, returned: entries.length, limit: JOURNAL_ROW_LIMIT });

    return NextResponse.json(
      { ...journalFindings({ entries, history }), truncated },
      { headers: { 'X-Request-Id': requestId } },
    );
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`journal findings failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
