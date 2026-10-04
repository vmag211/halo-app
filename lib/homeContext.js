/**
 * Home contexts: one stay at one located home (migration 0016).
 *
 * A household's readings are tied to the home they were measured at. Moving
 * closes the old context and opens a new one, so the old home's readings are
 * never presented as the new home's history. The database half is
 * supabase/migrations/0016_home_contexts.sql: the home_contexts table and the
 * two service-role functions transition_home_context and
 * update_home_context_attributes. This module builds their arguments, mirrors
 * their "is this a move?" decision, and shapes what the API returns.
 *
 * Pure module.
 */
import { locationMoved, roundCoord } from './geocode.js';

/** The keys transition_home_context accepts in p_location. */
const LOCATION_KEYS = ['county', 'state'];

/** The keys transition_home_context accepts in p_attributes. */
const ATTRIBUTE_KEYS = ['pwsid', 'service_area_status', 'water_source', 'home_year', 'match_method'];

/** The value as the database should get it: an explicit null stays null; undefined means "not given". */
const given = (source, key) => source[key] !== undefined;

/**
 * The p_location and p_attributes arguments of transition_home_context, from a
 * profile-like object (the onboard route's profile update, or a profiles row).
 *
 * lat and lng are always present, rounded to 3 decimals (about 110 m) with
 * roundCoord, the one rounding HALO stores; they are null when missing or not
 * a finite number, which the database refuses. Every other key is copied only
 * when the object has it: a key left out keeps the stored value on a re-submit
 * of the same home (and is unknown, null, at a new home), while an explicit
 * null clears it. Values are passed as given; the routes validate them first.
 *
 *   location:   lat, lng, county, state
 *   attributes: pwsid, service_area_status, water_source, home_year, match_method
 *
 * Identity, the request id (its own argument), the ZIP code and anything else
 * are never copied.
 *
 * @param {object|null|undefined} profileLike
 * @returns {{ location: { lat: number|null, lng: number|null, county?: string|null, state?: string|null },
 *             attributes: { pwsid?: string|null, service_area_status?: string|null, water_source?: string|null,
 *                           home_year?: number|null, match_method?: string|null } }}
 */
export function toContextAttributes(profileLike) {
  const source = profileLike ?? {};
  const location = { lat: roundCoord(source.lat), lng: roundCoord(source.lng) };
  for (const key of LOCATION_KEYS) if (given(source, key)) location[key] = source[key];
  const attributes = {};
  for (const key of ATTRIBUTE_KEYS) if (given(source, key)) attributes[key] = source[key];
  return { location, attributes };
}

/**
 * Whether saving `next` opens a new home context: true when there is no
 * current context (the first one) or when the rounded point differs from the
 * current context's (a move); false for the same rounded point, which updates
 * the current context in place.
 *
 * This is locationMoved (lib/geocode.js) on the point rounded with roundCoord,
 * the same comparison transition_home_context makes in SQL on the rounded
 * point the route sends it: a current context without a stored point is not a
 * move. test/homeContextDb.test.mjs runs both on one table of coordinate pairs.
 *
 * @param {{ lat?: number|null, lng?: number|null, location?: { lat?: number|null, lng?: number|null } }|null|undefined} current
 *   the current home_contexts row, or its contextSummary, or null when there is none
 * @param {{ lat: number, lng: number }} next the new point, rounded or not
 * @returns {boolean}
 * @throws {TypeError} when `next` has no finite lat and lng (the database refuses it too)
 */
export function shouldOpenNewContext(current, next) {
  const lat = roundCoord(next?.lat);
  const lng = roundCoord(next?.lng);
  if (lat === null || lng === null) {
    throw new TypeError('shouldOpenNewContext: the new location needs a finite lat and lng');
  }
  if (!current) return true;
  return locationMoved(current.location ?? current, { lat, lng });
}

const orNull = (value) => (value === undefined ? null : value);

/**
 * The public shape of one home context, as the API returns it to its owner.
 *
 * lat and lng are the household's own point as stored (rounded to 3 decimals
 * by the routes): they are returned only to the authenticated owner of the
 * context. The owner id, the onboarding request id and the row's own
 * created_at and updated_at are never included.
 *
 * @param {object|null|undefined} row a home_contexts row (from a select or one of the RPCs)
 * @returns {null | {
 *   id: string, sequence: number, revision: number, origin: string, current: boolean,
 *   location: { lat: number|null, lng: number|null, county: string|null, state: string|null },
 *   pwsid: string|null, service_area_status: string|null, water_source: string|null,
 *   home_year: number|null, match_method: string|null,
 *   backfill: { state: string|null, from: string|null, to: string|null, updated_at: string|null },
 *   effective_from: string|null, effective_to: string|null, closed_reason: string|null }}
 */
export function contextSummary(row) {
  if (!row) return null;
  return {
    id: orNull(row.id),
    sequence: orNull(row.sequence),
    revision: orNull(row.revision),
    origin: orNull(row.origin),
    current: row.effective_to == null,
    location: {
      lat: orNull(row.lat),
      lng: orNull(row.lng),
      county: orNull(row.county),
      state: orNull(row.state),
    },
    pwsid: orNull(row.pwsid),
    service_area_status: orNull(row.service_area_status),
    water_source: orNull(row.water_source),
    home_year: orNull(row.home_year),
    match_method: orNull(row.match_method),
    backfill: {
      state: orNull(row.backfill_state),
      from: orNull(row.backfill_from),
      to: orNull(row.backfill_to),
      updated_at: orNull(row.backfill_updated_at),
    },
    effective_from: orNull(row.effective_from),
    effective_to: orNull(row.effective_to),
    closed_reason: orNull(row.closed_reason),
  };
}

/**
 * How one history reading relates to the household's current home.
 *
 *   'current_context'  measured at the current home: its context is the current one.
 *   'earlier_home'     measured at an earlier home: its context is any other one,
 *                      closed by a move. This includes a closed legacy context.
 *   'legacy_assumed'   assumed to be the current home but not provable: its context
 *                      is the current one and was made by the 0016 legacy migration
 *                      (readings from before an unrecorded past move cannot be told
 *                      apart), or the reading has no context at all (written before
 *                      the daily writers carried one).
 *
 * @param {{ home_context_id?: string|null, home_context_origin?: string|null }|null|undefined} historyRow
 *   a daily_scores row with its context id and that context's origin
 * @param {string|null|undefined} currentContextId the household's current context id, null when it has none
 * @returns {'current_context'|'earlier_home'|'legacy_assumed'}
 */
export function comparability(historyRow, currentContextId) {
  const contextId = historyRow?.home_context_id ?? null;
  if (contextId === null) return 'legacy_assumed';
  if (currentContextId == null || contextId !== currentContextId) return 'earlier_home';
  return historyRow.home_context_origin === 'legacy_migration' ? 'legacy_assumed' : 'current_context';
}
