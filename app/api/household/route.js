import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { normalizeBands } from '@/lib/household';
import { readJsonBody } from '@/lib/validate';
import { requestIdFor, apiError, validationError, internalError } from '@/lib/apiErrors';
import { parseHouseholdBody } from '@/lib/profileInput';

/**
 * Household composition (§8, §16.2).
 *   GET  /api/household  → the seven group booleans (+ renter_mode, locale)
 *   PUT  /api/household  → upsert composition and profile preferences. The PUT
 *                          replaces the composition: a group key left out (or null)
 *                          is false, and the answer lists all seven. The body is
 *                          read with a 2048 byte limit and checked before anything
 *                          is written (lib/profileInput.js): invalid JSON is a 400,
 *                          an oversize body a 413, a group that is not true or
 *                          false, a renter_mode that is not a boolean or a locale
 *                          other than en or es is a 400 with field_errors, and the
 *                          household is left exactly as it was in all of those.
 *
 * The PUT saves through public.save_household (migration 0015), which writes the
 * composition and the preferences in one transaction, so either all of it is
 * saved or none of it; the answer then says `transactional: true`. Until 0015 is
 * applied (PostgREST answers PGRST202, or Postgres 42883, for the missing
 * function) it saves in two steps as before, logs one warning per process and
 * says `transactional: false`. Any other failure of the function is a 500 and
 * nothing is saved.
 *
 * Owner-scoped: identity is the verified session token. Composition never
 * changes a measurement or a score — only which wording and actions appear.
 * (Requires migration 0002; 0015 for the single transaction.)
 */

export async function GET(request) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);
    const { data: bandRow, error: bandsError } = await supabaseAdmin
      .from('household_bands')
      .select('*')
      .eq('profile_id', userId)
      .maybeSingle();
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('renter_mode, locale')
      .eq('id', userId)
      .maybeSingle();
    if (bandsError) console.error(`Household read failed (request ${requestId}):`, bandsError.message);
    if (profileError) console.error(`Household preferences read failed (request ${requestId}):`, profileError.message);
    // The defaults below are what a household with no rows gets. A read that failed
    // gets them too, so the answer then says it is not the household's real one.
    const unavailableReason = bandsError ? 'household_unavailable' : profileError ? 'preferences_unavailable' : null;
    return NextResponse.json(
      {
        household: normalizeBands(bandRow),
        household_set: bandRow !== null,
        renter_mode: profile?.renter_mode === true,
        locale: profile?.locale ?? 'en',
        ...(unavailableReason && { unavailable: true, reason: unavailableReason }),
      },
      { headers: { 'X-Request-Id': requestId } },
    );
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`Household failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}

const PUT_MAX_BYTES = 2048;

/** The error codes for "save_household does not exist here yet": PostgREST's, then Postgres's. */
const RPC_UNAVAILABLE = new Set(['PGRST202', '42883']);
let warnedNoTransaction = false;

/**
 * One call to save_household. Returns the saved state, or null when the function is
 * not available yet (migration 0015 not applied); throws on any other failure.
 */
async function saveInOneTransaction(userId, value) {
  const { data, error } = await supabaseAdmin.rpc('save_household', {
    p_profile_id: userId,
    p_bands: value.bands,
    // Explicit nulls: PostgREST finds the function by the names of the arguments sent.
    p_renter_mode: value.renter_mode ?? null,
    p_locale: value.locale ?? null,
  });
  if (error && RPC_UNAVAILABLE.has(error.code)) {
    if (!warnedNoTransaction) {
      warnedNoTransaction = true;
      console.warn(
        `Household save: the save_household function is not available (${error.code}), so migration 0015 ` +
          'is probably not applied yet. Saving the household and its preferences in two steps, without a transaction.',
      );
    }
    return null;
  }
  if (error) throw new Error(`Failed to save household (${error.code}): ${error.message}`);
  if (!data || typeof data !== 'object' || Array.isArray(data) || !data.household || typeof data.household !== 'object') {
    throw new Error('Failed to save household: save_household returned no saved state');
  }
  return data;
}

/** The write before migration 0015: the composition, then the preferences, as two statements. */
async function saveInTwoSteps(userId, value) {
  // The seven known boolean keys only (a key left out is false); anything else is ignored.
  const bands = { profile_id: userId, updated_at: new Date().toISOString(), ...value.bands };

  const { error: bandErr } = await supabaseAdmin
    .from('household_bands')
    .upsert(bands, { onConflict: 'profile_id' });
  if (bandErr) throw new Error(`Failed to save household: ${bandErr.message}`);

  // Profile preferences travel with the same call when supplied.
  const profileUpdate = {};
  if (value.renter_mode !== undefined) profileUpdate.renter_mode = value.renter_mode;
  if (value.locale !== undefined) profileUpdate.locale = value.locale;
  if (Object.keys(profileUpdate).length > 0) {
    profileUpdate.id = userId;
    const { error: profErr } = await supabaseAdmin
      .from('profiles')
      .upsert(profileUpdate, { onConflict: 'id' });
    if (profErr) throw new Error(`Failed to save preferences: ${profErr.message}`);
  }
  return { household: bands, renter_mode: profileUpdate.renter_mode, locale: profileUpdate.locale };
}

export async function PUT(request) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);
    const body = await readJsonBody(request, { maxBytes: PUT_MAX_BYTES });
    if (!body.ok) {
      return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    }
    const input = parseHouseholdBody(body.value);
    if (!input.ok) return validationError(input.fieldErrors, requestId);

    const transaction = await saveInOneTransaction(userId, input.value);
    const saved = transaction ?? (await saveInTwoSteps(userId, input.value));

    // renter_mode and locale are echoed only when they were sent, as before.
    return NextResponse.json(
      {
        household: normalizeBands(saved.household),
        household_set: true,
        renter_mode: input.value.renter_mode !== undefined ? saved.renter_mode : undefined,
        locale: input.value.locale !== undefined ? saved.locale : undefined,
        transactional: transaction !== null,
      },
      { headers: { 'X-Request-Id': requestId } },
    );
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`Household save failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
