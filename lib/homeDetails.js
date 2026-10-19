/**
 * Saving a household's two home details, `water_source` and `home_year`,
 * through its home context (migration 0016).
 *
 * Two routes change these answers: PATCH /api/profile and the `home` group of
 * PATCH /api/settings. Both must save them the same way, because since 0016 the
 * answers describe the household's CURRENT HOME and the database keeps the
 * profile in step with it. A route that wrote `profiles` directly while a home
 * exists would leave the home describing different answers from the profile.
 * This was moved here unchanged from app/api/profile/route.js so the second
 * writer could not drift from the first.
 *
 *   - with a current home, through update_home_context_attributes at the
 *     revision read in this same call. A change to that home in between is a
 *     conflict for the caller to answer, and nothing is saved.
 *   - located but with no home yet (an address stored by the old onboard
 *     route), through transition_home_context with the stored point as it is
 *     and every answer (the changed one and the one kept), which makes the
 *     legacy home and saves the change in it.
 *   - not located (not onboarded), or 0016 not applied: null, and the caller
 *     writes the profile itself, as before.
 *
 * Owner scoped: every statement and function call names the caller's own id.
 */
import { roundCoord } from './geocode.js';
import {
  isConflictRefusal,
  readCurrentHomeContext,
  transitionHomeContext,
  updateHomeContextAttributes,
} from './homeContextRpc.js';

/** A stored point transition_home_context takes as it is: both numbers, already rounded to 3 decimals. */
const isStoredPoint = (profile) =>
  !!profile && [profile.lat, profile.lng].every((value) => Number.isFinite(value) && roundCoord(value) === value);

/** What a home context call came to: the saved row, a conflict for the caller, or the profile write (null). */
function settle(name, saved, onUnavailable) {
  if (saved.unavailable) {
    onUnavailable(saved.code);
    return null;
  }
  if (saved.refusal && isConflictRefusal(saved.refusal)) return { conflict: saved.refusal };
  if (saved.refusal) throw new Error(`${name} refused the home details update: ${saved.refusal.code} (${saved.refusal.detail})`);
  return { context: saved.context };
}

/**
 * Saves `answers` ({ water_source?, home_year? }) through the household's home context.
 *
 * @param {object} supabase the service-role client
 * @param {string} profileId the verified session's user id
 * @param {{ water_source?: string|null, home_year?: number|null }} answers
 * @param {{ requestId?: string|null, onUnavailable?: (code: string) => void }} [options]
 *   onUnavailable hears that 0016 is not applied (the caller decides whether to warn)
 * @returns {Promise<{ context: object } | { conflict: object } | null>} null means "write the profile yourself"
 */
export async function saveHomeDetails(supabase, profileId, answers, { requestId = null, onUnavailable = () => {} } = {}) {
  const current = await readCurrentHomeContext(supabase, profileId);
  if (current.unavailable) {
    onUnavailable(current.code);
    return null;
  }
  if (current.context) {
    const saved = await updateHomeContextAttributes(supabase, {
      profileId,
      contextId: current.context.id,
      expectedRevision: current.context.revision,
      attributes: answers,
    });
    return settle('update_home_context_attributes', saved, onUnavailable);
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('lat, lng, county, state, pwsid, water_source, home_year')
    .eq('id', profileId)
    .maybeSingle();
  if (error) throw new Error(`Could not read profile: ${error.message}`);
  // Not located: there is no home to save the answers in yet.
  if (!isStoredPoint(profile)) return null;

  // The same point is not a move, so the legacy home is made from the profile and updated in
  // place. Every answer is sent, so the one that is not changing is written as it was.
  const saved = await transitionHomeContext(supabase, {
    profileId,
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
      `Home details update (request ${requestId}): the household's address changed while this request saved its home details, ` +
        `so the save moved it back to the address the request had read (it closed home ${saved.previous_context_id}).`,
    );
  }
  return settle('transition_home_context', saved, onUnavailable);
}
