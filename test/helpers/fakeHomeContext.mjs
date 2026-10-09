/**
 * In-memory stand-ins for the two home context functions of migration 0016, on
 * the fake Supabase, so route tests can run the routes that call them:
 *
 *   transition_home_context(p_profile_id, p_location, p_attributes, p_request_id)
 *   update_home_context_attributes(p_profile_id, p_context_id, p_expected_revision, p_attributes)
 *
 *   const h = createRouteHarness({ tables: haloTables('profiles', 'home_contexts', 'daily_scores') });
 *   registerHomeContextRpcs(h.db);                    // both (0016 applied)
 *   registerHomeContextRpcs(h.db, { update: false }); // only the transition
 *   // not registered at all: the fake answers PGRST202, as PostgREST does before 0016
 *
 * The harness must declare profiles, home_contexts and daily_scores (HALO_TABLES
 * has all three). Rows go through db.from, so every statement shows in queryLog,
 * scoped to p_profile_id like the SQL.
 *
 * They follow the SQL, including:
 *   - arguments are cast first: a malformed uuid is 22P02, a revision that is not
 *     a whole number 22P02 and one beyond int 22003;
 *   - then checked: anything malformed is P0001 HALO_INVALID_INPUT with the same
 *     DETAIL text as the SQL, and nothing is written;
 *   - a household without a profile row is HALO_PROFILE_NOT_FOUND;
 *   - a household with no context at all but a located profile gets the legacy
 *     context first (sequence 1, origin legacy_migration, copied from the
 *     profile), and its readings with no context are linked to it;
 *   - the current context's request id again is a retry: it comes back as it is,
 *     moved false, and nothing is written;
 *   - the same rounded point updates the current context in place (revision up,
 *     given keys written, keys left out kept); a new point closes it and opens
 *     the next sequence with only what was sent (nothing carried over), links
 *     the household's unlinked readings to the closed context and deletes the
 *     closed context's readings for the household's today;
 *   - service_area_status 'lookup_failed' never overwrites a stored utility;
 *   - the profile follows the resulting context (zip cleared, onboard_request_id
 *     kept when none is given);
 *   - update_home_context_attributes refuses another household's context and a
 *     missing one with the same HALO_CONTEXT_NOT_FOUND, a closed one with
 *     HALO_CONTEXT_CLOSED, a stale revision with HALO_STALE_REVISION and the
 *     DETAIL '{"revision": N}' (jsonb's text form), as PostgREST passes them on:
 *     { code: 'P0001', message: 'HALO_...', details, hint: null }.
 *
 * Not modelled: the profile row lock (JavaScript runs one call at a time unless a
 * test interleaves them on purpose) and the unique-index backstops beyond what
 * the fake table declares. test/homeContextFake.test.mjs runs the same calls
 * through these and through the real functions on PGlite and fails when they
 * disagree.
 */
import './routeLoader.mjs'; // registers the module hooks first, so lib files load as ESM without the typeless-package warning
import { rpcError } from './fakeSupabase.mjs';

const { localDate } = await import('../../lib/localDate.js');

/** The home_contexts columns, in table order (checked against the migrated table in the drift test). */
export const HOME_CONTEXT_COLUMNS = Object.freeze([
  'id', 'profile_id', 'sequence', 'revision', 'origin', 'lat', 'lng', 'county', 'state', 'pwsid',
  'service_area_status', 'water_source', 'home_year', 'match_method', 'onboard_request_id', 'backfill_state',
  'backfill_from', 'backfill_to', 'backfill_updated_at', 'effective_from', 'effective_to', 'closed_reason',
  'created_at', 'updated_at',
]);

/** The functions' parameter names, as PostgREST matches them. */
export const TRANSITION_HOME_CONTEXT_ARGS = Object.freeze(['p_profile_id', 'p_location', 'p_attributes', 'p_request_id']);
export const UPDATE_HOME_CONTEXT_ATTRIBUTES_ARGS = Object.freeze(['p_profile_id', 'p_context_id', 'p_expected_revision', 'p_attributes']);

/** The stable messages the functions raise (SQLSTATE P0001). */
export const HALO_ERRORS = Object.freeze({
  INVALID_INPUT: 'HALO_INVALID_INPUT',
  PROFILE_NOT_FOUND: 'HALO_PROFILE_NOT_FOUND',
  CONTEXT_NOT_FOUND: 'HALO_CONTEXT_NOT_FOUND',
  CONTEXT_CLOSED: 'HALO_CONTEXT_CLOSED',
  STALE_REVISION: 'HALO_STALE_REVISION',
});

const LOCATION_KEYS = ['lat', 'lng', 'county', 'state'];
const TEXT_LOCATION = ['county', 'state'];
const ATTRIBUTE_KEYS = ['pwsid', 'service_area_status', 'water_source', 'home_year', 'match_method'];
const TEXT_ATTRIBUTES = ['pwsid', 'service_area_status', 'water_source', 'match_method'];
const UPDATABLE = ['water_source', 'home_year'];
const INT_MIN = -2147483648;
const INT_MAX = 2147483647;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const halo = (message, details = null) => rpcError('P0001', message, details);
const invalid = (detail) => halo(HALO_ERRORS.INVALID_INPUT, detail);

/** jsonb_typeof of a value as it arrived over JSON; undefined (a missing key) is SQL NULL. */
function jsonType(value) {
  if (value === undefined) return null;
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value; // 'object' | 'string' | 'number' | 'boolean'
}

/** Postgres's cast of an argument to uuid: lower-case, or 22P02. */
function castUuid(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw rpcError('22P02', `invalid input syntax for type uuid: "${value}"`);
  }
  return value.toLowerCase();
}

/** Postgres's cast of an argument to int: a whole number in range, or 22P02 / 22003. */
function castInt(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw rpcError('22P02', `invalid input syntax for type integer: "${value}"`);
  }
  if (value < INT_MIN || value > INT_MAX) throw rpcError('22003', `value "${value}" is out of range for type integer`);
  return value;
}

/** The keys of an object that are not in `allowed`, sorted, as the SQL's string_agg(k, ', ' order by k). */
const unknownKeys = (object, allowed) => Object.keys(object).filter((key) => !allowed.includes(key)).sort().join(', ');

/** A whole number within int, the check both functions make on home_year. */
const isWholeInt = (value) => Number.isInteger(value) && value >= INT_MIN && value <= INT_MAX;

function checkHomeYear(attributes) {
  const type = jsonType(attributes.home_year);
  if (type === null || type === 'null') return;
  if (type !== 'number' || !isWholeInt(attributes.home_year)) {
    throw invalid('p_attributes.home_year must be a whole number or null');
  }
}

/** The point is stored only when already rounded to 3 decimals (roundCoord), as the SQL insists. */
const roundedTo3 = (value) => Number(value.toFixed(3)) === value;

function checkTransitionArguments(profileId, location, rawAttributes) {
  if (profileId === null) throw invalid('p_profile_id is required');
  if (jsonType(location) !== 'object') throw invalid('p_location must be a JSON object');
  const attributes = rawAttributes ?? {};
  if (jsonType(attributes) !== 'object') throw invalid('p_attributes must be a JSON object or null');
  let bad = unknownKeys(location, LOCATION_KEYS);
  if (bad) throw invalid(`p_location has unknown keys: ${bad}`);
  bad = unknownKeys(attributes, ATTRIBUTE_KEYS);
  if (bad) throw invalid(`p_attributes has unknown keys: ${bad}`);
  for (const key of ['lat', 'lng']) {
    if (jsonType(location[key]) !== 'number') throw invalid(`p_location.${key} must be a number`);
  }
  if (location.lat < -90 || location.lat > 90) throw invalid('p_location.lat must be between -90 and 90');
  if (location.lng < -180 || location.lng > 180) throw invalid('p_location.lng must be between -180 and 180');
  if (!roundedTo3(location.lat) || !roundedTo3(location.lng)) {
    throw invalid('p_location.lat and p_location.lng must be rounded to 3 decimals (roundCoord)');
  }
  for (const key of TEXT_LOCATION) {
    const type = jsonType(location[key]);
    if (type !== null && type !== 'string' && type !== 'null') throw invalid(`p_location.${key} must be a string or null`);
  }
  for (const key of TEXT_ATTRIBUTES) {
    const type = jsonType(attributes[key]);
    if (type !== null && type !== 'string' && type !== 'null') throw invalid(`p_attributes.${key} must be a string or null`);
  }
  checkHomeYear(attributes);
  return attributes;
}

function checkUpdateArguments(profileId, contextId, expectedRevision, attributes) {
  if (profileId === null) throw invalid('p_profile_id is required');
  if (contextId === null) throw invalid('p_context_id is required');
  if (expectedRevision === null) throw invalid('p_expected_revision is required');
  if (jsonType(attributes) !== 'object' || Object.keys(attributes).length === 0) {
    throw invalid('p_attributes must be a JSON object with water_source or home_year');
  }
  const bad = unknownKeys(attributes, UPDATABLE);
  if (bad) throw invalid(`p_attributes has keys that cannot change here: ${bad}`);
  const type = jsonType(attributes.water_source);
  if (type !== null && type !== 'string' && type !== 'null') throw invalid('p_attributes.water_source must be a string or null');
  checkHomeYear(attributes);
}

/** A home_contexts row with every column, null where unset, as to_jsonb(row) returns it. */
export function fullContextRow(row) {
  return Object.fromEntries(HOME_CONTEXT_COLUMNS.map((column) => [column, row?.[column] ?? null]));
}

/** Runs a query and returns its data, or throws its error the way the function would fail. */
async function run(query) {
  const { data, error } = await query;
  if (error) throw rpcError(error.code, error.message, error.details ?? null, error.hint ?? null);
  return data;
}

/** has(object, key): the SQL's `object ? key` (the key is present, even with a JSON null). */
const has = (object, key) => Object.hasOwn(object, key);
const given = (object, key) => (has(object, key) ? object[key] ?? null : null);

function makeTransition(clock) {
  return async function transitionHomeContext(args, db) {
    const profileId = castUuid(args.p_profile_id);
    const requestId = castUuid(args.p_request_id);
    const location = args.p_location;
    const attributes = checkTransitionArguments(profileId, location, args.p_attributes);
    const lookupFailed = attributes.service_area_status === 'lookup_failed';
    const newLat = location.lat;
    const newLng = location.lng;

    const profile = await run(db.from('profiles').select('*').eq('id', profileId).maybeSingle());
    if (!profile) throw halo(HALO_ERRORS.PROFILE_NOT_FOUND);

    const at = clock();
    const now = at.toISOString();
    const contexts = () => db.from('home_contexts');
    let current = await run(contexts().select('*').eq('profile_id', profileId).is('effective_to', null).maybeSingle());

    // Located before it had a context: the legacy context section 4 of 0016 would have made.
    if (!current) {
      const any = await run(contexts().select('id').eq('profile_id', profileId).limit(1));
      if (any.length === 0 && profile.lat !== null && profile.lat !== undefined) {
        current = await run(
          contexts()
            .insert(fullContextRow({
              id: crypto.randomUUID(), profile_id: profileId, sequence: 1, revision: 1, origin: 'legacy_migration',
              lat: profile.lat, lng: profile.lng, county: profile.county, state: profile.state, pwsid: profile.pwsid,
              water_source: profile.water_source, home_year: profile.home_year, match_method: 'legacy_profile',
              onboard_request_id: profile.onboard_request_id, backfill_state: 'not_applicable',
              effective_from: now, created_at: now, updated_at: now,
            }))
            .select()
            .single(),
        );
        await run(db.from('daily_scores').update({ home_context_id: current.id }).eq('profile_id', profileId).is('home_context_id', null));
      }
    }

    // uuid equality, so the case a seed or a client used does not matter.
    if (current && requestId !== null && String(current.onboard_request_id ?? '').toLowerCase() === requestId) {
      return { context: fullContextRow(current), moved: false, previous_context_id: null };
    }

    const moved = !!current
      && current.lat !== null && current.lat !== undefined && current.lng !== null && current.lng !== undefined
      && (current.lat !== newLat || current.lng !== newLng);

    let saved;
    if (current && !moved) {
      const keepUtility = lookupFailed;
      saved = await run(
        contexts()
          .update({
            lat: newLat,
            lng: newLng,
            county: has(location, 'county') ? given(location, 'county') : current.county ?? null,
            state: has(location, 'state') ? given(location, 'state') : current.state ?? null,
            pwsid: keepUtility || !has(attributes, 'pwsid') ? current.pwsid ?? null : given(attributes, 'pwsid'),
            service_area_status: keepUtility || !has(attributes, 'service_area_status')
              ? current.service_area_status ?? null
              : given(attributes, 'service_area_status'),
            water_source: has(attributes, 'water_source') ? given(attributes, 'water_source') : current.water_source ?? null,
            home_year: has(attributes, 'home_year') ? given(attributes, 'home_year') : current.home_year ?? null,
            match_method: has(attributes, 'match_method') ? given(attributes, 'match_method') : current.match_method ?? null,
            onboard_request_id: requestId ?? current.onboard_request_id ?? null,
            revision: current.revision + 1,
            updated_at: now,
          })
          .eq('profile_id', profileId)
          .eq('id', current.id)
          .select()
          .single(),
      );
    } else {
      if (moved) {
        await run(contexts().update({ effective_to: now, closed_reason: 'moved', updated_at: now }).eq('profile_id', profileId).eq('id', current.id));
      }
      const sequences = await run(contexts().select('sequence').eq('profile_id', profileId));
      const nextSequence = Math.max(0, ...sequences.map((row) => row.sequence)) + 1;
      saved = await run(
        contexts()
          .insert(fullContextRow({
            id: crypto.randomUUID(), profile_id: profileId, sequence: nextSequence, revision: 1,
            origin: moved ? 'move' : 'onboard', lat: newLat, lng: newLng,
            county: given(location, 'county'), state: given(location, 'state'),
            pwsid: lookupFailed ? null : given(attributes, 'pwsid'),
            service_area_status: given(attributes, 'service_area_status'),
            water_source: given(attributes, 'water_source'), home_year: given(attributes, 'home_year'),
            match_method: given(attributes, 'match_method'), onboard_request_id: requestId,
            backfill_state: 'not_started', effective_from: now, created_at: now, updated_at: now,
          }))
          .select()
          .single(),
      );
      if (moved) {
        // Readings with no context predate the new home; then the old home's reading for today goes.
        await run(db.from('daily_scores').update({ home_context_id: current.id }).eq('profile_id', profileId).is('home_context_id', null));
        await run(db.from('daily_scores').delete().eq('profile_id', profileId).eq('home_context_id', current.id).eq('date', localDate(at)));
      }
    }

    const follow = {
      lat: saved.lat, lng: saved.lng, county: saved.county ?? null, state: saved.state ?? null, pwsid: saved.pwsid ?? null,
      water_source: saved.water_source ?? null, home_year: saved.home_year ?? null, zip: null,
    };
    if (requestId !== null) follow.onboard_request_id = requestId;
    await run(db.from('profiles').update(follow).eq('id', profileId));

    return { context: fullContextRow(saved), moved, previous_context_id: moved ? current.id : null };
  };
}

function makeUpdate(clock) {
  return async function updateHomeContextAttributes(args, db) {
    const profileId = castUuid(args.p_profile_id);
    const contextId = castUuid(args.p_context_id);
    const expectedRevision = castInt(args.p_expected_revision);
    const attributes = args.p_attributes;
    checkUpdateArguments(profileId, contextId, expectedRevision, attributes);

    const profile = await run(db.from('profiles').select('id').eq('id', profileId).maybeSingle());
    if (!profile) throw halo(HALO_ERRORS.PROFILE_NOT_FOUND);

    const contexts = () => db.from('home_contexts');
    const current = await run(contexts().select('*').eq('profile_id', profileId).eq('id', contextId).maybeSingle());
    if (!current) throw halo(HALO_ERRORS.CONTEXT_NOT_FOUND);
    if (current.effective_to !== null && current.effective_to !== undefined) throw halo(HALO_ERRORS.CONTEXT_CLOSED);
    if (current.revision !== expectedRevision) {
      throw halo(HALO_ERRORS.STALE_REVISION, `{"revision": ${current.revision}}`);
    }

    const saved = await run(
      contexts()
        .update({
          water_source: has(attributes, 'water_source') ? given(attributes, 'water_source') : current.water_source ?? null,
          home_year: has(attributes, 'home_year') ? given(attributes, 'home_year') : current.home_year ?? null,
          revision: current.revision + 1,
          updated_at: clock().toISOString(),
        })
        .eq('profile_id', profileId)
        .eq('id', current.id)
        .select()
        .single(),
    );
    await run(db.from('profiles').update({ water_source: saved.water_source ?? null, home_year: saved.home_year ?? null }).eq('id', profileId));
    return { context: fullContextRow(saved) };
  };
}

/**
 * The two stand-ins as plain handlers `(args, db) => result`, for a test that wraps one
 * (to fail on the second call, to change a revision in between, ...) and registers it itself
 * with `db.registerRpc(name, handler, { args: [...] })`.
 *
 * @param {{ clock?: () => Date }} [options] `clock` is "now" (and so the household's today); default new Date()
 */
export function homeContextHandlers({ clock = () => new Date() } = {}) {
  return { transition: makeTransition(clock), update: makeUpdate(clock) };
}

/**
 * Registers the stand-ins on a fake Supabase (h.db), by PostgREST's rules: a call must name
 * exactly the function's parameters (send p_request_id even when it is null).
 *
 * @param {object} db the fake from createFakeSupabase (or a route harness's h.db)
 * @param {{ transition?: boolean, update?: boolean, clock?: () => Date }} [options]
 *   leave one out (false) to keep it missing; `clock` as homeContextHandlers
 */
export function registerHomeContextRpcs(db, { transition = true, update = true, clock } = {}) {
  const handlers = homeContextHandlers({ clock });
  if (transition) db.registerRpc('transition_home_context', handlers.transition, { args: [...TRANSITION_HOME_CONTEXT_ARGS] });
  if (update) db.registerRpc('update_home_context_attributes', handlers.update, { args: [...UPDATE_HOME_CONTEXT_ATTRIBUTES_ARGS] });
}
