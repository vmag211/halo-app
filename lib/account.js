/**
 * The recovery half of `AccountSnapshot`, for GET /api/account?feature=recovery.
 *
 * The shape is fixed by the frontend, not by us: `useAccountService` runs
 * `validAccountSnapshot(value, feature)` on the response and throws the whole
 * thing away if it does not match, so this file follows
 * `lib/frontend/production/account-service.ts` on the frontend branch exactly.
 *
 * Two places where the contract and the database deliberately disagree, and
 * how that is resolved:
 *
 * 1. `challenge.maskedAddress` exists in the contract, but migration 0018
 *    stores only a hash of the address and a hash cannot be unmasked. The
 *    address is taken from the auth provider instead: a challenge is only ever
 *    created for an email that already resolves to a linked identity, so the
 *    account's own verified address IS the challenge's address. Nothing new is
 *    stored to satisfy the field.
 * 2. The table stores five statuses (pending, verified, expired, collision,
 *    failed); the contract's challenge may only say pending, expired or
 *    verified. A collision or a failure is therefore not reported as an open
 *    challenge at all, because the alternative is telling someone to wait for
 *    a verification that is never coming. Those outcomes reach the client
 *    through the recovery routes' own status, which has words for them.
 */
import { createHash } from 'node:crypto';

/** The features the contract names. Only `recovery` is built in this package. */
export const ACCOUNT_FEATURES = Object.freeze(['home', 'recovery', 'device', 'email', 'calendar']);
export const IMPLEMENTED_FEATURES = Object.freeze(['recovery']);

/** This release supports exactly one recovery method, so its id is the method itself. */
const METHOD_ID = 'email';

/** What a challenge's address is reported as when the provider has no address to mask. */
const UNKNOWN_MASK = '***';

/** Challenge statuses that are an open challenge the person can act on. */
const OPEN_STATUSES = new Set(['pending', 'verified', 'expired']);

/**
 * `a***@example.test`: the first character of the local part, then the domain.
 * The domain is what makes a mask recognisable ("yes, that is my work
 * address"), while the local part is the part worth hiding. An address with a
 * one-character local part reveals nothing extra, because the first character
 * is already shown for every address.
 */
export function maskEmail(address) {
  if (typeof address !== 'string') return UNKNOWN_MASK;
  const at = address.lastIndexOf('@');
  if (at < 1 || at === address.length - 1) return UNKNOWN_MASK;
  return `${address[0]}***${address.slice(at)}`;
}

/** A sha256 hex digest, the form every hashed column in 0018 accepts. */
export function hashToken(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

/**
 * The challenge to report, or null. `now` is injectable so a test can be exact
 * about the boundary rather than sleeping.
 */
export function openChallenge(row, { maskedAddress, now = Date.now() } = {}) {
  if (!row || row.consumed_at) return null; // a spent challenge is finished, not open
  if (!OPEN_STATUSES.has(row.status)) return null; // collision and failure have no word here
  const expiresAt = row.expires_at;
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return null; // without a usable expiry there is nothing truthful to say
  // The clock decides, not the stored word: a pending row whose window has
  // passed is expired, whatever a writer last wrote.
  const status = row.status === 'verified' ? 'verified' : expiry <= now ? 'expired' : 'pending';
  return { id: row.id, maskedAddress: maskedAddress || UNKNOWN_MASK, expiresAt, status };
}

/**
 * The linked recovery method, or null. An address the provider has not
 * confirmed is not a method: it has never been proved to belong to anyone, so
 * it could not recover anything.
 */
export function linkedMethod(user) {
  const address = user?.email;
  const verifiedAt = user?.email_confirmed_at ?? user?.emailConfirmedAt ?? null;
  if (!address || !verifiedAt || !Number.isFinite(Date.parse(verifiedAt))) return null;
  return { id: METHOD_ID, maskedAddress: maskEmail(address), verifiedAt };
}

/**
 * How many times this household's recovery state has changed, for the
 * `If-Match` precondition on a later write. Each challenge is one change and
 * linking the address is one more; both only ever increase, because challenges
 * are inserted rather than edited and this package has no way to unlink an
 * address. Task 4 must keep that true when it adds the link write.
 */
export function recoveryRevision({ challengeCount = 0, hasMethod = false } = {}) {
  return challengeCount + (hasMethod ? 1 : 0);
}

/** The snapshot the route returns. `recovery` is always present and contract-shaped. */
export function recoverySnapshot({
  enabled,
  reason,
  method = null,
  challenge = null,
  devices = [],
  unresolvedOperations = [],
  revision = 0,
}) {
  const snapshot = {
    feature: 'recovery',
    revision,
    unresolvedOperations,
    enabled,
    recovery: { method, challenge, devices },
  };
  if (reason) snapshot.reason = reason;
  return snapshot;
}
