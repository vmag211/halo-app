/**
 * The routes' side of migration 0024 (B07 plan, Task 1 and Rulings P3, P6,
 * P10, P11): thin wrappers for its five service-role functions, the test for
 * "0024 is not applied yet", the 503 that answers it, and a reader for the
 * refusals the functions raise.
 *
 *   privacy_schema_version() -> int                                  (P11 probe)
 *   privacy_fingerprint(p_profile_id uuid, p_tables text[]) -> text  (P6)
 *   privacy_counts(p_profile_id uuid, p_scope text) -> jsonb         (Task 1 item 4)
 *   clear_household_records(p_profile_id uuid, p_operation_id uuid,
 *                           p_scope text, p_fingerprint text) -> jsonb  (P3, P4)
 *   purge_privacy_receipts(p_profile_id uuid default null) -> int    (P10)
 *
 * ASSUMPTIONS where the plan leaves a signature's details open, written down so
 * they can be reconciled with migration 0024 (written in parallel):
 *
 *   A1  Every argument is passed by name, exactly as above. The global purge
 *       passes `p_profile_id: null` explicitly rather than relying on the
 *       default, so the call means the same whether or not the default exists.
 *   A2  privacy_schema_version returns the integer 1, which PostgREST answers
 *       as the bare scalar. Any other value is treated as unavailable (a
 *       different 0024 than this code was written for).
 *   A3  privacy_fingerprint returns a non-empty text (the plan says SHA-256;
 *       hex is expected, but any non-empty string up to 256 characters is
 *       accepted, since the value is only ever compared, inside the MAC).
 *       `p_tables` is sent in FINGERPRINT_TABLES order; the function is
 *       assumed to use its own fixed order either way.
 *   A4  privacy_counts returns a jsonb object `{<table name>: n}` with
 *       non-negative integer counts, the profile reported under `profiles`
 *       as 0 or 1 (Task 1 item 4). Keys are not checked against the
 *       inventory here; the inspect route decides what to show.
 *   A5  clear_household_records returns `{receipt, removed}` with
 *       `receipt` exactly `{operationId, status: 'succeeded', scope}` (P3
 *       step 7, P10) and `removed` a non-negative integer (P3 step 8).
 *   A6  Refusals are SQLSTATE P0001 with the code as the whole message:
 *       HALO_INVALID_INPUT, HALO_OPERATION_NOT_PENDING, HALO_REVIEW_CHANGED,
 *       HALO_BUSY, HALO_OPERATION_SETTLED (Task 1, "Refusals").
 *   A7  purge_privacy_receipts returns the number of rows it deleted.
 *
 * Every wrapper throws the Supabase error as it came, so a caller reads it
 * with `privacyRefusal` or `isPrivacyUnavailable`, and throws a plain Error
 * on a result that is not the function's shape. A caller logs a failure with
 * `loggableError` (code and message only): never a token, a fingerprint, a
 * row or an error's details.
 *
 * Identity: `profileId` is always the verified session's user id
 * (requireUser), never an id from the request.
 */
import { apiError, ERROR_CODES } from './apiErrors.js';
import { FINGERPRINT_TABLES, CLEAR_SCOPES } from './privacyInventory.js';

/** The ledger domain of every privacy operation (lib/operations.js DOMAINS). */
export const PRIVACY_DOMAIN = 'privacy';

/** The schema version this code was written against (A2). */
export const PRIVACY_SCHEMA_VERSION = 1;

/** "Not there yet": the function (PostgREST, Postgres), then a table (PostgREST, Postgres). */
const UNAVAILABLE_CODES = new Set(['PGRST202', '42883', 'PGRST205', '42P01']);

const UNAVAILABLE_MESSAGE = 'Privacy requests are not available yet. Nothing was changed.';

/** The refusal codes of the 0024 functions (A6), each with the reason a receipt or log carries. */
export const PRIVACY_REFUSALS = Object.freeze({
  HALO_INVALID_INPUT: 'invalid_input',
  HALO_OPERATION_NOT_PENDING: 'operation_not_pending',
  HALO_REVIEW_CHANGED: 'review_changed',
  HALO_BUSY: 'busy',
  HALO_OPERATION_SETTLED: 'operation_settled',
});

/** True when the error says migration 0024 (or a table it reads) is not applied. */
export function isPrivacyUnavailable(error) {
  return !!error && UNAVAILABLE_CODES.has(error.code);
}

/**
 * 503 `feature_unavailable`, not retryable: while the review key is missing
 * or 0017 or 0024 is not applied, asking again cannot help (P11). The client
 * shows its own "Privacy requests are unavailable." for it.
 */
export function privacyUnavailable(requestId) {
  return apiError({
    status: 503,
    code: ERROR_CODES.FEATURE_UNAVAILABLE,
    message: UNAVAILABLE_MESSAGE,
    retryable: false,
    requestId,
  });
}

/**
 * The refusal a 0024 function raised, `{code, reason}`, or null for any other
 * error (or none). Modelled on haloRefusal (lib/homeContextRpc.js): the code
 * must be the whole message, so a message that merely mentions one is not
 * taken for it, and the error's details are never read.
 */
export function privacyRefusal(error) {
  if (!error || error.code !== 'P0001' || typeof error.message !== 'string') return null;
  if (!Object.hasOwn(PRIVACY_REFUSALS, error.message)) return null;
  return { code: error.message, reason: PRIVACY_REFUSALS[error.message] };
}

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

function requireOwner(profileId, what) {
  if (typeof profileId !== 'string' || profileId.length === 0) throw new Error(`privacyStore: ${what} requires an owner`);
}

/**
 * The P11 probe. `{available: true}` when 0024 is applied at the version this
 * code expects, `{available: false, code}` when the function is missing (or a
 * different version answers, code `version`). Throws any other error.
 */
export async function probePrivacySchema(supabase) {
  const { data, error } = await supabase.rpc('privacy_schema_version');
  if (error && isPrivacyUnavailable(error)) return { available: false, code: error.code };
  if (error) throw error;
  if (data !== PRIVACY_SCHEMA_VERSION) return { available: false, code: 'version' };
  return { available: true };
}

/**
 * The review fingerprint of these tables of this household (P6). `tables`
 * must be names from FINGERPRINT_TABLES (from privacyInventory's
 * `fingerprintTables`); they are sent in that order. Returns the text.
 */
export async function privacyFingerprint(supabase, { profileId, tables }) {
  requireOwner(profileId, 'a fingerprint');
  if (!Array.isArray(tables) || tables.some((table) => !FINGERPRINT_TABLES.includes(table))) {
    throw new Error('privacyStore: a fingerprint covers only FINGERPRINT_TABLES');
  }
  const ordered = FINGERPRINT_TABLES.filter((table) => tables.includes(table));
  const { data, error } = await supabase.rpc('privacy_fingerprint', { p_profile_id: profileId, p_tables: ordered });
  if (error) throw error;
  if (typeof data !== 'string' || data.length === 0 || data.length > 256) {
    throw new Error('privacyStore: privacy_fingerprint returned an unexpected shape');
  }
  return data;
}

/**
 * What a clear of `scope` would remove right now, `{<table>: n}` (A4), so
 * inspect's count is one consistent read.
 */
export async function privacyCounts(supabase, { profileId, scope }) {
  requireOwner(profileId, 'counting records');
  if (!CLEAR_SCOPES.includes(scope)) throw new Error('privacyStore: counts are for a clear scope');
  const { data, error } = await supabase.rpc('privacy_counts', { p_profile_id: profileId, p_scope: scope });
  if (error) throw error;
  if (!isObject(data) || !Object.values(data).every(isCount)) {
    throw new Error('privacyStore: privacy_counts returned an unexpected shape');
  }
  return { ...data };
}

/**
 * Runs one clear (P3): every deletion, the profile reset for `all`, and the
 * settle of this operation's own ledger row, in one transaction. Returns
 * `{receipt, removed}` (A5). `removed` is for tests and logs only and is
 * never emitted. A refusal is thrown as the Supabase error: read it with
 * `privacyRefusal` (HALO_REVIEW_CHANGED and HALO_BUSY settle `failed`;
 * HALO_OPERATION_NOT_PENDING propagates, P15).
 */
export async function clearHouseholdRecords(supabase, { profileId, operationId, scope, fingerprint }) {
  requireOwner(profileId, 'a clear');
  if (!CLEAR_SCOPES.includes(scope)) throw new Error('privacyStore: unknown clear scope');
  const { data, error } = await supabase.rpc('clear_household_records', {
    p_profile_id: profileId,
    p_operation_id: operationId,
    p_scope: scope,
    p_fingerprint: fingerprint,
  });
  if (error) throw error;
  const receipt = data?.receipt;
  if (
    !isObject(data) || !isObject(receipt) || !isCount(data.removed)
    || Object.keys(receipt).length !== 3
    || receipt.operationId !== operationId || receipt.status !== 'succeeded' || receipt.scope !== scope
  ) {
    throw new Error('privacyStore: clear_household_records returned an unexpected shape');
  }
  return { receipt: { operationId, status: 'succeeded', scope }, removed: data.removed };
}

async function purge(supabase, profileId) {
  const { data, error } = await supabase.rpc('purge_privacy_receipts', { p_profile_id: profileId });
  if (error) throw error;
  if (!isCount(data)) throw new Error('privacyStore: purge_privacy_receipts returned an unexpected shape');
  return data;
}

/**
 * Deletes this household's privacy receipts settled more than 24 hours ago
 * (P10), lazily on every `privacy.status` read. Returns how many went.
 */
export async function purgePrivacyReceipts(supabase, { profileId }) {
  requireOwner(profileId, 'purging receipts');
  return purge(supabase, profileId);
}

/**
 * The same purge for every household, once a day from the cron (P10). A
 * separate function, so an owner that is accidentally missing can never
 * widen a household's purge to everyone's.
 */
export async function purgeAllPrivacyReceipts(supabase) {
  return purge(supabase, null);
}
