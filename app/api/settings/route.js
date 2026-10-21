import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, loggableError, requestIdFor, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody, parseUuid } from '@/lib/validate';
import { OPERATION_INPUT_MISMATCH, isOperationsUnavailable, runOperation } from '@/lib/operations';
import { isSettingsAlertsUnavailable, settingsAlertsUnavailable } from '@/lib/settingsAlerts';
import { haloRefusal, isConflictRefusal } from '@/lib/homeContextRpc';
import { readIfMatch } from '@/lib/ifMatch';
import {
  changedFields,
  ensurePreferences,
  isSaveSettingsMissing,
  isSettingsProfileMissing,
  parseSettingsSave,
  preferenceColumns,
  readBands,
  readSettingsProfile,
  readSettingsSnapshot,
  readSettingsState,
  saveSettings,
  settingsSnapshot,
  unresolvedSettingsOperations,
} from '@/lib/settings';

/**
 * GET   /api/settings  (settings.read)  ->  SettingsSnapshot
 * PATCH /api/settings  (settings.save)  ->  SettingsReceipt
 *
 *   PATCH body:  { group, values, household?, display?, calendar?, operationId }
 *   headers:     If-Match: <revision>, Idempotency-Key: <operationId>
 *
 * The shapes are the frontend's (lib/frontend/production/preferences-service.ts
 * on origin/codex/october15-review-refinement), which discards a whole read or
 * receipt that fails `validSettingsSnapshot`. lib/settings.js builds the
 * snapshot and says where each value lives.
 *
 * GET answers the whole snapshot. A household that has never saved a setting
 * gets 0021's defaults at revision 1, written as its row on that first read so
 * the revision it is shown is one a save can compare against, not a 404 and
 * not a revision the client refuses (it rejects 0).
 *
 * PATCH saves one group: `home` (year, water, tenure and the seven household
 * bands), `notifications` (the five switches and quiet hours), `display`
 * (language, the display block and the calendar block) or `luna` (the three
 * context switches). Only that group's slice of `values` is read; the other
 * groups in the body are the client's last snapshot and are never written
 * back. Within the group a field is written only when it differs from what the
 * client was shown, so an unanswered tenure or water source the snapshot
 * reports as 'other' stays unanswered unless the person picks something else.
 *
 * Concurrency (Rulings S4, S11, S12 and S15). `If-Match` is the revision the
 * client was shown. The whole save is one call to public.save_settings (0021):
 * the revision check and every table the group writes, in one transaction,
 * with the home details saved through the 0016 home functions inside it. So of
 * two saves holding the same revision that change something exactly one
 * applies and the other is a 409 having written nothing, a save that fails
 * anywhere applies nothing (a 500 recorded as failed is true), and the
 * revision advances exactly once per applied save that changed a value and not
 * at all for a save of the values already stored (review finding C: the
 * client accepts any valid receipt, ProductionPreferences.tsx, so nothing
 * needs a strictly advancing revision, and a second device holding the same
 * revision is not sent a needless conflict). Every other writer of a value in
 * the snapshot advances the revision through 0021's triggers in the same
 * transaction as its write, so a change made anywhere else makes a stale save
 * here conflict instead of being reverted by it. The receipt is built from the
 * rows save_settings returns; nothing is read between its commit and the
 * ledger's settle.
 *
 * The same transaction settles this save's own ledger row as succeeded
 * (Ruling S15), with the receipt below, and 0021 then refuses to relabel it.
 * So if save_settings commits and its answer is lost, runOperation's settle
 * as failed is refused and logged (lib/operations.js settle does not throw),
 * the route answers 500, which the client treats as an unknown outcome, and
 * its "check status" reads the success the save was. If the ledger's reaper
 * settled the row first, save_settings refuses with nothing written, and the
 * route records it as abandoned and answers 200 { operationId, status:
 * 'failed' }, so the client keeps the draft; a replay of it is a terminal 409.
 *
 * Idempotency is the ledger (migration 0017) with domain 'settings' and
 * nothing else. The same operationId replays the first receipt without acting
 * again; a stale revision is decided inside the claimed operation, so a replay
 * of a lost success returns that success rather than a conflict; the same id
 * with a different body is a 409. The receipt the ledger keeps carries
 * `snapshot.unresolvedOperations: []` (Ruling S14): it is the record of what
 * this save did, served unchanged by a replay and by GET /api/operations, and
 * the list it was written with would be stale by then. Only the direct answer
 * to the save that ran carries the live list, without this operation.
 *
 * Answers:
 *   200 { operationId, status: 'succeeded', snapshot }   the full snapshot, new revision
 *   200 { operationId, status: 'pending' | 'unknown' }   a replay of work not yet settled
 *   200 { operationId, status: 'failed' }   this call's save found its ledger
 *       row already settled as abandoned by the reaper, so nothing was
 *       written; the client keeps the draft ("The save was not applied")
 *   409 conflict, reason 'stale_revision' (with the current `revision`),
 *       'home_changed' or 'operation_mismatch'
 *   409 conflict, reason 'operation_failed' or 'operation_abandoned': a
 *       replay of an id whose save failed, or was settled as abandoned by the
 *       ledger's reaper. Terminal: the same id never succeeds.
 *   404 not_found for a household with no profile row (review N1): there are no
 *       settings to read or save, and nothing was changed. Decided before the
 *       operation id is claimed, which the ledger's own foreign key would refuse
 *   422 validation_failed with field_errors, before anything is read or written
 *   503 feature_unavailable until 0017 and 0021 are applied, decided before the
 *       operation id is claimed, so "nothing was changed" is true (and, should
 *       save_settings alone be missing, after the claim, when nothing was
 *       changed either)
 *
 * Identity comes only from the verified session token. No field of the body or
 * the query names a household, and every statement is scoped to the caller.
 *
 * A failure is logged as its code and message only (lib/apiErrors.js
 * loggableError): a database error's details can quote the whole row it
 * refused, location included (review of 0021, finding B).
 */

/**
 * Route segment config (Next 16, route-segment-config/maxDuration). The ledger
 * reports a pending row older than 120 s as unknown, and the reaper settles it
 * to failed; bounding this function well inside that window means a slow save
 * cannot settle its row after the reaper already has.
 */
export const maxDuration = 60;

/** values with all five groups, plus household, display and calendar, is well under 2 kB from the real client. */
const MAX_BYTES = 8192;

const MESSAGES = Object.freeze({
  conflict: 'These settings changed. Review the latest values before saving.',
  homeChanged: 'Your home details changed. Review the latest values before saving.',
  mismatch: 'That request was already made with different details. Please try again.',
  abandoned: 'That save stopped before it finished and was not confirmed. Review the latest settings before saving again.',
  failed: 'That save did not complete. Review the latest settings before saving again.',
  ifMatch: 'Send the settings revision you are saving against in If-Match.',
  idempotency: 'The Idempotency-Key header and the operationId must be the same id.',
  noProfile: 'Settings are not available until this household is set up. Nothing was changed.',
});

/** 404: the household has no profile row, so it has no settings (review N1). Not retryable. */
function profileMissing(requestId) {
  return apiError({ status: 404, code: ERROR_CODES.NOT_FOUND, message: MESSAGES.noProfile, retryable: false, requestId });
}

/** Thrown inside the operation when If-Match is not the stored revision. */
class StaleRevisionError extends Error {
  constructor(revision) {
    super('stale_revision');
    this.name = 'StaleRevisionError';
    this.revision = revision;
  }
}

/** Thrown inside the operation when the household's home changed under the save. */
class HomeChangedError extends Error {
  constructor() {
    super('home_changed');
    this.name = 'HomeChangedError';
  }
}

/** 422 in the envelope, the client maps it to a validation failure (runtime.ts:144). */
function invalid(fieldErrors, requestId) {
  return apiError({
    status: 422,
    code: ERROR_CODES.VALIDATION_FAILED,
    message: fieldErrors[0]?.message ?? 'Some details need another look.',
    fieldErrors,
    retryable: false,
    requestId,
  });
}

function conflict(message, extra, requestId) {
  return apiError({ status: 409, code: ERROR_CODES.CONFLICT, message, retryable: false, requestId, extra });
}

/** `If-Match: 4`, also accepted as an entity tag ("4" or W/"4"). */
function parseIfMatch(header) {
  if (header === null) return null;
  const match = /^(?:W\/)?"?(\d{1,15})"?$/.exec(header.trim());
  if (!match) return null;
  const revision = Number(match[1]);
  return Number.isSafeInteger(revision) && revision >= 1 ? revision : null;
}

export async function GET(request) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);
    return NextResponse.json(await readSettingsSnapshot(supabaseAdmin, userId), { headers: { 'X-Request-Id': requestId } });
  } catch (err) {
    if (isSettingsAlertsUnavailable(err) || isOperationsUnavailable(err)) return settingsAlertsUnavailable(requestId);
    if (isSettingsProfileMissing(err)) return profileMissing(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`Settings read failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}

/**
 * The one save, inside the operation the ledger has claimed. Returns the
 * receipt the ledger keeps, whose `unresolvedOperations` is always [] (Ruling
 * S14): a stored receipt is history, not a lock, and GET /api/operations and a
 * replay serve it as stored, so a list frozen into it would name operations
 * long settled, and two overlapping saves would each park the other for ever.
 * The live list, read before the save and without this operation, goes in
 * `live` for the direct answer alone.
 */
async function save(supabase, { userId, operationId, group, patch, expectedRevision, live }) {
  // The precondition is decided here, after the claim, so a replay of a lost
  // response returns the first outcome instead of a conflict.
  const state = await readSettingsState(supabase, userId);
  const shown = settingsSnapshot({ ...state, unresolvedOperations: [] });
  if (shown.revision !== expectedRevision) throw new StaleRevisionError(shown.revision);
  const bands = group === 'home' && patch.household ? await readBands(supabase, userId) : null;
  const changes = changedFields(group, patch, shown, bands);
  // Read before the save, so nothing that can fail is left between its commit
  // and the ledger's settle.
  const unresolvedOperations = await unresolvedSettingsOperations(supabase, userId, { excludeOperationId: operationId });

  let saved;
  try {
    saved = await saveSettings(supabase, {
      profileId: userId,
      operationId,
      expectedRevision,
      preferences: preferenceColumns(group, patch, state.preferences),
      changes,
    });
  } catch (err) {
    // The home changed under the save: the whole save was rolled back with it.
    if (isConflictRefusal(haloRefusal(err))) throw new HomeChangedError();
    throw err;
  }
  // The reaper settled this operation first, so save_settings wrote nothing.
  // Recorded with the reaper's own reason, so a replay and a reconcile say
  // abandoned (review item 4 of the S14 follow-up); this call's own answer is
  // the failed receipt (PATCH below).
  if (saved.abandoned) return { status: 'failed', reason: 'abandoned' };
  // A refused save names the stored revision, the one to send next. When
  // save_settings found no preferences row at all (it was removed after the
  // read above, which nothing in the app does), it has no revision to name, so
  // the row is made again exactly as a first read makes it, and that revision
  // is the answer: a stale_revision always carries one (task 3 review N3).
  if (!saved.saved) {
    throw new StaleRevisionError(saved.revision ?? (await ensurePreferences(supabase, userId)).revision);
  }

  live.unresolvedOperations = unresolvedOperations;
  return { status: 'succeeded', snapshot: settingsSnapshot({ ...saved, unresolvedOperations: [] }) };
}

/** The direct answer to a save this call made: the stored receipt with the live list (Ruling S14). */
function withLiveList(receipt, unresolvedOperations) {
  return { ...receipt, snapshot: { ...receipt.snapshot, unresolvedOperations } };
}

export async function PATCH(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);

    const body = await readJsonBody(request, { maxBytes: MAX_BYTES });
    if (!body.ok) {
      return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    }

    const operationId = parseUuid(body.value.operationId);
    if (!operationId.ok) {
      return invalid([{ field: 'operationId', code: operationId.code, message: operationId.message }], requestId);
    }
    const idempotencyKey = request.headers.get('idempotency-key');
    if (idempotencyKey !== null && idempotencyKey.trim().toLowerCase() !== operationId.value) {
      return invalid([{ field: 'operationId', code: 'idempotency_key_mismatch', message: MESSAGES.idempotency }], requestId);
    }
    const expectedRevision = parseIfMatch(readIfMatch(request));
    if (expectedRevision === null) {
      return invalid([{ field: 'If-Match', code: 'precondition_required', message: MESSAGES.ifMatch }], requestId);
    }

    const input = parseSettingsSave(body.value);
    if (!input.ok) return invalid(input.fieldErrors, requestId);
    const { group, patch } = input.value;

    // 0021 is proved here, before the operation id is claimed, so an
    // unavailable surface has written nothing when it says nothing was changed.
    // So is the profile row: the preferences row's foreign key refuses a
    // household without one (SettingsProfileMissingError, a 404 below).
    try {
      await ensurePreferences(supabaseAdmin, userId);
      await readSettingsProfile(supabaseAdmin, userId);
    } catch (err) {
      if (isSettingsAlertsUnavailable(err)) return settingsAlertsUnavailable(requestId);
      throw err;
    }

    const live = { unresolvedOperations: null };
    const outcome = await runOperation(
      supabaseAdmin,
      {
        operationId: operationId.value,
        profileId: userId,
        domain: 'settings',
        kind: 'settings.save',
        input: { group, patch, expectedRevision },
      },
      () => save(supabaseAdmin, { userId, operationId: operationId.value, group, patch, expectedRevision, live }),
    );

    // This call's own save found its ledger row already reaped, so
    // save_settings wrote nothing (the only failed outcome a first call
    // returns rather than throws). The answer is the failed receipt the client
    // type allows, { operationId, status: 'failed' }: the client then says "The
    // save was not applied. Your draft is still here." and keeps the person's
    // edits. A 409 here would make it re-read, overwrite the draft and say the
    // settings changed, which they did not (S16 re-review, nit 1).
    if (outcome.status === 'failed' && !outcome.replayed) {
      return NextResponse.json({ operationId: operationId.value, status: 'failed' }, { headers });
    }

    // A replay of an operation that settled as failed is a terminal 409 with
    // the reason it failed, in either stored shape: the reaper's
    // { status: 'failed', reason: 'abandoned' } for a save that never finished,
    // or no result at all for one that threw in process (a stale revision, a
    // home that changed, a database error). Neither is "not found" and neither
    // can ever succeed on retry, and the client answers a 409 by re-reading.
    if (outcome.status === 'failed') {
      const abandoned = outcome.result?.reason === 'abandoned';
      return conflict(
        abandoned ? MESSAGES.abandoned : MESSAGES.failed,
        { reason: abandoned ? 'operation_abandoned' : 'operation_failed' },
        requestId,
      );
    }

    // A replay of work still running, or that died before it settled, has no
    // receipt to replay: the client parks the id and reconciles later. A
    // replay of a success is the stored receipt as it is, whose list is [];
    // only the save this call made answers with the live list (Ruling S14).
    const receipt = outcome.result ?? { operationId: operationId.value, status: outcome.status };
    const answer = !outcome.replayed && receipt.snapshot && live.unresolvedOperations
      ? withLiveList(receipt, live.unresolvedOperations)
      : receipt;
    return NextResponse.json(answer, { headers });
  } catch (err) {
    if (err instanceof StaleRevisionError) {
      return conflict(MESSAGES.conflict, { reason: 'stale_revision', ...(err.revision ? { revision: err.revision } : {}) }, requestId);
    }
    if (err instanceof HomeChangedError) return conflict(MESSAGES.homeChanged, { reason: 'home_changed' }, requestId);
    if (err?.message === OPERATION_INPUT_MISMATCH) return conflict(MESSAGES.mismatch, { reason: 'operation_mismatch' }, requestId);
    if (isSettingsAlertsUnavailable(err) || isSaveSettingsMissing(err) || isOperationsUnavailable(err)) {
      return settingsAlertsUnavailable(requestId);
    }
    if (isSettingsProfileMissing(err)) return profileMissing(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    // The code and message go to the log: a database message is not for the
    // person, and its details, which can quote the refused row, go nowhere.
    console.error(`Settings save failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
