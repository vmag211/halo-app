import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { requireUser, authErrorResponse, linkCallerEmail, supabaseAdmin } from '@/lib/serverAuth';
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
  CHALLENGE_INTENT,
  IMPLEMENTED_FEATURES,
  hashToken,
  isRecoveryUnavailable,
  linkedMethod,
  readRecoverySnapshot,
  recoveryRevision,
} from '@/lib/account';

/**
 * POST /api/account/commands
 *
 *   { feature, action, payload, expectedRevision, operationId }  ->  AccountReceipt
 *
 * The write half of the account surface. `feature` is `recovery` here; the
 * five actions are the ones the real interface sends for a recovery method
 * (components/production/ProductionAccountFlows.tsx):
 *
 *   request-recovery  { email }                  link an address and open a challenge
 *   check-recovery    { challengeId }            has the provider confirmed it yet
 *   cancel-recovery   { challengeId }            drop the pending challenge
 *   remove-recovery   { id, revision }           unlink the verified address
 *   revoke-device     { id, revision }           refused: no capability exists (Ruling 27)
 *
 * `revoke-device` is RECOGNISED here, not implemented. Ruling 27 found that
 * the installed admin API (@supabase/supabase-js 2.110.7, enumerated off the
 * client object rather than trusted from documentation, and proved in
 * test/recoveryCapability.test.mjs) has nothing matching /session|device/i, and that
 * `auth.admin.signOut` takes only the JWT of the CURRENT caller, which a
 * server never holds for a device other than the one making this request.
 * PostgREST exposes only the `public` schema, so `auth.sessions` is not
 * reachable either. There is no session list to show a household and nothing
 * to revoke one by, so this action answers with a terminal `failed` receipt
 * that says so, rather than falling through to "unknown action": a capability
 * that does not exist and a client that mistyped the action name are
 * different facts, and a person reading the receipt, or a developer reading
 * this file, must not be told the same thing for both. See BE-227 in
 * docs/backend/requirements-tracker.md for the two alternatives that were
 * named and not chosen, and who decides between them.
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
 * The link is the CALLER's own email change, not the service role's
 * (Ruling 10): `linkCallerEmail` in lib/serverAuth.js sends the request
 * `auth.updateUser({ email })` sends, carrying the caller's verified token and
 * the public anon key. Two things are meant to follow, and they are the reason
 * it is done this way: the provider is expected to stage the address as a
 * pending change rather than write it into the unique `auth.users.email`
 * column, so an address nobody has proved is not occupied and thereby denied to
 * its real owner, and the provider sends its own confirmation message, so
 * nothing in HALO has to deliver mail for `check-recovery` to be satisfiable.
 *
 * The first of those is EXPECTED, not proved, and nothing here claims
 * otherwise. Whether the installed GoTrue stages the address for an ANONYMOUS
 * identity specifically, or writes `email` directly and leaves it unconfirmed,
 * has not been checked against a real project, which the local-only boundary
 * excludes; `auth.users` carrying the pending-change columns is evidence, not
 * proof, and the test suite proves only what the fake models. The code is
 * written so that either behaviour is correct here: `check-recovery` treats the
 * challenge as still in flight when the challenge's address is either the
 * pending change or an unconfirmed address on the identity. If the provider
 * writes it directly then this route behaves exactly as the admin path did, and
 * the squatting exposure the user-scoped call is meant to close is still open.
 *
 * Taken from the provider's documented behaviour rather than checked here: a
 * change is only staged when the requested address differs from the one the
 * identity already carries, which is why asking for an address that is already
 * on the identity is refused below instead of becoming a challenge nobody can
 * settle.
 *
 * How a collision is detected, and why that way. An address that already
 * belongs to another identity must fail explicitly and must never be merged
 * (BE-334). The detection is the provider's own refusal, because
 * `auth.users.email` is unique and that constraint is the only authority that
 * can decide atomically; searching first (`listUsers`) and then writing would
 * leave a window in which the other identity could claim it. There are two
 * points at which the refusal can arrive, and each has an ending that is not a
 * wait:
 *
 *   request time      the provider refuses the change outright
 *                     (`email_exists`), before any challenge row is written.
 *   confirmation time the address was free when the change was staged and
 *                     taken by the time the person opened the link, so the
 *                     promotion fails.
 *
 * What the provider does to the pending change after refusing a promotion is
 * ANOTHER THING NOT VERIFIED here: it may clear it, or leave it in place so the
 * person can retry. Both shapes are handled, and neither leaves a challenge
 * that can never settle. If it is cleared, `check-recovery` sees an address
 * that is neither pending nor confirmed and ends the challenge at once. If it
 * is left in place, the address stays pending for as long as the other
 * household holds it, so the challenge's own expiry is the bound: past it there
 * is nothing this challenge can still settle, and it is ended rather than
 * answered with a wait that has no end.
 *
 * The provider does not tell us why a promotion did not happen, so neither
 * receipt claims a reason. They say the address could not be added, or that the
 * request expired, which is all that is both true and safe to say.
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

/**
 * The five actions the interface sends for a recovery method. `revoke-device`
 * is recognised but refused (Ruling 27): see `revokeDevice` below.
 */
const RECOVERY_ACTIONS = Object.freeze([
  'request-recovery',
  'check-recovery',
  'cancel-recovery',
  'remove-recovery',
  'revoke-device',
]);

/** The only keys the body may carry; anything else is a client that is confused about this endpoint. */
const BODY_KEYS = Object.freeze(['feature', 'action', 'payload', 'expectedRevision', 'operationId']);

/** The only keys each action's payload may carry. */
const PAYLOAD_KEYS = Object.freeze({
  'request-recovery': ['email'],
  'check-recovery': ['challengeId'],
  'cancel-recovery': ['challengeId'],
  'remove-recovery': ['id', 'revision'],
  'revoke-device': ['id', 'revision'],
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
  linked: 'That address must be confirmed before it can recover your account. Check that address for a confirmation message.',
  alreadyVerified: 'That address is already verified for this account.',
  removeFirst: 'This account already has a verified address. Remove it before adding a different one.',
  collision: 'That address cannot be linked to this account. Please use a different address.',
  throttled: 'Verification for this account was requested a moment ago. Please wait a minute and try again.',
  challengeMissing: 'That verification request was not found.',
  changeGone: 'That address could not be added. Nothing was merged. You can try a different address.',
  expired: 'That request expired before the address was confirmed. Ask for a new confirmation message.',
  sameAddress:
    'That address is already on your account, so no new confirmation can be sent to it. Use a different address.',
  confirmed: 'That address is confirmed, and can now recover your account.',
  notConfirmed: 'That address is not confirmed yet. Nothing has changed.',
  cancelled:
    'That verification request was cancelled. We cannot recall the confirmation message already sent, so if you open the link in it, that address will still be added.',
  removed: 'That address can no longer recover your account. It stays on your account record until you add a different one.',
  nothingToRemove: 'There is no recovery address to remove.',
  conflict: 'This information changed. Please review it again.',
  mismatch: 'That request was already made with different details. Please try again.',
  deviceRevocationUnavailable: 'Revoking a specific device is not available. Nothing was changed.',
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
  if (action === 'revoke-device') {
    // The shape the interface sends (ProductionAccountFlows.tsx) is the same
    // { id, revision } pair remove-recovery takes. There is no device
    // registry to check the id against, because there is no capability to
    // populate one from (Ruling 27, see revokeDevice below): only the shape
    // is enforced here, and the action is refused the same way regardless of
    // what id is sent. The bound is wider than remove-recovery's 40, because
    // that id is always the fixed method id "email" while this one would
    // name an actual device or session (a hashed fingerprint, say), which is
    // plausibly a longer opaque value; it is still shape only and never read.
    const id = parseText(raw.id, { maxLength: 128, required: true, rejectControl: true });
    if (!id.ok) return { ok: false, fieldErrors: asField('payload.id', id) };
    const revision = parseBoundedInt(raw.revision, { min: 0, max: Number.MAX_SAFE_INTEGER });
    if (!revision.ok) return { ok: false, fieldErrors: asField('payload.revision', revision) };
    return { ok: true, value: {} };
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

/** An address as it is compared and hashed everywhere here: trimmed and lowercased. */
const normalizeAddress = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : null);

/** The digest of an address the provider is reporting, or null when there is none. */
const addressDigest = (value) => {
  const address = normalizeAddress(value);
  return address ? hashToken(address) : null;
};

/**
 * Ask the provider to add the address to this identity, and open a challenge
 * for it.
 *
 * The identity is never replaced: the change is made on the caller's own
 * `auth.users` row, so `profiles.id` and every owned row keep pointing at it
 * (BE-050). Nothing is confirmed by asking, so `linkedMethod` reports no method
 * and the address cannot recover anything until the person proves it.
 */
async function requestRecovery(supabase, { request, userId, operationId, email }) {
  // The ledger is the throttle: it is append-only, so this cannot be reset by
  // cancelling a challenge. The current operation's own row is already claimed,
  // hence excluded. Only attempts that got as far as asking the provider count:
  // a refused one sent nothing, so counting it would refuse the corrected
  // attempt with a message that is false. 'pending' counts because a request
  // still running may already have sent, and 'failed' does not because the only
  // failure after a successful send is a database error, which is a 500 the
  // person is not being asked to wait out.
  const { count, error: recentError } = await supabase
    .from('operations')
    .select('operation_id', { count: 'exact', head: true })
    .eq('profile_id', userId)
    .eq('domain', 'account')
    .eq('kind', 'account.request-recovery')
    .in('status', ['pending', 'succeeded'])
    .neq('operation_id', operationId)
    .gte('created_at', new Date(Date.now() - RESEND_WINDOW_MS).toISOString());
  if (recentError) throw recentError;
  if ((count ?? 0) > 0) return refused(MESSAGES.throttled);

  const { data: account, error: accountError } = await supabase.auth.admin.getUserById(userId);
  if (accountError) throw new Error(accountError.message);
  const user = account?.user ?? null;
  const current = normalizeAddress(user?.email);
  const method = linkedMethod(user);

  // Already proved: there is nothing to verify, so no second challenge is made.
  if (current === email && method) return applied(supabase, userId, MESSAGES.alreadyVerified);

  // A verified address is this household's only way back in. Replacing it would
  // take that away before the new address has been proved, so the exchange is
  // two deliberate steps, which is also all the interface offers.
  if (method) return refused(MESSAGES.removeFirst);

  // The provider only stages a change when the address differs from the one the
  // identity already carries, so asking for that same address would send
  // nothing, and opening a challenge for it would be asking the person to wait
  // for a message that is never coming. Reachable straight after
  // remove-recovery, which leaves the address in place unconfirmed.
  if (current === email) return refused(MESSAGES.sameAddress);

  // The caller's own email change, every time: asking again is a re-send, which
  // is what the throttle above exists to bound.
  const link = await linkCallerEmail(request, email);
  if (!link.ok) {
    if (link.reason === 'address_taken') return refused(MESSAGES.collision);
    // Anything else is ours, not the person's: a misconfigured provider, an
    // unreachable one, or a refusal we do not recognise. It fails loudly rather
    // than writing a challenge for an address that was never accepted.
    throw new Error(`account link refused by the provider: ${link.reason}${link.detail ? ` (${link.detail})` : ''}`);
  }

  // One address is in flight at a time, because the provider holds one pending
  // change, so this request closes whatever the household had open. Without it
  // a superseded challenge outlives the request that replaced it and the next
  // read reports it as an open verification, masked as the address now in
  // flight rather than its own.
  //
  // Narrowed to the link intent (0019, Ruling 15). The unauthenticated
  // POST /api/recovery/request writes rows to this table for the same
  // profile_id, and this delete used to be scoped to the owner alone, which
  // would have made a signed-in owner linking an address cancel an in-flight
  // recovery attempt. Their rows are not this operation's to close: the only
  // thing that can settle one is the browser that holds its nonce.
  const { error: supersedeError } = await supabase
    .from('recovery_challenges')
    .delete()
    .eq('profile_id', userId)
    .eq('intent', CHALLENGE_INTENT.LINK);
  if (supersedeError) throw supersedeError;

  const { error: challengeError } = await supabase.from('recovery_challenges').insert({
    profile_id: userId,
    intent: CHALLENGE_INTENT.LINK,
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
 * What the provider now says about the challenge's address. One of three
 * answers, and the digest comparison is what makes each of them about THIS
 * challenge: without it the question would be "is any address confirmed", and
 * an address confirmed earlier would close a challenge raised for another one.
 *
 *   confirmed    the address is the identity's own and verified. The challenge
 *                has nothing left to ask, so it goes.
 *   in flight    the provider is holding it as a pending change, or has written
 *                it unconfirmed onto the identity, and this challenge has not
 *                expired. Nothing changes; the person can check again. Past the
 *                expiry the challenge is ended instead, because a pending
 *                change the provider will not promote would otherwise be a wait
 *                with no end.
 *   gone         neither. The provider is no longer working on it, which is one
 *                of the two shapes a collision discovered at confirmation time
 *                can take. The challenge is closed with a terminal failure that
 *                claims no reason, because the provider does not give one.
 *
 * A closed challenge is deleted rather than relabelled. Migration 0018 cannot
 * record either ending truthfully: `verified` requires a restore token hash,
 * and minting a restore token in the link intent would hand out a credential
 * that recovers the household, which belongs to the separate recover path
 * (BE-227). Leaving the row open would be worse, because a stale pending row
 * for an address that is already settled is exactly what the unauthenticated
 * recovery routes look for by address digest. What happened is in the ledger,
 * which records every command and is never deleted.
 */
async function checkRecovery(supabase, { userId, challengeId }) {
  const { data: row, error } = await supabase
    .from('recovery_challenges')
    .select('id, email_hash, expires_at')
    .eq('profile_id', userId)
    .eq('intent', CHALLENGE_INTENT.LINK)
    .eq('id', challengeId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return refused(MESSAGES.challengeMissing);

  const { data: account, error: accountError } = await supabase.auth.admin.getUserById(userId);
  if (accountError) throw new Error(accountError.message);
  const user = account?.user ?? null;
  const method = linkedMethod(user);
  if (method && addressDigest(user.email) === row.email_hash) {
    await closeChallenge(supabase, { userId, challengeId });
    return applied(supabase, userId, MESSAGES.confirmed);
  }

  // Still in flight, either staged as a pending change or written unconfirmed
  // onto the identity. The second case is the behaviour the provider may have
  // for an anonymous identity, and it must read as waiting rather than as a
  // failure (see the route's header).
  const pending = addressDigest(user?.new_email);
  const unconfirmed = method ? null : addressDigest(user?.email);
  if (pending === row.email_hash || unconfirmed === row.email_hash) {
    // Still in flight, but only worth waiting on while this challenge is live.
    // Past its expiry there is nothing it can settle, whether the provider is
    // still holding the pending change or not.
    const expiry = Date.parse(row.expires_at);
    if (Number.isFinite(expiry) && expiry > Date.now()) {
      return applied(supabase, userId, MESSAGES.notConfirmed);
    }
    await closeChallenge(supabase, { userId, challengeId });
    return refused(MESSAGES.expired);
  }

  await closeChallenge(supabase, { userId, challengeId });
  return refused(MESSAGES.changeGone);
}

/**
 * Removes one of the caller's link challenges. Scoped to the owner AND to the
 * link intent, so neither another household's row nor a recovery attempt on
 * this one can be reached by naming its id.
 */
async function closeChallenge(supabase, { userId, challengeId }) {
  const { error } = await supabase
    .from('recovery_challenges')
    .delete()
    .eq('profile_id', userId)
    .eq('intent', CHALLENGE_INTENT.LINK)
    .eq('id', challengeId);
  if (error) throw error;
}

/**
 * Drop a pending challenge. The row is removed for the same reason as above:
 * 0018 has no word for "the person changed their mind", and a challenge nobody
 * is waiting on still holds a hashed address with no retention period approved
 * for it.
 *
 * Nothing is asked of the provider. A confirmed address is untouched, which is
 * the point: the address being cancelled was never written into the identity's
 * own, so cancelling cannot cost the household a credential it already had. The
 * provider's pending change is left to lapse, since there is no supported call
 * to withdraw one; if the person opens the confirmation link afterwards the
 * address does become theirs, which is the provider's state and the truth, and
 * the next read reports it.
 */
async function cancelRecovery(supabase, { userId, challengeId }) {
  const { data: row, error } = await supabase
    .from('recovery_challenges')
    .select('id')
    .eq('profile_id', userId)
    .eq('intent', CHALLENGE_INTENT.LINK)
    .eq('id', challengeId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return refused(MESSAGES.challengeMissing);

  await closeChallenge(supabase, { userId, challengeId });
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

/**
 * `revoke-device`, refused (Ruling 27). Neither half of this action is
 * buildable against the installed client: there is no provider call that
 * lists another identity's sessions, so a household's devices cannot be
 * enumerated to check the given id against, and `auth.admin.signOut` takes
 * only the JWT of the CURRENT caller, which a server never holds for a
 * device other than the one making this request. test/recoveryCapability.
 * test.mjs proves both of those against the installed SDK rather than
 * trusting documentation, so an upgrade that adds the capability fails that
 * test and tells someone this function can be finished.
 *
 * Nothing here reads the database or the provider: there is nothing to check
 * the payload's id against, so it is accepted for shape only and never acted
 * on. This still runs inside the ledger's claimed operation, the same as
 * every other action, so a replay returns the same terminal refusal instead
 * of asking the person again.
 */
async function revokeDevice() {
  return refused(MESSAGES.deviceRevocationUnavailable);
}

/** The one effect of one command, inside the operation the ledger has claimed. */
async function perform(supabase, { request, action, userId, operationId, payload, expectedRevision, currentRevision }) {
  // The precondition is checked here, not before the claim, so that a replay of
  // a lost response returns the first outcome instead of a conflict.
  if (currentRevision !== expectedRevision) throw new StaleRevisionError(currentRevision);
  if (action === 'request-recovery') {
    return requestRecovery(supabase, { request, userId, operationId, email: payload.email });
  }
  if (action === 'check-recovery') return checkRecovery(supabase, { userId, challengeId: payload.challengeId });
  if (action === 'cancel-recovery') return cancelRecovery(supabase, { userId, challengeId: payload.challengeId });
  if (action === 'revoke-device') return revokeDevice();
  return removeRecovery(supabase, { userId, methodId: payload.id });
}

/**
 * Proves migrations 0018 and 0019 are applied before anything is written,
 * scoped to the caller like every other statement here. Without it a missing
 * table or column would be discovered after the address had been linked, and
 * the 503's "nothing was changed" would be false. `intent` is named, rather
 * than only selected, for two reasons: a filter on a column that does not exist
 * is the same error as selecting one, and it keeps the rule that every statement
 * this route makes on the table is narrowed to its own intent, so none of them
 * can see or count a recovery attempt.
 */
async function requireChallengeTable(supabase, profileId) {
  const { error } = await supabase
    .from('recovery_challenges')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', profileId)
    .eq('intent', CHALLENGE_INTENT.LINK);
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
          request,
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
    if (isOperationsUnavailable(err) || isRecoveryUnavailable(err)) return operationsUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    // The detail goes to the log: a provider or database message is not for the person.
    console.error(`account command failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
