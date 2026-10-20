import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { requestIdFor, internalError, apiError, loggableError, ERROR_CODES } from '@/lib/apiErrors';
import { parseUuid, parseEnum } from '@/lib/validate';
import {
  readOperation,
  isOperationsUnavailable,
  listUnresolvedOperations,
  operationsUnavailable,
  OPERATION_DOMAINS,
  UNAUTHENTICATED_DOMAIN,
} from '@/lib/operations';
import { featureEnabled } from '@/lib/features';
import { ACTIONS_DOMAIN, actionsUnavailable, isActionsUnavailable, liveActionsSnapshot } from '@/lib/actionsStore';
import { PRIVACY_DOMAIN, PRIVACY_KINDS } from '@/lib/privacyStore';
import { privacyLimitKey, rebuildExportFile, withExportFile, withinRebuildWindow } from '@/lib/privacyExport';
import { privacyReviewKey } from '@/lib/privacyToken';
import { checkLimit, privacyLimiter } from '@/lib/ratelimit';
import { CHANGED_ELSEWHERE, WORKSPACE_DOMAIN, isWorkspaceUnavailable, workspaceReconcileResult, workspaceUnavailable } from '@/lib/workspaceStore';
import {
  ATTACHMENTS_DOMAIN,
  attachmentReconcileResult,
  attachmentsEnabled,
  attachmentsUnavailable,
  isAttachmentsUnavailable,
} from '@/lib/attachmentStore';
import { SUMMARY_DOMAIN, isSummaryUnavailable, recordedReceipt, summaryUnavailable } from '@/lib/summaryStore';

// A reader, but a privacy export reconcile rebuilds the household's whole
// file (B07 P9), as the POST that first built it may (60 s); under the
// ledger's 120 s staleness window like every privacy route (P17).
export const maxDuration = 60;

/** The 429 a rebuild past the household's privacy budget gets (P17); the panel says "Please wait". */
const PRIVACY_LIMITED_MESSAGE = 'Too many privacy requests. Please try again later.';

/**
 * Where each domain's succeeded receipt carries its `unresolvedOperations`
 * (Ruling S16). A receipt is stored with `[]` there (Ruling S14: a stored
 * receipt is history, not a lock), and this route puts the household's LIVE
 * list for that domain in its place, without the operation being read:
 * settled operations are never listed live, so two operations cannot park
 * each other for ever, and work that is genuinely still pending stays
 * locked, because no client re-reads after a reconcile that succeeds
 * (ProductionAlerts.tsx, ProductionPreferences.tsx, useAccountService.ts).
 * A domain not named here is replayed exactly as stored, except `actions`,
 * which has its own overlay in GET below (B06 Ruling H18): its stored receipt
 * has no snapshot to put a list into, and `privacy`, whose export receipt is
 * given a rebuilt file (B07 Ruling P9). `privacy` is deliberately absent: no
 * privacy receipt carries an `unresolvedOperations` list.
 */
const LIVE_LIST_PATHS = Object.freeze({
  account: ['snapshot', 'unresolvedOperations'],
  alerts: ['unresolvedOperations'],
  settings: ['snapshot', 'unresolvedOperations'],
});

/**
 * The receipt with the live list at `path`, when the stored receipt carries a
 * list there; otherwise the receipt as it is. Nothing is changed in place.
 */
async function withLiveList(receipt, { path, operationId, profileId, domain }) {
  const parents = path.slice(0, -1);
  const key = path.at(-1);
  let holder = receipt;
  for (const step of parents) holder = holder?.[step];
  if (!holder || typeof holder !== 'object' || !Array.isArray(holder[key])) return receipt;
  const live = (await listUnresolvedOperations(supabaseAdmin, { profileId, domains: [domain] })).filter((id) => id !== operationId);
  const put = (node, [step, ...rest]) => ({ ...node, [step]: rest.length ? put(node[step], rest) : live });
  return put(receipt, path);
}

/**
 * GET /api/operations?operationId=<uuid>&domain=<domain>
 *
 * What actually happened to a mutation whose response the caller lost.
 *
 *   200 { operationId, domain, kind, status, result, created_at }
 *
 * `status` is one of succeeded, failed, cancelled, pending, unknown. The first
 * three are settled and carry `result`, the canonical receipt the original
 * route returned, replayed as stored so the client can finish what it started,
 * except that a succeeded receipt in a domain of LIVE_LIST_PATHS carries the
 * household's live unresolved list rather than the stored `[]` (Ruling S16),
 * and a succeeded privacy export recorded within the last ten minutes carries
 * `file`, rebuilt from its stored selection (B07 Ruling P9).
 * `pending` means the work is genuinely still running. `unknown` means the
 * attempt was recorded but never settled and has outstripped its window: the
 * honest answer when a process died, and specifically NOT a failure, because
 * the effect may well have applied. In practice this route reaps such a row as
 * it reads it, so it answers `failed` with reason `abandoned`
 * (lib/operations.js, reapIfAbandoned); `unknown` remains only when that reap
 * could not run.
 *
 * A 404 means this household has no such operation in this domain. That is
 * different from `failed`, and the difference matters: the client must not read
 * "never recorded" as "did not happen". Another household's operation id is a
 * 404 too, with nothing said about whose it is.
 *
 * The owner comes only from the verified session token. The one domain that
 * accepts no session is `recovery`, which runs before the caller has an
 * identity; those rows are keyed by the operation id alone and carry no owner,
 * so they are read through the recovery routes rather than here.
 *
 * Until migration 0017 is applied the table does not exist: a non-retryable
 * 503 `feature_unavailable`, never an invented status.
 */
/** A 400 naming the field that failed, using the validator's own code and message. */
function badField(field, result, requestId) {
  return apiError({
    status: 400,
    code: ERROR_CODES.VALIDATION_FAILED,
    message: result.message,
    fieldErrors: [{ field, code: result.code, message: result.message }],
    retryable: false,
    requestId,
  });
}

export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);
    const url = new URL(request.url);

    const operationId = parseUuid(url.searchParams.get('operationId'));
    if (!operationId.ok) return badField('operationId', operationId, requestId);

    // Recovery operations have no owner, so they are deliberately not readable
    // here: letting a signed-in caller name the recovery domain would turn this
    // into a lookup for rows that belong to nobody.
    const readable = OPERATION_DOMAINS.filter((name) => name !== UNAUTHENTICATED_DOMAIN);
    const domain = parseEnum(url.searchParams.get('domain'), readable);
    if (!domain.ok) return badField('domain', domain, requestId);

    const operation = await readOperation(supabaseAdmin, {
      operationId: operationId.value,
      profileId: userId,
      domain: domain.value,
    });
    if (!operation) {
      return apiError({
        status: 404,
        code: ERROR_CODES.NOT_FOUND,
        message: 'That request was not found.',
        retryable: false,
        requestId,
      });
    }

    // One overlay step, spread once below (Rulings S16, H18). `actions` is
    // handled first and is deliberately NOT in LIVE_LIST_PATHS: its stored
    // receipt holds ids and revisions only (Ruling H3), no snapshot, so the
    // generic overlay would find no list and leave the client parked. A
    // succeeded `actions` operation is answered with the household's CURRENT
    // snapshot and the live list minus the operation itself, at
    // `snapshot.unresolvedOperations` where the actions adapter reads it
    // (adapters.ts:7,11) and at the top level over the stored `[]`. Behind
    // the `tasks` flag like the rest of My Week (Ruling H17). Every other
    // domain goes through LIVE_LIST_PATHS, and every other status is
    // replayed as stored.
    let result = operation.result && typeof operation.result === 'object' ? operation.result : {};
    let file = null;
    // The status answered. It is the ledger's, except for one computed case:
    // a succeeded workspace save whose record was since removed on another
    // device (B11 Ruling W15) is answered `failed`, the only receipt the
    // client settles for a write it can no longer find (home-service.ts:80).
    let status = operation.status;
    if (operation.domain === WORKSPACE_DOMAIN) {
      // B11 Ruling W5: every status, not only succeeded. The home adapter
      // refuses any receipt without `changes` (adapters.ts:15), a failed or
      // pending one included, so a succeeded workspace operation is answered
      // with the CURRENT rows of the collections it touched (the ledger keeps
      // names, ids and revisions only) and every other status with
      // `changes: {}` and its sentence. Behind the `workspace` flag like the
      // rest of the workspace (Ruling W1).
      if (!featureEnabled('workspace')) return workspaceUnavailable(requestId);
      try {
        result = await workspaceReconcileResult(supabaseAdmin, userId, operation);
        if (operation.status === 'succeeded' && result.reason === CHANGED_ELSEWHERE) status = 'failed';
      } catch (err) {
        if (isWorkspaceUnavailable(err)) return workspaceUnavailable(requestId);
        throw err;
      }
    } else if (operation.domain === ATTACHMENTS_DOMAIN) {
      // B14 Ruling A11, the W5 pattern: every status carries `changes` (the
      // removal's receipt() and the provider's recovered reconcile require
      // it); a succeeded one the CURRENT rows of the collections it touched
      // and, for an upload whose file still exists, its descriptor as
      // `attachment` (adapters.ts:23). Behind the `attachments` flag.
      if (!attachmentsEnabled()) return attachmentsUnavailable(requestId);
      try {
        result = await attachmentReconcileResult(supabaseAdmin, userId, operation);
      } catch (err) {
        if (isAttachmentsUnavailable(err)) return attachmentsUnavailable(requestId);
        throw err;
      }
    } else if (operation.domain === SUMMARY_DOMAIN) {
      // B15 Ruling S15-11, every status: the stored receipt holds the summary
      // id or a reason code only, so a succeeded prepare is answered with the
      // snapshot saved then, read now (`validSummaryReceipt` needs it,
      // summary-service.ts:16), or `failed` `gone` once it has been cleared;
      // a failure with its sentence; a pending one with the in-flight
      // sentence. `cancelled`, which no summary writer sets, is answered
      // `failed` (Ruling S15-3): the client never settles a cancelled
      // receipt and would stay locked. Behind the `summaries` flag.
      if (!featureEnabled('summaries') || !featureEnabled('workspace')) return summaryUnavailable(requestId);
      try {
        result = await recordedReceipt(supabaseAdmin, userId, { status: operation.status, result: operation.result });
        status = result.status;
      } catch (err) {
        if (isSummaryUnavailable(err)) return summaryUnavailable(requestId);
        throw err;
      }
    } else if (operation.status === 'succeeded') {
      if (operation.domain === ACTIONS_DOMAIN) {
        if (!featureEnabled('tasks')) return actionsUnavailable(requestId);
        try {
          const snapshot = await liveActionsSnapshot(supabaseAdmin, userId, operation.operationId);
          result = { ...result, unresolvedOperations: snapshot.unresolvedOperations, snapshot };
        } catch (err) {
          if (isActionsUnavailable(err)) return actionsUnavailable(requestId);
          throw err;
        }
      } else if (operation.domain === PRIVACY_DOMAIN) {
        // B07 Ruling P9: a succeeded export stored only its selection (two
        // group names and a boolean, never the file, trap P-8). Within ten
        // minutes of the export its file is rebuilt from that selection and
        // the current rows; after that, or if it no longer fits, the receipt
        // is answered as stored, without `file`, which the privacy panel
        // reads as "The export is not ready to download. Check its status."
        // Every other privacy receipt (a clear's) is answered as stored.
        // The rebuild is a full read of the household, so inside the window
        // it spends the privacy budget inspect and export share (P17,
        // fail-open), and with no review key it is skipped: the key is the
        // switch (P18), and it switches off this ten-minute tail too.
        if (operation.kind === PRIVACY_KINDS.export && privacyReviewKey() && withinRebuildWindow(operation.createdAt)) {
          const allowed = await checkLimit(privacyLimiter, privacyLimitKey(userId), { fallback: true, label: 'privacy limiter' });
          if (!allowed) return apiError({ status: 429, code: ERROR_CODES.RATE_LIMITED, message: PRIVACY_LIMITED_MESSAGE, requestId });
          file = await rebuildExportFile(supabaseAdmin, { profileId: userId, selection: result.selection, createdAt: operation.createdAt });
        }
      } else if (LIVE_LIST_PATHS[operation.domain]) {
        result = await withLiveList(result, { path: LIVE_LIST_PATHS[operation.domain], operationId: operation.operationId, profileId: userId, domain: operation.domain });
      }
    }

    const body = {
      // The stored receipt first, so the client sees exactly the body the
      // original route returned and its domain validators still pass, with
      // the live unresolved list in place of the stored one (Ruling S16). The
      // canonical fields are written after it: a receipt frozen at write time
      // must never override the status computed now, which is the only place
      // a stale 'pending' becomes 'unknown'.
      ...result,
      operationId: operation.operationId,
      domain: operation.domain,
      kind: operation.kind,
      status,
      created_at: operation.createdAt,
    };
    // A rebuilt export file is attached only when the whole body, as sent,
    // fits the 4,000,000-byte cap (B07 P8); with no file the body is unchanged.
    const answer = withExportFile(body, file);
    // A body carrying the household's export is never cached anywhere.
    return NextResponse.json(answer, { headers: answer === body ? headers : { ...headers, 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (isOperationsUnavailable(err)) return operationsUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    // Code and message only (loggableError): a Postgres error's details and
    // hint can hold a row, and the actions overlay reads task rows.
    console.error(`operations read failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
