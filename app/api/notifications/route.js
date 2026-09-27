import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { normalizePrefs, NOTIFICATION_TYPES } from '@/lib/alertInputs';

/**
 * GET /api/notifications → { preferences: { air_quality_change, weather_advisory,
 *                             new_water_results, radon_season, season_summary } }
 * PUT /api/notifications { preferences: { <any of those>: boolean } } → same shape
 *
 * Every type defaults on. The daily job skips types turned off, for both the
 * inbox and device pushes. Needs migration 0010.
 */
async function read(userId) {
  const { data, error } = await supabaseAdmin.from('notification_prefs').select('*').eq('profile_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return { preferences: normalizePrefs(data) };
}

export async function GET(request) {
  try {
    const { userId } = await requireUser(request);
    return NextResponse.json(await read(userId));
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const { userId } = await requireUser(request);
    const body = await request.json().catch(() => null);
    const incoming = body?.preferences;
    if (!incoming || typeof incoming !== 'object') {
      return NextResponse.json({ error: 'Send { preferences: { type: boolean } }.' }, { status: 400 });
    }
    const update = {};
    for (const [k, v] of Object.entries(incoming)) {
      if (!NOTIFICATION_TYPES.includes(k)) {
        return NextResponse.json({ error: `Unknown notification type: ${k}` }, { status: 400 });
      }
      if (typeof v !== 'boolean') {
        return NextResponse.json({ error: `${k} must be true or false.` }, { status: 400 });
      }
      update[k] = v;
    }
    const { error } = await supabaseAdmin
      .from('notification_prefs')
      .upsert({ profile_id: userId, ...update, updated_at: new Date().toISOString() }, { onConflict: 'profile_id' });
    if (error) throw new Error(error.message);
    return NextResponse.json(await read(userId));
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
