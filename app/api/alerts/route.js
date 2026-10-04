import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { ERROR_CODES, apiError, requestIdFor, internalError, validationError } from '@/lib/apiErrors';
import { readJsonBody } from '@/lib/validate';
import { parseAlertAction } from '@/lib/alertWriteInput';
import { ALERTS_ROW_LIMIT, isTruncated } from '@/lib/boundedRead';

/**
 * Alerts inbox (§19).
 *   GET  /api/alerts                        → history (dismissed excluded), exact unread count
 *                                              and `truncated` when more than the newest 100 exist
 *   POST /api/alerts { id }                 → mark one read
 *   POST /api/alerts { all: true }          → mark all read
 *   POST /api/alerts { id, dismissed: bool } → dismiss (swipe) or undo (§19.4)
 *
 * Alerts are written only by the daily job (service role); the household reads
 * its own, marks them read, and dismisses them. Dismiss needs migration 0010;
 * before it, dismissed alerts simply aren't filtered.
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
    return NextResponse.json({ count: alerts.length, unread, truncated, alerts }, { headers: { 'X-Request-Id': requestId } });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`Alerts failed (request ${requestId}):`, err);
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
    console.error(`Alerts update failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
