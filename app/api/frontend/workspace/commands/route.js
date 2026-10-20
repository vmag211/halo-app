import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, loggableError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody, parseUuid } from '@/lib/validate';
import { featureDisabledReason, featureEnabled } from '@/lib/features';
import { ABANDONED_REASON, OPERATION_INPUT_MISMATCH, isOperationsUnavailable, requestHash, runOperation } from '@/lib/operations';
import {
  LIMITS,
  REFUSALS,
  STORED_REFUSALS,
  WORKSPACE_DOMAIN,
  collectionsToRead,
  commitWorkspace,
  isWorkspaceUnavailable,
  parseWorkspaceCommand,
  planWorkspaceCommand,
  readWorkspaceCollections,
  refusalForError,
  refusalReceipt,
  workspaceRefusal,
  workspaceUnavailable,
} from '@/lib/workspaceStore';
import {
  ATTACHMENT_COLLECTIONS,
  attachmentReferences,
  attachmentsEnabled,
  isAttachmentsUnavailable,
  referencesAreOwned,
  sweepAttachmentObjects,
} from '@/lib/attachmentStore';

/**
 * POST /api/frontend/workspace/commands  (registry `workspace.execute`, runtime.ts:23)
 *
 *   { operationId, kind: 'write', collection, record, expectedRevision, collectionRevision? }
 *   { operationId, kind: 'remove', collection, recordId, expectedRevision, collectionRevision? }
 *   { operationId, kind: 'remove-notes', selection: [{id, revision}] }
 *   { operationId, kind: 'clear-private', ... }                       refused (Ruling W9)
 *     ->  200 { operationId, status: 'succeeded', changes: {<collection>: [every row]} }
 *     ->  200 { operationId, status: 'failed', changes: {}, code, reason, message }
 *
 * Saves one change to a Homeguard workspace collection (B11 plan). The client
 * accepts a succeeded receipt only when `changes` passes `validHomeChanges`
 * (adapters.ts:15) and shows the command took effect
 * (`homeReceiptCoversCommand`, home-service.ts:76-85): a write returns its
 * record at a revision above `expectedRevision ?? 0`, a remove returns the
 * collection without it. `changes` is required for EVERY status, a failed one
 * included, or the adapter throws and the provider locks on the operation.
 *
 * ORDER. Session; the body (at most 1,000,000 bytes, Ruling W7); the
 * operation id, in the body and as `Idempotency-Key`, the same id; the
 * `workspace` flag; the command (`parseWorkspaceCommand`), whose own refusals
 * (W2, W3, W4, W7's record size, W9, a record the client's row check refuses)
 * are answered here as 200 `failed` and recorded nowhere; `If-Match`, which
 * the adapter sends as the expected revision of a write or remove
 * (adapters.ts:29) and which must then equal it; then the ledger claim.
 *
 * THE COMMIT (Ruling W12, the B06 H8 pattern). Inside the claimed operation:
 * read the collections the command touches, plan it (`planWorkspaceCommand`:
 * a stale revision or an existing id is refused early), then call
 * commit_household_workspace, which checks references and every revision
 * again under its locks, applies the writes, settles this operation's own
 * ledger row `succeeded` with names, ids and revisions only, and returns the
 * touched collections read in its transaction. So a record exists if and
 * only if its operation is `succeeded`; 0026's settled-row guard keeps a lost
 * response from turning that into `failed`.
 *
 * THE ANSWERS:
 *   - succeeded: the collections the commit returned, or for a replay the
 *     current ones;
 *   - refused against stored state (stale_revision, notes_changed,
 *     invalid_reference, limit): 200 failed, the reason stored, so a replay
 *     answers the same body;
 *   - a replay that meets a row settled `failed` with no refusal of ours: 409
 *     (abandoned, not_applied or unrecognized_receipt);
 *   - a replay still pending: the retryable 503;
 *   - the same id with different input: 409 `operation_mismatch`.
 *
 * PRIVATE FILES (B14 Ruling A7). With the `attachments` flag on, a write may
 * name files: before the claim, check_attachment_references must find each
 * one ready and staged or linked for this collection and record, at its
 * revision, or the write is refused `invalid_reference` (recorded nowhere);
 * before 0028 it is refused `attachments_unavailable`, exactly as W4. 0028's
 * trigger checks again under its locks and links them. A succeeded commit
 * that may have deleted files (a dropped reference, a removed record) is
 * followed by a best-effort sweep of the household's queued objects; any
 * object it misses stays queued for /api/cron/daily. With the flag off, W4
 * stands.
 *
 * A database failure inside the commit is a 500, which this client reads as
 * "not confirmed" and reconciles through GET /api/operations. Until 0026 or
 * 0017 is applied: the non-retryable 503, decided before the claim. Log
 * lines carry the error's code and message only (loggableError), never a
 * record. No top-level `data` key in any body.
 */

export const maxDuration = 60;

const MESSAGES = Object.freeze({
  incomplete: 'That earlier save did not finish, so nothing was saved. Reload before trying again.',
  unrecognized: 'That earlier save cannot be confirmed here. Nothing new was saved. Reload to see your records.',
  mismatch: 'That request was already made with different details. Please try again.',
  inFlight: 'That save is still being processed. Please check its status before trying again.',
  ifMatch: 'The If-Match header must carry the expected revision of this record.',
  idempotencyKey: 'Send an Idempotency-Key header carrying this request\'s own id.',
  idempotencyMismatch: 'The Idempotency-Key header and the operationId must be the same id.',
  tooDeep: 'This value is nested too deeply to save.',
});

const inFlight = (requestId) =>
  apiError({ status: 503, code: ERROR_CODES.UPSTREAM_UNAVAILABLE, message: MESSAGES.inFlight, retryable: true, requestId });

const conflict = (message, requestId, reason) =>
  apiError({ status: 409, code: ERROR_CODES.CONFLICT, message, retryable: false, requestId, extra: { reason } });

/** The ledger's copy of a refusal: the reason code only (no record content). */
const storedRefusal = (reason) => ({ status: 'failed', reason, unresolvedOperations: [] });

/** The If-Match the adapter sends: the expected revision of a write or remove, and nothing else. */
function ifMatchProblem(request, command) {
  const header = request.headers.get('if-match');
  const expected = command.kind === 'remove-notes' ? null : command.expectedRevision;
  if (header === null) return null;
  return expected === null || header.trim() !== String(expected) ? MESSAGES.ifMatch : null;
}

/** A command that may delete files: any write or remove in a collection that holds them, or remove-notes. */
const touchesFiles = (command) => command.kind === 'remove-notes' || ATTACHMENT_COLLECTIONS.includes(command.collection);

/** Best effort, never changes the answer: what it cannot delete stays queued for the daily sweep. */
async function sweepFiles(userId, requestId) {
  try {
    await sweepAttachmentObjects(supabaseAdmin, { profileId: userId });
  } catch (err) {
    console.error(`workspace commit: the file sweep failed; the objects stay queued (request ${requestId}):`, loggableError(err));
  }
}

export async function POST(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);

    const body = await readJsonBody(request, { maxBytes: LIMITS.bodyBytes });
    if (!body.ok) return apiError({ status: body.status, code: body.code, message: body.message, requestId });

    const operationId = parseUuid(body.value.operationId);
    if (!operationId.ok) {
      return validationError([{ field: 'operationId', code: operationId.code, message: operationId.message }], requestId);
    }
    const key = parseUuid((request.headers.get('idempotency-key') ?? '').trim().toLowerCase());
    if (!key.ok) return validationError([{ field: 'Idempotency-Key', code: key.code, message: MESSAGES.idempotencyKey }], requestId);
    if (key.value !== operationId.value) {
      return validationError([{ field: 'operationId', code: 'idempotency_key_mismatch', message: MESSAGES.idempotencyMismatch }], requestId);
    }

    // Off by default (Ruling W1): nothing read, nothing claimed. A 200
    // receipt, not a 5xx, which this client would read as unknown and lock on.
    if (!featureEnabled('workspace')) {
      return NextResponse.json(
        { operationId: operationId.value, status: 'failed', changes: {}, code: 'unavailable', message: featureDisabledReason('workspace') },
        { headers },
      );
    }

    const files = attachmentsEnabled();
    const parsed = parseWorkspaceCommand(body.value, { attachments: files });
    if (!parsed.ok) return validationError(parsed.fieldErrors, requestId);
    if (parsed.refusal) return NextResponse.json(refusalReceipt(operationId.value, parsed.refusal), { headers });
    const { command } = parsed;

    const references = command.kind === 'write' ? attachmentReferences(command.collection, command.record) : [];
    if (files && references.length) {
      let owned;
      try {
        owned = await referencesAreOwned(supabaseAdmin, userId, command.collection, command.record.id, references);
      } catch (err) {
        if (isAttachmentsUnavailable(err)) return NextResponse.json(refusalReceipt(operationId.value, 'attachments_unavailable'), { headers });
        throw err;
      }
      if (!owned) return NextResponse.json(refusalReceipt(operationId.value, 'invalid_reference'), { headers });
    }

    const ifMatch = ifMatchProblem(request, command);
    if (ifMatch) return validationError([{ field: 'If-Match', code: 'precondition_mismatch', message: ifMatch }], requestId);

    const input = { ...body.value };
    delete input.operationId;
    try {
      requestHash(input);
    } catch {
      return validationError([{ field: 'body', code: 'unstorable_depth', message: MESSAGES.tooDeep }], requestId);
    }

    // Proves 0026 before the claim: a missing function is the 503, recording nothing.
    let current = await readWorkspaceCollections(supabaseAdmin, userId, collectionsToRead(command));
    let committedChanges = null;

    const outcome = await runOperation(
      supabaseAdmin,
      { operationId: operationId.value, profileId: userId, domain: WORKSPACE_DOMAIN, kind: `workspace.${command.kind}`, input },
      async () => {
        const plan = planWorkspaceCommand(command, current);
        if (!plan.ok) return storedRefusal(plan.reason);
        try {
          const committed = await commitWorkspace(supabaseAdmin, { profileId: userId, operationId: operationId.value, writes: plan.writes });
          committedChanges = committed.changes;
          return committed.receipt;
        } catch (error) {
          const reason = refusalForError(workspaceRefusal(error), command);
          if (reason) return storedRefusal(reason);
          throw error;
        }
      },
    );
    current = null;

    const result = outcome.result;
    if (!result) {
      if (outcome.status === 'failed') return conflict(MESSAGES.incomplete, requestId, 'not_applied');
      return inFlight(requestId);
    }
    if (result.status === 'succeeded') {
      if (files && !outcome.replayed && touchesFiles(command)) await sweepFiles(userId, requestId);
      const changes = outcome.replayed || !committedChanges
        ? await readWorkspaceCollections(supabaseAdmin, userId, (Array.isArray(result.collections) ? result.collections : []).filter((name) => typeof name === 'string'))
        : committedChanges;
      return NextResponse.json({ operationId: operationId.value, status: 'succeeded', changes }, { headers });
    }
    if (result.status === 'failed' && STORED_REFUSALS.includes(result.reason) && REFUSALS[result.reason]) {
      return NextResponse.json(refusalReceipt(operationId.value, result.reason), { headers });
    }
    if (result.status === 'failed' && result.reason === ABANDONED_REASON) return conflict(MESSAGES.incomplete, requestId, 'abandoned');
    console.error(`workspace commit: unrecognized stored receipt (request ${requestId}, ledger status ${outcome.status})`);
    return conflict(MESSAGES.unrecognized, requestId, 'unrecognized_receipt');
  } catch (err) {
    if (err?.message === OPERATION_INPUT_MISMATCH) return conflict(MESSAGES.mismatch, requestId, 'operation_mismatch');
    if (isWorkspaceUnavailable(err) || isOperationsUnavailable(err)) return workspaceUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`workspace commit failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
