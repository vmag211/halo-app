/**
 * The routes' side of migration 0016's home contexts: reading the table, calling
 * its two service-role functions, and answering for them in the API envelope.
 *
 *   transition_home_context(p_profile_id, p_location, p_attributes, p_request_id)
 *   update_home_context_attributes(p_profile_id, p_context_id, p_expected_revision, p_attributes)
 *
 * Until 0016 is applied the table and the functions do not exist. PostgREST then
 * answers PGRST205 (table) or PGRST202 (function), and Postgres itself 42P01 or
 * 42883; isHomeContextUnavailable recognises all four. A route either answers
 * 503 `feature_unavailable` (homeContextUnavailable) or, where an older path
 * exists, keeps using it. Never an empty success: unknown is not zero.
 *
 * The functions refuse with SQLSTATE P0001 and a stable message (see the 0016
 * header); haloRefusal reads it. HALO_STALE_REVISION carries the current
 * revision as JSON in the detail, which the 409 passes on.
 *
 * Every helper takes the Supabase client, so it holds no client of its own.
 * Identity: `profileId` must be the verified session's user id (requireUser),
 * never an id from the request; a context id from the request is only ever a
 * lookup key next to it.
 */

import { ERROR_CODES, apiError } from './apiErrors.js';

/**
 * The home_contexts columns a route reads: everything contextSummary returns, and never the
 * owner id or the onboarding request id.
 */
export const HOME_CONTEXT_FIELDS = [
  'id', 'sequence', 'revision', 'origin', 'lat', 'lng', 'county', 'state', 'pwsid', 'service_area_status',
  'water_source', 'home_year', 'match_method', 'backfill_state', 'backfill_from', 'backfill_to',
  'backfill_updated_at', 'effective_from', 'effective_to', 'closed_reason',
].join(', ');

/** "Not there yet": the function (PostgREST, Postgres), then the table (PostgREST, Postgres). */
const UNAVAILABLE_CODES = new Set(['PGRST202', '42883', 'PGRST205', '42P01']);

/** The stable refusals of the 0016 functions (SQLSTATE P0001, message exactly the code). */
export const HALO_REFUSALS = Object.freeze([
  'HALO_INVALID_INPUT',
  'HALO_PROFILE_NOT_FOUND',
  'HALO_CONTEXT_NOT_FOUND',
  'HALO_CONTEXT_CLOSED',
  'HALO_STALE_REVISION',
]);

/** True when the error says migration 0016 is not applied: its table or function does not exist. */
export function isHomeContextUnavailable(error) {
  return !!error && UNAVAILABLE_CODES.has(error.code);
}

/**
 * The refusal a 0016 function raised, or null for any other error (or none).
 * `detail` is the function's DETAIL, for the log only. For HALO_STALE_REVISION,
 * `revision` is the context's current revision from that detail
 * ('{"revision": 3}'), or null when it cannot be read.
 *
 * @param {{ code?: string, message?: string, details?: string|null }|null|undefined} error
 * @returns {null | { code: string, detail: string|null, revision?: number|null }}
 */
export function haloRefusal(error) {
  if (!error || error.code !== 'P0001' || !HALO_REFUSALS.includes(error.message)) return null;
  const detail = typeof error.details === 'string' ? error.details : null;
  if (error.message !== 'HALO_STALE_REVISION') return { code: error.message, detail };
  let revision = null;
  try {
    const parsed = JSON.parse(detail);
    if (Number.isInteger(parsed?.revision)) revision = parsed.revision;
  } catch {
    // an unreadable detail leaves the revision unknown (null), never a guess
  }
  return { code: error.message, detail, revision };
}

const NOT_FOUND_MESSAGE = 'We could not find that home.';
const STALE_MESSAGE = 'This home was changed since you last loaded it. Reload it and try again.';
const CLOSED_MESSAGE = 'This is no longer your current home, so its details cannot be changed.';
const UNAVAILABLE_MESSAGE = 'Home history is not available yet.';

/**
 * 404 `not_found` for a context the caller cannot see. The same answer for one that
 * does not exist and one that belongs to another household: nothing tells them apart.
 */
export function homeContextNotFound(requestId) {
  return apiError({ status: 404, code: ERROR_CODES.NOT_FOUND, message: NOT_FOUND_MESSAGE, requestId });
}

/**
 * 409 `conflict` for a refused attribute change. `reason` is 'stale_revision' (with
 * the context's current `revision`, so the client can reload and retry) or
 * 'context_closed' (the household has moved on from that home). Not retryable as
 * it is: the same request would be refused again.
 *
 * @param {{ code: string, revision?: number|null }} refusal from haloRefusal
 * @param {string} requestId
 */
export function homeContextConflict(refusal, requestId) {
  if (refusal.code === 'HALO_STALE_REVISION') {
    return apiError({
      status: 409,
      code: ERROR_CODES.CONFLICT,
      message: STALE_MESSAGE,
      retryable: false,
      requestId,
      extra: { reason: 'stale_revision', revision: refusal.revision ?? null },
    });
  }
  return apiError({
    status: 409,
    code: ERROR_CODES.CONFLICT,
    message: CLOSED_MESSAGE,
    retryable: false,
    requestId,
    extra: { reason: 'context_closed' },
  });
}

/** True for the refusals homeContextConflict answers: a stale revision or a closed context. */
export const isConflictRefusal = (refusal) =>
  refusal?.code === 'HALO_STALE_REVISION' || refusal?.code === 'HALO_CONTEXT_CLOSED';

/**
 * 503 `feature_unavailable` while migration 0016 is not applied. Not retryable: it
 * will not work until the migration runs, however often the client asks.
 */
export function homeContextUnavailable(requestId) {
  return apiError({
    status: 503,
    code: ERROR_CODES.FEATURE_UNAVAILABLE,
    message: UNAVAILABLE_MESSAGE,
    retryable: false,
    requestId,
  });
}

/** The function's answer as `{ context }`, or a thrown error when it returned no row. */
function withContext(name, data) {
  const context = data && typeof data === 'object' && !Array.isArray(data) ? data.context : null;
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    throw new Error(`${name} returned no home context`);
  }
  return data;
}

/** A thrown error for a failed call, with the database's code, message and detail (for the log only). */
function callFailed(name, error) {
  const detail = error.details ? ` (${error.details})` : '';
  return new Error(`${name} failed (${error.code}): ${error.message}${detail}`);
}

/**
 * The household's current home context (`HOME_CONTEXT_FIELDS`), read owner-scoped.
 *
 * @returns {Promise<{ unavailable: true, code: string } | { unavailable: false, context: object|null }>}
 * @throws {Error} on any other database error
 */
export async function readCurrentHomeContext(supabase, profileId) {
  const { data, error } = await supabase
    .from('home_contexts')
    .select(HOME_CONTEXT_FIELDS)
    .eq('profile_id', profileId)
    .is('effective_to', null)
    .maybeSingle();
  if (error && isHomeContextUnavailable(error)) return { unavailable: true, code: error.code };
  if (error) throw new Error(`Could not read the current home: ${error.message}`);
  return { unavailable: false, context: data ?? null };
}

/**
 * update_home_context_attributes for the household's own context.
 *
 * @param {object} supabase the service-role client
 * @param {{ profileId: string, contextId: string, expectedRevision: number,
 *           attributes: { water_source?: string|null, home_year?: number|null } }} args
 * @returns {Promise<{ unavailable: true, code: string } | { refusal: { code: string, detail: string|null, revision?: number|null } }
 *   | { context: object }>} a HALO_* refusal is returned for the route to answer; the context is the raw row
 * @throws {Error} on any other failure, or an answer without a context
 */
export async function updateHomeContextAttributes(supabase, { profileId, contextId, expectedRevision, attributes }) {
  const name = 'update_home_context_attributes';
  const { data, error } = await supabase.rpc(name, {
    p_profile_id: profileId,
    p_context_id: contextId,
    p_expected_revision: expectedRevision,
    p_attributes: attributes,
  });
  if (error && isHomeContextUnavailable(error)) return { unavailable: true, code: error.code };
  const refusal = haloRefusal(error);
  if (refusal) return { refusal };
  if (error) throw callFailed(name, error);
  return { context: withContext(name, data).context };
}

/**
 * transition_home_context: save the household's home at `location`.
 *
 * @param {object} supabase the service-role client
 * @param {{ profileId: string, location: object, attributes: object, requestId: string|null }} args
 *   location and attributes as lib/homeContext.js toContextAttributes builds them (lat and lng
 *   already rounded); requestId the onboarding request's id, or null. Every argument is sent,
 *   since PostgREST finds the function by the names of the arguments.
 * @returns {Promise<{ unavailable: true, code: string } | { refusal: { code: string, detail: string|null } }
 *   | { context: object, moved: boolean, previous_context_id: string|null }>}
 * @throws {Error} on any other failure, or an answer without a context
 */
export async function transitionHomeContext(supabase, { profileId, location, attributes, requestId }) {
  const name = 'transition_home_context';
  const { data, error } = await supabase.rpc(name, {
    p_profile_id: profileId,
    p_location: location,
    p_attributes: attributes,
    p_request_id: requestId ?? null,
  });
  if (error && isHomeContextUnavailable(error)) return { unavailable: true, code: error.code };
  const refusal = haloRefusal(error);
  if (refusal) return { refusal };
  if (error) throw callFailed(name, error);
  const answer = withContext(name, data);
  return { context: answer.context, moved: answer.moved === true, previous_context_id: answer.previous_context_id ?? null };
}
