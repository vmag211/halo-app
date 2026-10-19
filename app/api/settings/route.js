import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, requestIdFor, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody, parseUuid } from '@/lib/validate';
import { OPERATION_INPUT_MISMATCH, isOperationsUnavailable, runOperation } from '@/lib/operations';
import { isSettingsAlertsUnavailable, settingsAlertsUnavailable } from '@/lib/settingsAlerts';
import { haloRefusal, isConflictRefusal } from '@/lib/homeContextRpc';
import {
  changedFields,
  ensurePreferences,
  isSaveSettingsMissing,
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
 * Concurrency (Rulings S4, S11 and S12). `If-Match` is the revision the client
 * was shown. The whole save is one call to public.save_settings (0021): the
 * compare-and-set on the revision and every table the group writes, in one
 * transaction, with the home details saved through the 0016 home functions
 * inside it. So of two saves holding the same revision exactly one applies and
 * the other is a 409 having written nothing, a save that fails anywhere
 * applies nothing (a 500 recorded as failed is true), and the revision
 * advances exactly once per applied save. Every other writer of a value in the
 * snapshot advances the revision through 0021's triggers in the same
 * transaction as its write, so a change made anywhere else makes a stale save
 * here conflict instead of being reverted by it. The receipt is built from the
 * rows save_settings returns; nothing is read between its commit and the
 * ledger's settle.
 *
 * Idempotency is the ledger (migration 0017) with domain 'settings' and
 * nothing else. The same operationId replays the first receipt without acting
 * again; a stale revision is decided inside the claimed operation, so a replay
 * of a lost success returns that success rather than a conflict; the same id
 * with a different body is a 409.
 *
 * Answers:
 *   200 { operationId, status: 'succeeded', snapshot }   the full snapshot, new revision
 *   200 { operationId, status: 'pending' | 'unknown' }   a replay of work not yet settled
 *   409 conflict, reason 'stale_revision' (with the current `revision`),
 *       'home_changed' or 'operation_mismatch'
 *   409 conflict, reason 'operation_failed' or 'operation_abandoned': a
 *       replay of an id whose save failed, or was settled as abandoned by the
 *       ledger's reaper. Terminal: the same id never succeeds.
 *   422 validation_failed with field_errors, before anything is read or written
 *   503 feature_unavailable until 0017 and 0021 are applied, decided before the
 *       operation id is claimed, so "nothing was changed" is true (and, should
 *       save_settings alone be missing, after the claim, when nothing was
 *       changed either)
 *
 * Identity comes only from the verified session token. No field of the body or
 * the query names a household, and every statement is scoped to the caller.
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
});

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
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`Settings read failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}

/** The one save, inside the operation the ledger has claimed. */
async function save(supabase, { userId, operationId, group, patch, expectedRevision }) {
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
      expectedRevision,
      preferences: preferenceColumns(group, patch, state.preferences),
      changes,
    });
  } catch (err) {
    // The home changed under the save: the whole save was rolled back with it.
    if (isConflictRefusal(haloRefusal(err))) throw new HomeChangedError();
    throw err;
  }
  if (!saved.saved) throw new StaleRevisionError(saved.revision);

  return { status: 'succeeded', snapshot: settingsSnapshot({ ...saved, unresolvedOperations }) };
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
    const expectedRevision = parseIfMatch(request.headers.get('if-match'));
    if (expectedRevision === null) {
      return invalid([{ field: 'If-Match', code: 'precondition_required', message: MESSAGES.ifMatch }], requestId);
    }

    const input = parseSettingsSave(body.value);
    if (!input.ok) return invalid(input.fieldErrors, requestId);
    const { group, patch } = input.value;

    // 0021 is proved here, before the operation id is claimed, so an
    // unavailable surface has written nothing when it says nothing was changed.
    try {
      await ensurePreferences(supabaseAdmin, userId);
      await readSettingsProfile(supabaseAdmin, userId);
    } catch (err) {
      if (isSettingsAlertsUnavailable(err)) return settingsAlertsUnavailable(requestId);
      throw err;
    }

    const outcome = await runOperation(
      supabaseAdmin,
      {
        operationId: operationId.value,
        profileId: userId,
        domain: 'settings',
        kind: 'settings.save',
        input: { group, patch, expectedRevision },
      },
      () => save(supabaseAdmin, { userId, operationId: operationId.value, group, patch, expectedRevision }),
    );

    // A replay of an operation that settled as failed is a terminal 409 with
    // the reason it failed, in either stored shape: the reaper's
    // { status: 'failed', reason: 'abandoned' } for a save that never finished,
    // or no result at all for one that threw in process (a stale revision, a
    // home that changed, a database error). Neither is "not found" and neither
    // can ever succeed on retry, and the client answers a 409 by re-reading.
    if (outcome.replayed && outcome.status === 'failed') {
      const abandoned = outcome.result?.reason === 'abandoned';
      return conflict(
        abandoned ? MESSAGES.abandoned : MESSAGES.failed,
        { reason: abandoned ? 'operation_abandoned' : 'operation_failed' },
        requestId,
      );
    }

    // A replay of work still running, or that died before it settled, has no
    // receipt to replay: the client parks the id and reconciles later.
    const receipt = outcome.result ?? { operationId: operationId.value, status: outcome.status };
    return NextResponse.json(receipt, { headers });
  } catch (err) {
    if (err instanceof StaleRevisionError) {
      return conflict(MESSAGES.conflict, { reason: 'stale_revision', ...(err.revision ? { revision: err.revision } : {}) }, requestId);
    }
    if (err instanceof HomeChangedError) return conflict(MESSAGES.homeChanged, { reason: 'home_changed' }, requestId);
    if (err?.message === OPERATION_INPUT_MISMATCH) return conflict(MESSAGES.mismatch, { reason: 'operation_mismatch' }, requestId);
    if (isSettingsAlertsUnavailable(err) || isSaveSettingsMissing(err) || isOperationsUnavailable(err)) {
      return settingsAlertsUnavailable(requestId);
    }
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    // The detail goes to the log: a database message is not for the person.
    console.error(`Settings save failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
