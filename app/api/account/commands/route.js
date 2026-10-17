import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody, parseBoundedInt, parseEnum, parseText, parseUuid } from '@/lib/validate';
import { featureEnabled, featureDisabledReason } from '@/lib/features';
import {
  OPERATION_INPUT_MISMATCH,
  isOperationsUnavailable,
  operationsUnavailable,
  runOperation,
} from '@/lib/operations';
import {
  ACCOUNT_FEATURES,
  IMPLEMENTED_FEATURES,
  hashToken,
  linkedMethod,
  readRecoverySnapshot,
  recoveryRevision,
} from '@/lib/account';

/**
 * POST /api/account/commands
 *
 *   { feature, action, payload, expectedRevision, operationId }  ->  AccountReceipt
 *
 * The write half of the account surface. `feature` is `recovery` here; the four
 * actions are the ones the real interface sends for a recovery method
 * (components/production/ProductionAccountFlows.tsx):
 *
 *   request-recovery  { email }                  link an address and open a challenge
 *   check-recovery    { challengeId }            has the provider confirmed it yet
 *   cancel-recovery   { challengeId }            drop the pending challenge
 *   remove-recovery   { id, revision }           unlink the verified address
 *
 * `revoke-device` is the fifth action the same interface sends and is NOT
 * implemented here (task 9): it is refused as a validation error, so a client
 * is told its button does nothing yet rather than being answered as if the
 * device had been revoked.
 *
 * The answer is `AccountReceipt`: `{ operationId, status, snapshot?, message? }`
 * with status `succeeded`, `pending`, `unknown` or `failed`, which
 * `validAccountReceipt` checks before the client will look at it. A succeeded
 * receipt carries the whole `AccountSnapshot` that `GET /api/account` would
 * return, rebuilt after the change and read through the same
 * `readRecoverySnapshot`, so the client never has to re-read to find out what
 * it now has. `failed` is terminal and its `message` is shown to the person;
 * `pending` and `unknown` make the client park the id and reconcile later
 * through `GET /api/operations`.
 *
 * Identity comes only from the verified session token. No field of the body or
 * the query can name another household: a body key that is not one of the five
 * is a validation error rather than something quietly ignored, and every
 * statement here is scoped to the caller, so another household's challenge id
 * is answered exactly like one that never existed.
 *
 * Idempotency is the ledger from migration 0017 and nothing else. The row is
 * claimed before the effect is attempted, so the same `operationId` replays the
 * first outcome without acting again, concurrent duplicates serialize, a dead
 * attempt reads as `unknown`, and the same id arriving with different input is
 * a 409 rather than a wrong replay.
 *
 * The `If-Match` precondition is `expectedRevision`, which is the count of this
 * household's account-domain ledger rows (see recoveryRevision). A mismatch is
 * a 409 carrying the current revision, which the client maps to a conflict and
 * re-reads. The check is made inside the operation, after the id is claimed, so
 * that a replay returns the first outcome instead of being refused as stale.
 * It is a precondition, not a lock: two commands with different ids that read
 * the same revision both pass it, and what keeps them safe is the per-action
 * guard each one then meets (the throttle, the collision refusal, the
 * owner-scoped lookup), not the revision.
 *
 * How a collision is detected, and why that way. An address that already
 * belongs to another identity must fail explicitly and must never be merged
 * (BE-334). The detection is the provider's own refusal: `updateUserById` is
 * attempted and `email_exists` means the address is taken, because
 * `auth.users.email` is unique and the constraint is the only authority that
 * can decide this atomically. Searching first (`listUsers`) and then writing
 * would be a race, and the window between the two is exactly when the other
 * identity could claim it. The refusal is also checked before the challenge is
 * written, so a collision leaves no challenge row behind.
 *
 * What this route does NOT do: deliver the confirmation message. Linking sets
 * the address on the identity unconfirmed and records the challenge;
 * `check-recovery` then asks the provider whether it has been confirmed. No
 * verification email is sent from here, deliberately: `generateLink`'s usable
 * types are a signup link (which creates a user when none matches, the second
 * identity BE-334 forbids) or a magic link (which mints a session for whoever
 * opens it, and BE-227 requires the link and recover intents to stay separate
 * code paths). Delivery, its budget and the human-verification requirement
 * (BE-340) are all still open, and the capability flag is off until they are
 * settled, so no address can be confirmed through this route today.
 *
 * The capability is off unless its flag is on (BE-351). While it is off this
 * handler reads nothing and writes nothing, and the refusal is a terminal
 * receipt carrying the same plain reason the read route gives, so a deployed
 * interface cannot talk its way past it.
 *
 * Until migrations 0017 and 0018 are applied the route answers a non-retryable
 * 503 `feature_unavailable`, decided before the operation id is claimed and
 * before the provider is touched, so "nothing was changed" is true when it says
 * so.
 */

/** The body is five fields; the largest is a 254 character address. */
const MAX_BYTES = 2048;

/** The actions this task implements. `revoke-device` is task 9's. */
const RECOVERY_ACTIONS = Object.freeze(['request-recovery', 'check-recovery', 'cancel-recovery', 'remove-recovery']);

/** The only keys the body may carry; anything else is a client that is confused about this endpoint. */
const BODY_KEYS = Object.freeze(['feature', 'action', 'payload', 'expectedRevision', 'operationId']);

/** The only keys each action's payload may carry. */
const PAYLOAD_KEYS = Object.freeze({
  'request-recovery': ['email'],
  'check-recovery': ['challengeId'],
  'cancel-recovery': ['challengeId'],
  'remove-recovery': ['id', 'revision'],
});

/** The client's own rule (lib/frontend/account-review.ts), enforced here because the client is not authority. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX_LENGTH = 254;

/** How long a person has to confirm an address before the challenge is stale. */
const CHALLENGE_TTL_MS = 30 * 60 * 1000;

/**
 * How long after asking for verification another request is refused. One
 * minute: short enough that a mistyped address is not a long lockout, long
 * enough that holding the button down cannot queue a second message. It is
 * measured on the ledger rather than on the challenge rows, because a challenge
 * can be cancelled and the ledger cannot, so cancelling is not a way around it.
 */
const RESEND_WINDOW_MS = 60 * 1000;

const MESSAGES = Object.freeze({
  linked: 'That address was added. It cannot recover your account until it is confirmed.',
  alreadyVerified: 'That address is already verified for this account.',
  removeFirst: 'This account already has a verified address. Remove it before adding a different one.',
  collision: 'That address cannot be linked to this account. Please use a different address.',
  throttled: 'Verification for this account was requested a moment ago. Please wait a minute and try again.',
  challengeMissing: 'That verification request was not found.',
  confirmed: 'That address is confirmed, and can now recover your account.',
  notConfirmed: 'That address is not confirmed yet. Nothing has changed.',
  cancelled: 'That verification request was cancelled. No address was added.',
  removed: 'That address is no longer used to recover your account.',
  nothingToRemove: 'There is no recovery address to remove.',
  conflict: 'This information changed. Please review it again.',
  mismatch: 'That request was already made with different details. Please try again.',
});

/** Thrown inside the operation when `expectedRevision` is not the current revision. */
class StaleRevisionError extends Error {
  constructor(revision) {
    super('stale_revision');
    this.name = 'StaleRevisionError';
    this.revision = revision;
  }
}

/** One field error, from a parser result or a literal `{ code, message }`. */
const asField = (field, result) => [{ field, code: result.code, message: result.message }];

/** A 400 naming the field that failed, using the validator's own code and message. */
const badField = (field, result, requestId) => validationError(asField(field, result), requestId);

/** The 503 for a feature the contract names but this package has not built. */
function notBuiltHere(requestId) {
  return apiError({
    status: 503,
    code: ERROR_CODES.FEATURE_UNAVAILABLE,
    message: 'That part of your account is not available yet.',
    retryable: false,
    requestId,
  });
}

/** 409 for a precondition that no longer holds, with the revision to reload from. */
function revisionConflict(revision, requestId) {
  return apiError({
    status: 409,
    code: ERROR_CODES.CONFLICT,
    message: MESSAGES.conflict,
    retryable: false,
    requestId,
    extra: { reason: 'stale_revision', revision },
  });
}

/** 409 for an operation id reused with different input: a client bug or an attack, never a replay. */
function operationMismatch(requestId) {
  return apiError({
    status: 409,
    code: ERROR_CODES.CONFLICT,
    message: MESSAGES.mismatch,
    retryable: false,
    requestId,
    extra: { reason: 'operation_mismatch' },
  });
}

/**
 * The address, normalized. Lowercased because the provider lowercases it too,
 * and a digest of the address the person typed would then never match a digest
 * of the address the provider stores.
 */
function parseEmail(value) {
  const given = parseText(value, { maxLength: EMAIL_MAX_LENGTH, required: true, rejectControl: true });
  if (!given.ok) return given;
  const address = given.value.toLowerCase();
  if (!EMAIL_SHAPE.test(address)) {
    return { ok: false, code: 'invalid_email', message: 'Enter an email address in the form name@example.com.' };
  }
  return { ok: true, value: address };
}

/** One action's payload, with every other key refused rather than ignored. */
function parsePayload(action, raw) {
  if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      fieldErrors: [{ field: 'payload', code: 'invalid_payload', message: 'Send a payload object for this action.' }],
    };
  }
  const allowed = PAYLOAD_KEYS[action];
  const unknown = Object.keys(raw).filter((key) => !allowed.includes(key)).sort();
  if (unknown.length > 0) {
    return {
      ok: false,
      fieldErrors: unknown.map((key) => ({
        field: `payload.${key}`,
        code: 'unknown_field',
        message: `Only ${allowed.join(' and ')} can be sent for ${action}.`,
      })),
    };
  }

  if (action === 'request-recovery') {
    const email = parseEmail(raw.email);
    if (!email.ok) return { ok: false, fieldErrors: asField('payload.email', email) };
    return { ok: true, value: { email: email.value } };
  }
  if (action === 'remove-recovery') {
    // `id` is the method id the snapshot returned, and `revision` is the
    // revision the person was looking at. The precondition is enforced once,
    // from expectedRevision, so this copy of it is only checked for shape: a
    // client cannot weaken the check by sending a different number here.
    const id = parseText(raw.id, { maxLength: 40, required: true, rejectControl: true });
    if (!id.ok) return { ok: false, fieldErrors: asField('payload.id', id) };
    const revision = parseBoundedInt(raw.revision, { min: 0, max: Number.MAX_SAFE_INTEGER });
    if (!revision.ok) return { ok: false, fieldErrors: asField('payload.revision', revision) };
    return { ok: true, value: { id: id.value } };
  }

  const challengeId = parseUuid(raw.challengeId);
  if (!challengeId.ok) return { ok: false, fieldErrors: asField('payload.challengeId', challengeId) };
  return { ok: true, value: { challengeId: challengeId.value } };
}

/** The receipt body for a change that was made. */
const applied = async (supabase, userId, message) => ({
  status: 'succeeded',
  snapshot: await readRecoverySnapshot(supabase, userId),
  message,
});

/** The receipt body for a refusal the person can read and act on. */
const refused = (message) => ({ status: 'failed', message });

/** True when the provider is saying the address belongs to another identity. */
function isAddressTaken(error) {
  const code = typeof error?.code === 'string' ? error.code.toLowerCase() : '';
  if (code === 'email_exists' || code === 'user_already_exists' || code === '23505') return true;
  // Older GoTrue builds answer 400 or 422 with no code. The test is deliberately
  // narrow: an error this does not recognise becomes a 500, which is the safe
  // direction, because the alternative is calling an unknown failure a collision
  // or, worse, continuing as if the address had been linked.
  const message = String(error?.message ?? '').toLowerCase();
  return (
    [400, 409, 422].includes(error?.status) &&
    /already (been )?registered|already exists|already in use|duplicate key/.test(message)
  );
}

/**
 * Link the address to this identity and open a challenge for it.
 *
 * The identity is never replaced: `updateUserById` changes the address on the
 * same `auth.users` row, so `profiles.id` and every owned row keep pointing at
 * it (BE-050). The address is written unconfirmed, because an admin write is
 * not proof that the person owns it; until the provider confirms it,
 * `linkedMethod` reports no method and nothing can be recovered with it.
 */
async function requestRecovery(supabase, { userId, operationId, email }) {
  // The ledger is the throttle: it is append-only, so this cannot be reset by
  // cancelling a challenge. The current operation's own row is already claimed,
  // hence excluded.
  const { count, error: recentError } = await supabase
    .from('operations')
    .select('operation_id', { count: 'exact', head: true })
    .eq('profile_id', userId)
    .eq('domain', 'account')
    .eq('kind', 'account.request-recovery')
    .neq('operation_id', operationId)
    .gte('created_at', new Date(Date.now() - RESEND_WINDOW_MS).toISOString());
  if (recentError) throw recentError;
  if ((count ?? 0) > 0) return refused(MESSAGES.throttled);

  const { data: account, error: accountError } = await supabase.auth.admin.getUserById(userId);
  if (accountError) throw new Error(accountError.message);
  const user = account?.user ?? null;
  const current = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : null;
  const method = linkedMethod(user);

  // Already proved: there is nothing to verify, so no second challenge is made.
  if (current === email && method) return applied(supabase, userId, MESSAGES.alreadyVerified);

  // A verified address is this household's only way back in. Replacing it would
  // take that away before the new address has been proved, so the exchange is
  // two deliberate steps, which is also all the interface offers.
  if (method) return refused(MESSAGES.removeFirst);

  if (current !== email) {
    const { error: linkError } = await supabase.auth.admin.updateUserById(userId, {
      email,
      // Stated rather than left to the provider's default: a confirmed address
      // is a credential that can recover this household, and nothing has been
      // proved yet.
      email_confirm: false,
    });
    if (linkError) {
      if (isAddressTaken(linkError)) return refused(MESSAGES.collision);
      throw new Error(linkError.message);
    }
  }

  const { error: challengeError } = await supabase.from('recovery_challenges').insert({
    profile_id: userId,
    email_hash: hashToken(email),
    // There is no client nonce in the link intent: the caller already holds a
    // verified session, which binds this request more strongly than a nonce
    // could. The column is not nullable, so it holds the digest of a value
    // generated here and never revealed, which also means the unauthenticated
    // recovery routes can never present a matching nonce for this row.
    nonce_hash: hashToken(randomBytes(32).toString('hex')),
    status: 'pending',
    expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
  });
  if (challengeError) throw challengeError;

  return applied(supabase, userId, MESSAGES.linked);
}

/**
 * Has the provider confirmed the challenge's address yet.
 *
 * The provider's confirmation is the proof, so this reads it rather than
 * deciding anything itself. The digest comparison matters: without it the
 * question would be "is any address confirmed", and an address confirmed
 * earlier would close a challenge raised for a different one.
 *
 * A challenge whose address is confirmed is removed. Migration 0018 cannot
 * record what happened to it: `verified` requires a restore token hash, and
 * minting a restore token in the link intent would hand out a credential that
 * recovers the household, which belongs to the separate recover path (BE-227).
 * Leaving it open would be worse, because a stale pending row for an address
 * that is already confirmed is exactly what the unauthenticated recovery routes
 * look for by address digest. What happened is in the ledger, which is the
 * record of every command and is never deleted.
 */
async function checkRecovery(supabase, { userId, challengeId }) {
  const { data: row, error } = await supabase
    .from('recovery_challenges')
    .select('id, email_hash')
    .eq('profile_id', userId)
    .eq('id', challengeId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return refused(MESSAGES.challengeMissing);

  const { data: account, error: accountError } = await supabase.auth.admin.getUserById(userId);
  if (accountError) throw new Error(accountError.message);
  const user = account?.user ?? null;
  const confirmed = linkedMethod(user) ? hashToken(user.email.trim().toLowerCase()) : null;
  if (confirmed !== row.email_hash) return applied(supabase, userId, MESSAGES.notConfirmed);

  const { error: deleteError } = await supabase
    .from('recovery_challenges')
    .delete()
    .eq('profile_id', userId)
    .eq('id', challengeId);
  if (deleteError) throw deleteError;
  return applied(supabase, userId, MESSAGES.confirmed);
}

/**
 * Drop a pending challenge. The row is removed for the same reason as above:
 * 0018 has no word for "the person changed their mind", and a challenge nobody
 * is waiting on still holds a hashed address with no retention period approved
 * for it. Any address linked by the cancelled request stays on the identity
 * unconfirmed, where it is not a recovery method and is replaced by the next
 * request; the provider's admin API has no supported way to take an address off
 * an identity.
 */
async function cancelRecovery(supabase, { userId, challengeId }) {
  const { data: row, error } = await supabase
    .from('recovery_challenges')
    .select('id')
    .eq('profile_id', userId)
    .eq('id', challengeId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return refused(MESSAGES.challengeMissing);

  const { error: deleteError } = await supabase
    .from('recovery_challenges')
    .delete()
    .eq('profile_id', userId)
    .eq('id', challengeId);
  if (deleteError) throw deleteError;
  return applied(supabase, userId, MESSAGES.cancelled);
}

/**
 * Unlink the verified address.
 *
 * `email_confirm: false` is the documented operation that does this: the
 * provider's admin API cannot remove an address from an identity, and deleting
 * the identity would delete the household. An unconfirmed address is not a
 * recovery method (`linkedMethod` requires the confirmation) and the recovery
 * routes only act on addresses that resolve to a linked identity, so it can no
 * longer recover anything.
 *
 * A method id that is not the linked one is answered exactly like having no
 * method at all, so guessing ids teaches nothing.
 */
async function removeRecovery(supabase, { userId, methodId }) {
  const { data: account, error: accountError } = await supabase.auth.admin.getUserById(userId);
  if (accountError) throw new Error(accountError.message);
  const method = linkedMethod(account?.user ?? null);
  if (!method || method.id !== methodId) return refused(MESSAGES.nothingToRemove);

  const { error } = await supabase.auth.admin.updateUserById(userId, { email_confirm: false });
  if (error) throw new Error(error.message);
  return applied(supabase, userId, MESSAGES.removed);
}

/** The one effect of one command, inside the operation the ledger has claimed. */
async function perform(supabase, { action, userId, operationId, payload, expectedRevision, currentRevision }) {
  // The precondition is checked here, not before the claim, so that a replay of
  // a lost response returns the first outcome instead of a conflict.
  if (currentRevision !== expectedRevision) throw new StaleRevisionError(currentRevision);
  if (action === 'request-recovery') {
    return requestRecovery(supabase, { userId, operationId, email: payload.email });
  }
  if (action === 'check-recovery') return checkRecovery(supabase, { userId, challengeId: payload.challengeId });
  if (action === 'cancel-recovery') return cancelRecovery(supabase, { userId, challengeId: payload.challengeId });
  return removeRecovery(supabase, { userId, methodId: payload.id });
}

/**
 * Proves migration 0018 is applied before anything is written, scoped to the
 * caller like every other statement here. Without it a missing table would be
 * discovered after the address had been linked, and the 503's "nothing was
 * changed" would be false.
 */
async function requireChallengeTable(supabase, profileId) {
  const { error } = await supabase
    .from('recovery_challenges')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', profileId);
  if (error) throw error;
}

export async function POST(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);

    const body = await readJsonBody(request, { maxBytes: MAX_BYTES });
    if (!body.ok) {
      return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    }

    const feature = parseEnum(body.value.feature, ACCOUNT_FEATURES);
    if (!feature.ok) return badField('feature', feature, requestId);
    if (!IMPLEMENTED_FEATURES.includes(feature.value)) return notBuiltHere(requestId);

    // The receipt has to carry the caller's own operation id, so it is read
    // before anything that answers with one.
    const operationId = parseUuid(body.value.operationId);
    if (!operationId.ok) return badField('operationId', operationId, requestId);
    const idempotencyKey = request.headers.get('idempotency-key');
    if (idempotencyKey !== null && idempotencyKey.trim().toLowerCase() !== operationId.value) {
      return validationError(
        [{
          field: 'operationId',
          code: 'idempotency_key_mismatch',
          message: 'The Idempotency-Key header and the operationId must be the same id.',
        }],
        requestId,
      );
    }

    // Off by default, and off means off: no reads, no writes, nothing disclosed
    // about the account, and the same plain reason the read route gives.
    if (!featureEnabled('recovery')) {
      return NextResponse.json(
        { operationId: operationId.value, ...refused(featureDisabledReason('recovery')) },
        { headers },
      );
    }

    const unknown = Object.keys(body.value).filter((key) => !BODY_KEYS.includes(key)).sort();
    if (unknown.length > 0) {
      return validationError(
        unknown.map((key) => ({
          field: key,
          code: 'unknown_field',
          message: `Only ${BODY_KEYS.join(', ')} can be sent.`,
        })),
        requestId,
      );
    }

    const action = parseEnum(body.value.action, RECOVERY_ACTIONS);
    if (!action.ok) return badField('action', action, requestId);

    const expectedRevision = parseBoundedInt(body.value.expectedRevision, { min: 0, max: Number.MAX_SAFE_INTEGER });
    if (!expectedRevision.ok) return badField('expectedRevision', expectedRevision, requestId);
    const ifMatch = request.headers.get('if-match');
    if (ifMatch !== null && ifMatch.trim() !== String(expectedRevision.value)) {
      return validationError(
        [{
          field: 'expectedRevision',
          code: 'precondition_mismatch',
          message: 'The If-Match header and expectedRevision must be the same revision.',
        }],
        requestId,
      );
    }

    const payload = parsePayload(action.value, body.value.payload);
    if (!payload.ok) return validationError(payload.fieldErrors, requestId);

    // Both migrations are proved here, before the operation id is claimed and
    // before the provider is touched, so an unavailable feature has written
    // nothing when it says nothing was changed.
    const currentRevision = await recoveryRevision(supabaseAdmin, userId);
    await requireChallengeTable(supabaseAdmin, userId);

    const outcome = await runOperation(
      supabaseAdmin,
      {
        operationId: operationId.value,
        profileId: userId,
        domain: 'account',
        kind: `account.${action.value}`,
        input: { feature: feature.value, action: action.value, payload: payload.value, expectedRevision: expectedRevision.value },
      },
      () =>
        perform(supabaseAdmin, {
          action: action.value,
          userId,
          operationId: operationId.value,
          payload: payload.value,
          expectedRevision: expectedRevision.value,
          currentRevision,
        }),
    );

    // A replayed operation that is still running, or that died before it
    // settled, has no receipt to replay: the client is told `pending` or
    // `unknown` and reconciles later, which is not a failure and not a success.
    const receipt = outcome.result ?? { operationId: operationId.value, status: outcome.status };
    return NextResponse.json(receipt, { headers });
  } catch (err) {
    if (err instanceof StaleRevisionError) return revisionConflict(err.revision, requestId);
    if (err?.message === OPERATION_INPUT_MISMATCH) return operationMismatch(requestId);
    if (isOperationsUnavailable(err)) return operationsUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    // The detail goes to the log: a provider or database message is not for the person.
    console.error(`account command failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
