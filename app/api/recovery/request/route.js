import { NextResponse, after } from 'next/server';
import { supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody, parseText, parseUuid } from '@/lib/validate';
import { featureEnabled, featureDisabledReason } from '@/lib/features';
import { checkLimit, recoveryAddressLimiter, recoveryRequestLimiter } from '@/lib/ratelimit';
import {
  OPERATION_INPUT_MISMATCH,
  UNAUTHENTICATED_DOMAIN,
  isOperationsUnavailable,
  operationsUnavailable,
  runOperation,
} from '@/lib/operations';
import { CHALLENGE_INTENT, hashToken, isRecoveryUnavailable, linkedMethod } from '@/lib/account';

/**
 * POST /api/recovery/request
 *
 *   { email, clientNonce, operationId }  ->  RecoveryStatus
 *
 * The first step of "I have lost access to my account", and the only PUBLIC
 * route in this application: there is no session, no `Authorization` header to
 * read, and nothing in the request may act as authority over whose account is
 * touched. The address lookup is the only thing that resolves an identity, and
 * a credential that happens to be attached to the call is ignored, because the
 * frontend's runtime does not promise never to attach one to a public endpoint
 * (lib/frontend/production/runtime.ts registers all three recovery routes as
 * `public: true`, which permits a public runtime to call them rather than
 * forbidding a signed-in one).
 *
 * THE ANSWER IS ALWAYS THE SAME. One body, for every accepted request:
 *
 *   { operationId, status: 'pending', challengeId: null, expiresAt: null }
 *
 * `challengeId` is null even when a challenge was created. The plan's ruling is
 * that a row exists only for an address that resolves to a linked identity, so
 * returning the id would make a non-null field the oracle the body is otherwise
 * designed not to be: an attacker would learn from one request whether an
 * address can recover an account. Nothing is lost by withholding it, because
 * `/status` and `/complete` find the challenge from the `clientNonce`, which
 * only the browser that asked for it holds, and the client's own type permits
 * null for both fields (`validRecoveryStatus` in
 * lib/frontend/production/recovery-service.ts). It does require both KEYS to be
 * present, with a null or a usable value, which is why they are always written.
 *
 * NO TIMING FORK, and how it is actually prevented. The work that depends on
 * the address (asking the provider whether it resolves, opening a challenge,
 * having a verification sent) takes much longer than doing nothing, and no
 * amount of care over the body hides a response that arrives later for an
 * address that exists. So none of that work happens while the caller is
 * waiting: the answer does not depend on the address, so it is produced before
 * the address is looked at, and the rest runs in `after()`, once the response
 * is finished. What the caller waits for is the same statements in the same
 * order either way, rather than the same duration by luck, which is a property
 * a test can assert instead of a measurement that would flake.
 *
 * The one thing that is NOT local to this file: a deployment must actually send
 * the response before running `after` work. Next.js does (it is what `after`
 * is for, via `waitUntil` on a serverless platform), and the installed
 * documentation says so, but it is a platform promise rather than something
 * proved here.
 *
 * RATE LIMITED TWICE, on two different things, for two different reasons. Both
 * budgets are sliding windows in the shared limiter (lib/ratelimit.js), both
 * are keyed by a digest, and both fail CLOSED.
 *
 *   per address  At most a few requests an hour for one address digest. Over
 *                that, the request is accepted and silently does nothing: the
 *                answer is the same `pending` body, so being limited is not
 *                observable and cannot say anything about the address either.
 *                This is what keeps someone's inbox from being used as a
 *                weapon, and it is the bound that still holds when the client
 *                budget can be sidestepped (see the assumption below).
 *
 *                It is deliberately NOT a count of rows (Ruling 18). Any count
 *                is read before the write that would make it true, so N
 *                simultaneous requests for one address all see a count below
 *                the budget and all proceed: the bound would be concurrency,
 *                not the number. A sliding window is one atomic decision per
 *                request in Redis, so a burst spends tokens instead of racing.
 *                Counting CHALLENGE rows would be wrong for a second reason as
 *                well, which the window also avoids: the link intent deletes
 *                them when a person cancels or an address is confirmed, so an
 *                attacker whose attempts had settled would get a fresh budget
 *                (Ruling 14). Nothing anyone can delete refills this window.
 *
 *                The budget is spent inside the operation, so a replay costs
 *                nothing: replaying an id does no work, and should not be able
 *                to exhaust an address's budget by being repeated.
 *
 *                The window is self-extending: a request that is dropped still
 *                spends a token. That is the deliberate direction. Not spending
 *                one would let an attacker send the full budget of real
 *                messages every hour; spending it means a budget spent on noise
 *                buys silence instead. The cost is that someone under attack
 *                cannot recover until the attacker stops, which is true of any
 *                per-address limit, and the abuse guard proper is the human
 *                verification Task 6 adds in front of this route.
 *
 *   per client   At most a few requests an hour from one client. This one
 *                answers 429, because a client being told to slow down tells it
 *                nothing it does not already know: it is its own traffic. It is
 *                checked first, before anything is read, so a flood is shed
 *                rather than served.
 *
 *                AN ASSUMPTION, NOT A FACT (Ruling 19): there is no session
 *                here, so this rests on the client address a proxy reports, and
 *                a header is only as trustworthy as whatever sits in front of
 *                this route. `clientDigest` below prefers the headers a
 *                platform sets over the one any caller can send, and takes the
 *                hop nearest the proxy rather than the one furthest from it, so
 *                a prepended value cannot buy a fresh bucket. Whether the
 *                deployment actually overwrites or appends these headers is NOT
 *                verified here and is recorded as an open human check. If it
 *                does not, this budget is per claimed address rather than per
 *                caller, and the address budget above is what still bounds the
 *                damage. That is why the address budget is not allowed to
 *                depend on it.
 *
 * Neither limit can become an enumeration channel, because both are decided
 * before the address is looked at and neither decision depends on whether it
 * resolves. A 429 for a linked and an unlinked address is the same 429.
 *
 * WHAT A CHALLENGE ROW OF THE OTHER INTENT MEANS HERE: nothing, and that is
 * enforced rather than assumed. This route reads no challenge row at all. It
 * writes one, with `intent = 'recover'` (migration 0019), and it never reads,
 * supersedes or counts the link intent's rows, whose nonce was generated and
 * discarded by the route that wrote them and so can never match a recovering
 * browser's. Treating one as this flow's would be worse than ignoring it: a
 * person who had once linked an address would be unable to recover with it.
 *
 * ONE LIVE ROW PER BROWSER, which is the invariant tasks 7 and 8 get to rely on
 * (Ruling 20). Because the answer carries no challenge id, the nonce digest is
 * the only handle those routes have on a row. Two accepted requests reusing one
 * `clientNonce` are not replays (different operation ids) and both are within
 * the address budget, so without care they would leave two live rows sharing
 * one digest and a single-row lookup there could not resolve it. So this route
 * supersedes its own prior UNCONSUMED row for the same `(profile_id,
 * nonce_hash)` before inserting, which leaves exactly one. The invariant is
 * therefore: AT MOST ONE UNCONSUMED `recover` ROW PER (profile_id, nonce_hash),
 * INCLUDING A VERIFIED ONE. The condition is "unconsumed", not "unverified", so
 * a same-nonce re-request does delete a `verified` row whose restore token the
 * person is still holding. That is required by the invariant and is only
 * reachable by the browser that holds the nonce, but it has a consequence
 * tasks 7 and 8 must honour: "no row found" and "wrong token" have to be
 * answered identically, or the difference between them is an oracle. A
 * CONSUMED row is never touched, because `consumed_at` is the evidence that a
 * restore token was spent and single use depends on it, so a lookup there must
 * filter on `consumed_at is null` to be certain of one row. Another browser's
 * nonce, and another household's rows, are out of scope of the delete by
 * construction.
 *
 * HASHES ONLY. The address and the nonce are stored as sha256 digests, which is
 * all migration 0018's columns physically accept, and the provider's one-time
 * link and token are used and dropped: they reach no response, no row and no
 * log line (BE-201).
 *
 * AND NOTHING IS LOGGED PER REQUEST once the address is in play, in either
 * direction. Not finding an address is obviously not loggable: a line per
 * request that found nothing is a record of which addresses do not exist. The
 * inverse is just as disclosing and is the easier mistake to make: the provider
 * resolves the address before it hands anything to its mailer, so a delivery or
 * a write failure can only happen for an address that DID resolve, and a line
 * per such failure accumulates one entry per existing address and none per
 * address that does not. During a mailer outage that log IS the answer to "does
 * this address have an account", readable off the line count by anyone who can
 * tie a request id to the address it was asked about. So the delivery step logs
 * nothing at all, whatever happens, and does not branch on which error it got
 * either (which also means it does not depend on a provider error code this
 * package cannot verify). Nothing is granted on failure, so the line bought
 * little; what it cost was the property the rest of this route is built on.
 * Provider-side delivery health is the provider's own monitoring, and the
 * ledger records that the attempt existed.
 *
 * THE ONE PROVIDER CALL, and what is unverified about it.
 * `auth.admin.generateLink({ type: 'magiclink', email })` is both halves of
 * this route's provider step: it resolves the address to an existing identity,
 * and the provider's own mailer is what delivers the verification. It is the
 * only email-keyed admin call the installed client offers that cannot create an
 * identity (`inviteUserByEmail` creates one, and `listUsers` takes only a page
 * and a page size, so it cannot look an address up at all, which
 * test/recoveryCapability.test.mjs pins against the installed SDK).
 *
 * Two things about it are NOT verified here, because the local-only boundary
 * excludes a real project, and both fail in the safe direction:
 *
 *   1. Whether the installed GoTrue delivers mail for this call. If it does
 *      not, nothing arrives, the challenge expires unproved and nobody
 *      recovers anything. Recovery stays shut rather than opening wrongly.
 *   2. What it does for an address that sits on an identity unconfirmed, which
 *      is what `remove-recovery` leaves behind. A message may go to that
 *      address even though no challenge is opened for it, because the call that
 *      resolves is the call that sends. No challenge means this route grants
 *      nothing; the exposure, if the provider sends, is a provider-native
 *      sign-in link to a mailbox that had once proved itself on that identity.
 *      It is recorded in the task report as an open human check rather than
 *      hidden here.
 *
 * A challenge is opened only when the address resolves to a LINKED identity:
 * `linkedMethod` requires the provider's own confirmation, and the resolved
 * identity's confirmed address must be the one that was asked about, so neither
 * an unconfirmed address nor one the provider merely has in flight can open one.
 *
 * IDEMPOTENCY is the ledger from migration 0017 and nothing else. The row is
 * claimed before anything is scheduled, so a repeated `operationId` replays the
 * first answer and sends no second verification, concurrent duplicates
 * serialize, a dead attempt reads as `unknown`, and the same id with a
 * different address is a 409 rather than a wrong replay. The nonce is not part
 * of the fingerprint: the answer carries nothing a replay could reveal, so the
 * same id with another nonce is a replay that writes nothing, and the challenge
 * stays bound to the browser that opened it.
 *
 * OFF, AND NOT THERE YET. The capability is off unless its flag is on
 * (BE-351), and while it is off this handler reads nothing and writes nothing.
 * Until migrations 0017, 0018 and 0019 are applied the answer is a
 * non-retryable 503 `feature_unavailable`, decided before the operation id is
 * claimed and before the provider is touched, so a false `pending` is never
 * given for a request that could not be recorded (Ruling 6). Note that the
 * frontend's runtime reads any 5xx on a POST as an unknown outcome rather than
 * as "stop", so "non-retryable" is what the envelope says and not what the
 * client does; the honest 503 is still better than a `pending` that promises a
 * message nothing will send.
 */

/** The body is three fields; the largest is a 254 character address. */
const MAX_BYTES = 1024;

/** The only keys the body may carry; anything else is a client confused about this endpoint. */
const BODY_KEYS = Object.freeze(['email', 'clientNonce', 'operationId']);

/** The client's own rule (lib/frontend/account-review.ts), enforced here because the client is not authority. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX_LENGTH = 254;

/**
 * The client nonce is two concatenated UUIDs, 72 characters
 * (ProductionRestoreAccessFlow.tsx). The bounds here are deliberately wider
 * than that, because the contract fixes no format, but a nonce short enough to
 * guess is not a secret and this is the only thing that will later prove the
 * caller of `/status` is the browser that asked.
 */
const NONCE_MIN_LENGTH = 32;
const NONCE_MAX_LENGTH = 200;

/** How long a person has to prove the address, matching the link intent's window. */
const CHALLENGE_TTL_MS = 30 * 60 * 1000;

const DOMAIN = UNAUTHENTICATED_DOMAIN;
const KIND = 'recovery.request';

/** The limiter keys. The budgets themselves are the windows in lib/ratelimit.js. */
const CLIENT_KEY = 'recovery:client:';
const ADDRESS_KEY = 'recovery:address:';

/**
 * The one bucket every caller shares when no proxy reported a client address.
 * A fixed string, deliberately: anything per-request (a fresh id, say) would
 * look like a key and quietly give every such caller an unlimited budget.
 */
const UNATTRIBUTED = 'unattributed';

/**
 * Where a client address is looked for, in order, taking the first header that
 * yields a hop. What is actually known about each, rather than assumed
 * (Ruling 21):
 *
 *   x-vercel-forwarded-for  a vendor-specific name, so it is present only where
 *                           that platform puts it there. Nothing here verifies
 *                           that it does; it is first because a name no generic
 *                           proxy uses is the one a caller gains least by
 *                           sending.
 *   x-forwarded-for         a list anyone may send. Only its RIGHTMOST entry is
 *                           worth anything, because that is the one the nearest
 *                           proxy appends IF a proxy is in front. It is
 *                           consulted before x-real-ip because an append-style
 *                           front (nginx, and most non-platform fronts) puts
 *                           the real peer here and sets nothing else: ordering
 *                           x-real-ip above this hands the bucket straight back
 *                           to the caller on exactly those deployments, with
 *                           the trustworthy value sitting unread.
 *   x-real-ip               a convention some proxies set. A single value with
 *                           no hop structure, so a forged one is
 *                           indistinguishable from a real one. Last, and
 *                           reached only when no chain was forwarded at all.
 *
 * None of this is verified against the deployment. See `clientDigest`.
 */
const CLIENT_ADDRESS_HEADERS = Object.freeze(['x-vercel-forwarded-for', 'x-forwarded-for', 'x-real-ip']);

const MESSAGES = Object.freeze({
  limited: 'Too many recovery requests from this device. Please wait and try again later.',
  mismatch: 'That request was already made with different details. Please start again.',
  email: 'Enter an email address in the form name@example.com.',
  nonce: 'That request is missing the value that identifies this browser. Please start again.',
});

/** The one body an accepted request is answered with. Built here so it cannot drift per branch. */
const answer = (operationId, status) => ({ operationId, status, challengeId: null, expiresAt: null });

/** A 400 naming the field that failed, using the validator's own code and message. */
const badField = (field, result, requestId) =>
  validationError([{ field, code: result.code, message: result.message }], requestId);

/** The 503 while the capability is off or its schema is not applied. Retrying cannot help. */
function featureOff(requestId) {
  return apiError({
    status: 503,
    code: ERROR_CODES.FEATURE_UNAVAILABLE,
    message: featureDisabledReason('recovery'),
    retryable: false,
    requestId,
  });
}

/** 429 for a client asking too often. Identical whatever the address was. */
function tooManyRequests(requestId) {
  return apiError({
    status: 429,
    code: ERROR_CODES.RATE_LIMITED,
    message: MESSAGES.limited,
    requestId,
  });
}

/** 409 for an operation id reused with a different address: a client bug or an attack, never a replay. */
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

/** An address as it is compared and hashed everywhere here: trimmed and lowercased. */
const normalizeAddress = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : null);

/**
 * The address, normalized. Lowercased because the provider lowercases it too,
 * so the digest of what was typed matches the digest of what is stored, and a
 * change of case cannot open a second challenge for one address or buy a second
 * budget under the rate limit.
 */
function parseEmail(value) {
  const given = parseText(value, { maxLength: EMAIL_MAX_LENGTH, required: true, rejectControl: true });
  if (!given.ok) return given;
  const address = normalizeAddress(given.value);
  if (!EMAIL_SHAPE.test(address)) return { ok: false, code: 'invalid_email', message: MESSAGES.email };
  return { ok: true, value: address };
}

/** The browser's own nonce. Never stored or compared in the clear. */
function parseNonce(value) {
  const given = parseText(value, { maxLength: NONCE_MAX_LENGTH, required: true, rejectControl: true });
  if (!given.ok) return given;
  if (given.value.length < NONCE_MIN_LENGTH) return { ok: false, code: 'invalid_nonce', message: MESSAGES.nonce };
  return { ok: true, value: given.value };
}

/**
 * Which client this is, as a digest. There is no session to key a limit to, so
 * the only thing available is the client address a proxy reports, and it is
 * hashed because a client address is personal data and a limiter key is not the
 * place for it.
 *
 * Two rules, both because the raw header is caller-supplied text (Ruling 19):
 *
 *   1. The headers are tried in the order of `CLIENT_ADDRESS_HEADERS` above,
 *      which puts the one a caller gains least by sending first and the one a
 *      caller gains most by sending last. A single-valued header is never
 *      preferred over a forwarded chain, because a chain at least has an end a
 *      proxy appends and a single value does not (Ruling 21).
 *   2. Within whichever header is used, the hop NEAREST the proxy is taken,
 *      which is the rightmost entry. A proxy appends the peer it received the
 *      request from, so the rightmost value is the one the hop closest to us
 *      saw; the leftmost is the end furthest away and is whatever the caller
 *      chose to put there. Taking the leftmost would let a caller vary its own
 *      bucket per request and never be refused.
 *
 * This is an ASSUMPTION about the deployment, not a property of this code: if
 * nothing in front of this route rewrites or appends these headers, the budget
 * is per claimed address rather than per caller. It is not verified here. The
 * per-address budget is deliberately independent of it, so that is what still
 * bounds the damage; this one is defence in depth.
 *
 * A request with no reported address shares one bucket with every other such
 * request, which is the safe direction: a missing header must not mean an
 * unlimited caller. Locally there is usually no such header, so every local
 * caller shares a budget.
 */
function clientDigest(request) {
  for (const name of CLIENT_ADDRESS_HEADERS) {
    const hops = (request.headers.get(name) ?? '').split(',').map((hop) => hop.trim()).filter(Boolean);
    const nearest = hops[hops.length - 1];
    if (nearest) return hashToken(nearest.toLowerCase());
  }
  return UNATTRIBUTED;
}

/**
 * Proves migrations 0018 and 0019 are applied, before the operation id is
 * claimed and before the provider is touched. The only question is whether the
 * statement can run at all: naming a table that is not there, or a column that
 * is not there, is the error this is here to provoke.
 *
 * So it reads the `intent` column of at most one row and discards it. It is
 * `intent` because without that column this route cannot label its own rows,
 * and an unlabelled row is one the link intent is entitled to delete. It is
 * `limit(1)` and NOT a count, exact or otherwise: an unauthenticated caller
 * must not be able to make this route scan a table, and `intent` is in none of
 * 0018's indexes, so a filtered count on it would be a full scan per public
 * request. With no filter and one row, the statement stops at the first row it
 * finds. Nothing is read from the result, so it discloses nothing.
 */
async function requireChallengeTable(supabase) {
  const { error } = await supabase.from('recovery_challenges').select('intent').limit(1);
  if (error) throw error;
}

/**
 * Whether this address has budget left in its window. One atomic decision in
 * the limiter rather than a count of rows, for the reasons in the header
 * (Ruling 18), and fail CLOSED: if the limiter cannot answer, nothing is sent.
 */
const withinAddressBudget = (addressDigest) =>
  checkLimit(recoveryAddressLimiter, `${ADDRESS_KEY}${addressDigest}`, {
    fallback: false,
    label: 'recovery address limiter',
  });

/**
 * The work that depends on the address, run after the response is finished.
 *
 * Ask the provider for a verification, which is also how the address is
 * resolved, and open a challenge if, and only if, it resolved to an identity
 * whose own address is confirmed.
 *
 * Nothing here can reach the caller, and nothing here is logged or rethrown:
 * every failure on this path is one that can only happen for an address that
 * resolved, so a line per failure is an existence record (see the header). Each
 * one simply stops, which grants nothing and promises nothing. There is also no
 * branching on which error the provider gave, so no provider error code this
 * package cannot verify is load-bearing.
 */
async function deliver(supabase, { email, addressDigest, nonceHash }) {
  try {
    const { data, error } = await supabase.auth.admin.generateLink({ type: 'magiclink', email });
    if (error) return;

    // Resolved, but only a confirmed address of this identity's own can recover
    // it. An unconfirmed one is what `remove-recovery` leaves behind and is no
    // longer a credential; an address the provider merely has in flight has
    // never been proved by anyone.
    const user = data?.user ?? null;
    if (!linkedMethod(user) || normalizeAddress(user.email) !== email) return;

    // One live challenge per browser (Ruling 20). This browser's own earlier
    // attempt is superseded so that its nonce digest, which is the only handle
    // /status and /complete have, names exactly one unconsumed row. Scoped to
    // this identity, this intent and this digest, so another browser's attempt
    // and another household's rows are out of reach; a CONSUMED row is left
    // alone, because `consumed_at` is the evidence a restore token was spent.
    const { error: supersedeError } = await supabase
      .from('recovery_challenges')
      .delete()
      .eq('profile_id', user.id)
      .eq('intent', CHALLENGE_INTENT.RECOVER)
      .eq('nonce_hash', nonceHash)
      .is('consumed_at', null);
    // Without the delete there could be two live rows for one digest, which is
    // worse than this attempt doing nothing: the person still has the challenge
    // their first request opened.
    if (supersedeError) return;

    await supabase.from('recovery_challenges').insert({
      profile_id: user.id,
      intent: CHALLENGE_INTENT.RECOVER,
      email_hash: addressDigest,
      nonce_hash: nonceHash,
      status: 'pending',
      expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    });
  } catch {
    // A thrown provider or database failure, after the caller has already been
    // answered. Deliberately silent, for the same reason as above.
  }
}

export async function POST(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    // Off by default, and off means off: nothing is read, nothing is written,
    // and the same plain reason the account surface gives.
    if (!featureEnabled('recovery')) return featureOff(requestId);

    const body = await readJsonBody(request, { maxBytes: MAX_BYTES });
    if (!body.ok) {
      return apiError({ status: body.status, code: body.code, message: body.message, requestId });
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

    const email = parseEmail(body.value.email);
    if (!email.ok) return badField('email', email, requestId);
    const nonce = parseNonce(body.value.clientNonce);
    if (!nonce.ok) return badField('clientNonce', nonce, requestId);
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

    // Shed a flood before reading anything. Fail closed: during a limiter
    // outage this route pauses rather than becoming an open mail relay. The
    // decision is made before the address is looked at, so it cannot differ for
    // an address that exists.
    const allowed = await checkLimit(recoveryRequestLimiter, `${CLIENT_KEY}${clientDigest(request)}`, {
      fallback: false,
      label: 'recovery request limiter',
    });
    if (!allowed) return tooManyRequests(requestId);

    // Both recovery migrations are proved here, before the id is claimed, so an
    // unavailable feature has written nothing when it says so.
    await requireChallengeTable(supabaseAdmin);

    const addressDigest = hashToken(email.value);
    const outcome = await runOperation(
      supabaseAdmin,
      {
        operationId: operationId.value,
        // No owner: this runs before the caller has an identity, and `recovery`
        // is the one domain the ledger allows an unowned row in.
        profileId: null,
        domain: DOMAIN,
        kind: KIND,
        // The operation's fingerprint. Address-derived, so the same id arriving
        // with a different address is caught as a mismatch rather than
        // answered with the first address's outcome. The nonce is left out:
        // the answer carries nothing a replay could reveal, so the same id
        // with another nonce is a replay that writes nothing, and the
        // challenge stays bound to the browser that opened it.
        input: { addressDigest },
      },
      async () => {
        // Inside the operation, so a replay spends no budget and does no work.
        if (await withinAddressBudget(addressDigest)) {
          // Everything that depends on the address, after the response.
          after(() =>
            deliver(supabaseAdmin, {
              email: email.value,
              addressDigest,
              nonceHash: hashToken(nonce.value),
            }),
          );
        }
        // The same answer either way, and the receipt a replay will be given.
        return answer(operationId.value, 'pending');
      },
    );

    // A replayed operation that is still running, or that died before it
    // settled, has no receipt to replay: 'pending' or 'unknown', which this
    // client understands, and never a claim that a message was sent.
    return NextResponse.json(outcome.result ?? answer(operationId.value, outcome.status), { headers });
  } catch (err) {
    if (err?.message === OPERATION_INPUT_MISMATCH) return operationMismatch(requestId);
    if (isOperationsUnavailable(err) || isRecoveryUnavailable(err)) return operationsUnavailable(requestId);
    // The detail goes to the log, and only as much of it as cannot carry an
    // address: a database or provider message can quote the value it refused.
    console.error(`recovery request failed (request ${requestId}): ${err?.code ?? err?.name ?? 'Error'}`);
    return internalError(requestId);
  }
}
