import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { validateSubscription } from '@/lib/push';
import { pushLimiter, checkLimit } from '@/lib/ratelimit';

/**
 * POST   /api/push/subscribe  <the browser's PushSubscription JSON>  → { ok: true }
 * DELETE /api/push/subscribe  { endpoint }                           → { ok: true }
 *
 * Registers or removes this device for alert pushes (§19.5). The subscription is
 * tied to the verified session's household. An endpoint is globally unique, so one
 * that another household already holds is never taken over or reassigned, and the
 * answer is the same { ok: true } as for a new device so it does not reveal that
 * the endpoint exists. Rate-limited per household. Needs migration 0010.
 */
async function limited(userId) {
  const ok = await checkLimit(pushLimiter, `push:${userId}`, { fallback: true, label: 'push limiter' });
  return ok ? null : NextResponse.json({ error: 'Too many changes. Try again later.' }, { status: 429 });
}

export async function POST(request) {
  try {
    const { userId } = await requireUser(request);
    const tooMany = await limited(userId);
    if (tooMany) return tooMany;

    const v = validateSubscription(await request.json().catch(() => null));
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

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
        .upsert({ profile_id: userId, ...v.value }, { onConflict: 'endpoint', ignoreDuplicates: true });
      if (error) throw new Error(error.message);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { userId } = await requireUser(request);
    const tooMany = await limited(userId);
    if (tooMany) return tooMany;

    const body = await request.json().catch(() => null);
    if (typeof body?.endpoint !== 'string') {
      return NextResponse.json({ error: 'Send { endpoint }.' }, { status: 400 });
    }
    const { error } = await supabaseAdmin
      .from('push_subscriptions')
      .delete()
      .eq('profile_id', userId)
      .eq('endpoint', body.endpoint);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
