import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { normalizePrefs } from '@/lib/alertInputs';
import { apiError, requestIdFor, internalError, validationError } from '@/lib/apiErrors';
import { readJsonBody } from '@/lib/validate';
import { parseNotificationUpdate } from '@/lib/alertWriteInput';

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
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);
    return NextResponse.json(await read(userId), { headers: { 'X-Request-Id': requestId } });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`Notifications failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}

const PUT_MAX_BYTES = 2048;

export async function PUT(request) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);
    const body = await readJsonBody(request, { maxBytes: PUT_MAX_BYTES });
    if (!body.ok) {
      return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    }
    const input = parseNotificationUpdate(body.value);
    if (!input.ok) return validationError(input.fieldErrors, requestId);

    // The owner key comes last, so nothing in the validated input can override it.
    const { error } = await supabaseAdmin
      .from('notification_prefs')
      .upsert({ ...input.value, updated_at: new Date().toISOString(), profile_id: userId }, { onConflict: 'profile_id' });
    if (error) throw new Error(error.message);
    return NextResponse.json(await read(userId), { headers: { 'X-Request-Id': requestId } });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`Notifications update failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
