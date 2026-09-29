import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { normalizeBands } from '@/lib/household';
import { normalizeWaterSource } from '@/lib/waterSource';
import { validateHomeYear } from '@/lib/geocode';

/**
 * GET   /api/profile — the household's stored location, home details and
 *                      composition. Drives first-visit routing (§7.5).
 * PATCH /api/profile { water_source?, home_year? } — change home details
 *                      without re-sending the address (onboarding step 4,
 *                      Settings → Your home, HomeGuard's "are you on a well?").
 *
 * `onboarded` — an address has been processed (coordinates stored).
 * `onboarding_complete` — coordinates AND a water source are stored, i.e. the
 *   household has also answered the question that decides HomeGuard's branch.
 *
 * A database error is a 500, never a 200 with an empty profile: that would send
 * an onboarded household back through onboarding.
 *
 * Identity comes from the verified session token; a client can only ever read
 * or change its own profile.
 */

async function profileResponse(userId) {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`Could not read profile: ${error.message}`);

  // Composition is optional; a missing row (or table) means general-population.
  const { data: bandRow } = await supabaseAdmin
    .from('household_bands')
    .select('*')
    .eq('profile_id', userId)
    .maybeSingle();

  const onboarded = !!(profile && typeof profile.lat === 'number' && typeof profile.lng === 'number');
  const onboardingComplete = onboarded && typeof profile.water_source === 'string' && profile.water_source !== '';

  return {
    onboarded,
    onboarding_complete: onboardingComplete,
    profile: profile
      ? {
          county: profile.county ?? null,
          state: profile.state ?? null,
          zip: profile.zip ?? null,
          pwsid: profile.pwsid ?? null,
          lat: profile.lat ?? null,
          lng: profile.lng ?? null,
          // The schema carries both columns; onboard writes home_year.
          home_year: profile.home_year ?? profile.build_year ?? null,
          water_source: profile.water_source ?? null,
          renter_mode: profile.renter_mode === true,
          locale: profile.locale ?? 'en',
          // The /api/onboard request that stored this location (migration 0014).
          onboard_request_id: profile.onboard_request_id ?? null,
        }
      : null,
    household: normalizeBands(bandRow ?? null),
    household_set: !!bandRow,
  };
}

export async function GET(request) {
  try {
    const { userId } = await requireUser(request);
    return NextResponse.json(await profileResponse(userId));
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    console.error('Profile failed:', err);
    return NextResponse.json({ error: 'Could not load your profile. Please try again.' }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const { userId } = await requireUser(request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Send a JSON body with water_source and/or home_year.' }, { status: 400 });
    }

    const update = {};
    if ('water_source' in body) update.water_source = normalizeWaterSource(body.water_source);
    if ('home_year' in body) {
      const year = validateHomeYear(body.home_year);
      if (!year.ok) return NextResponse.json({ error: year.error }, { status: 400 });
      update.home_year = year.value;
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nothing to change: send water_source and/or home_year.' }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('profiles').upsert({ id: userId, ...update }, { onConflict: 'id' });
    if (error) throw new Error(`Could not update profile: ${error.message}`);

    return NextResponse.json(await profileResponse(userId));
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    console.error('Profile failed:', err);
    return NextResponse.json({ error: 'Could not load your profile. Please try again.' }, { status: 500 });
  }
}
