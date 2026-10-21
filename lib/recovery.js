/**
 * What POST /api/recovery/status and POST /api/recovery/complete share: how a
 * challenge row is FOUND, how its restore token is DERIVED, and how a
 * contract-valid `RecoveryStatus` is BUILT. These are a contract between the
 * two routes, not an implementation detail of either, so the rules live here
 * with the code that enforces them rather than in one route's header.
 *
 * READ THIS FIRST, BECAUSE IT IS THE RULE THAT MAKES THE WHOLE FLOW SAFE AND
 * THE ONE AN IMPLEMENTER WILL MOST WANT TO BREAK:
 *
 *   EVERY ANSWER EXCEPT `verified` IS THE SAME ANSWER (Ruling 30).
 *
 * Not "looks similar": byte-identical. `uniformStatus` below is the only thing
 * either route may say about a challenge it did not find, a `pending` one, an
 * `expired` one, a `collision`, a `failure`, or a spent row.
 *
 * Why, and it is not obvious until the two routes are read together. A
 * `recover` row exists ONLY for an address that resolved to a linked confirmed
 * identity, and `/request` keys that row by the CALLER'S OWN nonce, where the
 * caller is a stranger typing somebody else's address. That is the route's
 * premise, not a misuse of it. So a stranger who picks the nonce converts "this
 * address is linked" into "a row exists for the digest I chose", and any answer
 * here that distinguishes a found row from a missing one hands that back:
 *
 *   POST /request {email: victim, clientNonce: N}   ->  the uniform pending
 *   POST /status  {clientNonce: N, ...}             ->  found, or not found
 *
 * Two requests, and a definitive answer to "does this person have a HALO
 * account". No `profile_id` scoping can close it, because the row really does
 * belong to the digest the attacker chose. Only collapsing the answers can.
 *
 * This also means the plan's "return collision, expired and failed as distinct
 * terminal states" and its "never leak whether an address exists" cannot both
 * hold for an unauthenticated caller, because only a real account can produce a
 * row that expires, collides or fails. Enumeration safety wins: it is BE-334's
 * requirement and the reason Ruling 16 withheld the challenge id in the first
 * place.
 *
 * THE SINGLE EXCEPTION is `verified`, answered with the derived restore token,
 * AND ITS SAFETY IS CONDITIONAL ON SOMETHING NOT YET BUILT. The reasoning used
 * to run: reaching verified requires control of the mailbox, and whoever
 * controls the mailbox is entitled to recover the account. That is not enough.
 * The row is keyed by the CALLER'S nonce and the emailed link carries no nonce
 * binding, so the party controlling the mailbox is the victim who clicks, while
 * the party collecting the `verified` answer and the token is whoever holds the
 * nonce. A stranger can request recovery for somebody else's address, persuade
 * them to click, and collect the credential.
 *
 * The condition, stated so it can be checked rather than assumed: THE
 * VERIFICATION STEP MUST BIND THE CLICKER TO THE NONCE THAT OPENED THE
 * CHALLENGE (Ruling 31). It is unmet because that step does not exist, which is
 * the only reason the gap is dormant: nothing marks a recover row `verified`,
 * so no caller can reach the exception at all today.
 *
 * AND IT IS HONEST RATHER THAN A FUDGE, on the client's own evidence: its
 * pending copy is already conditional. 'If this address has recovery set up,
 * check its inbox. Open the verification link, then check here.'
 * (ProductionRestoreAccessFlow.tsx, quoted in the contract digest section 3.)
 * The frontend was written to treat pending as existence-agnostic. Collapsing
 * to it matches the client; it does not work around it.
 *
 * SECOND RULE, same family:
 *
 *   "NO ROW FOUND" AND "WRONG TOKEN" MUST BE ANSWERED IDENTICALLY (Ruling 23).
 *
 * POST /api/recovery/request supersedes its own prior UNCONSUMED row for the
 * same `(profile_id, nonce_hash)` before inserting, which is what keeps the
 * nonce digest naming exactly one row (Ruling 20). The condition is
 * "unconsumed", not "unverified", so a same-nonce re-request legitimately
 * DELETES a verified row whose restore token the person is still holding. A
 * caller can therefore hold a perfectly good token for a row that no longer
 * exists. If "there is no such row" and "that token is not this row's" are
 * answered differently, the difference tells an attacker whether a challenge
 * exists for a nonce they are guessing at, which is the enumeration oracle the
 * whole flow is built to avoid. One answer, for both.
 *
 * The lookup is BY THE NONCE DIGEST and never by a client-supplied
 * `challengeId` (Ruling 16). `/request` returns `challengeId: null` for the
 * linked and the unlinked case alike, deliberately, because an id returned only
 * for linked addresses is a one-request enumeration oracle. So the client has
 * no real id to send, and anything it does send is a value the server itself
 * handed it at best and an attacker's guess at worst. The raw client nonce is
 * the only thing a caller holds that proves it is the browser that opened the
 * challenge.
 *
 * Every statement here names `intent = 'recover'` (Ruling 15). Two operations
 * write `recovery_challenges` and 0018's columns cannot tell their rows apart,
 * so a lookup that does not name its intent can return the other one's row. A
 * link challenge's nonce was generated and discarded by the route that wrote
 * it, so it can never belong to a recovering browser.
 *
 * THE RESTORE TOKEN IS DERIVED, NEVER STORED (Ruling 28). Migration 0018 holds
 * only `restore_token_hash`, 64 hex characters, and a hash cannot be unmasked,
 * so there is no stored plaintext for `/status` to hand back. Deriving it from
 * a server-side key solves that without a schema change and without a write:
 *
 *   restoreToken = HMAC-SHA256(HALO_RECOVERY_TOKEN_KEY, `halo:restore:${id}:${nonceHash}`)
 *
 * The properties that make this the right shape, rather than merely a working
 * one:
 *
 *   - Nothing proof-bearing is stored (BE-201). The key never reaches the
 *     database and the token never reaches a row, a log line or a URL.
 *   - A LEAKED ROW STAYS UNREPLAYABLE, which is the property 0018's own header
 *     comment exists to protect. The row carries `id` and `nonce_hash`; without
 *     the key those two cannot produce the token.
 *   - It is reproducible, so `/complete` can recompute and compare rather than
 *     needing the plaintext to have been kept somewhere.
 *   - It is bound to ONE challenge and ONE browser: the row id pins the
 *     challenge, the nonce digest pins the browser, so a token is useless
 *     against any other row or from any other browser.
 *
 * NEVER COMPARE A CALLER'S TOKEN AGAINST `restore_token_hash`. The column is
 * not the other half of this scheme and nothing in this application writes it:
 * the only code that sets a row to `verified` does not exist yet, so whatever
 * eventually lands in that column is not this derivation's digest unless that
 * code is written to make it so. Comparing against it would either reject every
 * real token or, if a future writer stored something guessable there, accept a
 * token derived from the row itself, which is exactly the leaked-row replay
 * 0018's header promises cannot happen. `verifyRestoreToken` below is the only
 * comparison either route may make.
 *
 * AND IT FAILS CLOSED, TWICE OVER. With no key configured nothing is derived,
 * from a default or an empty string or anything else, and the capability is
 * shut; a key under `MIN_KEY_LENGTH` is treated the same way. A capability that
 * quietly weakens because a secret is absent is the failure mode BE-340 names
 * for human verification, and it is no better here.
 *
 * NOTHING IN THIS FILE MARKS A CHALLENGE VERIFIED, AND NOTHING ELSE IN THIS
 * SYSTEM DOES EITHER. See the header of app/api/recovery/status/route.js: a
 * `verified` recover row is a state no code currently produces, so recovery
 * cannot complete end to end today. This module reports such a row faithfully
 * if one exists; it does not create one.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { CHALLENGE_INTENT, hashToken } from './account.js';

/** Every status the frontend's `validRecoveryStatus` accepts. */
export const RECOVERY_STATUSES = Object.freeze([
  'pending',
  'verified',
  'expired',
  'collision',
  'failed',
  'unknown',
]);

/**
 * The statuses the DATABASE may hold: `validRecoveryStatus`'s six minus
 * `unknown`, which 0018's CHECK forbids (Ruling 9). A route manufactures
 * `unknown` when it cannot truthfully say more; it never reads one back.
 */
const STORED_STATUSES = new Set(['pending', 'verified', 'expired', 'collision', 'failed']);

/**
 * The stored statuses a writer meant as final. `challengeStatus` reports these
 * as they stand and never lets a later `expires_at` turn one back into a live
 * challenge; see the reasoning there.
 */
const TERMINAL_STATUSES = new Set(['expired', 'collision', 'failed']);

/** The columns a status read needs, and nothing else. */
const CHALLENGE_COLUMNS = 'id, status, expires_at, consumed_at, created_at';

/**
 * A FLOOR ON THE DERIVATION KEY, and why a short one is not merely untidy.
 *
 * Anyone who legitimately recovers their own account ends up holding a known
 * `(challengeId, nonceHash, token)` triple, which is an offline oracle for the
 * key: they can guess keys and check each one in a single HMAC, with no request
 * to us and nothing for us to rate limit or notice. Recover the key and the
 * scheme's whole point is gone, because then any later database leak lets them
 * mint a token for every verified row, which is precisely the property 0018's
 * header promises survives a leak.
 *
 * So the key has to be long enough that the offline search is hopeless.
 * `HALO_RECOVERY_TOKEN_KEY=halo` would otherwise open the capability. Thirty
 * two characters is the floor, matching the nonce's.
 *
 * What this CANNOT check, stated rather than implied: length is not entropy. A
 * 32-character key of repeated words passes this and is still weak. The floor
 * stops the obvious mistake; choosing a random key is an operational
 * requirement no code here can enforce.
 */
const MIN_KEY_LENGTH = 32;

/**
 * The configured derivation key, or null. Server side only, and never a
 * `NEXT_PUBLIC_` variable: this is the half that must never reach a browser.
 * Whitespace is not a secret, so a variable set to nothing leaves it unset, and
 * neither is a key short enough to search for (see `MIN_KEY_LENGTH`). Both
 * cases return null, which shuts the capability.
 */
export function restoreTokenKey() {
  const value = process.env.HALO_RECOVERY_TOKEN_KEY;
  if (typeof value !== 'string') return null;
  const key = value.trim();
  return key.length >= MIN_KEY_LENGTH ? key : null;
}

/**
 * The restore token for one challenge and one browser. `key` must come from
 * `restoreTokenKey()`; passing a falsy one returns null rather than deriving
 * from a default, because a token anyone could recompute is worse than none.
 *
 * `nonceHash` is the DIGEST of the client nonce, never the nonce itself: the
 * raw value is the caller's secret and has no reason to be inside a derivation
 * input that a future reader might log.
 */
export function deriveRestoreToken(key, { challengeId, nonceHash }) {
  if (!key || !challengeId || !nonceHash) return null;
  return createHmac('sha256', key).update(`halo:restore:${challengeId}:${nonceHash}`).digest('hex');
}

/**
 * Whether two restore tokens are the same, compared in constant time so the
 * comparison cannot be turned into a character-by-character oracle. Written
 * here rather than in `/complete` because that route is the one that compares a
 * caller-supplied token against a derived one, and a comparison this matters
 * for should not be re-implemented per route.
 *
 * Lengths that differ are answered false without reaching `timingSafeEqual`,
 * which throws on mismatched lengths. That leaks only the length, which for a
 * derived token is a constant.
 */
export function restoreTokenMatches(given, derived) {
  if (typeof given !== 'string' || typeof derived !== 'string') return false;
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(derived, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * THE ONLY WAY EITHER ROUTE MAY ACCEPT A RESTORE TOKEN. Use this rather than
 * `deriveRestoreToken` plus `restoreTokenMatches`, and never
 * `restore_token_hash` (see the header).
 *
 * It exists because the expiry bound this module advertises was advertised and
 * not enforced: `findRecoverChallenge` deliberately does not filter
 * `expires_at`, so the only thing between an expired verified row and a minted
 * session was the next route remembering to consult `challengeStatus` first.
 * A guarantee that depends on a caller remembering is not a guarantee. So the
 * clock is checked HERE, in the same call that compares, and the two cannot be
 * separated by a later implementer.
 *
 * Requires all of: a row this module considers `verified` RIGHT NOW (so a
 * `pending`, `expired`, `collision`, `failed` or past-its-window row is refused
 * whatever its stored word says), a configured key, the caller's nonce digest,
 * and a token equal to the derivation in constant time.
 *
 * Returns false for every failure, with no reason, deliberately: a caller that
 * cannot tell "no such row" from "wrong token" from "expired" cannot turn the
 * difference into an oracle (Rulings 23 and 30).
 */
export function verifyRestoreToken(row, { given, key, nonceHash, now = Date.now() } = {}) {
  if (!row || !key || !nonceHash || typeof given !== 'string') return false;
  if (challengeStatus(row, { now }) !== 'verified') return false;
  const derived = deriveRestoreToken(key, { challengeId: row.id, nonceHash });
  return derived !== null && restoreTokenMatches(given, derived);
}

/**
 * The live `recover` challenge for one client nonce, or null.
 *
 * Read the file header before relying on this: a null here means "no row found
 * OR the nonce is not this row's", and the two MUST be answered identically by
 * every caller (Ruling 23).
 *
 * Three filters, each load-bearing:
 *
 *   intent = 'recover'   or the link intent's rows are in scope (Ruling 15).
 *   nonce_hash           the only handle a caller can prove (Ruling 16). It is
 *                        not scoped by `profile_id`, because the caller is not
 *                        signed in and has no identity to scope by; the nonce
 *                        is what stands in for one. Another household's row is
 *                        unreachable because its nonce digest is different, not
 *                        because an owner filter excluded it.
 *   consumed_at is null  `consumed_at` is the evidence a restore token was
 *                        spent, and single use depends on it. A spent row is
 *                        finished, not a state to report, and excluding it is
 *                        also what makes the remaining row unique: `/request`
 *                        guarantees at most one UNCONSUMED row per
 *                        (profile_id, nonce_hash), and says nothing about
 *                        consumed ones (Ruling 20).
 *
 * `order` plus `limit(1)` rather than `maybeSingle()`, deliberately: if the
 * one-live-row invariant is ever violated, `maybeSingle()` answers PGRST116 and
 * a legitimate browser can never finish recovering. Taking the newest row
 * degrades to "the attempt that stands" instead of to a dead end.
 */
export async function findRecoverChallenge(supabase, { nonceHash, includeConsumed = false } = {}) {
  if (!nonceHash) return null;
  let query = supabase
    .from('recovery_challenges')
    .select(CHALLENGE_COLUMNS)
    .eq('intent', CHALLENGE_INTENT.RECOVER)
    .eq('nonce_hash', nonceHash);
  // `includeConsumed` is for ONE purpose: proving a caller holds the nonce of
  // the challenge a ledger receipt names, after that challenge has been spent.
  // It must never be used to decide what to report about a challenge, because a
  // spent row is finished and a lookup that returns one cannot promise it is
  // the only match for the digest.
  if (!includeConsumed) query = query.is('consumed_at', null);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

/** The digest a challenge is found by. One place, so the two routes cannot disagree. */
export const nonceDigest = (clientNonce) => hashToken(clientNonce);

/**
 * What a row's status IS, as opposed to what was last written to it.
 *
 * THE CLOCK DECIDES, NOT THE STORED WORD, BUT ONLY IN ONE DIRECTION. A row
 * whose window has passed is expired whatever a writer left in the column, and
 * that applies to a `verified` row too, which is the one place this
 * deliberately differs from `openChallenge` in lib/account.js. There,
 * `verified` outranks the clock, because the question is "what is this
 * household waiting for" and a confirmed address does not stop being
 * confirmed. Here the question is "may this caller still restore an account
 * with it", and the answer has to stop being yes: the derived token is a
 * bearer credential for someone else's household, so its life is bounded by
 * the row's own expiry rather than being unbounded.
 *
 * THE CLOCK NEVER REVIVES A ROW, which is the half that is easy to miss. A
 * writer's `expired`, `collision` or `failed` is a terminal fact, and a future
 * `expires_at` next to one of those is a contradiction, not a resurrection: a
 * row someone marked dead must not come back as `pending` because its window
 * was later moved. So those three are reported as stored, and the clock is only
 * ever allowed to move a live-looking row TOWARDS terminal.
 *
 * A status the database should not hold, or an expiry that cannot be parsed, is
 * reported as `failed`: there is nothing truthful left to say, and a terminal
 * answer beats a `pending` that promises something that will never arrive.
 */
export function challengeStatus(row, { now = Date.now() } = {}) {
  if (!row || !STORED_STATUSES.has(row.status)) return 'failed';
  if (TERMINAL_STATUSES.has(row.status)) return row.status;
  const expiry = Date.parse(row.expires_at);
  if (!Number.isFinite(expiry)) return 'failed';
  if (expiry <= now) return 'expired';
  return row.status === 'verified' ? 'verified' : 'pending';
}

/**
 * A contract-valid `RecoveryStatus`, built in one place so no branch can drift
 * into a shape `validRecoveryStatus` throws away.
 *
 * What the validator requires, and what this guarantees:
 *   - `operationId` is echoed EXACTLY as the caller sent it. For a status call
 *     that is the status call's OWN id, never `requestOperationId` (Ruling 7).
 *     This function cannot enforce which one it was given; the route must pass
 *     the right one, and its tests are what pin that.
 *   - `challengeId` and `expiresAt` keys are ALWAYS present, carrying null when
 *     there is nothing to report. An absent key fails the validator, which is
 *     the easiest of these to get wrong.
 *   - `challengeId` is null unless it is a usable string of 1..500 characters;
 *     an empty string is not equivalent to null to the validator.
 *   - `expiresAt` is null unless `Date.parse` can read it.
 *   - `restoreToken` is omitted unless it is a usable string, and a `verified`
 *     status with no token is reported as `unknown` instead of as a body the
 *     client will discard. `unknown` is honest there: the row says verified but
 *     this deployment cannot produce what the client needs from it.
 *   - `session` is never set here. A session is `/complete`'s to return, and a
 *     `verified` response carrying only a session leaves the UI's "Restore my
 *     account" button enabled but inert (Ruling 8).
 *
 * `reason` is additive and optional, for the capability-off case Ruling 6
 * requires to carry one. Extra top-level keys are never checked by the
 * validator, so adding one cannot break a client.
 */
export function recoveryStatus({ operationId, status, challengeId = null, expiresAt = null, restoreToken = null, reason = null }) {
  const id = typeof challengeId === 'string' && challengeId.length > 0 && challengeId.length <= 500 ? challengeId : null;
  const expiry = typeof expiresAt === 'string' && Number.isFinite(Date.parse(expiresAt)) ? expiresAt : null;
  const token = typeof restoreToken === 'string' && restoreToken.length > 0 && restoreToken.length <= 8192 ? restoreToken : null;
  const named = RECOVERY_STATUSES.includes(status) ? status : 'unknown';
  // A verified answer the client cannot act on is worse than an honest
  // "we cannot say": the button it enables does nothing at all (Ruling 8).
  const reported = named === 'verified' && !token ? 'unknown' : named;

  const body = { operationId, status: reported, challengeId: id, expiresAt: expiry };
  if (reported === 'verified') body.restoreToken = token;
  if (reason) body.reason = reason;
  return body;
}

/**
 * THE ONE ANSWER (Ruling 30). Everything a status read can discover about a
 * challenge, except that it is verified and the caller owns it, is reported as
 * exactly this: a challenge that does not exist, a `pending` one, one past its
 * window, a `collision`, a `failure`, a spent row, and an operation there is
 * nothing truthful to add about.
 *
 * It carries no `challengeId` and no `expiresAt`, because both are values only
 * a real account can produce and either one turns the body into the existence
 * oracle described in this file's header.
 *
 * `pending` rather than `failed` is the deliberate choice, on the client's own
 * evidence: its pending copy is conditional ('If this address has recovery set
 * up, check its inbox'), so pending is the one word the frontend already
 * treats as existence-agnostic, while `failed` tells someone with a real
 * challenge in flight that it definitively did not happen.
 */
export const uniformStatus = (operationId) => recoveryStatus({ operationId, status: 'pending' });

/**
 * Where a client address is looked for, in order, taking the first header that
 * yields a hop. Shared by every public recovery route so the two cannot drift
 * apart; the reasoning, and what is assumption rather than fact, is in
 * `clientDigest` below and in the header of app/api/recovery/request/route.js.
 */
const CLIENT_ADDRESS_HEADERS = Object.freeze(['x-vercel-forwarded-for', 'x-forwarded-for', 'x-real-ip']);

/**
 * The one bucket every caller shares when no proxy reported a client address.
 * A fixed string, deliberately: anything per-request (a fresh id, say) would
 * look like a key and quietly give every such caller an unlimited budget.
 */
export const UNATTRIBUTED = 'unattributed';

/**
 * Which client this is, as a digest. There is no session on a recovery route,
 * so the only thing available is the client address a proxy reports, and it is
 * hashed because a client address is personal data and a limiter key is not the
 * place for it.
 *
 * Two rules, both because the raw header is caller-supplied text (Rulings 19
 * and 21):
 *
 *   1. The headers are tried in the order above, which puts the one a caller
 *      gains least by sending first and the one a caller gains most by sending
 *      last. A single-valued header is never preferred over a forwarded chain,
 *      because a chain at least has an end a proxy appends and a single value
 *      does not.
 *   2. Within whichever header is used, the hop NEAREST the proxy is taken,
 *      which is the rightmost entry. Taking the leftmost would let a caller
 *      vary its own bucket per request and never be refused.
 *
 * This is an ASSUMPTION about the deployment, not a property of this code: if
 * nothing in front rewrites or appends these headers, the budget is per claimed
 * address rather than per caller. It is not verified here.
 */
export function clientDigest(request) {
  for (const name of CLIENT_ADDRESS_HEADERS) {
    const hops = (request.headers.get(name) ?? '').split(',').map((hop) => hop.trim()).filter(Boolean);
    const nearest = hops[hops.length - 1];
    if (nearest) return hashToken(nearest.toLowerCase());
  }
  return UNATTRIBUTED;
}
