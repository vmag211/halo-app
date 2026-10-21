/**
 * The routes' side of migration 0023: a household's tasks in My Week, read as
 * one snapshot, plus the household's unsettled task operations.
 *
 *   read_household_actions(p_profile_id) -> {version, actions, metas, preferences}
 *
 *   commit_household_actions(p_profile_id, p_operation_id, p_base_version, p_writes)
 *     -> {receipt, snapshot}
 *
 * B06 plan, Tasks 3 and 4 (docs/backend/plans/b06-home-actions-week.md),
 * Rulings H2, H8, H9, H10, H16, H17, H18, H24 and H31. Used by
 * GET /api/frontend/actions, POST /api/frontend/actions/commands and the
 * `actions` reconcile in GET /api/operations. Every snapshot they emit is
 * built with `emittedSnapshot`, so the load, a receipt and a reconcile cannot
 * disagree about its shape.
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
import {
  actionDraftError,
  actionMetadataError,
  emptyWeekMeta,
  validActionPreferences,
  validActionSnapshot,
} from './actionRules.js';

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

/**
 * Every sentence the client's own checks can give a task or its planning
 * details (`actionDraftError`, expanded-preview.ts:36-40, and
 * `actionMetadataError`, action-service.ts:27-36, transcribed in
 * lib/actionRules.js), each with a short code. They are fixed constants: none
 * interpolates a value, so neither the sentence nor its code can carry text a
 * person typed (Ruling H31).
 *
 * Two uses. The H24 log names the code for an `invalid_action` or
 * `invalid_meta` finding, so a log line can tell a clock-change gap from an
 * unknown zone. And the commit route stores the code, never the sentence, with
 * an `invalid_result` refusal, so a replay of the refusal gives back the same
 * sentence the first answer did while the ledger holds a code only (Ruling H3).
 * test/actionsStore.test.mjs fails if lib/actionRules.js gains a sentence that
 * is not listed here, and test/contractsB06.test.mjs fails if the B06
 * contract's `check` codes or `invalid_result` sentences differ from it.
 */
export const ACTION_CHECKS = Object.freeze([
  ['title', 'Enter a title between 1 and 160 characters.'],
  ['date', 'Choose a valid calendar date.'],
  ['schedule', 'The task schedule is invalid.'],
  ['details', 'The task details are invalid.'],
  ['duration', 'Choose a duration between 15 and 1440 minutes.'],
  ['zone', 'Choose a valid timezone.'],
  ['time', 'Choose a valid dated time outside clock-change gaps or ambiguous times.'],
  ['recurrence', 'Repeating tasks need an all-day date.'],
  ['completion', 'The completion date is invalid.'],
]);
const CHECK_BY_MESSAGE = new Map(ACTION_CHECKS.map(([code, message]) => [message, code]));
const MESSAGE_BY_CHECK = new Map(ACTION_CHECKS);

/** The code for one of the client's fixed task sentences, or null for any other string. */
export function actionCheckCode(message) {
  return CHECK_BY_MESSAGE.get(message) ?? null;
}

/** The client's sentence for a code from `actionCheckCode`, or null for anything else. */
export function actionCheckMessage(code) {
  return MESSAGE_BY_CHECK.get(code) ?? null;
}

/**
 * H31: why one action fails on its own. The title or date sentence when one
 * applies, else `record` (an id, key, state, revision, reason or origin the
 * client refuses, which no sentence names).
 */
function actionCheck(action) {
  const draft = typeof action?.title === 'string' && typeof action.date === 'string'
    ? actionDraftError(action.title, action.date)
    : null;
  return actionCheckCode(draft) ?? 'record';
}

/** H31: why an action that passes alone fails with its meta, merged as the client loads it. */
function metaCheck(action, meta) {
  try {
    return actionCheckCode(actionMetadataError({ ...emptyWeekMeta, ...meta }, action)) ?? 'record';
  } catch {
    return 'record';
  }
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
 * the six names 0023's CHECK allows, so never text a person typed). An
 * `invalid_action` or `invalid_meta` finding also carries `check`, the code of
 * the client's own fixed sentence for it (Ruling H31, `actionCheckCode`:
 * `time` for a clock-change gap, `zone` for an unknown time zone, ...), or
 * `record` when no sentence names it. Never a title, a note, a key, a reason,
 * an origin, a date or any meta value: this is for a log line.
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
    if (!validActionSnapshot({ actions: [action], metas: {} })) problems.push({ code: 'invalid_action', id, check: actionCheck(action) });
    else if (meta && !validActionSnapshot({ actions: [action], metas: { [action.key]: meta } })) problems.push({ code: 'invalid_meta', id, check: metaCheck(action, meta) });
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
    if (problem.preferences?.length) return `${problem.code} ${problem.preferences.join(',')}`;
    return [problem.code, problem.id, problem.check].filter(Boolean).join(' ');
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

/**
 * The household's current snapshot with its live unresolved list, the
 * `snapshot` of a succeeded `actions` receipt that is answered again rather
 * than just committed: a replay through the commit route, and the reconcile in
 * GET /api/operations (Ruling H18). The ledger keeps ids and revisions only
 * (Ruling H3), so the snapshot is rebuilt from the tables now. A current
 * snapshot, not the one the operation saw: a frozen one could roll back
 * another device's later change (digest A8), and the client's reconcile checks
 * validity, not coverage (ExpandedPreviewState.tsx:113).
 *
 * `operationId` is the operation being answered, never listed in its own
 * receipt (trap T2), whatever its row says. The list is read before the
 * snapshot, for the reason GET /api/frontend/actions gives: a commit writes
 * and settles in one transaction (Ruling H8), so an operation missing from the
 * list is already in the snapshot. The reverse case, a commit landing between
 * the two reads, is listed although its write is in the snapshot; the client
 * then reconciles it once and is answered `succeeded` with a current snapshot
 * by this same function.
 */
export async function liveActionsSnapshot(supabase, profileId, operationId) {
  const unresolvedOperations = await unresolvedActionOperations(supabase, profileId, { exclude: [operationId] });
  const snapshot = await readActionsSnapshot(supabase, profileId);
  return { ...snapshot, unresolvedOperations };
}

/** The refusal codes 0023's functions raise (SQLSTATE P0001, the code as the message). */
export const ACTIONS_REFUSALS = Object.freeze({
  INVALID_INPUT: 'HALO_INVALID_INPUT',
  OPERATION_NOT_PENDING: 'HALO_OPERATION_NOT_PENDING',
  STALE_BASE: 'HALO_STALE_BASE',
  OPERATION_SETTLED: 'HALO_OPERATION_SETTLED',
});

/**
 * The HALO_* code a 0023 function raised, or null for any other error.
 * Modelled on haloRefusal (lib/homeContextRpc.js): the code is the whole
 * message, so a message that merely mentions one is not mistaken for it.
 */
export function actionsRefusal(error) {
  return error?.code === 'P0001' && typeof error.message === 'string' && /^HALO_[A-Z_]+$/.test(error.message)
    ? error.message
    : null;
}

const isRevision = (value) => Number.isSafeInteger(value) && value >= 1;

/**
 * One call of commit_household_actions (0023 section 3, Rulings H6, H8 and
 * H10): the version advance from `baseVersion`, every write in `writes` (the
 * planner's, lib/actionRules.js `planActionCommand`), and the settle of this
 * operation's own ledger row as `succeeded`, in one transaction.
 *
 * Returns `{ receipt, snapshot }`: the receipt the function stored on the
 * ledger row, `{status: 'succeeded', affected: [{id, revision}], removed: [id]}`
 * (ids and revisions only, Ruling H3), and the snapshot read in the same
 * transaction after the writes, in the emitted shape.
 *
 * Throws the Supabase error as it came, so the caller can read a HALO_* code
 * with `actionsRefusal` (HALO_STALE_BASE is the one to retry) or an
 * unavailable one with `isActionsUnavailable`. Throws on a result that is not
 * the function's shape. `profileId` is the verified caller only.
 */
export async function commitActions(supabase, { profileId, operationId, baseVersion, writes }) {
  if (!profileId) throw new Error('actionsStore: committing tasks requires an owner');
  const { data, error } = await supabase.rpc('commit_household_actions', {
    p_profile_id: profileId,
    p_operation_id: operationId,
    p_base_version: baseVersion,
    p_writes: writes,
  });
  if (error) throw error;
  const receipt = data?.receipt;
  const snapshot = data?.snapshot;
  if (
    !isObject(data) || !isObject(receipt) || receipt.status !== 'succeeded'
    || !Array.isArray(receipt.affected) || !receipt.affected.every((item) => isObject(item) && typeof item.id === 'string' && isRevision(item.revision))
    || !Array.isArray(receipt.removed) || !receipt.removed.every((id) => typeof id === 'string')
    || !isObject(snapshot) || !Array.isArray(snapshot.actions) || !isObject(snapshot.metas) || !isObject(snapshot.preferences)
  ) {
    throw new Error('actionsStore: commit_household_actions returned an unexpected shape');
  }
  return {
    receipt: { status: 'succeeded', affected: receipt.affected, removed: receipt.removed },
    snapshot: emittedSnapshot(snapshot),
  };
}
