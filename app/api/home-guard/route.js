import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { lazyClient } from '@/lib/lazyClient';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { parseHomeGuardOverrides } from '@/lib/homeGuardInput';
import { requestIdFor, validationError, internalError } from '@/lib/apiErrors';
import { lookupWaterGeoOne } from '@/lib/waterGeo';
import { homeGuardPayload } from '@/lib/homeGuardPayload';

// 1. Connect to Supabase using your safe, public keys (built on first use, so
//    `next build` needs no secrets).
const supabase = lazyClient(() =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
);

/**
 * GET /api/home-guard[?county=&pwsid=&state=&water_source=&home_year=]
 *
 * The Homeguard score, its water, radon and lead factors, the ranked action
 * plan and the per-factor breakdown. The computation itself lives in
 * lib/homeGuardPayload.js, shared with the saved household summary
 * (app/api/summaries/route.js), so a summary's Homeguard snapshot is exactly
 * what this route answers for the household's stored answers.
 */
export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    // 1. Require a session. This route reads no personal data -- the caller
    //    passes county/pwsid explicitly -- so auth here is not about privacy.
    //    It keeps identity handling uniform across the API and stops the
    //    endpoint being used as an open proxy onto the EPA dataset.
    const { userId } = await requireUser(request);

    // 2. Validate the query overrides before anything is read (see
    //    lib/homeGuardInput.js): a malformed override is a 400, not ignored.
    const { searchParams } = new URL(request.url);
    const overrides = parseHomeGuardOverrides(searchParams);
    if (!overrides.ok) return validationError(overrides.fieldErrors, requestId);

    // The household's stored answers are the defaults; query parameters still
    // override them (kept for compatibility and for looking at another place).
    const { data: profileRow, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (profileErr) throw new Error(`Could not read profile: ${profileErr.message}`);

    const built = await homeGuardPayload({
      profileRow,
      given: overrides.value,
      utilities: supabase,
      // Composition and renter mode personalize wording only (§8.2). Before
      // migration 0002 the table is absent and the read answers no row.
      readBands: async () => (await supabaseAdmin.from('household_bands').select('*').eq('profile_id', userId).maybeSingle()).data ?? null,
      lookupPopulation: lookupWaterGeoOne,
    });

    // 3. Safety check: ONLY require the county.
    if (!built.ok) {
      return validationError(
        [{
          field: 'county',
          code: 'county_required',
          message: 'No county on file. Finish onboarding, or pass the county parameter.',
        }],
        requestId,
      );
    }

    return NextResponse.json(built.payload, { headers });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;

    console.error(`HomeGuard API Error (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
