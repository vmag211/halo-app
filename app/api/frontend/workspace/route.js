import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { requestIdFor, internalError, apiError, loggableError, ERROR_CODES } from '@/lib/apiErrors';
import { parseEnum } from '@/lib/validate';
import { featureEnabled } from '@/lib/features';
import { isOperationsUnavailable } from '@/lib/operations';
import { validProductionRecord } from '@/lib/workspaceRecords';
import {
  JOURNAL_OFF,
  UNSTORED_COLLECTIONS,
  WORKSPACE_COLLECTIONS,
  isWorkspaceUnavailable,
  journalEnabled,
  pendingWorkspaceOperations,
  readWorkspaceCollections,
  workspaceUnavailable,
} from '@/lib/workspaceStore';
import { JOURNAL_COLLECTION, readWeekJournal } from '@/lib/weekJournalStore';

/**
 * GET /api/frontend/workspace?collection=<name>  (registry `workspace.load`, runtime.ts:22)
 *
 *   200 { records: [...], availability: 'ready' | 'empty', complete: true, pendingOperations: [...] }
 *   200 { records: [], availability: 'unavailable', complete: false, message, pendingOperations: [...] }
 *
 * One owned collection, complete, as `HomeCollectionSnapshot`
 * (home-service.ts:5-17; B11 plan). The adapter refuses the whole load unless
 * `records` passes `validHomeRecords` AND `pendingOperations` is an array
 * (adapters.ts:28), and the provider then discards the collection for one row
 * its `validProductionCollection` refuses (HomeWorkspaceState.tsx:107), so
 * the list is always present, even empty, and every row is one the server
 * stored only after that same check (lib/workspaceRecords.js).
 *
 * `pendingOperations` is the household's unsettled `workspace` operations,
 * read BEFORE the rows (the B06 H32 order): a commit writes and settles in one
 * transaction, so an operation missing from the list is already in the rows.
 * The provider treats each listed one as a lock and offers a status check
 * (HomeWorkspaceState.tsx:109-111).
 *
 * `homeTransitions` is never stored (Ruling W3): it is answered `unavailable`
 * with the household's pending list, which the provider records before it
 * shows the collection as settled "not available yet" (no retry).
 *
 * `weekJournal` (migration 0034) is the journal table, read through
 * lib/weekJournalStore.js while the `journal` flag is on: the newest 1000
 * entries, answered `partial` with `complete: false` only beyond that. While the flag is off it is
 * answered `unavailable` like homeTransitions (W2, superseded 2026-10-25).
 *
 * No collection `revision` (Ruling W6): per-record revisions are the
 * concurrency control. No `nextCursor`: the collection is complete (at most
 * 1,000 records, Ruling W7).
 *
 * Flag `workspace` off (Ruling W1), 0026 or 0017 missing: the non-retryable
 * 503 `feature_unavailable`, never an empty list that may be false. Identity
 * only from the verified token; `X-Halo-Home-Context` is ignored, because
 * records keep the home they were made for (contract :510). No top-level
 * `data` key (runtime.ts:149-153 would unwrap it).
 */

export const maxDuration = 60;

export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);

    const collection = parseEnum(new URL(request.url).searchParams.get('collection'), WORKSPACE_COLLECTIONS);
    if (!collection.ok) {
      return apiError({
        status: 400,
        code: ERROR_CODES.VALIDATION_FAILED,
        message: collection.message,
        fieldErrors: [{ field: 'collection', code: collection.code, message: collection.message }],
        retryable: false,
        requestId,
      });
    }

    if (!featureEnabled('workspace')) return workspaceUnavailable(requestId);

    const pendingOperations = await pendingWorkspaceOperations(supabaseAdmin, userId);
    if (collection.value === JOURNAL_COLLECTION) {
      if (!journalEnabled()) {
        return NextResponse.json(
          { records: [], availability: 'unavailable', complete: false, message: JOURNAL_OFF.load, pendingOperations },
          { headers },
        );
      }
      const journal = await readWeekJournal(supabaseAdmin, userId);
      return NextResponse.json(
        { records: journal.records, availability: !journal.complete ? 'partial' : journal.records.length ? 'ready' : 'empty', complete: journal.complete, pendingOperations },
        { headers },
      );
    }
    const unstored = UNSTORED_COLLECTIONS[collection.value];
    if (unstored) {
      return NextResponse.json(
        { records: [], availability: 'unavailable', complete: false, message: unstored.load, pendingOperations },
        { headers },
      );
    }

    const records = (await readWorkspaceCollections(supabaseAdmin, userId, [collection.value]))[collection.value];
    // Content-free: a row the client would refuse can only come from drift
    // between the transcription and the client. The count and the collection
    // name only; the rows are returned unchanged, because leaving one out
    // would tell the person a record does not exist.
    const refused = records.filter((row) => !validProductionRecord(collection.value, row)).length;
    if (refused) console.error(`workspace load: ${refused} stored ${collection.value} row(s) fail the client's row check (request ${requestId})`);
    return NextResponse.json(
      { records, availability: records.length ? 'ready' : 'empty', complete: true, pendingOperations },
      { headers },
    );
  } catch (err) {
    if (isWorkspaceUnavailable(err) || isOperationsUnavailable(err)) return workspaceUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`workspace load failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
