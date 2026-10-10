import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { aqiSeverity, uvSeverity, pollenSeverity, moldSeverity } from '@/lib/severity';
import { localDate } from '@/lib/localDate';
import { parseBoundedInt, parseDateRange, parseUuid } from '@/lib/validate';
import { requestIdFor, validationError, internalError } from '@/lib/apiErrors';
import { historyHome, inScope, latestPerDay, readHistoryRows, readingComparability } from '@/lib/journalHistory';
import { homeContextNotFound, homeContextUnavailable, readOwnedHomeContext } from '@/lib/homeContextRpc';

/** The daily_scores columns a history point is made from. */
const HISTORY_COLUMNS = 'date, score, aqi, uv_index, pollen_level, mold_risk, created_at';

/**
 * GET /api/history?days=90 (or ?from=YYYY-MM-DD&to=YYYY-MM-DD) [&context=all|<home id>]
 *
 * Daily readings across a date range, exactly one record per date (per home with
 * context=all): the latest write wins when a day was refreshed more than once.
 * Serves the seven-day trend lines and the Journal's pattern analysis. Read-only,
 * owner-scoped.
 *
 * The range: `days` (1 to 365, whole numbers, default 90) is the window length,
 * ending at `to`, which defaults to today (household-local). An explicit `from`
 * wins over `days`, and `from` to `to` may span at most 366 days. A malformed or
 * inverted range, or a malformed `days` (even one that `from` makes unused), is a
 * 400 with field errors, never a silent default. `to` may be one day past today.
 *
 * At most 5000 rows are read. When more exist (or the server's own row cap hid
 * some) `truncated` is true; rows are read newest first, so the days that fall
 * off are the oldest. The limit counts the household's readings in the range,
 * whichever home they are from.
 *
 * Homes (migration 0016). A reading belongs to the home it was taken at. Which
 * readings are shown (`context`, see lib/journalHistory.js):
 *   (not given)  the current home's, plus readings with no home recorded, which
 *                are assumed to be the current home's. An earlier home's reading
 *                is never shown in place of the current home's.
 *   all          every home's. A date around a move can then have one point per
 *                home (the earlier home's reading and the new home's backfilled
 *                one), the earlier home's flagged, so a client can show the
 *                break. Within a date, points come in the order their readings
 *                were written.
 *   <home id>    one of the household's own homes (GET /api/home-contexts), its
 *                linked readings only. Another household's id and an id that
 *                does not exist are the same 404 `not_found` as
 *                GET /api/home-contexts/<id>. Not a UUID (and not `all`): 400.
 * Each point adds `home_context_id` (its home, null when none is recorded) and
 * `comparability`: 'current_context' (the current home), 'legacy_assumed' (no home
 * recorded, or the current home made by 0016's migration of an older account,
 * which cannot prove where every reading was taken) or 'earlier_home'. The body
 * adds `context: { current_id, includes_earlier_homes }`: the current home's id
 * (null when there is none) and whether any point is an earlier home's.
 *
 * Until 0016 is applied (no home_contexts table, or no home_context_id column)
 * the history is exactly as before: every reading, `context.current_id` null,
 * each point `legacy_assumed` with `home_context_id` null. `context=all` is then
 * the same history, and `context=<home id>` is a 503 `feature_unavailable`
 * (there are no homes to choose from yet).
 *
 * Identity comes from the verified session token; a home id in the query is only
 * a lookup key next to it.
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
    const scope = parseScope(searchParams.get('context'));
    const fieldErrors = [
      ...(days.ok ? [] : [{ field: 'days', code: days.code, message: days.message }]),
      ...(range.ok ? [] : range.fieldErrors),
      ...(scope.ok ? [] : [{ field: 'context', code: scope.code, message: scope.message }]),
    ];
    if (fieldErrors.length > 0) return validationError(fieldErrors, requestId);
    const { from, to } = range.value;

    // The household's current home: one owner-scoped read (not linked before 0016).
    const home = await historyHome(supabaseAdmin, userId);
    const oneHome = typeof scope.value === 'object';
    if (oneHome) {
      if (!home.linked) return homeContextUnavailable(requestId);
      // Owner first: another household's home finds nothing, exactly like a missing one.
      const owned = await readOwnedHomeContext(supabaseAdmin, userId, scope.value.contextId);
      if (owned.unavailable) return homeContextUnavailable(requestId);
      if (!owned.context) return homeContextNotFound(requestId);
    }

    // Newest first, so a cut at the row limit drops the oldest days, never today.
    const read = await readHistoryRows(supabaseAdmin, userId, from, to, { columns: HISTORY_COLUMNS, home });
    if (oneHome && !read.home.linked) return homeContextUnavailable(requestId);

    // One record per date (per date and home for context=all), the latest refresh; listed
    // oldest first, as it always has been.
    const rows = latestPerDay(inScope(read.rows, read.home, scope.value), read.home).reverse();
    const history = rows.map((row) => toPoint(row, read.home));

    return NextResponse.json(
      {
        from,
        to,
        count: history.length,
        history,
        truncated: read.truncated,
        context: {
          current_id: read.home.linked ? read.home.current?.id ?? null : null,
          includes_earlier_homes: history.some((point) => point.comparability === 'earlier_home'),
        },
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

/**
 * `context`: not given (or empty) is the current home, `all` (any case) every home, a UUID one home
 * (lowercased, as ids are stored). Anything else is a field error.
 */
function parseScope(value) {
  if (value === null || value === '') return { ok: true, value: 'current' };
  if (value.toLowerCase() === 'all') return { ok: true, value: 'all' };
  const id = parseUuid(value);
  if (id.ok) return { ok: true, value: { contextId: id.value } };
  return { ok: false, code: id.code, message: 'Use all, or the id of one of your homes.' };
}

/** One daily_scores row as a history point: the fields it always had, then its home. */
function toPoint(row, home) {
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
    home_context_id: home.linked ? row.home_context_id ?? null : null,
    comparability: readingComparability(row, home),
  };
}
