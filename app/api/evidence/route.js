import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { ERROR_CODES, apiError, requestIdFor, validationError, internalError, loggableError } from '@/lib/apiErrors';
import { readCurrentHomeContext } from '@/lib/homeContextRpc';
import { localDate } from '@/lib/localDate';
import { MAX_SPAN_DAYS, buildHistorySnapshot, firstFullDay, isCalendarDate } from '@/lib/dailyMaxima';
import { isDailyMaximaUnavailable, probeDailyMaximaSchema, readEvidenceRows, readRecordingFrom } from '@/lib/dailyMaximaStore';

/**
 * GET /api/evidence?kind=history&from=YYYY-MM-DD&to=YYYY-MM-DD (operation `evidence.read`,
 * B08 Task 4; docs/backend/plans/b08-evidence.md, Rulings E11 to E19). The environmental
 * history Patterns and Season compare check-ins with (components/production/WeekSources.tsx:6).
 *
 * E1, E6. The answer is built from public.daily_maxima only (migration 0025), the recorded
 *   daily maxima, never from daily_scores: an app-time reading is never a daily maximum, and
 *   nothing is backfilled. A date with no recorded maximum is a null row with its reason.
 * E11. The context is the household's current home, read owner-scoped with
 *   readCurrentHomeContext; `X-Halo-Home-Context` and any id in the query are ignored. Only
 *   that home's rows are read (profile_id AND home_context_id on the query itself), so an
 *   earlier home's maxima and another household's are never served.
 * E12. No current home, or 0016 not applied (the client's context id is then null too):
 *   `{rows: [], comparison: {context: null, basis: 'daily maximum', version: 'daily-max-v1'},
 *   complete: true}`, 200.
 * E13, E14, E16, E17, E18. The body is lib/dailyMaxima.js buildHistorySnapshot with the
 *   server's local date: one row per date and factor, oldest first, the latest 84 days
 *   served, `issued: 'Unknown'`, `complete: true`.
 * E15. The query keys are exactly `kind`, `from` and `to`, each once. `kind` must be
 *   `history`; `from` and `to` are real calendar dates, `from <= to`, at most 92 days
 *   inclusive. A `to` after today is accepted (its dates are null rows). Anything else is a 400
 *   with field_errors, before any database read.
 * E19. 401 without a session. 0025 not applied (lib/dailyMaximaStore.js probeDailyMaximaSchema
 *   and isDailyMaximaUnavailable: the probe daily_maxima_schema_version, or a
 *   table it made, missing: PGRST202, 42883, PGRST205, 42P01) is a non-retryable 503
 *   `feature_unavailable`. Any other database error is the house 500. The body has no
 *   top-level `data` key. No outbound network call is made. `X-Request-Id` on every answer,
 *   `Cache-Control: private, no-store` on the 200.
 *
 * Logs carry the request id and the error's code and message only: never a context id, a
 * point or a row.
 */

const QUERY_KEYS = Object.freeze(['kind', 'from', 'to']);
const NO_STORE = 'private, no-store';
const DAY_MS = 86_400_000;

const MESSAGES = Object.freeze({
  required: (key) => `Send ${key} with the request.`,
  unknown: 'Only kind, from and to can be sent.',
  duplicate: (key) => `Send ${key} only once.`,
  kind: 'Only the history kind can be read here.',
  date: 'Use a real date in YYYY-MM-DD form.',
  inverted: 'The start date must be on or before the end date.',
  span: `Choose a range of ${MAX_SPAN_DAYS} days or fewer.`,
  unavailable: 'Environmental history is not available yet.',
});

/**
 * A key the caller sent, for its field error: only a plain name of at most 40 characters is
 * echoed. Anything else (a U+2014, markup, a long string) is named `query`, so a caller cannot
 * put its own text into our response.
 */
const echo = (key) => (/^[A-Za-z0-9_.-]{1,40}$/.test(key) ? key : 'query');

/** E15: `{ok: true, value: {from, to}}` or `{ok: false, fieldErrors}`. Never throws. */
function parseQuery(searchParams) {
  const fieldErrors = [];
  const seen = new Map();
  for (const [key, value] of searchParams) {
    if (!QUERY_KEYS.includes(key)) {
      fieldErrors.push({ field: echo(key), code: 'unknown_field', message: MESSAGES.unknown });
      continue;
    }
    if (seen.has(key)) {
      if (seen.get(key) !== null) fieldErrors.push({ field: key, code: 'duplicate_field', message: MESSAGES.duplicate(key) });
      seen.set(key, null);
      continue;
    }
    seen.set(key, value);
  }
  for (const key of QUERY_KEYS) {
    if (!seen.has(key)) fieldErrors.push({ field: key, code: 'required', message: MESSAGES.required(key) });
  }
  const kind = seen.get('kind');
  if (typeof kind === 'string' && kind !== 'history') fieldErrors.push({ field: 'kind', code: 'unsupported_kind', message: MESSAGES.kind });
  for (const key of ['from', 'to']) {
    const value = seen.get(key);
    if (typeof value === 'string' && !isCalendarDate(value)) fieldErrors.push({ field: key, code: 'invalid_date', message: MESSAGES.date });
  }
  if (fieldErrors.length) return { ok: false, fieldErrors };

  const from = seen.get('from');
  const to = seen.get('to');
  if (from > to) return { ok: false, fieldErrors: [{ field: 'from', code: 'range_inverted', message: MESSAGES.inverted }] };
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1;
  if (span > MAX_SPAN_DAYS) return { ok: false, fieldErrors: [{ field: 'from', code: 'range_too_large', message: MESSAGES.span }] };
  return { ok: true, value: { from, to } };
}

function unavailable(requestId) {
  return apiError({
    status: 503,
    code: ERROR_CODES.FEATURE_UNAVAILABLE,
    message: MESSAGES.unavailable,
    retryable: false,
    requestId,
  });
}

export async function GET(request) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);

    const parsed = parseQuery(new URL(request.url).searchParams);
    if (!parsed.ok) return validationError(parsed.fieldErrors, requestId);
    const { from, to } = parsed.value;

    if (!(await probeDailyMaximaSchema(supabaseAdmin)).available) return unavailable(requestId);

    const today = localDate();
    const current = await readCurrentHomeContext(supabaseAdmin, userId);
    const context = current.unavailable ? null : current.context;
    let snapshot;
    if (!context) {
      snapshot = buildHistorySnapshot({ from, to, today, context: null, rows: [] });
    } else {
      let rows;
      let recordingFrom;
      try {
        [rows, recordingFrom] = await Promise.all([
          readEvidenceRows(supabaseAdmin, userId, context.id, from, to),
          readRecordingFrom(supabaseAdmin),
        ]);
      } catch (error) {
        if (isDailyMaximaUnavailable(error)) return unavailable(requestId);
        throw error;
      }
      snapshot = buildHistorySnapshot({
        from,
        to,
        today,
        context: context.id,
        rows,
        recordingFrom,
        firstFullDay: firstFullDay(context.effective_from),
      });
    }
    return NextResponse.json(snapshot, { status: 200, headers: { 'X-Request-Id': requestId, 'Cache-Control': NO_STORE } });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`Evidence read failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
