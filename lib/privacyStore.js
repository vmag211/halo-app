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
 * they can be reconciled with migration 0024 (written in parallel). Since the
 * merge, test/privacyStoreDb.test.mjs holds each one against the real 0024
 * functions on PGlite, called by argument name as PostgREST calls them:
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
import { privacyReviewKey } from './privacyToken.js';

/** The ledger domain of every privacy operation (lib/operations.js DOMAINS). */
export const PRIVACY_DOMAIN = 'privacy';

/**
 * The one table of privacy ledger kinds, by the scope the client knows each
 * by (P14): the export and clear routes record under these kinds, and
 * privacy.status maps a kind back to its scope with `privacyScopeOfKind`.
 */
export const PRIVACY_KINDS = Object.freeze({
  export: 'privacy.export',
  journal: 'privacy.clear.journal',
  all: 'privacy.clear.all',
});

const SCOPE_BY_KIND = new Map(Object.entries(PRIVACY_KINDS).map(([scope, kind]) => [kind, scope]));

/** The scope of a privacy ledger kind, or null for a kind no privacy route writes. */
export function privacyScopeOfKind(kind) {
  return SCOPE_BY_KIND.get(kind) ?? null;
}

/**
 * An error's code when it looks like a Postgres or PostgREST code, else
 * `unexpected`: the only part of a privacy failure a log line may carry where
 * the message itself is not wanted (P10).
 */
export function loggableCode(err) {
  return typeof err?.code === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(err.code) ? err.code : 'unexpected';
}

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

/**
 * True when the error says migration 0024 (or a table it reads) is not
 * applied. For the five 0024 calls in this module ONLY.
 *
 * Two limits a caller must know:
 *   - PGRST202 is also PostgREST's answer to "no function with these argument
 *     names", so a parameter-name mismatch with 0024 would read as
 *     "unavailable" and every privacy route would quietly answer 503. That
 *     mismatch is ruled out by test/privacyStoreDb.test.mjs, which calls every
 *     wrapper here against the real 0024 functions with named arguments.
 *   - The export builder (Task 4) must NOT use this for its table reads. P11
 *     rules that a missing table during an export read is zero rows plus a
 *     warning in the manifest, and this function counts PGRST205 and 42P01
 *     (a missing table) as "privacy is unavailable", which would turn one
 *     missing optional table into a 503 for the whole export.
 */
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
 * The opening every privacy route makes before it reads or records anything
 * (P11): a usable HALO_PRIVACY_REVIEW_KEY, then the 0024 probe (0024 asserts
 * 0017 at apply time, so the probe covers the ledger too). Returns the key,
 * or null when privacy is unavailable, which the route answers with
 * `privacyUnavailable`. The key is checked first, so without it nothing is
 * asked of the database. Throws what the probe throws for any other error.
 */
export async function openPrivacy(supabase) {
  const key = privacyReviewKey();
  if (!key) return null;
  const probe = await probePrivacySchema(supabase);
  return probe.available ? key : null;
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
  if (scope !== 'all') return { ...data };
  // B11 Ruling W8: clear all also removes the Homeguard workspace (0026's
  // trigger on the clear's own settle), which 0024's counts do not know.
  // Until 0026 is applied there is no workspace to count or remove.
  const workspace = await optionalCounts(supabase, 'workspace_privacy_counts', profileId);
  // B14 Ruling A12: clear all also removes private files (0028's trigger on
  // the same settle). 0028 needs 0026, so without the workspace there are none;
  // until 0028 is applied there are none to count.
  const files = workspace ? await optionalCounts(supabase, 'attachment_privacy_counts', profileId) : null;
  // B16: clear all also removes saved project idea sets (0030's trigger on
  // the same settle). 0030 needs neither 0026 nor 0028; until it is applied
  // there are none to count.
  const projects = await optionalCounts(supabase, 'project_privacy_counts', profileId);
  return { ...data, ...workspace, ...files, ...projects };
}

/** One later migration's counts, or null when that migration is not applied. */
async function optionalCounts(supabase, name, profileId) {
  const { data, error } = await supabase.rpc(name, { p_profile_id: profileId });
  if (error) {
    if (WORKSPACE_MISSING.has(error.code)) return null;
    throw error;
  }
  if (!isObject(data) || !Object.values(data).every(isCount)) {
    throw new Error(`privacyStore: ${name} returned an unexpected shape`);
  }
  return data;
}

/** 0026, 0028 or 0030 not applied: its count function (PostgREST, Postgres) or table (PostgREST, Postgres) is missing. */
const WORKSPACE_MISSING = new Set(['PGRST202', '42883', 'PGRST205', '42P01']);

/**
 * Runs one clear (P3): every deletion, the profile reset for `all`, and the
 * settle of this operation's own ledger row, in one transaction. Returns
 * `{receipt, removed}` (A5). `removed` is for tests and logs only and is
 * never emitted. A refusal is thrown as the Supabase error: read it with
 * `privacyRefusal` (HALO_REVIEW_CHANGED and HALO_BUSY settle `failed`;
 * HALO_OPERATION_NOT_PENDING propagates, P15).
 *
 * The operation id is compared lowercased: Postgres writes a uuid in
 * lowercase, so an id the caller passed in capitals is still this clear's own
 * receipt. The receipt returned carries the canonical (lowercase) id. The
 * route should still pass the trimmed, lowercased id (P17), since that is the
 * id its ledger row was claimed under.
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
  const canonicalId = typeof operationId === 'string' ? operationId.toLowerCase() : operationId;
  if (
    !isObject(data) || !isObject(receipt) || !isCount(data.removed)
    || Object.keys(receipt).length !== 3
    || receipt.operationId !== canonicalId || receipt.status !== 'succeeded' || receipt.scope !== scope
  ) {
    throw new Error('privacyStore: clear_household_records returned an unexpected shape');
  }
  return { receipt: { operationId: canonicalId, status: 'succeeded', scope }, removed: data.removed };
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
