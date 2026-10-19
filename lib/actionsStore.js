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
 * `{ version, snapshot: { actions, metas, preferences? } }`.
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
 * The snapshot's emitted shape, in this key order: `actions`, `metas`, then
 * `preferences` only when the household has saved one. The client accepts an
 * omitted `preferences` and an empty object alike (action-service.ts:89);
 * omitting it makes a new household's body exactly the client's own fixture,
 * `{"actions":[],"metas":{},"unresolvedOperations":[]}` (digest 5.1, trap T1).
 * Every value is passed on exactly as stored (trap T4): nothing is defaulted,
 * normalised or dropped, and `version` never leaves the server.
 */
export function emittedSnapshot({ actions, metas, preferences }) {
  const snapshot = { actions, metas };
  if (isObject(preferences) && Object.keys(preferences).length > 0) snapshot.preferences = preferences;
  return snapshot;
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
