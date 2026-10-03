import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { aqiSeverity, uvSeverity, pollenSeverity, moldSeverity } from '@/lib/severity';
import { localDate } from '@/lib/localDate';
import { parseBoundedInt, parseDateRange } from '@/lib/validate';
import { requestIdFor, validationError, internalError } from '@/lib/apiErrors';
import { HISTORY_ROW_LIMIT, isTruncated } from '@/lib/boundedRead';

/**
 * GET /api/history?days=90 (or ?from=YYYY-MM-DD&to=YYYY-MM-DD)
 *
 * Daily readings across a date range, exactly one record per date — the latest
 * write wins when a day was refreshed more than once. Serves the seven-day trend
 * lines and the Journal's pattern analysis. Read-only, owner-scoped.
 *
 * The range: `days` (1 to 365, whole numbers, default 90) is the window length,
 * ending at `to`, which defaults to today (household-local). An explicit `from`
 * wins over `days`, and `from` to `to` may span at most 366 days. A malformed or
 * inverted range, or a malformed `days` (even one that `from` makes unused), is a
 * 400 with field errors, never a silent default. `to` may be one day past today.
 *
 * At most 5000 rows are read. When more exist (or the server's own row cap hid
 * some) `truncated` is true; rows are read newest first, so the days that fall
 * off are the oldest.
 */
export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);
    const { searchParams } = new URL(request.url);

    const days = parseBoundedInt(searchParams.get('days'), { min: 1, max: 365, fallback: 90 });
    const range = parseDateRange(
      { from: searchParams.get('from'), to: searchParams.get('to') },
      // Household-local dates (item 10): the dates readings are stored under.
      { today: localDate(), defaultDays: days.ok ? days.value : 90, maxDays: 366 },
    );
    const fieldErrors = [
      ...(days.ok ? [] : [{ field: 'days', code: days.code, message: days.message }]),
      ...(range.ok ? [] : range.fieldErrors),
    ];
    if (fieldErrors.length > 0) return validationError(fieldErrors, requestId);
    const { from, to } = range.value;

    // Newest first, so a cut at the row limit drops the oldest days, never today.
    const { data, error, count } = await supabaseAdmin
      .from('daily_scores')
      .select('date, score, aqi, uv_index, pollen_level, mold_risk, created_at', { count: 'exact' })
      .eq('profile_id', userId)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(HISTORY_ROW_LIMIT);

    if (error) throw new Error(error.message);
    const rows = data || [];

    // Collapse to one record per date (rows are newest-first within a date).
    const byDate = new Map();
    for (const row of rows) {
      if (!byDate.has(row.date)) byDate.set(row.date, row);
    }

    // The response lists dates oldest first, as it always has.
    const history = [...byDate.values()].reverse().map((row) => {
      let pollen = { tree: null, grass: null, weed: null };
      if (row.pollen_level) {
        try { pollen = { ...pollen, ...JSON.parse(row.pollen_level) }; } catch { /* leave nulls */ }
      }
      const pollenVals = [pollen.tree, pollen.grass, pollen.weed].filter((v) => typeof v === 'number');
      const pollenWorst = pollenVals.length ? Math.max(...pollenVals) : null;
      return {
        date: row.date,
        score: row.score ?? null,
        // Canonical severity words per factor, for trend bands and Journal analysis.
        air: aqiSeverity(row.aqi),
        uv: uvSeverity(row.uv_index),
        pollen: pollenSeverity(pollenWorst),
        mold: moldSeverity(row.mold_risk),
        values: { aqi: row.aqi ?? null, uv_index: row.uv_index ?? null, pollen, mold_risk: row.mold_risk ?? null },
      };
    });

    return NextResponse.json(
      {
        from,
        to,
        count: history.length,
        history,
        truncated: isTruncated({ count, returned: rows.length, limit: HISTORY_ROW_LIMIT }),
      },
      { headers },
    );
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`history failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
