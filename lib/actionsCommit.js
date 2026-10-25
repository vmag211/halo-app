/**
 * The one write path for My Week's tasks: plan a parsed command against the
 * household's snapshot and commit it with commit_household_actions, retrying a
 * lost race (B06 Rulings H6, H8, H10, H11).
 *
 * Two callers, one path:
 *
 *   - POST /api/frontend/actions/commands (`actions.commit`), the screen's own saves;
 *   - POST /api/luna/tools/confirm (`luna.confirm`, B20), which turns a reviewed
 *     Luna proposal into an ordinary task command and commits it here, inside
 *     its own `actions` ledger claim, so a confirmed Luna change has exactly the
 *     revision checks, ledger row and unknown-outcome reconciliation a change
 *     made in My Week has.
 *
 * Call `commitCommand` only inside runOperation's `execute` for the same
 * operation id in domain `actions`: commit_household_actions settles that
 * ledger row as `succeeded` in the transaction that writes the tasks (H8), and
 * refuses with HALO_OPERATION_NOT_PENDING when there is no pending row.
 *
 * Moved here from the actions route unchanged in behaviour (the route's test
 * suites still pin every answer).
 */
import {
  ACTION_REFUSAL_MESSAGES,
  ACTION_REFUSAL_REASONS,
  planActionCommand,
} from './actionRules.js';
import {
  ACTIONS_REFUSALS,
  actionCheckCode,
  actionCheckMessage,
  actionsRefusal,
  commitActions,
  readActionsState,
} from './actionsStore.js';

/** Lost races with another save before answering `busy` (Ruling H10). */
export const MAX_COMMIT_ATTEMPTS = 3;

/** The refusals the commit records and replays as a 200 `failed` receipt (Ruling H11). */
export const COMMIT_REFUSAL_REASONS = new Set(Object.values(ACTION_REFUSAL_REASONS));

/**
 * The ledger's copy of a refusal: the reason, the current revisions for
 * `stale_revision`, the sentence's code for `invalid_result`, and the empty
 * unresolved list every stored receipt carries (Ruling S14). Codes and ids
 * only (Ruling H3).
 */
export function storedRefusal(plan) {
  const receipt = { status: 'failed', reason: plan.reason };
  if (plan.reason === ACTION_REFUSAL_REASONS.STALE_REVISION) receipt.revisions = plan.revisions;
  if (plan.reason === ACTION_REFUSAL_REASONS.INVALID_RESULT) {
    const check = actionCheckCode(plan.message);
    if (check) receipt.check = check;
  }
  receipt.unresolvedOperations = [];
  return receipt;
}

/** The 200 refusal answered from a stored one, live or replayed alike. */
export function refusalBody(operationId, stored) {
  const message = stored.reason === ACTION_REFUSAL_REASONS.INVALID_RESULT
    ? actionCheckMessage(stored.check) ?? ACTION_REFUSAL_MESSAGES.invalid_result
    : ACTION_REFUSAL_MESSAGES[stored.reason];
  return {
    operationId,
    status: 'failed',
    reason: stored.reason,
    message,
    ...(stored.reason === ACTION_REFUSAL_REASONS.STALE_REVISION && Array.isArray(stored.revisions) ? { revisions: stored.revisions } : {}),
  };
}

/**
 * Plan `command` against the household's snapshot and commit it (Rulings H6,
 * H8, H10). `state` is an optional snapshot already read (the route reads one
 * before the claim to prove 0023 is applied); a lost race reads it again and
 * plans again from scratch, so the command's preconditions are re-checked
 * every time.
 *
 * Returns `{ receipt, snapshot }`: the receipt to store (ids, revisions and a
 * reason code only, Ruling H3, with `unresolvedOperations: []`) and the
 * snapshot the commit read in its transaction, or the unchanged one for a
 * refusal or a no-op. Throws a database error as it came.
 */
export async function commitCommand(supabase, { profileId, operationId, command, state = null, newId }) {
  let current = state;
  for (let attempt = 1; attempt <= MAX_COMMIT_ATTEMPTS; attempt += 1) {
    if (!current) current = await readActionsState(supabase, profileId);
    const plan = planActionCommand(current.snapshot, command, newId ? { newId } : undefined);
    if (!plan.ok) return { receipt: storedRefusal(plan), snapshot: current.snapshot };
    if (plan.noop) {
      return { receipt: { status: 'succeeded', affected: [], removed: [], unresolvedOperations: [] }, snapshot: current.snapshot };
    }
    try {
      const committed = await commitActions(supabase, {
        profileId,
        operationId,
        baseVersion: current.version,
        writes: plan.writes,
      });
      return { receipt: { ...committed.receipt, unresolvedOperations: [] }, snapshot: committed.snapshot };
    } catch (error) {
      if (actionsRefusal(error) !== ACTIONS_REFUSALS.STALE_BASE) throw error;
      current = null;
    }
  }
  return { receipt: storedRefusal({ reason: ACTION_REFUSAL_REASONS.BUSY }), snapshot: null };
}
