import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { ERROR_CODES, apiError, requestIdFor, internalError, loggableError, validationError } from '@/lib/apiErrors';
import { readJsonBody } from '@/lib/validate';
import { parseAlertAction } from '@/lib/alertWriteInput';
import { ALERTS_ROW_LIMIT, isTruncated } from '@/lib/boundedRead';
import { isOperationsUnavailable, listUnresolvedOperations } from '@/lib/operations';
import { isSettingsAlertsUnavailable } from '@/lib/settingsAlerts';
import { readAlertItems } from '@/lib/alertsInbox';

/**
 * Alerts inbox (§19).
 *   GET  /api/alerts                        → history (dismissed excluded), exact unread count
 *                                              and `truncated` when more than the newest 100 exist,
 *                                              plus the contract inbox `items` and
 *                                              `unresolvedOperations` (alerts.read, below)
 *   POST /api/alerts { id }                 → mark one read
 *   POST /api/alerts { all: true }          → mark all read
 *   POST /api/alerts { id, dismissed: bool } → dismiss (swipe) or undo (§19.4)
 *
 * Alerts are written only by the daily job (service role); the household reads
 * its own, marks them read, and dismisses them. Dismiss needs migration 0010;
 * before it, dismissed alerts simply aren't filtered.
 *
 * THE CONTRACT READ (B04 Task 2b). The production client calls this route as
 * `alerts.read` and runs `validAlertSnapshot` on the body, which needs
 * `items` and `unresolvedOperations`; the extra legacy keys are harmless to it
 * (its own fixture carries both sets, digest section 0). So the body is the
 * legacy one with two keys ADDED, and nothing legacy changes: StageSession
 * still calls this route on every session start and reads `alerts`
 * (stage-api.ts:148), and the screen that rendered it is unmounted, so breaking
 * it would be silent.
 *
 *   items                 the contract inbox, lib/alertsInbox.js: the newest
 *                         100 alerts INCLUDING dismissed ones, which the
 *                         legacy list leaves out and the contract needs (Undo
 *                         re-selects a dismissed row)
 *   unresolvedOperations  this household's unsettled `alerts` operations, from
 *                         listUnresolvedOperations and nothing else. It is a
 *                         LOCK, not a log (Ruling S1): a non-empty list makes
 *                         the whole inbox read-only in the client until it is
 *                         reconciled, so it is never widened, narrowed or
 *                         filtered here
 *
 * Before 0021, or before 0017, those two keys are LEFT OUT and every legacy key
 * is still served (Ruling S10). This route never answers 503 for a migration:
 * production has 0019 to 0021 unapplied, and a 503 here would break the live
 * alerts list. The client then rejects the body and says the alerts could not
 * be verified, which is true. Both are left out together, because an inbox
 * whose lock state is unknown cannot honestly be offered as one with nothing
 * outstanding. The ledger is asked first, so without it the inbox is not read.
 *
 * Opening an alert is not reading it (Ruling S6). This route reads; it never
 * marks anything read, and neither does anything else except an explicit
 * `alerts.update` (POST /api/alerts/state).
 *
 * THE LEGACY POST IS NOT REVISION-AWARE. It changes `read` and `dismissed`
 * without advancing `alerts.revision` (0021), so it is the one writer the
 * contract's compare-and-set cannot see: a client holding a row at revision N
 * would still match it after this route changed it, and the put-back in
 * POST /api/alerts/state (lib/alertsInbox.js, applyAlertPatch) could undo a
 * change made here. It is left as it is because nothing in production calls it:
 * its only caller is `markAlerts` (stage-api.ts:157), used only by
 * components/stage/StageApp.tsx, which nothing imports; the daily job only
 * inserts. It must not be revived without a compare-and-set revision bump, and
 * it is retired together with StageApp.
 */
const POST_MAX_BYTES = 2048;

function isUndefinedColumnError(error) {
  return (
    !!error &&
    (error.code === '42703' ||
      error.code === 'PGRST204' ||
      /column .* does not exist/i.test(error.message || '') ||
      /could not find the .* column/i.test(error.message || ''))
  );
}

/**
 * `{ items, unresolvedOperations }`, or `{}` when 0017 or 0021 is not applied
 * (see the header). Any other failure is thrown, as a failed legacy read is.
 */
async function contractInbox(userId) {
  try {
    const unresolvedOperations = await listUnresolvedOperations(supabaseAdmin, { profileId: userId, domains: ['alerts'] });
    const items = await readAlertItems(supabaseAdmin, userId);
    return { items, unresolvedOperations };
  } catch (error) {
    if (isOperationsUnavailable(error) || isSettingsAlertsUnavailable(error)) return {};
    throw error;
  }
}

export async function GET(request) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);
    // The newest 100, with an exact count of the rows that match so a cut can be reported.
    const list = () =>
      supabaseAdmin
        .from('alerts')
        .select('*', { count: 'exact' })
        .eq('profile_id', userId)
        .order('fired_at', { ascending: false })
        .limit(ALERTS_ROW_LIMIT);
    // Unread is counted over every undismissed alert of the household, not just the page above.
    const unreadCount = () =>
      supabaseAdmin.from('alerts').select('id', { count: 'exact', head: true }).eq('profile_id', userId).eq('read', false);

    let filterDismissed = true;
    let { data, error, count } = await list().eq('dismissed', false);
    if (error && isUndefinedColumnError(error)) {
      filterDismissed = false;
      ({ data, error, count } = await list());
    }
    if (error) throw new Error(error.message);

    const unreadResult = await (filterDismissed ? unreadCount().eq('dismissed', false) : unreadCount());
    if (unreadResult.error) throw new Error(unreadResult.error.message);

    const alerts = data || [];
    const truncated = isTruncated({ count, returned: alerts.length, limit: ALERTS_ROW_LIMIT });
    // Unknown is not zero: if the count did not come back, the page's own unread alerts are the floor.
    const unread = unreadResult.count ?? alerts.filter((a) => a.read !== true).length;
    return NextResponse.json(
      { count: alerts.length, unread, truncated, alerts, ...(await contractInbox(userId)) },
      { headers: { 'X-Request-Id': requestId } },
    );
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    // Code and message only (loggableError): contractInbox rethrows a database
    // error as it came, and its details and hint can quote a stored row.
    console.error(`Alerts failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}

export async function POST(request) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);
    const body = await readJsonBody(request, { maxBytes: POST_MAX_BYTES });
    if (!body.ok) {
      return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    }
    // The id is checked as a UUID first: Postgres rejects anything else with an error,
    // which would surface as a 500.
    const action = parseAlertAction(body.value);
    if (!action.ok) return validationError(action.fieldErrors, requestId);

    let update;
    let q;
    if (action.value.kind === 'dismiss') {
      update = { dismissed: action.value.dismissed };
      q = supabaseAdmin.from('alerts').update(update).eq('profile_id', userId).eq('id', action.value.id);
    } else if (action.value.kind === 'read_all') {
      update = { read: true };
      q = supabaseAdmin.from('alerts').update(update).eq('profile_id', userId).eq('read', false);
    } else {
      update = { read: true };
      q = supabaseAdmin.from('alerts').update(update).eq('profile_id', userId).eq('id', action.value.id);
    }

    // .select() so the client learns how many rows actually matched (a wrong or
    // foreign id updates 0 rows rather than erroring, thanks to the profile scope).
    const { data, error } = await q.select('id');
    if (error && 'dismissed' in update && isUndefinedColumnError(error)) {
      return apiError({
        status: 501,
        code: ERROR_CODES.FEATURE_UNAVAILABLE,
        message: 'Dismissing alerts needs migration 0010.',
        requestId,
      });
    }
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, updated: (data || []).length }, { headers: { 'X-Request-Id': requestId } });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`Alerts update failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
