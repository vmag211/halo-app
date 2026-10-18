/**
 * The recovery half of `AccountSnapshot`, for GET /api/account?feature=recovery
 * and for the receipts of POST /api/account/commands, which carry the same
 * snapshot rebuilt after the change.
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
 *    address is taken from the auth provider instead: it is the address in
 *    flight on this identity, which is the pending change the provider is
 *    holding, or failing that the identity's own address. A household has at
 *    most one open challenge, because a new request closes the one it replaces
 *    (POST /api/account/commands), so the address in flight is that challenge's
 *    address. Nothing new is stored to satisfy the field.
 * 2. The table stores five statuses (pending, verified, expired, collision,
 *    failed); the contract's challenge may only say pending, expired or
 *    verified. A collision or a failure is therefore not reported as an open
 *    challenge at all, because the alternative is telling someone to wait for
 *    a verification that is never coming. Those outcomes reach the client
 *    through the recovery routes' own status, which has words for them.
 */
import { createHash } from 'node:crypto';
import { listUnresolvedOperations } from './operations.js';

/** The features the contract names. Only `recovery` is built in this package. */
export const ACCOUNT_FEATURES = Object.freeze(['home', 'recovery', 'device', 'email', 'calendar']);
export const IMPLEMENTED_FEATURES = Object.freeze(['recovery']);

/** This release supports exactly one recovery method, so its id is the method itself. */
const METHOD_ID = 'email';

/**
 * Which operation wrote a `recovery_challenges` row (migration 0019).
 *
 *   link     POST /api/account/commands, signed in: attach an address to the
 *            caller's own identity and wait for the provider's confirmation.
 *   recover  POST /api/recovery/request, NOT signed in: prove ownership of an
 *            address that is already linked.
 *
 * Link and recover are separate operations with separate code paths (BE-227),
 * but they share one table, and 0018's columns cannot tell their rows apart: a
 * fresh row of either kind carries a nonce hash, a null restore_token_hash and
 * a null consumed_at. Every statement on the table must name the intent it
 * means, or one operation acts on the other's rows.
 */
export const CHALLENGE_INTENT = Object.freeze({ LINK: 'link', RECOVER: 'recover' });

/**
 * "Not there yet" for the recovery schema: migration 0018's table is missing
 * (PGRST205 from PostgREST, 42P01 from Postgres) or 0019's `intent` column is
 * (PGRST204, 42703). Both are answered with the same non-retryable 503 as the
 * ledger's, by `operationsUnavailable` in lib/operations.js.
 *
 * The column counts as "unavailable" rather than something to work around.
 * Without it the account surface cannot tell a link challenge from a recovery
 * one, so reporting `challenge: null`, or superseding whatever the household
 * had open, would be a claim it has no way to support.
 */
const RECOVERY_SCHEMA_MISSING = new Set(['PGRST205', '42P01', 'PGRST204', '42703']);

/** True when the error says migration 0018 or 0019 is not applied. */
export function isRecoveryUnavailable(error) {
  return !!error && RECOVERY_SCHEMA_MISSING.has(error.code);
}

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
 * The household's recovery revision, for the `If-Match` precondition on a
 * write: how many account-domain operations this household has ever recorded
 * in the ledger (migration 0017).
 *
 * It counted the challenges plus the linked address until task 4, with a
 * comment claiming that could only increase "because this package has no way
 * to unlink an address". That was wrong: `remove-recovery` unlinks, and a
 * cancelled challenge is removed, so the old count could go DOWN and a stale
 * `If-Match` would then look current. Counting ledger rows cannot: a row is
 * written before every command is attempted and is never deleted or edited
 * afterwards, except by the owner cascade that deletes the household entirely.
 * It also advances by exactly one per command, which is what lets a receipt's
 * snapshot be used as the next command's precondition.
 *
 * The cost, accepted deliberately: a command that fails advances the revision
 * too, so a client can see a new revision after a change that did not happen
 * and must re-read. The alternative was a counter column, and migrations are
 * applied by hand in production.
 *
 * `GET /api/account` and `POST /api/account/commands` must both read it from
 * here, or the precondition one checks is not the number the other published.
 */
export async function recoveryRevision(supabase, profileId) {
  if (!profileId) throw new Error('account: the recovery revision needs an owner');
  const { count, error } = await supabase
    .from('operations')
    .select('operation_id', { count: 'exact', head: true })
    .eq('profile_id', profileId)
    .eq('domain', 'account');
  if (error) throw error;
  return count ?? 0;
}

/**
 * The enabled snapshot for one household, read from the provider and the
 * database. Both `GET /api/account` and every command receipt are built from
 * this one function, so a receipt's snapshot is the same answer the next read
 * would give rather than a second opinion assembled separately.
 *
 * `devices` is empty: listing and revoking sessions is task 9, and an empty
 * list here is not a claim that there are none.
 *
 * The caller holds the capability flag: this function reads, so it must not be
 * called while recovery is off.
 */
export async function readRecoverySnapshot(supabase, profileId) {
  const { data: account, error: accountError } = await supabase.auth.admin.getUserById(profileId);
  if (accountError) throw new Error(accountError.message);
  const user = account?.user ?? null;

  // The link intent only. A recovery challenge belongs to the same identity but
  // is not a verification this person started or can act on here, and its
  // address is not the one the provider has in flight, so reporting it as the
  // open challenge would be telling someone to wait for a message addressed to
  // a different request (0019, Ruling 15).
  const { data: challenges, error: challengeError } = await supabase
    .from('recovery_challenges')
    .select('id, status, expires_at, consumed_at, created_at')
    .eq('profile_id', profileId)
    .eq('intent', CHALLENGE_INTENT.LINK)
    .order('created_at', { ascending: false })
    .limit(1);
  if (challengeError) throw challengeError;

  // Owned domains only. An unauthenticated recovery operation has no owner to
  // attribute it to, so it can never appear in anyone's inventory.
  const unresolvedOperations = await listUnresolvedOperations(supabase, { profileId, domains: ['account'] });

  return recoverySnapshot({
    enabled: true,
    method: linkedMethod(user),
    // The challenge's address is the one in flight on this identity: the
    // address the provider is holding as a pending change, or failing that the
    // identity's own address. Masking from the method instead would report
    // `***` for exactly the case a challenge exists for, an address nobody has
    // confirmed yet.
    challenge: openChallenge(challenges?.[0], {
      maskedAddress: maskEmail(user?.new_email ?? user?.email),
    }),
    devices: [],
    unresolvedOperations,
    revision: await recoveryRevision(supabase, profileId),
  });
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
