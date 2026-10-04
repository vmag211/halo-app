import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { fetchHistoryWindow } from '@/lib/journalHistory';
import { retrospectiveComparison } from '@/lib/journalRetro';
import { localDate } from '@/lib/localDate';
import { readJsonBody } from '@/lib/validate';
import { requestIdFor, apiError, validationError, internalError } from '@/lib/apiErrors';
import { parseRetrospectiveDates } from '@/lib/retroInput';

/**
 * POST /api/journal/retrospective { dates: ["YYYY-MM-DD", ...] }
 *   → { ready, factor, statement, ..., rejected, truncated }
 *
 * Journal's first visit (§14.4): the household taps the rough days they
 * remember, and this compares those days' readings with the rest of those
 * months and with the days they didn't pick — e.g. "On the 3 days you flagged,
 * grass pollen averaged High. The month's average was Low. Days you didn't flag
 * averaged Low." Descriptive, never causal. Past days only. Reads only; nothing
 * is saved.
 *
 * The body is read with a 65536 byte limit (invalid JSON is a 400, an oversize
 * body a 413). `dates` is a list of at most 100 as sent (lib/retroInput.js has the
 * rules): a date that is not a real past date, or repeats an earlier one, is
 * listed in `rejected` ({ index, date, code }) and the valid ones are still
 * compared; more than 62 distinct days, or months spanning over 366 days, is a
 * 400. `truncated` is true when the readings were cut at the row limit (the
 * oldest days go first).
 */
const MAX_BODY_BYTES = 65536;

export async function POST(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);
    const body = await readJsonBody(request, { maxBytes: MAX_BODY_BYTES });
    if (!body.ok) {
      return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    }
    const input = parseRetrospectiveDates(body.value, { today: localDate() });
    if (!input.ok) return validationError(input.fieldErrors, requestId);
    const { dates, rejected, window } = input.value;

    if (!window) {
      return NextResponse.json(
        { ...retrospectiveComparison({ dates: [], history: [] }), rejected, truncated: false },
        { headers },
      );
    }

    const { history, truncated } = await fetchHistoryWindow(supabaseAdmin, userId, window.from, window.to);
    return NextResponse.json({ ...retrospectiveComparison({ dates, history }), rejected, truncated }, { headers });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`journal retrospective failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
