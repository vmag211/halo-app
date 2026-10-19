import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { requestIdFor, internalError } from '@/lib/apiErrors';
import { featureEnabled } from '@/lib/features';
import {
  actionsUnavailable,
  isActionsUnavailable,
  readActionsSnapshot,
  snapshotProblemLine,
  unresolvedActionOperations,
} from '@/lib/actionsStore';

/**
 * GET /api/frontend/actions  (registry `actions.load`, runtime.ts:29)
 *
 *   200 { actions: [...], metas: {...}, preferences: {...}, unresolvedOperations: [<operationId>, ...] }
 *
 * The household's tasks in My Week, as one snapshot (B06 plan, Task 3). The
 * client's adapter refuses the whole load unless `validActionSnapshot` passes
 * AND `unresolvedOperations` is an array (adapters.ts:9), so the list is always
 * present (trap T1). A household with nothing gets exactly
 * `{"actions":[],"metas":{},"preferences":{},"unresolvedOperations":[]}` (plan,
 * Task 3 acceptance; an empty preferences object is valid, digest 5.1), which
 * loads My Week ready, empty and writable. The snapshot is built by
 * `emittedSnapshot`, as a commit receipt and a reconcile are, so the three
 * agree on its shape. Never a
 * 404 for any household state (trap T7): to this client a 404 is the dead
 * screen.
 *
 * The capability flag `tasks` (Rulings H1, H17) is off by default and stays
 * off until a retention period for tasks is approved. While it is off this
 * handler reads nothing, writes nothing and discloses nothing: after the
 * session check it answers a non-retryable 503 `feature_unavailable`, the
 * Luna precedent. My Week then shows what it shows today with no route at all,
 * "Your tasks could not load. Reconnect and try again." with adding disabled
 * (ExpandedPreviewState.tsx:77, :82), rather than an empty week that may be
 * false. (Whether that sentence is acceptable while the flag is off is the
 * plan's Open question 4.)
 *
 * `unresolvedOperations` (Ruling H16) is the household's genuinely unsettled
 * `actions` operations, oldest first, at most 100 (trap T8). The client locks
 * My Week on the first one and asks for its status (ExpandedPreviewState.tsx:63),
 * so a settled operation and another domain's are never listed. Abandoned
 * claims are reaped before listing. This route never claims an operation, so
 * there is no own id to leave out; ruling S14's `unresolvedOperations: []` is
 * for stored receipts, and this is a live read.
 *
 * The list is read BEFORE the snapshot. A commit writes its tasks and settles
 * its ledger row in one transaction (Ruling H8), so an operation missing from
 * the list had settled before the snapshot was read, and its write is in the
 * snapshot. Read the other way round, a commit landing between the two reads
 * would be in neither, and the client would show a stale week with no check.
 *
 * Ruling H24: the stored snapshot is returned exactly as read, never with a
 * row left out. Hiding a row the server's own validator would refuse (only
 * possible through time-zone data drift) would tell the person a task does
 * not exist. When the whole body fails the client's `validActionSnapshot`
 * (lib/actionRules.js), one line is logged naming only the offending task
 * ids and a reason code per finding (snapshotProblemLine), never a title, a
 * note or any other text a person typed.
 *
 * Identity comes only from the verified token. The query string is ignored
 * (the client sends none), and so is `X-Halo-Home-Context`: tasks belong to
 * the household, not a home (Ruling H2). Until migration 0023 (the read
 * function) or 0017 (the ledger) is applied the answer is the same
 * non-retryable 503, never an invented empty week and never a 500. No
 * top-level `data` key (runtime.ts:149-153 would unwrap it).
 */

// The house ceiling for ledger routes, under the staleness window
// (DEFAULT_STALE_AFTER_MS, 120 s). This route only reads and reaps, but the
// plan (H21) sets it on all four B06 routes so none can outlive a claim.
export const maxDuration = 60;

export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);

    // Off by default, and off means off: no read, no reap, nothing disclosed.
    if (!featureEnabled('tasks')) return actionsUnavailable(requestId);

    const unresolvedOperations = await unresolvedActionOperations(supabaseAdmin, userId);
    const snapshot = await readActionsSnapshot(supabaseAdmin, userId);
    const body = { ...snapshot, unresolvedOperations };
    const problem = snapshotProblemLine(body, requestId);
    if (problem) console.error(problem);
    return NextResponse.json(body, { headers });
  } catch (err) {
    if (isActionsUnavailable(err)) return actionsUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`actions load failed (request ${requestId}):`, err?.code ?? '', err?.message ?? err);
    return internalError(requestId);
  }
}
