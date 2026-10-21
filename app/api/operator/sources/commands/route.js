import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, requestIdFor, validationError, loggableError, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody, parseUuid } from '@/lib/validate';
import { ABANDONED_REASON, OPERATION_INPUT_MISMATCH, runOperation } from '@/lib/operations';
import { readIfMatch } from '@/lib/ifMatch';
import {
  DECIDING_ROLES,
  PUBLISHER_DECISIONS,
  SOURCE_DECISIONS,
  SOURCE_IDS,
  SOURCE_OPS_DOMAIN,
  isSourceOpsUnavailable,
  operatorForbidden,
  operatorRole,
  revisions,
  sourceOpsUnavailable,
} from '@/lib/sourceOps';

/**
 * POST /api/operator/sources/commands  (registry `sourceOps.command`, runtime.ts:21)
 *
 *   { operationId, sourceId, sourceRevision, target, decision, reason,
 *     recordedAt, snapshotRevision, locale? }
 *     ->  200 { operationId, status: 'failed', reason, message }
 *
 * One source decision from /operations (ProductionSourceOperations.tsx:27-28).
 * It VALIDATES, RECORDS, then REFUSES, every time: no decision has a real
 * effect in this backend yet (no release registry, candidate, publication
 * pointer, translation or scoped retry job; B13 plan), and every source's
 * `allowedDecisions` is empty, so the screen offers none. A refusal is never
 * dressed up as success.
 *
 * WHO. A session (401 otherwise) whose server-side role is reviewer or
 * publisher (403 otherwise, before anything is recorded, so a household
 * account cannot write to the ledger or the audit through this route). The
 * role is read again inside the ledger claim, at the moment of the decision:
 * one revoked in between, or a reviewer sending a publisher's decision, is
 * refused as `forbidden`.
 *
 * THE BODY is exactly what the client sends, checked with the client's own
 * bounds (sourceOpsError, source-operations-service.ts:30-33) before anything
 * is recorded: a 400 names the field. `recordedAt` must be an instant but is
 * not the audit's time; the server's is (wiring doc: "Client event time is not
 * the authoritative audit instant"). `Idempotency-Key` is required and must be
 * the body's `operationId`; `If-Match` is required and must be the body's
 * `sourceRevision`, as the client sends it (runtime.ts:97-98).
 *
 * THEN THE LEDGER (domain `source-operations`, the domain the screen
 * reconciles in, :29) and one append-only audit row (0027) with the server's
 * time, the role found, and the refusal:
 *   forbidden    the role at decision time cannot make this decision
 *   changed      the source's or the registry's revision is not the one sent
 *   unsupported  otherwise: this decision has no real effect here yet
 * The receipt stored is `{status: 'failed', reason}` and the operation id;
 * `message` is derived when answering. The client treats `failed` as "not
 * applied, your reason is kept" (:22), which is exactly true.
 *
 * REPLAYS are answered from the ledger without acting or auditing again, as
 * POST /api/week/changes/acknowledge does: this route's refusal is the same
 * 200; a reaped claim (`abandoned`) or a claim that threw is a terminal 409;
 * a receipt this route never writes is a terminal 409 and is never replayed;
 * a claim still running is a retryable 503; the same id with other input is
 * 409 `operation_mismatch`.
 *
 * Before 0027: 503 feature_unavailable. Before 0017: the ledger's own 503.
 */

// The house ceiling for ledger routes (test/operationsMaxDuration.test.mjs).
export const maxDuration = 60;

const MAX_BYTES = 4096;

/** The command's keys, as ProductionSourceOperations.tsx:27 builds it. `locale` is optional. */
const BODY_KEYS = Object.freeze(['operationId', 'sourceId', 'sourceRevision', 'target', 'decision', 'reason', 'recordedAt', 'snapshotRevision', 'locale']);
const REQUIRED_KEYS = BODY_KEYS.filter((key) => key !== 'locale');

/** The refusals this route records, in the order they are decided. */
const REFUSALS = Object.freeze(['forbidden', 'changed', 'unsupported']);

/** Every server-authored string, none with an em dash. */
const MESSAGES = Object.freeze({
  forbidden: 'Your verified role cannot make this decision. Nothing was changed.',
  changed: 'This source changed. Refresh it before deciding again. Nothing was changed.',
  unsupported: 'This decision is not available for this source yet. Nothing was changed.',
  incomplete: 'That earlier decision did not finish, so nothing was changed. Prepare a new review.',
  unrecognized: 'That earlier decision cannot be confirmed here. Nothing new was changed.',
  mismatch: 'That request was already made with different details. Prepare a new review.',
  inFlight: 'That decision is still being processed. Check its status before trying again.',
  ifMatch: 'Send an If-Match header carrying the source revision this decision was reviewed against.',
  idempotencyKey: 'Send an Idempotency-Key header carrying this decision\'s own id.',
  idempotencyMismatch: 'The Idempotency-Key header and the operationId must be the same id.',
  unknownField: `Only ${BODY_KEYS.join(', ')} can be sent.`,
  required: 'This field is required.',
  source: 'That source is not available.',
  revision: 'That revision is not valid.',
  target: 'The target must be text of 200 characters or fewer.',
  decision: `Choose one of ${SOURCE_DECISIONS.join(', ')}.`,
  reason: 'Add a plain-language decision reason of 8 to 500 characters.',
  recordedAt: 'That time is not valid.',
  locale: 'Only the Spanish locale (es) can be named.',
});

const field = (name, code) => ({ field: name, code, message: MESSAGES[code] ?? MESSAGES[name] });
const positiveInt = (value) => Number.isSafeInteger(value) && value > 0;
/** The client's reason rule (service.ts:33), plus no lone surrogate, which Postgres text would mangle. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const validReason = (value) =>
  typeof value === 'string' && value.trim().length >= 8 && value.length <= 500 && !/[\u0000-\u001F\u2014]/.test(value) && !LONE_SURROGATE.test(value);

/** Field errors for the body, in key order; empty when it is exactly a command. */
function bodyErrors(body) {
  const unknown = Object.keys(body).filter((key) => !BODY_KEYS.includes(key)).sort();
  if (unknown.length) return unknown.map((key) => ({ field: key, code: 'unknown_field', message: MESSAGES.unknownField }));
  const missing = REQUIRED_KEYS.filter((key) => body[key] === undefined);
  if (missing.length) return missing.map((key) => ({ field: key, code: 'required', message: MESSAGES.required }));
  const operationId = parseUuid(body.operationId);
  return [
    operationId.ok ? null : { field: 'operationId', code: operationId.code, message: operationId.message },
    SOURCE_IDS.includes(body.sourceId) ? null : field('sourceId', 'source'),
    positiveInt(body.sourceRevision) ? null : field('sourceRevision', 'revision'),
    typeof body.target === 'string' && body.target.length <= 200 && !/[\u0000-\u001F]/.test(body.target) && !LONE_SURROGATE.test(body.target) ? null : field('target', 'target'),
    SOURCE_DECISIONS.includes(body.decision) ? null : field('decision', 'decision'),
    validReason(body.reason) ? null : field('reason', 'reason'),
    typeof body.recordedAt === 'string' && body.recordedAt.length <= 40 && Number.isFinite(Date.parse(body.recordedAt)) ? null : field('recordedAt', 'recordedAt'),
    positiveInt(body.snapshotRevision) ? null : field('snapshotRevision', 'revision'),
    body.locale === undefined || body.locale === 'es' ? null : field('locale', 'locale'),
  ].filter(Boolean);
}

/** 503 for an attempt on this id that has not settled. Retryable. */
const inFlight = (requestId) =>
  apiError({ status: 503, code: ERROR_CODES.UPSTREAM_UNAVAILABLE, message: MESSAGES.inFlight, retryable: true, requestId });

/** A terminal 409, carrying why for a log and a contract test. */
const conflict = (message, requestId, reason) =>
  apiError({ status: 409, code: ERROR_CODES.CONFLICT, message, retryable: false, requestId, extra: { reason } });

/**
 * Decide the refusal at decision time and audit it. Runs once per operation
 * id, inside the ledger claim. An audit write that fails throws, so the claim
 * settles as failed with no receipt and the route answers 409 not_applied:
 * nothing is ever answered that the audit does not hold.
 */
async function refuseAndAudit({ userId, isAnonymous, command }) {
  const role = await operatorRole(supabaseAdmin, { userId, isAnonymous });
  let refusal = 'unsupported';
  if (!DECIDING_ROLES.includes(role) || (PUBLISHER_DECISIONS.includes(command.decision) && role !== 'publisher')) {
    refusal = 'forbidden';
  } else {
    const current = await revisions(supabaseAdmin, command.sourceId);
    if (current.source !== command.sourceRevision || current.registry !== command.snapshotRevision) refusal = 'changed';
  }
  const { error } = await supabaseAdmin.from('source_ops_audit').insert({
    operation_id: command.operationId,
    actor_profile_id: userId,
    role,
    source_id: command.sourceId,
    source_revision: command.sourceRevision,
    target: command.target,
    decision: command.decision,
    reason: command.reason,
    locale: command.locale ?? null,
    outcome: 'refused',
    refusal,
  });
  if (error) throw error;
  return { status: 'failed', reason: refusal };
}

export async function POST(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId, isAnonymous } = await requireUser(request);
    const role = await operatorRole(supabaseAdmin, { userId, isAnonymous });
    if (!DECIDING_ROLES.includes(role)) return operatorForbidden(requestId);

    const body = await readJsonBody(request, { maxBytes: MAX_BYTES });
    if (!body.ok) return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    const errors = bodyErrors(body.value);
    if (errors.length > 0) return validationError(errors, requestId);
    const command = { ...body.value, operationId: parseUuid(body.value.operationId).value };

    const idempotencyKey = parseUuid((request.headers.get('idempotency-key') ?? '').trim().toLowerCase());
    if (!idempotencyKey.ok) {
      return validationError([{ field: 'Idempotency-Key', code: idempotencyKey.code, message: MESSAGES.idempotencyKey }], requestId);
    }
    if (idempotencyKey.value !== command.operationId) {
      return validationError([{ field: 'operationId', code: 'idempotency_key_mismatch', message: MESSAGES.idempotencyMismatch }], requestId);
    }
    if ((readIfMatch(request) ?? '').trim() !== String(command.sourceRevision)) {
      return validationError([{ field: 'If-Match', code: 'precondition_required', message: MESSAGES.ifMatch }], requestId);
    }

    const outcome = await runOperation(
      supabaseAdmin,
      {
        operationId: command.operationId,
        profileId: userId,
        domain: SOURCE_OPS_DOMAIN,
        kind: 'sourceOps.command',
        // The client's time is not part of what was decided.
        input: {
          sourceId: command.sourceId,
          sourceRevision: command.sourceRevision,
          target: command.target,
          decision: command.decision,
          reason: command.reason,
          snapshotRevision: command.snapshotRevision,
          locale: command.locale ?? null,
        },
      },
      () => refuseAndAudit({ userId, isAnonymous, command }),
    );

    if (!outcome.result) {
      if (outcome.status === 'failed') return conflict(MESSAGES.incomplete, requestId, 'not_applied');
      return inFlight(requestId);
    }
    const stored = outcome.result;
    if (stored.status === 'failed' && REFUSALS.includes(stored.reason)) {
      return NextResponse.json(
        { operationId: command.operationId, status: 'failed', reason: stored.reason, message: MESSAGES[stored.reason] },
        { headers },
      );
    }
    if (stored.status === 'failed' && stored.reason === ABANDONED_REASON) return conflict(MESSAGES.incomplete, requestId, 'abandoned');
    // A receipt this route never writes. Not replayed; logged with no content.
    console.error(`operator source command: unrecognized stored receipt (request ${requestId}, ledger status ${outcome.status})`);
    return conflict(MESSAGES.unrecognized, requestId, 'unrecognized_receipt');
  } catch (err) {
    if (err?.message === OPERATION_INPUT_MISMATCH) return conflict(MESSAGES.mismatch, requestId, 'operation_mismatch');
    // 0027 or 0017 not applied: the same non-retryable 503, before or instead of any effect.
    if (isSourceOpsUnavailable(err)) return sourceOpsUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`operator source command failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
