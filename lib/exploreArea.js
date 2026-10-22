/**
 * A household's saved discovery area: the place it chose on the Explore screen
 * (B05 plan, Task 3, Rulings D5 and D6). Requires migration 0022.
 *
 * One row per household in public.explore_areas, keyed by profile_id alone
 * (Ruling D5): the area belongs to the household, not to a home context, and
 * nothing here takes a home context.
 *
 * Revisions (Ruling D6). The client requires a positive revision on every read
 * and sends it back as If-Match on a save, so:
 *
 *   no row          reads as { place: null, revision: 1 }, the never-saved
 *                   state. Revision 1 is never stored (0022 refuses it).
 *   first save      expected revision 1: a plain insert with revision 2. The
 *                   primary key is the precondition, so if another first save
 *                   won, this insert raises a unique violation (23505) and
 *                   that is the conflict. There is no read-then-write window.
 *   later saves     expected revision N >= 2: one update scoped to the owner
 *                   AND to revision N, setting N + 1. A stale revision matches
 *                   no row, so nothing is written, and that is the conflict.
 *
 * A conflict is answered with the revision the row holds now (1 when there is
 * still no row), so the caller can report it and the client can re-read.
 * Clearing the area is a save with `place: null`; it keeps the row and still
 * advances the revision.
 *
 * Every query is scoped to the caller's profile_id, which the route takes from
 * the verified token. The table name is written as a literal at each call
 * because the repository's guardrail scans read `.from('...')` out of the
 * source (test/haloTables.test.mjs), and a constant would hide it.
 *
 * Until 0022 is applied every call throws the database's own "relation does
 * not exist" error; isExploreAreaUnavailable() recognizes it and
 * exploreAreaUnavailable() is the one 503 a route answers with, the same way
 * lib/operations.js does it for the ledger and lib/luna.js for Luna's tables.
 */
import { apiError, ERROR_CODES } from '@/lib/apiErrors';
import { countyForPoint } from '@/lib/geoContainment';
import { exactPlaces } from '@/lib/places';

/** The revision a household with no row reads as (Ruling D6). */
export const NEVER_SAVED_REVISION = 1;

const COLUMNS = 'place_id, place, state, label, timezone, revision';

/** The five `DiscoveryPlace` fields, in the client's names. */
const PLACE_FIELDS = ['id', 'place', 'state', 'label', 'timezone'];

/** A unique violation: on a first save, another first save got there first. */
const UNIQUE_VIOLATION = '23505';

// ---------------------------------------------------------------------------
// Degrading cleanly before migration 0022
// ---------------------------------------------------------------------------

/**
 * "Not there yet": the table is missing (PGRST205 from PostgREST, 42P01 from
 * Postgres), as lib/operations.js checks for 0017. 0022 adds one whole table
 * and no column to an existing one, so a missing table is the only half-applied
 * state there is.
 */
const UNAVAILABLE_CODES = new Set(['PGRST205', '42P01']);

/** True when the error says migration 0022 is not applied. */
export function isExploreAreaUnavailable(error) {
  return !!error && UNAVAILABLE_CODES.has(error.code);
}

/**
 * The one 503 the area routes answer with while 0022 is not applied. Not
 * retryable: retrying cannot help, and the production client discards an error
 * body anyway (only the status reaches it), so this sentence is for a log, an
 * older caller and anybody reading by hand.
 */
export function exploreAreaUnavailable(requestId) {
  return apiError({
    status: 503,
    code: ERROR_CODES.FEATURE_UNAVAILABLE,
    message: 'Your discovery area is not available yet. Nothing was changed. Please try again later.',
    retryable: false,
    requestId,
  });
}

// ---------------------------------------------------------------------------
// Rows and areas
// ---------------------------------------------------------------------------

/** A stored row as the client's `DiscoveryArea`: the place (or null) and the revision. */
function areaOf(row) {
  if (!row) return { place: null, revision: NEVER_SAVED_REVISION };
  const place = row.place_id === null || row.place_id === undefined
    ? null
    : { id: row.place_id, place: row.place, state: row.state, label: row.label, timezone: row.timezone };
  return { place, revision: row.revision };
}

/** The five place columns for a save; all null when the area is being cleared. */
function placeColumns(place) {
  if (place === null) return { place_id: null, place: null, state: null, label: null, timezone: null };
  return { place_id: place.id, place: place.place, state: place.state, label: place.label, timezone: place.timezone };
}

function assertSave({ profileId, expectedRevision, place }) {
  if (typeof profileId !== 'string' || !profileId) throw new Error('exploreArea: a save needs the caller\'s profile id');
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < NEVER_SAVED_REVISION) {
    throw new Error('exploreArea: the expected revision is a positive integer');
  }
  if (place === null) return;
  const complete = !!place && typeof place === 'object'
    && PLACE_FIELDS.every((field) => typeof place[field] === 'string')
    && !!place.id;
  if (!complete) throw new Error('exploreArea: a place is null or all five DiscoveryPlace fields');
}

// ---------------------------------------------------------------------------
// Reading and saving
// ---------------------------------------------------------------------------

/** This household's discovery area; `{ place: null, revision: 1 }` when it has never saved one. */
export async function readArea(db, profileId) {
  const { data, error } = await db
    .from('explore_areas')
    .select(COLUMNS)
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error) throw error;
  return areaOf(data);
}

const NC_STATE_NAMES = new Set(['nc', 'north carolina']);

/**
 * The county a household that has never chosen an area starts from: the NC county its stored home
 * point falls in (lib/geoContainment.js), or else its stored county name when its state is North
 * Carolina, as the gazetteer's canonical candidate. Null when the household is not located, is outside
 * NC, or names no county the gazetteer knows. A county, not the home point or a ZIP code: the ZIP is not
 * stored, and the area is shown on screen and handed to Explore's directory reads.
 */
export async function homeCountyPlace(db, profileId) {
  const { data, error } = await db.from('profiles').select('lat, lng, county, state').eq('id', profileId).maybeSingle();
  if (error) throw error;
  if (!data || typeof data.lat !== 'number' || typeof data.lng !== 'number') return null;
  const byPoint = countyForPoint(data.lat, data.lng);
  const named = byPoint
    ?? (typeof data.state === 'string' && NC_STATE_NAMES.has(data.state.trim().toLowerCase()) ? data.county : null);
  if (typeof named !== 'string' || !named.trim()) return null;
  const { counties } = exactPlaces(named);
  return counties.length === 1 ? counties[0] : null;
}

/**
 * Save `place` (a canonical DiscoveryPlace, or null to clear) if the stored
 * revision is still `expectedRevision`.
 *
 *   { ok: true, area }                              saved; area.revision is expectedRevision + 1
 *   { ok: false, reason: 'conflict', revision }     not saved; revision is the current one
 *
 * Any other database error is thrown, including the unavailable one.
 */
export async function writeArea(db, { profileId, expectedRevision, place }) {
  assertSave({ profileId, expectedRevision, place });
  const nextRevision = expectedRevision + 1;
  const values = { ...placeColumns(place), revision: nextRevision, updated_at: new Date().toISOString() };

  if (expectedRevision === NEVER_SAVED_REVISION) {
    const { data, error } = await db
      .from('explore_areas')
      .insert({ profile_id: profileId, ...values })
      .select(COLUMNS)
      .single();
    if (error?.code === UNIQUE_VIOLATION) return conflict(db, profileId);
    if (error) throw error;
    return { ok: true, area: areaOf(data) };
  }

  const { data, error } = await db
    .from('explore_areas')
    .update(values)
    .eq('profile_id', profileId)
    .eq('revision', expectedRevision)
    .select(COLUMNS);
  if (error) throw error;
  if (!data || data.length === 0) return conflict(db, profileId);
  return { ok: true, area: areaOf(data[0]) };
}

/** The refusal, carrying the revision the household's area holds now. */
async function conflict(db, profileId) {
  const { revision } = await readArea(db, profileId);
  return { ok: false, reason: 'conflict', revision };
}
