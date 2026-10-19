import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { requestIdFor, internalError } from '@/lib/apiErrors';
import { isOperationsUnavailable, listUnresolvedOperations, operationsUnavailable } from '@/lib/operations';

/**
 * GET /api/week/changes  (registry `week.changes`, runtime.ts:31)
 *
 *   200 { changes: [], unresolvedOperations: [<operationId>, ...] }
 *
 * The strip of "a change to review" above My Week. B06 ruling H4: `changes` is
 * ALWAYS the empty array, because no source of a change exists. A change has
 * to name a loaded task and a versioned source (organizer events, a forecast,
 * the home record collections), and none of those is built; deriving one from
 * water alerts would invent a link no record makes (digest 6.1, C4). The empty
 * answer is the client's own designed empty state: `WeekUpdateList` renders
 * nothing at all when there are no changes, no unknown operation and no error
 * (WeekUpdates.tsx:30). There is no "no updates" copy to show, so an honest
 * empty list is invisible, which is right.
 *
 * `unresolvedOperations` (H20, H16) is the household's genuinely unsettled
 * `week-updates` operations, oldest first, at most 100. The client restores
 * the first one as an acknowledgement whose outcome it must check
 * (WeekUpdates.tsx:17), so a settled operation must never be listed, and
 * another domain's never either. `listUnresolvedOperations` reaps a stale
 * claim to `failed` before listing, so a dead acknowledgement cannot hold the
 * strip in "An update needs a status check." for ever. This route never claims
 * an operation, so there is no own id to leave out.
 *
 * Not behind the `tasks` flag (H17): this route collects no free text and
 * reads nothing but the ledger. With the flag off the strip still renders
 * nothing, because it only shows changes bound to a loaded task.
 *
 * Identity comes only from the verified token. The query string is ignored
 * (the client sends none, runtime.ts:125-129 with `{}`), and so is
 * `X-Halo-Home-Context` (H2). No task table is read, so this route needs only
 * migration 0017; until that is applied it is a non-retryable 503
 * `feature_unavailable`, never an invented empty list. No top-level `data` key
 * (runtime.ts:149-153 would unwrap it).
 */

// The house ceiling for ledger routes, under the staleness window
// (DEFAULT_STALE_AFTER_MS, 120 s). This route only reads and reaps, but the
// plan (H21) sets it on all four B06 routes so none can outlive a claim.
export const maxDuration = 60;

/** The client's validator caps the list at 100 ids (action-service.ts:90); oldest first. */
const MAX_UNRESOLVED = 100;

export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);
    const unresolved = await listUnresolvedOperations(supabaseAdmin, {
      profileId: userId,
      domains: ['week-updates'],
    });
    return NextResponse.json(
      { changes: [], unresolvedOperations: unresolved.slice(0, MAX_UNRESOLVED) },
      { headers },
    );
  } catch (err) {
    if (isOperationsUnavailable(err)) return operationsUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`week changes read failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
