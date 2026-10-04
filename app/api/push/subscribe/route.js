import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { parsePushSubscription, parsePushEndpointForRemoval } from '@/lib/pushInput';
import { pushLimiter, checkLimit } from '@/lib/ratelimit';
import { ERROR_CODES, apiError, internalError, requestIdFor, validationError } from '@/lib/apiErrors';
import { readJsonBody } from '@/lib/validate';

/**
 * POST   /api/push/subscribe  <the browser's PushSubscription JSON>  → { ok: true }
 * DELETE /api/push/subscribe  { endpoint }                           → { ok: true }
 *
 * Registers or removes this device for alert pushes (§19.5). The subscription is
 * tied to the verified session's household. An endpoint is globally unique, so one
 * that another household already holds is never taken over or reassigned, and the
 * answer is the same { ok: true } as for a new device so it does not reveal that
 * the endpoint exists. Rate-limited per household. Needs migration 0010.
 *
 * The daily job POSTs to every stored endpoint, so a new subscription must point at a
 * known Web Push service and carry well formed keys (lib/pushInput.js). Removal checks
 * the endpoint's shape but not its host, so a device stored before that rule can go.
 */
const MAX_BYTES = 4096;

async function limited(userId, requestId) {
  const ok = await checkLimit(pushLimiter, `push:${userId}`, { fallback: true, label: 'push limiter' });
  return ok
    ? null
    : apiError({ status: 429, code: ERROR_CODES.RATE_LIMITED, message: 'Too many changes. Try again later.', requestId });
}

export async function POST(request) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);
    const tooMany = await limited(userId, requestId);
    if (tooMany) return tooMany;

    const body = await readJsonBody(request, { maxBytes: MAX_BYTES });
    if (!body.ok) {
      return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    }
    const v = parsePushSubscription(body.value);
    if (!v.ok) return validationError(v.fieldErrors, requestId);

    // This household's own device: refresh its keys in place.
    const { data: own, error: ownError } = await supabaseAdmin
      .from('push_subscriptions')
      .update({ p256dh: v.value.p256dh, auth: v.value.auth })
      .eq('profile_id', userId)
      .eq('endpoint', v.value.endpoint)
      .select('id');
    if (ownError) throw new Error(ownError.message);

    // Otherwise register it only if nobody holds the endpoint: ON CONFLICT DO NOTHING,
    // so a row that belongs to another household stays exactly as it was.
    if ((own || []).length === 0) {
      const { error } = await supabaseAdmin
        .from('push_subscriptions')
        .upsert({ ...v.value, profile_id: userId }, { onConflict: 'endpoint', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
    return NextResponse.json({ ok: true }, { headers: { 'X-Request-Id': requestId } });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`push subscribe failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}

export async function DELETE(request) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);
    const tooMany = await limited(userId, requestId);
    if (tooMany) return tooMany;

    const body = await readJsonBody(request, { maxBytes: MAX_BYTES });
    if (!body.ok) {
      return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    }
    const v = parsePushEndpointForRemoval(body.value);
    if (!v.ok) return validationError(v.fieldErrors, requestId);

    const { error } = await supabaseAdmin
      .from('push_subscriptions')
      .delete()
      .eq('profile_id', userId)
      .eq('endpoint', v.value.endpoint);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true }, { headers: { 'X-Request-Id': requestId } });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`push unsubscribe failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
