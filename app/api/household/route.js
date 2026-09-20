import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { BAND_KEYS, normalizeBands } from '@/lib/household';

/**
 * Household composition (§8, §16.2).
 *   GET  /api/household  → the seven group booleans (+ renter_mode, locale)
 *   PUT  /api/household  → upsert composition and profile preferences
 *
 * Owner-scoped: identity is the verified session token. Composition never
 * changes a measurement or a score — only which wording and actions appear.
 * (Requires migration 0002.)
 */

export async function GET(request) {
  try {
    const { userId } = await requireUser(request);
    const { data: bandRow } = await supabaseAdmin
      .from('household_bands')
      .select('*')
      .eq('profile_id', userId)
      .maybeSingle();
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('renter_mode, locale')
      .eq('id', userId)
      .maybeSingle();
    return NextResponse.json({
      household: normalizeBands(bandRow),
      household_set: bandRow !== null,
      renter_mode: profile?.renter_mode === true,
      locale: profile?.locale ?? 'en',
    });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const { userId } = await requireUser(request);
    const body = await request.json().catch(() => ({}));

    // Only accept the seven known boolean keys; ignore anything else.
    const bands = { profile_id: userId, updated_at: new Date().toISOString() };
    for (const k of BAND_KEYS) bands[k] = body[k] === true;

    const { error: bandErr } = await supabaseAdmin
      .from('household_bands')
      .upsert(bands, { onConflict: 'profile_id' });
    if (bandErr) throw new Error(`Failed to save household: ${bandErr.message}`);

    // Profile preferences travel with the same call when supplied.
    const profileUpdate = {};
    if (typeof body.renter_mode === 'boolean') profileUpdate.renter_mode = body.renter_mode;
    if (body.locale === 'en' || body.locale === 'es') profileUpdate.locale = body.locale;
    if (Object.keys(profileUpdate).length > 0) {
      profileUpdate.id = userId;
      const { error: profErr } = await supabaseAdmin
        .from('profiles')
        .upsert(profileUpdate, { onConflict: 'id' });
      if (profErr) throw new Error(`Failed to save preferences: ${profErr.message}`);
    }

    return NextResponse.json({
      household: normalizeBands(bands),
      household_set: true,
      renter_mode: profileUpdate.renter_mode ?? undefined,
      locale: profileUpdate.locale ?? undefined,
    });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
