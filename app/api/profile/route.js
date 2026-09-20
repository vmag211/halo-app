import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { normalizeBands } from '@/lib/household';

/**
 * GET /api/profile — the household's stored location, home details, and
 * composition. Drives first-visit routing (§7.5): `onboarded` is false until an
 * address has been processed (lat/lng present), in which case the app shows
 * onboarding rather than Today.
 *
 * Identity comes from the verified session token; a client can only ever read
 * its own profile.
 */
export async function GET(request) {
  try {
    const { userId } = await requireUser(request);

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    // Composition is optional and may not be stored yet (or the table may not
    // exist before migration 0002). Either way, degrade to general-population.
    let bandRow = null;
    {
      const { data } = await supabaseAdmin
        .from('household_bands')
        .select('*')
        .eq('profile_id', userId)
        .maybeSingle();
      if (data) bandRow = data;
    }

    const onboarded = !!(
      profile &&
      typeof profile.lat === 'number' &&
      typeof profile.lng === 'number'
    );

    return NextResponse.json({
      onboarded,
      profile: profile
        ? {
            county: profile.county ?? null,
            zip: profile.zip ?? null,
            pwsid: profile.pwsid ?? null,
            lat: profile.lat ?? null,
            lng: profile.lng ?? null,
            // The schema carries both columns; onboard writes home_year.
            home_year: profile.home_year ?? profile.build_year ?? null,
            water_source: profile.water_source ?? null,
            renter_mode: profile.renter_mode === true,
            locale: profile.locale ?? 'en',
          }
        : null,
      household: normalizeBands(bandRow),
      household_set: bandRow !== null,
    });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
