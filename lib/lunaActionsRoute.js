/**
 * What the four Luna review routes share (B20): the request's operation id
 * and review reference, read the way the production component sends them,
 * and the `LunaOperation` answer with the canonical conversation.
 *
 * The client (components/expanded/ProductionLunaConversation.tsx `act`) sends,
 * for confirm, cancel and the status check:
 *
 *   body or query  { id, proposalId, revision }   (id is the review's own id;
 *                                                  for the status check, the
 *                                                  operation's)
 *   Idempotency-Key <operationId>                 (mutations)
 *   X-Halo-If-Match <revision>
 *
 * and accepts an answer only when `validLunaOperation` passes AND its `id` is
 * the operation id it sent. A `succeeded` or `cancelled` answer must carry the
 * conversation, or the client throws it away; a `failed` one may, and the
 * client then shows the review as it stands now.
 */
import { NextResponse } from 'next/server';
import { validationError } from './apiErrors.js';
import { parseUuid } from './validate.js';
import { readIfMatch } from './ifMatch.js';
import { conversationPayload } from './luna.js';
import { receiptMessage, withProposals } from './lunaActions.js';

const BODY_KEYS = ['id', 'proposalId', 'revision'];

/** The Idempotency-Key as the operation id: a UUID, lowercased. */
export function operationIdOf(request) {
  return parseUuid((request.headers.get('idempotency-key') ?? '').trim().toLowerCase());
}

/**
 * `{ ok: true, proposalId, revision }` from a confirm or cancel body, or
 * `{ ok: false, response }` with the 400 to send. `id` and `proposalId` name
 * the same review when both are sent; the precondition header, when sent,
 * must name the same revision.
 */
export function parseReviewReference(request, value, { requestId, idIsOperation = false } = {}) {
  const fail = (field, code, message) => ({ ok: false, response: validationError([{ field, code, message }], requestId) });
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('body', 'invalid_body', 'Send the review as a JSON object.');
  const unknown = Object.keys(value).filter((key) => !BODY_KEYS.includes(key));
  if (unknown.length) return fail(unknown[0].slice(0, 40), 'unknown_field', `Only ${BODY_KEYS.join(', ')} can be sent.`);
  const proposal = parseUuid(value.proposalId ?? (idIsOperation ? undefined : value.id));
  if (!proposal.ok) return fail('proposalId', proposal.code, 'Send the id of the review.');
  if (!idIsOperation && value.id !== undefined) {
    const same = parseUuid(value.id);
    if (!same.ok || same.value !== proposal.value) return fail('id', 'id_mismatch', 'id and proposalId must name the same review.');
  }
  const revision = typeof value.revision === 'string' && /^\d{1,9}$/.test(value.revision) ? Number(value.revision) : value.revision;
  if (!Number.isInteger(revision) || revision < 1) return fail('revision', 'invalid_revision', 'revision must be a whole number of 1 or more.');
  const header = readIfMatch(request);
  if (header !== null && header.trim() !== String(revision)) {
    return fail('X-Halo-If-Match', 'precondition_mismatch', 'The precondition header and the revision must be the same.');
  }
  return { ok: true, proposalId: proposal.value, revision };
}

/** The household's conversation with its reviews, as every Luna payload is built. */
export async function reviewedConversation(supabase, { profileId }) {
  const payload = await conversationPayload(supabase, { profileId });
  return withProposals(supabase, { profileId, payload });
}

/**
 * The `LunaOperation` answer: `{ id, status, message?, conversation? }`. The
 * conversation is attached to every settled answer, and only those.
 */
export async function operationAnswer(supabase, { profileId, operationId, status, reason, receipt, headers }) {
  const body = { id: operationId, status };
  if (status === 'failed') body.message = receiptMessage(operationId, receipt ?? { reason });
  if (status === 'succeeded' || status === 'failed' || status === 'cancelled') {
    const conversation = await reviewedConversation(supabase, { profileId });
    if (conversation) body.conversation = conversation;
  }
  return NextResponse.json(body, { headers: { ...headers, 'Cache-Control': 'private, no-store' } });
}
