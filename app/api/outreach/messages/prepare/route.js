import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, loggableError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { parseUuid, readJsonBody } from '@/lib/validate';
import { featureEnabled } from '@/lib/features';
import { ABANDONED_REASON, OPERATION_INPUT_MISMATCH, isOperationsUnavailable, readOperation, runOperation } from '@/lib/operations';
import { isExploreAreaUnavailable, readArea } from '@/lib/exploreArea';
import { isWorkspaceUnavailable, readWorkspaceCollections } from '@/lib/workspaceStore';
import {
  CONNECTION,
  LIMITS,
  MESSAGES,
  NIL_UUID,
  OUTREACH_DOMAIN,
  STORED_REFUSALS,
  draftKey,
  includedSections,
  isOutreachUnavailable,
  outreachErrorCode,
  parsePrepare,
  publicContext,
  readDrafts,
  receiptDraft,
  saveDraft,
  sourcesUsable,
  writeUnavailable,
} from '@/lib/outreach';

/**
 * POST /api/outreach/messages/prepare  (registry `outreach.prepare`, runtime.ts:55)
 *
 *   { to, name, subject, body, notes: [{id, revision}], publicContext: {id, revision} | null,
 *     context: {topic, recipient, area, water}, signature, senderRevision }
 *     -> 200 OutreachDraft { id, revision, status: 'draft', delivery: 'copy', from: null, expiresAt: null,
 *                           recipient, topic, water, area, name, to, subject, body, notes, publicContext,
 *                           createdAt, updatedAt, signature }
 *
 * Builds and keeps a copy-only draft from the household's selected context
 * (B17 Rulings O5, O6). Exactly the screen's keys (ProductionOutreach.tsx:63).
 * Nothing is sent: `from` and `expiresAt` are null because there is no sender
 * and no send approval, so the client's `validOutreachReview` refuses this
 * answer, and the screen never calls it while the connection says "not
 * connected" (`:60`). The person copies the message with the screen's share
 * tools.
 *
 * CHECKS, before the claim, for a new operation only (a replay is answered
 * from the ledger, whatever has changed since):
 *   senderRevision    must be the connection's revision (1), else 409 sender_changed
 *   area              must be the household's saved Explore area (0022), else 409 area_changed
 *   publicContext     the entry `outreach.context` answers now, at its revision, else 409 stale_context
 *   notes             each the household's saved `exploreNotes` record at its exact revision
 *                     (B11's 0026, flag `workspace`), else 409 stale_note; without them, 403
 *   body              must end with the included sections exactly as the screen composes them
 *                     from those server copies, after a non-empty message, else 422 sections_differ
 *
 * THE SAVE (0031 save_outreach_draft): the notes are held at their revisions,
 * the draft is created or raised one revision when its content changed, and
 * this operation's ledger row is settled, in one transaction. The receipt
 * holds the draft id and revision only. Refusals it raises are stored as a
 * reason code and replayed: stale_note (409) and limit (422).
 *
 * The operation id is the required `Idempotency-Key` (the runtime sends one).
 * Flag off, 0031, 0017 or (with notes) 0026 missing: 403 `feature_unavailable`
 * before any claim (Ruling O1).
 */

export const maxDuration = 60;

const conflict = (message, requestId, reason) =>
  apiError({ status: 409, code: ERROR_CODES.CONFLICT, message, retryable: false, requestId, extra: { reason } });
const unprocessable = (message, requestId, reason) =>
  apiError({ status: 422, code: ERROR_CODES.VALIDATION_FAILED, message, retryable: false, requestId, extra: { reason } });
const inFlight = (requestId) =>
  apiError({ status: 503, code: ERROR_CODES.UPSTREAM_UNAVAILABLE, message: MESSAGES.inFlight, retryable: true, requestId });
const ok = (draft, signature, requestId) =>
  NextResponse.json({ ...draft, signature }, { headers: { 'X-Request-Id': requestId, 'Cache-Control': 'private, no-store' } });

/** The checks against what the household has saved; `{ draft }` to save, or `{ response }`. */
async function buildDraft(userId, input, requestId) {
  try {
    await readDrafts(supabaseAdmin, userId, NIL_UUID);
  } catch (err) {
    if (isOutreachUnavailable(err)) return { response: writeUnavailable(requestId) };
    throw err;
  }

  let saved;
  try {
    saved = await readArea(supabaseAdmin, userId);
  } catch (err) {
    if (isExploreAreaUnavailable(err)) return { response: writeUnavailable(requestId) };
    throw err;
  }
  const sentId = input.rawArea?.id;
  const areaMatches = sentId === undefined ? saved.place === null : !!input.place && saved.place?.id === input.place.id;
  if (!areaMatches) return { response: conflict(MESSAGES.areaChanged, requestId, 'area_changed') };

  let entry = null;
  if (input.publicContext) {
    const evidence = publicContext(input);
    entry = evidence.revision === input.publicContext.revision ? evidence.entries.find((item) => item.id === input.publicContext.id) ?? null : null;
    if (!entry) return { response: conflict(MESSAGES.staleContext, requestId, 'stale_context') };
    entry = { ...entry, revision: evidence.revision };
  }

  const notes = [];
  if (input.notes.length) {
    if (!featureEnabled('workspace')) return { response: writeUnavailable(requestId, MESSAGES.notesUnavailable) };
    let records;
    try {
      records = (await readWorkspaceCollections(supabaseAdmin, userId, ['exploreNotes'])).exploreNotes;
    } catch (err) {
      if (isWorkspaceUnavailable(err)) return { response: writeUnavailable(requestId, MESSAGES.notesUnavailable) };
      throw err;
    }
    for (const chosen of input.notes) {
      const record = records.find((row) => row.id === chosen.id && row.revision === chosen.revision);
      if (!record || typeof record.title !== 'string' || typeof record.description !== 'string') {
        return { response: conflict(MESSAGES.staleNote, requestId, 'stale_note') };
      }
      notes.push({ id: record.id, revision: record.revision, title: record.title, description: record.description });
    }
  }

  const sections = includedSections(entry, notes);
  const letter = input.body.slice(0, input.body.length - sections.length);
  if (!input.body.endsWith(sections) || !letter.trim()) return { response: unprocessable(MESSAGES.sectionsDiffer, requestId, 'sections_differ') };

  return {
    draft: {
      id: crypto.randomUUID(),
      key: draftKey(input.recipient, input.to),
      recipient: input.recipient,
      topic: input.topic,
      water: input.water,
      area: input.place,
      name: input.name,
      to: input.to,
      subject: input.subject,
      body: input.body,
      notes,
      publicContext: entry,
      signatureHash: createHash('sha256').update(input.signature).digest('hex'),
    },
  };
}

export async function POST(request) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);
    if (!featureEnabled('outreach') || !sourcesUsable()) return writeUnavailable(requestId);

    const body = await readJsonBody(request, { maxBytes: LIMITS.bodyBytes });
    if (!body.ok) return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    const key = parseUuid((request.headers.get('idempotency-key') ?? '').trim().toLowerCase());
    if (!key.ok) return validationError([{ field: 'Idempotency-Key', code: key.code, message: 'Send an Idempotency-Key that is a uuid.' }], requestId);
    const operationId = key.value;

    const parsed = parsePrepare(body.value);
    if (!parsed.ok) return validationError(parsed.fieldErrors, requestId);
    const input = parsed.value;
    if (input.senderRevision !== CONNECTION.revision) return conflict(MESSAGES.senderChanged, requestId, 'sender_changed');

    // A recorded operation is answered from the ledger below; only a new one is checked.
    let draft = null;
    const recorded = await readOperation(supabaseAdmin, { operationId, profileId: userId, domain: OUTREACH_DOMAIN });
    if (!recorded) {
      const built = await buildDraft(userId, input, requestId);
      if (built.response) return built.response;
      draft = built.draft;
    }

    let fresh = null;
    const outcome = await runOperation(
      supabaseAdmin,
      { operationId, profileId: userId, domain: OUTREACH_DOMAIN, kind: 'outreach.prepare', input: body.value },
      async () => {
        // Only when the recorded operation vanished between the read and the claim
        // (a clear all deletes settled rows): nothing was checked, so nothing is saved.
        if (!draft) return { status: 'failed', reason: 'not_applied', unresolvedOperations: [] };
        try {
          const committed = await saveDraft(supabaseAdmin, { profileId: userId, operationId, draft });
          fresh = committed.draft;
          return committed.receipt;
        } catch (error) {
          const code = outreachErrorCode(error);
          if (code === 'HALO_STALE_REVISION') return { status: 'failed', reason: 'stale_note', unresolvedOperations: [] };
          if (code === 'HALO_LIMIT') return { status: 'failed', reason: 'limit', unresolvedOperations: [] };
          throw error;
        }
      },
    );

    const result = outcome.result;
    if (!result) return outcome.status === 'failed' ? conflict(MESSAGES.incomplete, requestId, 'not_applied') : inFlight(requestId);
    if (result.status === 'succeeded') {
      if (!outcome.replayed && fresh) return ok(fresh, input.signature, requestId);
      const named = receiptDraft(result);
      const [current] = named ? await readDrafts(supabaseAdmin, userId, named.id) : [];
      if (!current || current.revision !== named.revision) return conflict(MESSAGES.changedElsewhere, requestId, 'changed_elsewhere');
      return ok(current, input.signature, requestId);
    }
    if (result.status === 'failed' && Object.hasOwn(STORED_REFUSALS, result.reason)) {
      const refusal = STORED_REFUSALS[result.reason];
      return refusal.status === 409 ? conflict(refusal.message, requestId, result.reason) : unprocessable(refusal.message, requestId, result.reason);
    }
    if (result.status === 'failed' && result.reason === ABANDONED_REASON) return conflict(MESSAGES.incomplete, requestId, 'abandoned');
    if (result.status === 'failed' && result.reason === 'not_applied') return conflict(MESSAGES.incomplete, requestId, 'not_applied');
    console.error(`outreach prepare: unrecognized stored receipt (request ${requestId}, ledger status ${outcome.status})`);
    return conflict(MESSAGES.incomplete, requestId, 'unrecognized_receipt');
  } catch (err) {
    if (err?.message === OPERATION_INPUT_MISMATCH) return conflict(MESSAGES.mismatch, requestId, 'operation_mismatch');
    if (isOutreachUnavailable(err) || isOperationsUnavailable(err) || isWorkspaceUnavailable(err) || isExploreAreaUnavailable(err)) return writeUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`outreach prepare failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
