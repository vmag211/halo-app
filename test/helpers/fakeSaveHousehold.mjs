/**
 * An in-memory stand-in for public.save_household (migration 0015) on the fake
 * Supabase, so route tests can run PUT /api/household on its transactional path.
 *
 *   const h = createRouteHarness({ ... });
 *   registerSaveHousehold(h.db);
 *
 * It follows the SQL function: the call needs all four parameters by name; a
 * missing profile, a group that is not true, false or null, or a locale other
 * than en or es fails and changes nothing; otherwise the seven groups replace
 * the household's row (a missing key is false), renter_mode and locale change
 * only when given, and the saved state comes back. test/householdTransaction.test.mjs
 * runs the same calls through this and through the real function on PGlite and
 * fails when they disagree.
 *
 * Its table reads and writes go through db.from, so they appear in queryLog
 * like any statement, scoped to p_profile_id.
 */
import { rpcError } from './fakeSupabase.mjs';

/** The household_bands columns, in table order (lib/household.js BAND_KEYS; checked in the drift test). */
export const SAVE_HOUSEHOLD_BANDS = Object.freeze([
  'has_toddler',
  'has_child',
  'has_teen',
  'has_adult',
  'has_senior',
  'has_pregnant',
  'has_respiratory',
]);

/** The function's parameter names, as PostgREST matches them. */
export const SAVE_HOUSEHOLD_ARGS = Object.freeze(['p_profile_id', 'p_bands', 'p_renter_mode', 'p_locale']);

const LOCALES = ['en', 'es'];

async function saveHousehold({ p_profile_id: profileId, p_bands: bands, p_renter_mode: renterMode, p_locale: locale }, db) {
  if (profileId === null) throw rpcError('22004', 'save_household: p_profile_id is required');
  if (bands !== null && (typeof bands !== 'object' || Array.isArray(bands))) {
    throw rpcError('22023', 'save_household: p_bands must be a JSON object');
  }
  for (const key of SAVE_HOUSEHOLD_BANDS) {
    const value = bands?.[key];
    if (value !== undefined && value !== null && typeof value !== 'boolean') {
      throw rpcError('22023', `save_household: ${key} must be true or false`);
    }
  }

  const { data: profile, error: readError } = await db.from('profiles').select('id').eq('id', profileId).maybeSingle();
  if (readError) throw rpcError(readError.code, readError.message);
  if (!profile) throw rpcError('P0002', 'save_household: no profile row for this household');
  // The real function writes the groups first and the profile's check constraint then undoes
  // the whole call; the fake has no check constraints, so it refuses before writing anything.
  if (locale !== null && !LOCALES.includes(locale)) {
    throw rpcError('23514', 'new row for relation "profiles" violates check constraint "profiles_locale_check"');
  }

  const household = Object.fromEntries(SAVE_HOUSEHOLD_BANDS.map((key) => [key, bands?.[key] ?? false]));
  const updatedAt = new Date().toISOString();
  const { error: bandsError } = await db
    .from('household_bands')
    .upsert({ profile_id: profileId, ...household, updated_at: updatedAt }, { onConflict: 'profile_id' });
  if (bandsError) throw rpcError(bandsError.code, bandsError.message);

  const preferences = {};
  if (renterMode !== null) preferences.renter_mode = renterMode;
  if (locale !== null) preferences.locale = locale;
  if (Object.keys(preferences).length > 0) {
    const { error } = await db.from('profiles').update(preferences).eq('id', profileId);
    if (error) throw rpcError(error.code, error.message);
  }
  const { data: saved, error: savedError } = await db.from('profiles').select('renter_mode, locale').eq('id', profileId).single();
  if (savedError) throw rpcError(savedError.code, savedError.message);

  return { household, renter_mode: saved.renter_mode ?? false, locale: saved.locale ?? 'en', updated_at: updatedAt };
}

/** Registers the stand-in as rpc('save_household') on a fake Supabase. */
export function registerSaveHousehold(db) {
  db.registerRpc('save_household', saveHousehold, { args: [...SAVE_HOUSEHOLD_ARGS] });
}
