import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { normalizeBands } from '@/lib/household';
import { readJsonBody } from '@/lib/validate';
import { requestIdFor, apiError, validationError, internalError } from '@/lib/apiErrors';
import { parseProfilePatch } from '@/lib/profileInput';

/**
 * GET   /api/profile — the household's stored location, home details and
 *                      composition. Drives first-visit routing (§7.5).
 * PATCH /api/profile { water_source?, home_year? } — change home details
 *                      without re-sending the address (onboarding step 4,
 *                      Settings → Your home, HomeGuard's "are you on a well?").
 *                      A key that is present counts even when null (null clears
 *                      the answer); at least one of the two is required, other
 *                      keys are ignored. The body is read with a 2048 byte limit
 *                      and checked before anything is written (lib/profileInput.js):
 *                      invalid JSON is a 400, an oversize body a 413, a bad value a
 *                      400 with field_errors, and the profile is left as it was.
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

// `onBandsError` (optional) hears about a failed composition read; the read still
// degrades to general-population, as documented. GET uses it to mark the answer;
// PATCH does not pass it and answers as before.
async function profileResponse(userId, { onBandsError } = {}) {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`Could not read profile: ${error.message}`);

  // Composition is optional; a missing row (or table) means general-population.
  const { data: bandRow, error: bandsError } = await supabaseAdmin
    .from('household_bands')
    .select('*')
    .eq('profile_id', userId)
    .maybeSingle();
  if (bandsError) onBandsError?.(bandsError);

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
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);
    let bandsFailed = false;
    const body = await profileResponse(userId, {
      onBandsError: (error) => {
        bandsFailed = true;
        console.error(`Profile household read failed (request ${requestId}):`, error.message);
      },
    });
    // A composition that could not be read looks like "no composition yet", so say which it is.
    return NextResponse.json(
      bandsFailed ? { ...body, unavailable: true, reason: 'household_unavailable' } : body,
      { headers: { 'X-Request-Id': requestId } },
    );
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`Profile failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}

const PATCH_MAX_BYTES = 2048;

export async function PATCH(request) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);
    const body = await readJsonBody(request, { maxBytes: PATCH_MAX_BYTES });
    if (!body.ok) {
      return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    }
    const input = parseProfilePatch(body.value);
    if (!input.ok) return validationError(input.fieldErrors, requestId);

    const { error } = await supabaseAdmin.from('profiles').upsert({ id: userId, ...input.value }, { onConflict: 'id' });
    if (error) throw new Error(`Could not update profile: ${error.message}`);

    return NextResponse.json(await profileResponse(userId), { headers: { 'X-Request-Id': requestId } });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`Profile update failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
