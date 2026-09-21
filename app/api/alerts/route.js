import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';

/**
 * Alerts inbox (§19).
 *   GET  /api/alerts            → reverse-chronological history + unread count
 *   POST /api/alerts  {id}      → mark one read
 *   POST /api/alerts  {all:true}→ mark all read
 *
 * Alerts are written only by the scheduled process (service role); the client
 * can read its own and mark them read. Requires migration 0006.
 */
export async function GET(request) {
  try {
    const { userId } = await requireUser(request);
    const { data, error } = await supabaseAdmin
      .from('alerts')
      .select('*')
      .eq('profile_id', userId)
      .order('fired_at', { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    const alerts = data || [];
    const unread = alerts.filter((a) => a.read !== true).length;
    return NextResponse.json({ count: alerts.length, unread, alerts });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { userId } = await requireUser(request);
    const body = await request.json().catch(() => ({}));

    let q = supabaseAdmin.from('alerts').update({ read: true }).eq('profile_id', userId);
    if (body.all === true) {
      q = q.eq('read', false);
    } else if (typeof body.id === 'string') {
      q = q.eq('id', body.id);
    } else {
      return NextResponse.json({ error: 'Provide an id, or all:true.' }, { status: 400 });
    }
    const { error } = await q;
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
