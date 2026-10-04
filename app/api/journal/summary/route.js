import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { fetchHistoryWindow } from '@/lib/journalHistory';
import { seasonSummary, seasonRange, lastEndedSeason, SEASONS } from '@/lib/journalRetro';
import { localDate } from '@/lib/localDate';
import { parseBoundedInt, parseEnum } from '@/lib/validate';
import { requestIdFor, validationError, internalError } from '@/lib/apiErrors';
import { JOURNAL_ROW_LIMIT, isTruncated } from '@/lib/boundedRead';

/**
 * GET /api/journal/summary[?season=spring|summer|fall|winter&year=YYYY]
 *   → { season, year, logged_days, statement, factor, from, to, truncated }
 *
 * The season recap (§14.7), e.g. "This spring you logged 22 days. On the 9
 * high-pollen days, you flagged symptoms 7 times." Defaults to the most recently
 * ended season. Winter belongs to the year it starts in. An empty season or year
 * counts as not given; anything else that is not a season name (any case) or a
 * whole year from 2000 to 2100 is a 400 with field errors.
 *
 * `truncated` is true when either read left rows out (the readings at 5000 rows,
 * the entries at 2000, or the database API's own row cap); both read newest first,
 * so what is left out is the oldest.
 */
export async function GET(request) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const fallback = lastEndedSeason(localDate());
    const seasonInput = parseEnum(searchParams.get('season'), SEASONS, { fallback: fallback.season, caseInsensitive: true });
    const yearInput = parseBoundedInt(searchParams.get('year'), { min: 2000, max: 2100, fallback: fallback.year });

    const fieldErrors = [
      ...(seasonInput.ok ? [] : [{ field: 'season', code: seasonInput.code, message: seasonInput.message }]),
      ...(yearInput.ok ? [] : [{ field: 'year', code: yearInput.code, message: yearInput.message }]),
    ];
    if (fieldErrors.length > 0) return validationError(fieldErrors, requestId);
    const season = seasonInput.value;
    const year = yearInput.value;
    const { from, to } = seasonRange(season, year);

    const [{ history, truncated: historyTruncated }, { data, error, count }] = await Promise.all([
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
    if (error) throw new Error(error.message);
    const entries = data || [];
    const truncated =
      historyTruncated || isTruncated({ count, returned: entries.length, limit: JOURNAL_ROW_LIMIT });

    return NextResponse.json(
      { ...seasonSummary({ season, year, entries, history }), truncated },
      { headers: { 'X-Request-Id': requestId } },
    );
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`journal summary failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
