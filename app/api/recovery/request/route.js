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
  readOperation,
  runOperation,
} from '@/lib/operations';
import { CHALLENGE_INTENT, hashToken, isRecoveryUnavailable, linkedMethod } from '@/lib/account';
import { clientDigest } from '@/lib/recovery';

/**
 * POST /api/recovery/request
 *
 *   { email, clientNonce, operationId, captchaToken }  ->  RecoveryStatus
 *
 * READ THIS BEFORE WIRING THE CLIENT: `captchaToken` is NOT in the frontend
 * contract. See HUMAN VERIFICATION below. Nothing sends it yet, so with the
 * verification secret configured every request from today's client is refused,
 * which is why the capability flag stays off until the contract is closed.
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
 * HUMAN VERIFICATION, WHICH RUNS BEFORE THE ADDRESS IS TOUCHED (BE-340). This
 * route asks a provider to send a message to an address a stranger typed, so
 * the limiters below are a bound on abuse and not a guard against it. The guard
 * is a Cloudflare Turnstile token, verified server side against the provider's
 * siteverify endpoint. Three situations, which must not collapse into each
 * other:
 *
 *   1 CONFIGURED AND THE TOKEN VERIFIES. The request proceeds exactly as the
 *     rest of this file describes.
 *
 *   2 CONFIGURED AND THE TOKEN IS MISSING, UNUSABLE, ALREADY SPENT OR REJECTED,
 *     OR THE PROVIDER CANNOT BE ASKED. A 400 carrying a `reason`, and nothing
 *     else happens: no id is claimed, no row is written, no message is sent, and
 *     the address budget is not even consulted, so a refusal cannot be counted
 *     against an address either. Three reasons, naming three different facts:
 *
 *       verification_required     this route can see for itself that no usable
 *                                 token arrived (absent, not a string, empty,
 *                                 carrying control characters, or past the
 *                                 abuse bound below).
 *       verification_failed       the provider was asked and refused the token.
 *                                 The only reason that is about the person.
 *       verification_unavailable  the provider could not be asked, or answered
 *                                 something unreadable: a dead network, an
 *                                 abort at the timeout, a non-2xx, a body that
 *                                 is not the JSON object this expects. A fact
 *                                 about US, not about the person, and
 *                                 deliberately not collapsed into the one above
 *                                 (Ruling 24): recovery is the one route a
 *                                 locked-out person has, and telling everyone
 *                                 during a siteverify outage that their own
 *                                 check failed sends them round a retry loop
 *                                 that cannot succeed.
 *
 *     All three are distinguishable, so a client can tell a person whose widget
 *     never loaded from one whose answer was refused from one for whom nothing
 *     is working. All three are byte-identical for an address that resolves and
 *     one that does not, because a reason is a fact about the token or about the
 *     provider and never about the address.
 *
 *   3 NOT CONFIGURED. The route is SHUT: the same non-retryable 503
 *     `feature_unavailable`, in the same words, as the capability being off,
 *     decided before the body is read. A capability that skips human
 *     verification because a key is absent is exactly the failure BE-340 names,
 *     so the flag and the key compose as AND, never as "the flag is on, so the
 *     missing key is waived". Turning the flag on in an environment with no
 *     secret does not open this route; it leaves it shut. The 503 is identical
 *     to the flag's so that an unauthenticated stranger cannot read which piece
 *     of our configuration is missing off the refusal.
 *
 * HOW THE TOKEN ARRIVES, AND THE CONTRACT GAP. The frontend's request body for
 * `recovery.request` is `{ email, clientNonce, operationId }` and nothing else
 * (ProductionRestoreAccessFlow.tsx:46, pinned in
 * .superpowers/sdd/b02-identity-linking-and-recovery/recovery-contract-digest.md
 * section 1). There is no field for a human-verification token, so the two
 * readings were: a new BODY field, or a request HEADER alongside
 * `Idempotency-Key`. This route implements the body field `captchaToken`,
 * because the component assembles its per-route body in one place while the
 * runtime assembles headers generically for every endpoint, and because the
 * body here is validated as a CLOSED set of keys: a token sent under a
 * near-miss name is a 400, where a mistyped header name would be silently
 * ignored, which is the silent bypass this requirement is about. The name
 * follows the one this repo already uses for a Turnstile token on the client
 * (`getCaptchaToken` in lib/auth.js, passed to the provider as `captchaToken`).
 * THIS IS A SERVER-SIDE CHOICE, NOT A CONTRACT: the frontend does not send the
 * field, and until it does, a configured deployment refuses every request from
 * it. Closing that gap is a frontend change plus this name being agreed.
 *
 * WHAT A PERSON WHO CANNOT COMPLETE THE CHALLENGE CAN DO TODAY, stated plainly
 * because the honest answer is short: nothing through this route. The refusal
 * names a machine-readable reason so a client can offer a route forward instead
 * of a dead end, and no response here promises help that does not exist. But
 * there is no human-operated recovery path behind it yet: no support queue, no
 * identity-proofing procedure, no operator tool, and no owner. For BE-340's
 * "supported recovery path" to be real, three things are missing, none of them
 * in this file: a client that renders the widget and reads the reason, a
 * documented human-operated route with a standard of proof, and someone to run
 * it. The capability flag staying off is what keeps that from being a live dead
 * end in the meantime.
 *
 * A REPLAY ASKS FOR NO SECOND PROOF, and that is deliberate. A token is single
 * use at the provider, and the client reuses one `operationId` and one solved
 * widget for a retried request, so a second verification of the same token
 * would refuse the honest retry. So the ledger is asked first, keyed on the
 * client's own id and nothing else: an operation with a RECORDED OUTCOME skips
 * verification, because replaying it does no work, sends nothing and writes
 * nothing, and the answer it replays carries nothing a stranger could learn
 * from. An operation that has NOT settled (in flight, or dead and reported as
 * unknown) has no outcome to replay, so it still needs a token that verifies.
 * A consequence worth knowing: if an attempt dies before settling, that flow's
 * token is already spent, so retrying it is refused until the person starts
 * again with a fresh id and a fresh challenge, which is what the client's own
 * `restart()` does. The token is also NOT part of the operation's fingerprint,
 * for the same reason the nonce is not: a re-solved widget on the same id is a
 * replay, not a 409.
 *
 * AND THE VERIFICATION FAILS CLOSED. An unreachable provider, a non-2xx answer,
 * an unparseable one, or anything other than an explicit `success: true` is a
 * refusal. Nothing on this path is logged at all, in either direction: this
 * route keeps no per-request line (see further down), and a line per refused
 * verification would be the first one. So the SERVER-SIDE signal of a verifier
 * outage is still the provider's own dashboard and the platform's egress
 * metrics, and what this route adds is only that the person, and therefore the
 * client, is told which of the three facts it was. That is a real residual: if
 * an outage has to be visible here, the smallest honest addition is a line
 * carrying the request id and the reason and nothing else, weighed against the
 * no-per-request-line invariant rather than added casually. The token, the
 * client address and the provider's answer reach no log line, no row and no
 * response, and the client address is not sent to the provider either
 * (`remoteip` is optional, the header it would come from is not trustworthy
 * here, and a client address is personal data with no reason to reach a third
 * party).
 *
 * WHAT IS NOT VERIFIED ABOUT ANY OF IT. There is no site key and no secret key
 * in any environment, so the live exchange has never run: this code is tested
 * against a fake verifier only. The endpoint, the field names (`secret`,
 * `response`, `idempotency_key`), the form encoding and the
 * single-use-with-an-idempotency-key behaviour are all from the provider's
 * documentation and are unverified here. Nothing branches on the provider's own
 * `error-codes`, so no documented code is load-bearing, and every unverified
 * assumption fails in the direction of refusing rather than passing, AFTER a
 * call the provider logs. That last clause is why the token size it documents
 * is deliberately NOT enforced here: a local length limit is the only one of
 * these that would refuse without a round trip, leaving nothing on the
 * provider's side to see. See `TOKEN_CEILING`. Acceptance of BE-340 is blocked
 * on the keys existing.
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
 *                verification above, which an attacker has to pass per request
 *                before any of this is reached.
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
 * (BE-351) AND a verification secret is configured, and while either is missing
 * this handler reads nothing and writes nothing.
 * Until migrations 0017, 0018 and 0019 are applied the answer is a
 * non-retryable 503 `feature_unavailable`, decided before the operation id is
 * claimed and before the provider is touched, so a false `pending` is never
 * given for a request that could not be recorded (Ruling 6). Note that the
 * frontend's runtime reads any 5xx on a POST as an unknown outcome rather than
 * as "stop", so "non-retryable" is what the envelope says and not what the
 * client does; the honest 503 is still better than a `pending` that promises a
 * message nothing will send.
 */

/**
 * Where the human-verification token arrives. NOT a field the frontend sends
 * today: see HUMAN VERIFICATION in the header for the choice and the gap.
 */
const TOKEN_FIELD = 'captchaToken';

/**
 * An ABUSE BOUND on the token, deliberately loose, and NOT a transcription of
 * the size the provider documents (2048 characters at the time of writing).
 *
 * The looseness is the point (Ruling 25). Every other assumption this route
 * makes about the provider fails only AFTER a call the provider logs, so a
 * wrong one shows up in its dashboard, which is the only place a verification
 * problem here becomes visible. A tight length limit is the one assumption that
 * fails with NO round trip: a correctly working widget whose token had grown
 * would be refused locally, the person would be told to complete a check they
 * had already completed, and nothing at all would appear on the provider's
 * side. So the provider is the judge of what its own token looks like, and this
 * number exists only to stop an unauthenticated caller shipping a megabyte of
 * text through `fetch`. It is far enough above the documented size to absorb a
 * change in it.
 */
const TOKEN_CEILING = 8192;

/**
 * The body is four fields; the largest are a 254 character address and the
 * token. Sized from `TOKEN_CEILING` so the byte cap can never be what refuses a
 * token the ceiling allows: a 413 before the token is read would put the local
 * refusal back, by another door.
 */
const MAX_BYTES = 1024 + TOKEN_CEILING;

/** The only keys the body may carry; anything else is a client confused about this endpoint. */
const BODY_KEYS = Object.freeze(['email', 'clientNonce', 'operationId', TOKEN_FIELD]);

/** The provider's verification endpoint. The secret goes here and nowhere else. */
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * A verification that cannot answer in this long did not happen. An
 * unauthenticated caller must not be able to hold this handler open for as long
 * as the platform allows, and a stalled provider has to become a refusal.
 */
const VERIFY_TIMEOUT_MS = 8000;

/**
 * The three verification refusals, which a client must be able to tell apart,
 * and the one verdict that is not a refusal. Each names a different fact:
 * nothing usable arrived, the provider refused what did, or the provider could
 * not be asked at all. The third is a fact about US and never about the person
 * (Ruling 24).
 */
const VERIFICATION_REQUIRED = 'verification_required';
const VERIFICATION_FAILED = 'verification_failed';
const VERIFICATION_UNAVAILABLE = 'verification_unavailable';
const VERIFIED = 'verified';

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
 * Which headers a client address is looked for in, and why that order
 * (Ruling 21), now lives with `clientDigest` in lib/recovery.js, because
 * POST /api/recovery/status needs exactly the same rule and a second copy of
 * it is a second thing to get wrong. The reasoning is quoted there in full:
 * the platform-specific name first, then the RIGHTMOST hop of
 * x-forwarded-for, and x-real-ip only when no chain was forwarded at all.
 */

const MESSAGES = Object.freeze({
  limited: 'Too many recovery requests from this device. Please wait and try again later.',
  mismatch: 'That request was already made with different details. Please start again.',
  email: 'Enter an email address in the form name@example.com.',
  nonce: 'That request is missing the value that identifies this browser. Please start again.',
  // None of these offers help that does not exist (BE-340), and the third does
  // not blame the person for something that is ours: telling someone their own
  // check failed, on the one route a locked-out person has, during an outage
  // they cannot do anything about, sends them round a loop that cannot succeed.
  [VERIFICATION_REQUIRED]: 'Complete the verification check, then try again.',
  [VERIFICATION_FAILED]: 'That verification could not be confirmed. Please try the check again.',
  [VERIFICATION_UNAVAILABLE]:
    'Verification is unavailable right now, which is not a problem with your answer. Please try again in a few minutes.',
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

/**
 * The 400 for a request with no usable proof that a person made it. One
 * builder for every reason, so they cannot drift apart per branch, and so none
 * can ever carry anything derived from the address: a reason is a fact about
 * the token, or about the provider, and never about the person or the address,
 * which is what makes every one of these refusals byte-identical for an
 * address that resolves and one that does not.
 */
function verificationRefused(reason, requestId) {
  return apiError({
    status: 400,
    code: ERROR_CODES.VALIDATION_FAILED,
    message: MESSAGES[reason],
    fieldErrors: [{ field: TOKEN_FIELD, code: reason, message: MESSAGES[reason] }],
    retryable: false,
    requestId,
    extra: { reason },
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
 * The configured verification secret, or null. Server side only, and never a
 * `NEXT_PUBLIC_` variable: the site key is the public half and lives in
 * lib/auth.js, this is the half that must never reach a browser. Whitespace is
 * not a secret, so a variable set to nothing leaves the route shut.
 */
function verificationSecret() {
  const value = process.env.TURNSTILE_SECRET_KEY;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * The token as it arrived, or null when there is nothing worth asking the
 * provider about. These are the only checks made here, deliberately: present, a
 * string, not empty, one line, and under the abuse bound above. No character
 * class is guessed at and no size the provider documents is enforced, because
 * whether a token is REAL, or even well formed, is the provider's answer and
 * not a shape this route can know.
 */
function parseToken(value) {
  const given = parseText(value, { maxLength: TOKEN_CEILING, required: true, rejectControl: true });
  return given.ok ? given.value : null;
}

/**
 * What the provider said about this token: `VERIFIED`, `VERIFICATION_FAILED` or
 * `VERIFICATION_UNAVAILABLE`. Only the first lets a request through, so every
 * path still fails CLOSED, the same direction both limiters take, because the
 * alternative is an open mail relay during an outage.
 *
 * The three are kept apart because only ONE of them is about the token
 * (Ruling 24). An explicit `success: false` is the provider refusing what the
 * person sent. Everything else is the provider not answering at all: a dead
 * network, an abort, a non-2xx, a body that is not JSON, a body that is not an
 * object, or one with no readable `success`. Those say nothing about the person,
 * so they must not be reported as the person's own failure: during a siteverify
 * outage every locked-out caller would otherwise be told their check failed and
 * asked to retry it, which cannot succeed.
 *
 * Nothing here is logged, in either direction, and nothing it saw is returned:
 * the token, the provider's answer and its `error-codes` reach no log line, no
 * row and no response. Nothing branches on which code came back either, so no
 * documented provider code is load-bearing.
 */
async function providerVerdict(secret, token, operationId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      // What is sent, and what deliberately is not. No `remoteip`: it is
      // optional, the header it would come from is not trustworthy here (see
      // `clientDigest`), and a client address is personal data with no reason
      // to reach a third party. `idempotency_key` is the provider's own
      // mechanism for verifying one token more than once, which is what a
      // retried request needs; the operation id is already the client's own
      // choice and names nothing. Nothing depends on it working: if the
      // provider ignores it, a retry is refused, which is the safe direction.
      // How long the provider honours one is its own undocumented window.
      body: new URLSearchParams({ secret, response: token, idempotency_key: operationId }),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) return VERIFICATION_UNAVAILABLE;
    const verdict = await response.json();
    if (verdict?.success === true) return VERIFIED;
    // An explicit refusal is the only answer that is about the token. Anything
    // else is an answer this route cannot read, which is the provider not
    // having answered.
    return verdict?.success === false ? VERIFICATION_FAILED : VERIFICATION_UNAVAILABLE;
  } catch {
    // A dead network, an abort at the timeout, or a body that would not parse.
    return VERIFICATION_UNAVAILABLE;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether this operation already has a recorded outcome, which is the one case
 * that needs no second proof (see the header). Keyed on the id the client chose
 * and the unowned recovery domain, so asking is independent of the address and
 * of whether it resolves. A row that is still pending, or dead and reported as
 * unknown, has no outcome and so is not settled.
 */
async function alreadySettled(supabase, operationId) {
  const prior = await readOperation(supabase, { operationId, domain: DOMAIN });
  return !!prior?.result;
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

    // Human verification is part of this capability, not an extra on top of it,
    // so a deployment with no secret cannot do recovery at all: the same
    // refusal as the flag being off, decided here, before the body is read.
    // A missing key must never mean "everyone passes" (BE-340, situation 3).
    const secret = verificationSecret();
    if (!secret) return featureOff(requestId);

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
    // unavailable feature has written nothing when it says so, and so a token
    // is never spent on a request this deployment could not have served.
    await requireChallengeTable(supabaseAdmin);

    // Prove a person made this request, BEFORE anything that depends on the
    // address: the digest below is not computed, the address budget is not
    // consulted, the id is not claimed and the provider is not touched until
    // this passes, so a refusal can be neither timed nor counted against
    // whether an address resolves. The ledger is asked first, on the client's
    // own id alone, because an operation that already settled has a recorded
    // outcome to replay and the provider will not accept one token twice.
    if (!(await alreadySettled(supabaseAdmin, operationId.value))) {
      const token = parseToken(body.value[TOKEN_FIELD]);
      if (token === null) return verificationRefused(VERIFICATION_REQUIRED, requestId);
      const verdict = await providerVerdict(secret, token, operationId.value);
      if (verdict !== VERIFIED) return verificationRefused(verdict, requestId);
    }

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
