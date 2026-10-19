import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { normalizeBands } from '@/lib/household';
import { readJsonBody } from '@/lib/validate';
import { requestIdFor, apiError, validationError, internalError } from '@/lib/apiErrors';
import { parseProfilePatch } from '@/lib/profileInput';
import { roundCoord } from '@/lib/geocode';
import { contextSummary } from '@/lib/homeContext';
import {
  homeContextConflict,
  isConflictRefusal,
  readCurrentHomeContext,
  transitionHomeContext,
  updateHomeContextAttributes,
} from '@/lib/homeContextRpc';

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
 * Home contexts (migration 0016). The two answers describe the household's
 * current home, so once 0016 is applied the PATCH saves them there and the
 * database keeps the profile in step:
 *   - with a current home, through update_home_context_attributes at the
 *     revision read in this same request. A change to that home in between (a
 *     stale revision, or a move that closed it) is a 409 `conflict` with
 *     `reason` ('stale_revision' with the current `revision`, or
 *     'context_closed'), and nothing of this request is saved. The 409 is new
 *     for this route.
 *   - located but with no home yet (an address stored by the old onboard
 *     route), through transition_home_context with the stored point as it is
 *     and every answer (the changed one and the one kept), which makes the
 *     legacy home and saves the change in it. Known gap: a move by another
 *     request between this request's read and that call is undone by it, and
 *     logged.
 *   - not located (not onboarded): the profile write below, as before.
 * Saved through a home, the answer adds `home_context` (lib/homeContext.js
 * contextSummary); otherwise it is exactly as before. Until 0016 is applied
 * (PGRST205 or 42P01 for the table, PGRST202 or 42883 for the functions) the
 * PATCH is the profile write below, unchanged, and one warning is logged per
 * process.
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

let warnedNoHomeContexts = false;

/** Before migration 0016: the PATCH saves to the profile as it always has. Says so once per process. */
function withoutHomeContexts(code) {
  if (!warnedNoHomeContexts) {
    warnedNoHomeContexts = true;
    console.warn(
      `Profile update: home contexts are not available (${code}), so migration 0016 is probably not applied yet. ` +
        'Saving water_source and home_year to the profile only, as before.',
    );
  }
  return null;
}

/** A stored point transition_home_context takes as it is: both numbers, already rounded to 3 decimals. */
const isStoredPoint = (profile) =>
  !!profile && [profile.lat, profile.lng].every((value) => Number.isFinite(value) && roundCoord(value) === value);

/** What a home context call came to: the saved row, a conflict for the client, or the profile write (null). */
function settle(name, saved) {
  if (saved.unavailable) return withoutHomeContexts(saved.code);
  if (saved.refusal && isConflictRefusal(saved.refusal)) return { conflict: saved.refusal };
  if (saved.refusal) throw new Error(`${name} refused the profile update: ${saved.refusal.code} (${saved.refusal.detail})`);
  return { context: saved.context };
}

/**
 * Saves the answers through the household's home context (see the comment at the top).
 * Returns { context } when saved there, { conflict } for a 409, or null for the profile write.
 */
async function saveThroughHomeContext(userId, answers, requestId) {
  const current = await readCurrentHomeContext(supabaseAdmin, userId);
  if (current.unavailable) return withoutHomeContexts(current.code);
  if (current.context) {
    const saved = await updateHomeContextAttributes(supabaseAdmin, {
      profileId: userId,
      contextId: current.context.id,
      expectedRevision: current.context.revision,
      attributes: answers,
    });
    return settle('update_home_context_attributes', saved);
  }

  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('lat, lng, county, state, pwsid, water_source, home_year')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`Could not read profile: ${error.message}`);
  // Not located: there is no home to save the answers in yet.
  if (!isStoredPoint(profile)) return null;

  // The same point is not a move, so the legacy home is made from the profile and updated in
  // place. Every answer is sent, so the one that is not changing is written as it was.
  const saved = await transitionHomeContext(supabaseAdmin, {
    profileId: userId,
    location: { lat: profile.lat, lng: profile.lng, county: profile.county ?? null, state: profile.state ?? null },
    attributes: {
      pwsid: profile.pwsid ?? null,
      water_source: Object.hasOwn(answers, 'water_source') ? answers.water_source : profile.water_source ?? null,
      home_year: Object.hasOwn(answers, 'home_year') ? answers.home_year : profile.home_year ?? null,
    },
    requestId: null,
  });
  if (saved.moved) {
    console.error(
      `Profile update (request ${requestId}): the household's address changed while this request saved its home details, ` +
        `so the save moved it back to the address the request had read (it closed home ${saved.previous_context_id}).`,
    );
  }
  return settle('transition_home_context', saved);
}

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

    const saved = await saveThroughHomeContext(userId, input.value, requestId);
    if (saved?.conflict) return homeContextConflict(saved.conflict, requestId);

    if (!saved) {
      // The owner key comes last, so nothing in the validated input can override it.
      const { error } = await supabaseAdmin.from('profiles').upsert({ ...input.value, id: userId }, { onConflict: 'id' });
      if (error) throw new Error(`Could not update profile: ${error.message}`);
    }

    const answer = await profileResponse(userId);
    return NextResponse.json(saved ? { ...answer, home_context: contextSummary(saved.context) } : answer, {
      headers: { 'X-Request-Id': requestId },
    });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`Profile update failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
