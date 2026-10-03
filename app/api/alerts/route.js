import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { requestIdFor, internalError } from '@/lib/apiErrors';

/**
 * Alerts inbox (§19).
 *   GET  /api/alerts                        → history (dismissed excluded) + unread count
 *   POST /api/alerts { id }                 → mark one read
 *   POST /api/alerts { all: true }          → mark all read
 *   POST /api/alerts { id, dismissed: bool } → dismiss (swipe) or undo (§19.4)
 *
 * Alerts are written only by the daily job (service role); the household reads
 * its own, marks them read, and dismisses them. Dismiss needs migration 0010;
 * before it, dismissed alerts simply aren't filtered.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const base = () =>
      supabaseAdmin.from('alerts').select('*').eq('profile_id', userId).order('fired_at', { ascending: false }).limit(100);

    let { data, error } = await base().eq('dismissed', false);
    if (error && isUndefinedColumnError(error)) ({ data, error } = await base());
    if (error) throw new Error(error.message);

    const alerts = data || [];
    const unread = alerts.filter((a) => a.read !== true).length;
    return NextResponse.json({ count: alerts.length, unread, alerts }, { headers: { 'X-Request-Id': requestId } });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`Alerts failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}

export async function POST(request) {
  try {
    const { userId } = await requireUser(request);
    const body = await request.json().catch(() => ({}));

    if (typeof body.id === 'string' && !UUID_RE.test(body.id)) {
      // Postgres rejects a non-UUID id with an error, which would surface as a 500.
      return NextResponse.json({ error: 'That alert id is not valid.' }, { status: 400 });
    }

    let update;
    let q;
    if (typeof body.id === 'string' && typeof body.dismissed === 'boolean') {
      update = { dismissed: body.dismissed };
      q = supabaseAdmin.from('alerts').update(update).eq('profile_id', userId).eq('id', body.id);
    } else if (body.all === true) {
      update = { read: true };
      q = supabaseAdmin.from('alerts').update(update).eq('profile_id', userId).eq('read', false);
    } else if (typeof body.id === 'string') {
      update = { read: true };
      q = supabaseAdmin.from('alerts').update(update).eq('profile_id', userId).eq('id', body.id);
    } else {
      return NextResponse.json({ error: 'Provide an id, all:true, or id with dismissed.' }, { status: 400 });
    }

    // .select() so the client learns how many rows actually matched (a wrong or
    // foreign id updates 0 rows rather than erroring, thanks to the profile scope).
    const { data, error } = await q.select('id');
    if (error && 'dismissed' in update && isUndefinedColumnError(error)) {
      return NextResponse.json({ error: 'Dismissing alerts needs migration 0010.' }, { status: 501 });
    }
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, updated: (data || []).length });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
