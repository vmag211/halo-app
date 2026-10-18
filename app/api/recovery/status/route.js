import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody, parseText, parseUuid, parseEnum } from '@/lib/validate';
import { featureEnabled } from '@/lib/features';
import { checkLimit, recoveryRequestLimiter } from '@/lib/ratelimit';
import { UNAUTHENTICATED_DOMAIN, isOperationsUnavailable, readOperation } from '@/lib/operations';
import { isRecoveryUnavailable } from '@/lib/account';
import {
  clientDigest,
  deriveRestoreToken,
  findRecoverChallenge,
  challengeStatus,
  nonceDigest,
  recoveryStatus,
  restoreTokenKey,
} from '@/lib/recovery';

/**
 * POST /api/recovery/status
 *
 *   { challengeId, clientNonce, operationId, requestOperationId, scope }
 *     ->  RecoveryStatus
 *
 * The polling and reconciliation step of "I have lost access to my account",
 * and PUBLIC like the other two: no session, no `Authorization` header, and
 * nothing in the request acts as authority over whose account is reported on.
 * The raw `clientNonce` is the only thing that resolves a challenge, and a
 * credential that happens to be attached to the call is ignored, because the
 * frontend's runtime registers all three recovery routes as `public: true`,
 * which PERMITS a public runtime to call them rather than forbidding a
 * signed-in one.
 *
 * READ THIS FIRST, BECAUSE IT IS THE WHOLE TRUTH ABOUT THE FEATURE: NOTHING IN
 * THIS SYSTEM CURRENTLY PRODUCES A VERIFIED RECOVER ROW, SO RECOVERY CANNOT
 * COMPLETE END TO END TODAY. POST /api/recovery/request writes a `pending` row
 * and asks the provider to send a magic link with no redirect target, so
 * clicking that link signs the person in on the clicking device through
 * Supabase's own flow and HALO never learns it happened. No route in this
 * application sets `status = 'verified'` or writes a `restore_token_hash` on a
 * `recover` row, and no task in the B02 plan builds one: the verification step
 * is unassigned, not merely unbuilt. This route reports a verified row
 * faithfully if one exists, which is why its verified branch is tested against
 * a seeded row, and that is the only way such a row can exist right now. This
 * paragraph is a statement about today, not a promise about tomorrow.
 *
 * THIS ROUTE IS THE DELIBERATE EXCEPTION TO THE 503 CONVENTION (Ruling 6).
 * `/request` and `/complete` answer a non-retryable 503 `feature_unavailable`
 * when the capability is off or the schema is missing, and that convention
 * stands for them. It must NOT stand here. The frontend's runtime maps ANY 5xx
 * on a POST to `unknown_outcome` (runtime.ts:143), and all three recovery
 * routes are POST, so a 5xx parks the operation and offers the person "check
 * earlier recovery request", which lands on this route. A 503 here is therefore
 * a loop with no exit: the button offered to escape an unknown outcome produces
 * another unknown outcome, forever.
 *
 * So when the capability is off, the derivation key is absent, or migrations
 * 0018 or 0019 are not applied, this route answers HTTP 200 with a
 * contract-valid TERMINAL `failed` and a `reason`. That is honest rather than a
 * fudge: with no table, no key and no capability, no challenge can ever have
 * been created or redeemed, so "this definitively did not happen" is a true
 * statement, and it hands the client's reconciliation path a terminal answer
 * instead of a dead end. The cost, named rather than hidden: a 200 hides a
 * capability outage from HTTP-level monitoring, which is why the unavailable
 * case is the one thing this route logs.
 *
 * ONE REASON FOR ALL THREE CAUSES, and the log line is where they are told
 * apart. The body says `recovery_unavailable` whether the flag is off, the key
 * is missing or the migration is not applied, because an unauthenticated
 * stranger must not be able to read which piece of our configuration is absent
 * off a refusal, which is the same choice `/request` makes between its flag and
 * its verification secret. The server-side line names the cause, so an operator
 * can tell them apart and a stranger cannot.
 *
 * THE DERIVATION KEY IS PART OF THE CAPABILITY, NOT AN EXTRA ON TOP OF IT
 * (Ruling 28). Without `HALO_RECOVERY_TOKEN_KEY` no restore token can be
 * derived, so a verified challenge could never be reported in a form the client
 * can act on, and the honest answer is the unavailable one rather than a
 * `verified` body with nothing in it. Nothing is derived from a default or an
 * empty secret. The Turnstile secret is deliberately NOT required here:
 * `/status` sends no message and spends nothing at a provider, so there is
 * nothing for a human check to guard, and requiring it would shut the
 * reconciliation path in exactly the deployments where `/request` is already
 * shut, which is the dead end Ruling 6 exists to prevent.
 *
 * THE ECHOED `operationId` IS THE STATUS CALL'S OWN, NEVER `requestOperationId`
 * (Ruling 7), and this is the trap that breaks everything silently. On an
 * ordinary poll the two are deliberately DIFFERENT values: `operationId` is a
 * brand-new uuid the client minted for this one status call and also sent as
 * its `Idempotency-Key`, while `requestOperationId` is the id of the earlier
 * operation being asked about. `validRecoveryStatus(value, operationId)`
 * compares the echoed id against the id the client just sent, so echoing
 * `requestOperationId` makes the client discard every single response while
 * this server looks perfectly healthy in its own logs.
 *
 * A STATUS READ CREATES AND MUTATES NOTHING. No challenge is written,
 * superseded or marked verified, no restore token is minted into a row, and no
 * operation id of this route's own is claimed: it calls `readOperation` and
 * never `runOperation`. That is not an optimisation, it is the contract. A poll
 * is a question, and a question that changes the thing it asks about cannot be
 * repeated safely, which is exactly what reconciliation does. It also means
 * this route needs no idempotency of its own: reading twice gives the same
 * answer because nothing moved.
 *
 * 'unknown' IS RETURNED BUT NEVER WRITTEN (Ruling 9). 0018's CHECK permits five
 * statuses and `unknown` is not one of them, deliberately. This route
 * manufactures it when it cannot truthfully say more, and since it writes
 * nothing at all, it cannot store one even by mistake.
 *
 * THE CHALLENGE IS FOUND BY THE NONCE DIGEST, NEVER BY `challengeId`
 * (Ruling 16). `/request` returns `challengeId: null` for a linked and an
 * unlinked address alike, so the client has no real id to send; the field is
 * accepted, shape-checked and then IGNORED. Trusting it would hand an attacker
 * a lookup key they can guess at, which is precisely the oracle `/request`
 * gives up a useful field to avoid. The nonce is the credential: it never left
 * the browser that created the challenge.
 *
 * "NO ROW" AND "WRONG NONCE" ARE ONE ANSWER, BY CONSTRUCTION (Ruling 23). They
 * are not two branches that happen to agree; the lookup is keyed by the nonce
 * digest, so a wrong nonce IS no row and there is no second path for the two to
 * drift apart on. This matters because `/request`'s supersede matches on
 * unconsumed rather than unverified, so a same-nonce re-request can delete a
 * verified row whose token the person still holds: a caller can legitimately
 * hold a good token for a row that is gone. If the two answers differed, the
 * difference would tell an attacker whether a challenge exists.
 *
 * NOTHING ABOUT WHETHER AN ADDRESS EXISTS IS OBSERVABLE, including in the
 * not-found answer. This route never looks at an address at all: it takes no
 * `email` field, computes no address digest, and asks the provider nothing.
 * Every answer it gives is a fact about a nonce the caller already holds, so
 * there is no address for an answer to be about.
 *
 * THE THREE SCOPES, and the one rule that orders them. The challenge row is the
 * canonical state of a recovery attempt whenever one exists, because it is the
 * live record and a ledger receipt is a snapshot of a moment that has passed.
 * The ledger answers only when there is no live row to read:
 *
 *   challenge  A plain poll. "What is my challenge doing?" The ledger is not
 *              consulted at all, because no earlier operation is in question.
 *   request    Reconciling a `/request` whose response was lost. If no live
 *              challenge is found, the ledger is asked what that operation did.
 *   complete   Reconciling a `/complete` whose response was lost. Same path.
 *              A successful `/complete` consumes its row, so the live lookup
 *              finds nothing and the ledger is what answers, which is the case
 *              this fallback mainly exists for.
 *
 * A REPLAYED RECEIPT NEVER CARRIES A SESSION (Ruling 8). When the ledger
 * answers, this route reports the receipt's STATUS and reissues a derived
 * restore token for it; it does not forward a stored `session` object, because
 * minting a session is `/complete`'s to do and a `verified` response carrying
 * only a session leaves the UI's "Restore my account" button enabled and inert.
 * The person clicks it, `/complete` replays its own ledger receipt, and the
 * session arrives from the route that owns it.
 *
 * RATE LIMITED PER CLIENT, AND FAILING OPEN, WHICH IS THE OPPOSITE OF
 * `/request`. Both use the same sliding window from lib/ratelimit.js and the
 * same digest of the hop nearest the proxy, under a different key prefix so
 * each route has its own budget. The FALLBACK is where they deliberately
 * disagree, and a reviewer who sees two limiters with opposite fallbacks should
 * find the reason right here:
 *
 *   /request fails CLOSED because it can cause mail to be sent to an address a
 *   stranger typed, so during a limiter outage pausing is better than becoming
 *   an open mail relay.
 *
 *   /status fails OPEN because it writes nothing, sends nothing and spends
 *   nothing at a provider, so the whole cost of an outage-time flood is
 *   database reads. Failing closed would instead make the reconciliation path
 *   unanswerable for as long as Redis is down, which is the dead-end loop
 *   Ruling 6 exists to prevent. Availability is the safety property on this
 *   route; it is the hazard on the other one.
 *
 * NOTHING PROOF-BEARING LEAVES THE SERVER OTHER THAN THE RESTORE TOKEN ITSELF,
 * which necessarily crosses the wire once to the legitimate caller because the
 * client must resend it to `/complete`. The nonce, its digest, the derivation
 * key and every row value other than the challenge id and its expiry reach no
 * response and no log line (BE-201).
 */

/**
 * The body is five fields, all small: two uuids, a nonce bounded below, a
 * challenge id the contract caps at 500 characters, and a scope word.
 */
const MAX_BYTES = 4096;

/** The only keys the body may carry; anything else is a client confused about this endpoint. */
const BODY_KEYS = Object.freeze(['challengeId', 'clientNonce', 'operationId', 'requestOperationId', 'scope']);

/** The three the client can send (ProductionRestoreAccessFlow.tsx:46). */
const SCOPES = Object.freeze(['challenge', 'request', 'complete']);

/** The scopes that are reconciling an earlier operation rather than polling a challenge. */
const RECONCILING = new Set(['request', 'complete']);

/**
 * The nonce bounds, transcribed from `/request` so one route cannot accept what
 * the other refused. The real nonce is 72 characters; these are wider, because
 * the contract fixes no format, but a nonce short enough to guess is not a
 * secret and it is the only thing proving this caller opened the challenge.
 */
const NONCE_MIN_LENGTH = 32;
const NONCE_MAX_LENGTH = 200;

/** The contract's own cap on `challengeId` (recovery-service.ts). */
const CHALLENGE_ID_MAX_LENGTH = 500;

const DOMAIN = UNAUTHENTICATED_DOMAIN;

/** This route's own budget, separate from `/request`'s under the same window. */
const CLIENT_KEY = 'recovery:status:';

/**
 * The one reason an unavailable answer carries, whichever piece of the
 * capability is missing. A stranger must not be able to read our configuration
 * off it; the log line below is where the three are told apart.
 */
const UNAVAILABLE_REASON = 'recovery_unavailable';

/** Why the capability was unavailable, for the server-side line only. */
const CAUSE = Object.freeze({
  FLAG: 'capability flag off',
  KEY: 'no derivation key',
  SCHEMA: 'recovery schema not applied',
});

const MESSAGES = Object.freeze({
  limited: 'Too many status checks from this device. Please wait and try again later.',
  nonce: 'That request is missing the value that identifies this browser. Please start again.',
  challengeId: 'That challenge reference is not valid. Please start again.',
});

/** A 400 naming the field that failed, using the validator's own code and message. */
const badField = (field, result, requestId) =>
  validationError([{ field, code: result.code, message: result.message }], requestId);

/** 429 for a client polling too often. It says nothing it does not already know about itself. */
function tooManyRequests(requestId) {
  return apiError({
    status: 429,
    code: ERROR_CODES.RATE_LIMITED,
    message: MESSAGES.limited,
    requestId,
  });
}

/** The browser's own nonce. Never stored or compared in the clear. */
function parseNonce(value) {
  const given = parseText(value, { maxLength: NONCE_MAX_LENGTH, required: true, rejectControl: true });
  if (!given.ok) return given;
  if (given.value.length < NONCE_MIN_LENGTH) return { ok: false, code: 'invalid_nonce', message: MESSAGES.nonce };
  return { ok: true, value: given.value };
}

/**
 * An id the client left out: absent, null, or the empty string the component
 * sends when its own ref has been cleared. Treated as "not sent" rather than as
 * a malformed id, so a half-reset client still gets an answer instead of a 400.
 */
const absent = (value) => value === undefined || value === null || value === '';

/**
 * The client-supplied `challengeId`, shape-checked and then DISCARDED. It is
 * never a lookup key (Ruling 16); this exists only so a client sending
 * something structurally wrong is told, rather than having it silently ignored.
 */
function checkChallengeId(value) {
  if (absent(value)) return { ok: true };
  if (typeof value === 'string' && value.length <= CHALLENGE_ID_MAX_LENGTH) return { ok: true };
  return { ok: false, code: 'invalid_challenge_id', message: MESSAGES.challengeId };
}

/**
 * Proves migrations 0018 and 0019 are applied. The only question is whether the
 * statement can run at all: naming a table that is not there, or a column that
 * is not there, is the error this is here to provoke. It is `intent` because
 * without that column a `recover` row cannot be told from a `link` one, and
 * `limit(1)` and not a count, because an unauthenticated caller must not be
 * able to make this route scan a table. Nothing is read from the result.
 */
async function requireChallengeTable(supabase) {
  const { error } = await supabase.from('recovery_challenges').select('intent').limit(1);
  if (error) throw error;
}

/**
 * The answer for a capability that is not available, which is a 200 and never a
 * 503 on this route (Ruling 6). Logged, because a 200 is invisible to
 * HTTP-level monitoring and an outage that nothing records is an outage nobody
 * fixes. The line carries the request id and the cause and nothing else: no
 * nonce, no digest, no challenge id.
 */
function unavailable(operationId, cause, requestId) {
  console.error(`recovery status unavailable (request ${requestId}): ${cause}`);
  return recoveryStatus({ operationId, status: 'failed', reason: UNAVAILABLE_REASON });
}

/**
 * What a stored ledger receipt means here. `/request` and `/complete` both
 * store a `RecoveryStatus` as their receipt, so the status is read straight off
 * it; everything else is rebuilt rather than forwarded.
 *
 * A `verified` receipt is reissued with a token derived from the receipt's own
 * challenge id, so the person can finish through `/complete`, which replays its
 * own receipt and returns the session. A receipt with no usable challenge id
 * cannot produce a token, and `recoveryStatus` reports that as `unknown` rather
 * than as a `verified` body the client would discard.
 *
 * A `session` on the receipt is never forwarded (Ruling 8).
 */
function fromReceipt(receipt, { operationId, key, nonceHash }) {
  const status = receipt?.status;
  const challengeId = receipt?.challengeId ?? null;
  return recoveryStatus({
    operationId,
    status,
    challengeId,
    expiresAt: receipt?.expiresAt ?? null,
    restoreToken: status === 'verified' ? deriveRestoreToken(key, { challengeId, nonceHash }) : null,
  });
}

/**
 * The canonical outcome of the operation the client named, when no live
 * challenge was found. Read only: `readOperation`, never `runOperation`, so
 * this route claims no id of its own.
 *
 *   a stored receipt     report it (above)
 *   still pending        the operation is in flight, so `pending` is true
 *   failed or cancelled  a settled failure, reported as `failed`
 *   anything else        `unknown`: settled but with no receipt to replay, or
 *                        dead past its window. 'unknown' is exactly the word
 *                        for "cannot truthfully say more" (Ruling 9).
 *   no row at all        `failed`, the same terminal answer as no challenge
 */
async function fromLedger(supabase, { operationId, requestOperationId, key, nonceHash }) {
  const prior = await readOperation(supabase, { operationId: requestOperationId, domain: DOMAIN });
  if (!prior) return recoveryStatus({ operationId, status: 'failed' });
  if (prior.result) return fromReceipt(prior.result, { operationId, key, nonceHash });
  if (prior.status === 'pending') return recoveryStatus({ operationId, status: 'pending' });
  if (prior.status === 'failed' || prior.status === 'cancelled') {
    return recoveryStatus({ operationId, status: 'failed' });
  }
  return recoveryStatus({ operationId, status: 'unknown' });
}

export async function POST(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  // Hoisted, because the unavailable answer the catch builds has to echo the
  // id too: a RecoveryStatus whose `operationId` is wrong is one the client
  // throws away, and an answer it throws away is the dead end Ruling 6 is
  // about. It is null only before the body has been parsed, and nothing after
  // that point can be reached without it.
  let operationId = null;
  try {
    const body = await readJsonBody(request, { maxBytes: MAX_BYTES });
    if (!body.ok) {
      return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    }

    const unknownKeys = Object.keys(body.value).filter((key) => !BODY_KEYS.includes(key)).sort();
    if (unknownKeys.length > 0) {
      return validationError(
        unknownKeys.map((key) => ({
          field: key,
          code: 'unknown_field',
          message: `Only ${BODY_KEYS.join(', ')} can be sent.`,
        })),
        requestId,
      );
    }

    // The operation id is parsed before anything else is decided, because every
    // answer this route can give has to echo it, including the unavailable one.
    const operation = parseUuid(body.value.operationId);
    if (!operation.ok) return badField('operationId', operation, requestId);
    operationId = operation.value;

    const idempotencyKey = request.headers.get('idempotency-key');
    if (idempotencyKey !== null && idempotencyKey.trim().toLowerCase() !== operationId) {
      return validationError(
        [{
          field: 'operationId',
          code: 'idempotency_key_mismatch',
          message: 'The Idempotency-Key header and the operationId must be the same id.',
        }],
        requestId,
      );
    }

    const nonce = parseNonce(body.value.clientNonce);
    if (!nonce.ok) return badField('clientNonce', nonce, requestId);

    const scope = parseEnum(body.value.scope, SCOPES);
    if (!scope.ok) return badField('scope', scope, requestId);

    const challengeRef = checkChallengeId(body.value.challengeId);
    if (!challengeRef.ok) return badField('challengeId', challengeRef, requestId);

    // Accepted in every scope, required by neither parser unless it is there:
    // the component sends the empty string when its own ref has been cleared,
    // and refusing that would dead-end a client that is only half reset.
    let requestOperationId = null;
    if (!absent(body.value.requestOperationId)) {
      const prior = parseUuid(body.value.requestOperationId);
      if (!prior.ok) return badField('requestOperationId', prior, requestId);
      requestOperationId = prior.value;
    }

    // Shed a flood before reading anything, and FAIL OPEN: this route writes
    // nothing and sends nothing, so an outage-time flood costs reads, while
    // refusing during one would close the only path out of an unknown outcome.
    const allowed = await checkLimit(recoveryRequestLimiter, `${CLIENT_KEY}${clientDigest(request)}`, {
      fallback: true,
      label: 'recovery status limiter',
    });
    if (!allowed) return tooManyRequests(requestId);

    // Off means off, and on this route "off" is a terminal 200 (Ruling 6).
    if (!featureEnabled('recovery')) {
      return NextResponse.json(unavailable(operationId, CAUSE.FLAG, requestId), { headers });
    }
    const key = restoreTokenKey();
    if (!key) {
      return NextResponse.json(unavailable(operationId, CAUSE.KEY, requestId), { headers });
    }

    // Both recovery migrations are proved before anything is read, so a missing
    // one is the unavailable answer rather than a false `failed` that would
    // claim a challenge definitively does not exist.
    await requireChallengeTable(supabaseAdmin);

    const nonceHash = nonceDigest(nonce.value);
    const row = await findRecoverChallenge(supabaseAdmin, { nonceHash });

    // The live challenge is the canonical state whenever there is one.
    if (row) {
      const status = challengeStatus(row);
      return NextResponse.json(
        recoveryStatus({
          operationId,
          status,
          challengeId: row.id,
          expiresAt: row.expires_at,
          restoreToken: status === 'verified' ? deriveRestoreToken(key, { challengeId: row.id, nonceHash }) : null,
        }),
        { headers },
      );
    }

    // No live row. Only a reconciling scope has an earlier operation to ask
    // about; a plain poll has nothing further to say.
    if (RECONCILING.has(scope.value) && requestOperationId) {
      return NextResponse.json(
        await fromLedger(supabaseAdmin, { operationId, requestOperationId, key, nonceHash }),
        { headers },
      );
    }

    // No row, and nothing to reconcile. This is also the answer for a nonce
    // that is not this row's, by construction rather than by agreement
    // (Ruling 23).
    return NextResponse.json(recoveryStatus({ operationId, status: 'failed' }), { headers });
  } catch (err) {
    // A missing table or column is the capability not being there, which on
    // this route is the terminal 200 and never a 503. Only reachable once the
    // id has been parsed, because nothing before that touches the database.
    if (operationId && (isOperationsUnavailable(err) || isRecoveryUnavailable(err))) {
      return NextResponse.json(unavailable(operationId, CAUSE.SCHEMA, requestId), { headers });
    }
    console.error(`recovery status failed (request ${requestId}): ${err?.code ?? err?.name ?? 'Error'}`);
    return internalError(requestId);
  }
}
