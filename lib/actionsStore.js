/**
 * The routes' side of migration 0023: a household's tasks in My Week, read as
 * one snapshot, plus the household's unsettled task operations.
 *
 *   read_household_actions(p_profile_id) -> {version, actions, metas, preferences}
 *
 * B06 plan, Task 3 (docs/backend/plans/b06-home-actions-week.md), Rulings H2,
 * H9, H16 and H17. Used by GET /api/frontend/actions now, and by the commit
 * route and the `actions` reconcile (Task 4), which add their own helpers here
 * and build every snapshot they emit with `emittedSnapshot`, so the load, a
 * receipt and a reconcile cannot disagree about its shape.
 *
 * One read function, not table selects (Ruling H9): the function's jsonb
 * result is one consistent snapshot and is not cut at PostgREST's max_rows the
 * way a plain select of more than 1,000 tasks would be (finding F1). `version`
 * is the household's internal commit counter (Ruling H10). It is returned by
 * `readActionsState` for the commit route's retry loop and is never emitted.
 *
 * Identity: `profileId` is always the verified session's user id
 * (requireUser), never an id from the request. Tasks belong to the household,
 * not to a home, so no home context is read (Ruling H2).
 *
 * Until 0023 is applied the function does not exist (PostgREST PGRST202,
 * Postgres 42883), and until 0017 is applied the ledger table does not
 * (PGRST205, 42P01). Either answers a non-retryable 503 `feature_unavailable`
 * (actionsUnavailable), never an empty week that may be false, and never a 500.
 */
import { apiError, ERROR_CODES } from './apiErrors.js';
import { listUnresolvedOperations } from './operations.js';
import { validActionPreferences, validActionSnapshot } from './actionRules.js';

/** The ledger domain the frontend reconciles task saves against (action-service.ts, adapters.ts:11). */
export const ACTIONS_DOMAIN = 'actions';

/**
 * The client's validator refuses more than 100 unresolved ids
 * (action-service.ts:90), and one refused load is the dead screen
 * ("Your tasks could not load"), so the list is capped here (trap T8).
 */
export const MAX_UNRESOLVED = 100;

/** "Not there yet": the function (PostgREST, Postgres), then a table (PostgREST, Postgres). */
const UNAVAILABLE_CODES = new Set(['PGRST202', '42883', 'PGRST205', '42P01']);

const UNAVAILABLE_MESSAGE = 'Tasks in My Week are not available yet. Nothing was changed.';

/** True when the error says migration 0023 (or the 0017 ledger it lists from) is not applied. */
export function isActionsUnavailable(error) {
  return !!error && UNAVAILABLE_CODES.has(error.code);
}

/**
 * The 503 the task routes answer while the `tasks` capability is off or
 * migration 0023 or 0017 is missing. One helper, so every state the person
 * cannot fix degrades identically. Not retryable: retrying cannot help. The
 * client shows its own words for any failed load ("Your tasks could not load.
 * Reconnect and try again.", ExpandedPreviewState.tsx:77), not this message.
 */
export function actionsUnavailable(requestId) {
  return apiError({
    status: 503,
    code: ERROR_CODES.FEATURE_UNAVAILABLE,
    message: UNAVAILABLE_MESSAGE,
    retryable: false,
    requestId,
  });
}

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * The household's snapshot with its internal version:
 * `{ version, snapshot: { actions, metas, preferences } }`.
 *
 * Throws the Supabase error as it came (so isActionsUnavailable can read its
 * code), and throws on a result that is not the function's shape rather than
 * passing on something the client would refuse as a whole.
 */
export async function readActionsState(supabase, profileId) {
  if (!profileId) throw new Error('actionsStore: reading tasks requires an owner');
  const { data, error } = await supabase.rpc('read_household_actions', { p_profile_id: profileId });
  if (error) throw error;
  if (
    !isObject(data)
    || !Number.isSafeInteger(data.version) || data.version < 0
    || !Array.isArray(data.actions)
    || !isObject(data.metas)
    || !isObject(data.preferences)
  ) {
    throw new Error('actionsStore: read_household_actions returned an unexpected shape');
  }
  return { version: data.version, snapshot: emittedSnapshot(data) };
}

/** The household's snapshot as the client receives it, without the internal version. */
export async function readActionsSnapshot(supabase, profileId) {
  return (await readActionsState(supabase, profileId)).snapshot;
}

/**
 * The snapshot's emitted shape, always these three keys in this order:
 * `actions`, `metas`, `preferences`. A household that has never saved a
 * preference gets `preferences: {}`, which the client accepts
 * (action-service.ts:89; digest 5.1), so a new household's load body is
 * exactly `{"actions":[],"metas":{},"preferences":{},"unresolvedOperations":[]}`
 * (plan, Task 3 acceptance). The load, a commit receipt and an `actions`
 * reconcile (Task 4) all build their snapshot here, so they cannot disagree
 * about its shape. Every value is passed on exactly as stored (trap T4):
 * nothing is defaulted, normalised or dropped, and `version` never leaves the
 * server.
 */
export function emittedSnapshot({ actions, metas, preferences }) {
  return { actions, metas, preferences };
}

/** The six preference names 0023's CHECK allows: identifiers, never text a person typed. */
const PREFERENCE_NAMES = new Set([
  'week:focus', 'food-interests', 'week:availability', 'week:season-dismissals', 'week:review-preferences', 'outdoorPlan',
]);

/**
 * Ruling H24: why a snapshot fails the client's own load check
 * (`validActionSnapshot`, lib/actionRules.js), as content-free findings, or []
 * when it passes. For stored data this is only possible through drift (a time
 * zone rule that changed in Node's ICU, digest 9.5), because nothing is stored
 * that did not pass.
 *
 * Each finding is `{ code }` plus, where one row is to blame, its `id` (a
 * server-assigned uuid), or for preferences the failing preference names (only
 * the six names 0023's CHECK allows, so never text a person typed). Never a
 * title, a note, a key, a reason, an origin, a date or any meta value: this is
 * for a log line.
 *
 *   invalid_action      the action itself fails (title, date, state, revision, ...)
 *   invalid_meta        the action passes alone and fails with its meta
 *   duplicate_action    a second action with an id or key already seen
 *   orphan_meta         a meta whose key names no action (no id to report)
 *   invalid_preference  one or more preferences fail
 *   invalid_unresolved  the unresolved list fails (more than 100, a duplicate, ...)
 *   invalid_snapshot    it fails as a whole and none of the above says why
 *
 * The caller logs these and still returns the snapshot unchanged: leaving a
 * row out would tell the person a task does not exist.
 */
export function snapshotProblems(snapshot) {
  if (validActionSnapshot(snapshot)) return [];
  const problems = [];
  const actions = Array.isArray(snapshot?.actions) ? snapshot.actions : [];
  const metas = isObject(snapshot?.metas) ? snapshot.metas : {};
  const ids = new Set(), keys = new Set();
  for (const action of actions) {
    const id = typeof action?.id === 'string' ? action.id : null;
    if (ids.has(id) || keys.has(action?.key)) {
      problems.push({ code: 'duplicate_action', id });
      continue;
    }
    ids.add(id); keys.add(action?.key);
    const meta = typeof action?.key === 'string' && Object.hasOwn(metas, action.key) ? metas[action.key] : null;
    if (!validActionSnapshot({ actions: [action], metas: {} })) problems.push({ code: 'invalid_action', id });
    else if (meta && !validActionSnapshot({ actions: [action], metas: { [action.key]: meta } })) problems.push({ code: 'invalid_meta', id });
  }
  if (Object.keys(metas).some((key) => !keys.has(key))) problems.push({ code: 'orphan_meta' });
  if (snapshot?.preferences !== undefined && !validActionPreferences(snapshot.preferences)) {
    const names = isObject(snapshot.preferences)
      ? Object.keys(snapshot.preferences).filter((name) => !validActionPreferences({ [name]: snapshot.preferences[name] }))
      : [];
    problems.push({ code: 'invalid_preference', preferences: names.filter((name) => PREFERENCE_NAMES.has(name)) });
  }
  if (snapshot?.unresolvedOperations !== undefined
    && !validActionSnapshot({ actions: [], metas: {}, unresolvedOperations: snapshot.unresolvedOperations })) {
    problems.push({ code: 'invalid_unresolved' });
  }
  if (!problems.length) problems.push({ code: 'invalid_snapshot' });
  return problems;
}

/** At most this many findings go in one log line; the count says how many there were. */
const LOGGED_PROBLEMS_MAX = 20;

/**
 * The one H24 log line for a snapshot the client would refuse, or null when it
 * passes. Content-free by construction: it is built only from
 * `snapshotProblems`' codes, ids and preference names, and the request id.
 */
export function snapshotProblemLine(snapshot, requestId) {
  const problems = snapshotProblems(snapshot);
  if (!problems.length) return null;
  const listed = problems.slice(0, LOGGED_PROBLEMS_MAX).map((problem) => {
    if (problem.id) return `${problem.code} ${problem.id}`;
    if (problem.preferences?.length) return `${problem.code} ${problem.preferences.join(',')}`;
    return problem.code;
  });
  return `actions load: the stored snapshot fails the client's load check and is returned unchanged (request ${requestId}, ${problems.length} finding(s)): ${listed.join('; ')}`;
}

/**
 * The household's unsettled `actions` operations, oldest first, at most 100
 * (Ruling H16, traps T1, T2 and T8). `listUnresolvedOperations` reaps an
 * abandoned claim before listing, so a dead save cannot lock My Week for ever.
 *
 * `exclude` names operation ids that must not be listed: a commit's own id,
 * and a reconciled operation's own id (Task 4). They are filtered before the
 * cap, so leaving one out never costs another id its place. Call this only
 * after the commit function has returned, never inside runOperation's
 * `execute`, where the caller's own row is still pending (the account bug,
 * digest C1).
 */
export async function unresolvedActionOperations(supabase, profileId, { exclude = [] } = {}) {
  const excluded = new Set(Array.isArray(exclude) ? exclude : [exclude]);
  const ids = await listUnresolvedOperations(supabase, { profileId, domains: [ACTIONS_DOMAIN] });
  return ids.filter((id) => !excluded.has(id)).slice(0, MAX_UNRESOLVED);
}
