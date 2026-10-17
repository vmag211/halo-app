/**
 * The operation ledger: record-first idempotency for every mutation.
 *
 * Why this exists. The new frontend sends `Idempotency-Key: <operationId>` on
 * every mutation and treats a lost response as "unknown", never as failure. It
 * then asks `GET /api/operations` what actually happened. Without a ledger the
 * only honest answer would be "we do not know", and the client's only options
 * would be to give up or to replay a write that may already have applied.
 *
 * The contract the frontend enforces (see lib/frontend/production/runtime.ts
 * and its domain services): a receipt carries the same `operationId` the client
 * sent, a `status` of 'succeeded' | 'pending' | 'failed' | 'cancelled', and the
 * domain's own payload. `GET /api/operations` replays that receipt verbatim.
 *
 * Record first, then act. The row is written BEFORE the effect is attempted, so
 * a process that dies mid-write still leaves evidence the attempt existed. A
 * reader seeing a long-pending row is told 'unknown', not 'pending', because a
 * dead process must never look like work still in progress.
 *
 * "Unknown is not zero" applies here more than anywhere else: a missing row and
 * a failed operation are different answers, and neither is success.
 *
 * Requires migration 0017. Until it is applied every call reports the feature
 * as unavailable (503, not retryable), the same way the home-context routes
 * behave before 0016.
 */
import { createHash } from 'node:crypto';
import { apiError, ERROR_CODES } from '@/lib/apiErrors';

/** Domains the frontend reconciles against, from its production services. */
export const OPERATION_DOMAINS = Object.freeze([
  'account',
  'actions',
  'alerts',
  'attachments',
  'explore',
  'luna',
  'outreach',
  'privacy',
  'projects',
  'recovery',
  'settings',
  'source-operations',
  'summary',
  'week-updates',
  'workspace',
]);

/** The only domain allowed to record an operation with no owner (it runs before sign-in). */
export const UNAUTHENTICATED_DOMAIN = 'recovery';

/** Terminal statuses: the outcome is settled and the receipt can be replayed as-is. */
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

/**
 * How long a 'pending' row may sit before a reader is told 'unknown' instead.
 * Two minutes is well past the frontend's 20s request timeout, so an operation
 * still running is never slandered as dead, while a crashed one stops looking
 * live. Domains with genuinely long work (exports, generation) pass their own.
 */
export const DEFAULT_STALE_AFTER_MS = 120_000;

/** Thrown when an operationId is reused with different input. The caller maps it to 409. */
export const OPERATION_INPUT_MISMATCH = 'OPERATION_INPUT_MISMATCH';

/** "Not there yet": the table is missing (PostgREST, then Postgres). Mirrors lib/homeContextRpc.js. */
const UNAVAILABLE_CODES = new Set(['PGRST205', '42P01']);

const UNAVAILABLE_MESSAGE =
  'Saving is not available yet. Nothing was changed. Please try again later.';

/** True when the error says migration 0017 is not applied. */
export function isOperationsUnavailable(error) {
  return !!error && UNAVAILABLE_CODES.has(error.code);
}

/** The 503 every operation route returns until 0017 is applied. Not retryable: retrying cannot help. */
export function operationsUnavailable(requestId) {
  return apiError({
    status: 503,
    code: ERROR_CODES.FEATURE_UNAVAILABLE,
    message: UNAVAILABLE_MESSAGE,
    retryable: false,
    requestId,
  });
}

/**
 * A stable fingerprint of the operation's input, so the same id arriving with
 * different input is caught instead of silently returning the first outcome.
 * Keys are sorted at every depth, so property order never changes the hash.
 */
export function requestHash(input) {
  return createHash('sha256').update(stableStringify(input ?? null)).digest('hex');
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

/** A pending row older than the window is reported as 'unknown'. */
function effectiveStatus(row, staleAfterMs) {
  if (row.status !== 'pending') return row.status;
  const started = Date.parse(row.created_at);
  if (!Number.isFinite(started)) return 'unknown';
  return Date.now() - started > staleAfterMs ? 'unknown' : 'pending';
}

function assertDomain(domain, profileId) {
  if (!OPERATION_DOMAINS.includes(domain)) {
    throw new Error(`operations: unknown domain "${domain}"`);
  }
  if (!profileId && domain !== UNAUTHENTICATED_DOMAIN) {
    throw new Error(`operations: domain "${domain}" requires an owner`);
  }
}

/**
 * Run `execute` exactly once for this `operationId`, whatever the caller does.
 *
 *   const outcome = await runOperation(supabaseAdmin, {
 *     operationId, profileId: userId, domain: 'actions', kind: 'actions.commit', input: body,
 *   }, async () => ({ status: 'succeeded', applied: [...] }));
 *
 * `execute` returns the canonical receipt body (without `operationId`, which is
 * added here). Throwing from `execute` records the operation as failed and
 * rethrows, so the route's own error handling still runs.
 *
 * Returns `{ status, result, replayed }`:
 *   - replayed false: this call did the work.
 *   - replayed true: a previous call did, and `result` is its stored receipt.
 *     `status` may be 'pending' or 'unknown', in which case `result` is null and
 *     the caller must not act.
 *
 * Throws `OPERATION_INPUT_MISMATCH` when the id was already used with different
 * input: that is a client bug or an attack, never a replay.
 */
export async function runOperation(
  supabase,
  { operationId, profileId = null, domain, kind, input, staleAfterMs = DEFAULT_STALE_AFTER_MS },
  execute,
) {
  assertDomain(domain, profileId);
  const hash = requestHash(input);

  // Claim the id. ignoreDuplicates makes this an atomic "insert if absent":
  // exactly one concurrent caller gets a row back, the rest get none.
  const { data: claimed, error: claimError } = await supabase
    .from('operations')
    .upsert(
      { operation_id: operationId, profile_id: profileId, domain, kind, status: 'pending', request_hash: hash },
      { onConflict: 'operation_id', ignoreDuplicates: true },
    )
    .select('operation_id');
  if (claimError) throw claimError;

  if (!claimed || claimed.length === 0) {
    return replayExisting(supabase, { operationId, profileId, domain, hash, staleAfterMs });
  }

  let receipt;
  try {
    receipt = await execute();
  } catch (error) {
    await settle(supabase, operationId, 'failed', null);
    throw error;
  }
  const stored = { ...receipt, operationId, status: receipt?.status ?? 'succeeded' };
  await settle(supabase, operationId, TERMINAL.has(stored.status) ? stored.status : 'succeeded', stored);
  return { status: stored.status, result: stored, replayed: false };
}

async function settle(supabase, operationId, status, result) {
  const { error } = await supabase
    .from('operations')
    .update({ status, result, updated_at: new Date().toISOString() })
    .eq('operation_id', operationId);
  // A failed settle leaves the row pending, which readers report as 'unknown'.
  // That is the honest outcome, so it is logged rather than thrown over the
  // effect that already succeeded.
  if (error) console.error(`operations: could not settle ${operationId} as ${status}:`, error.message);
}

async function replayExisting(supabase, { operationId, profileId, domain, hash, staleAfterMs }) {
  const row = await fetchRow(supabase, { operationId, profileId, domain });
  if (!row) {
    // The id exists but not for this owner or domain. Say nothing about whose it is.
    throw new Error(OPERATION_INPUT_MISMATCH);
  }
  if (hash && row.request_hash && row.request_hash !== hash) {
    throw new Error(OPERATION_INPUT_MISMATCH);
  }
  const status = effectiveStatus(row, staleAfterMs);
  return { status, result: TERMINAL.has(status) ? row.result : null, replayed: true };
}

/**
 * The canonical outcome of a previous operation, for `GET /api/operations`.
 * Returns null when this owner has no such operation in this domain, which the
 * route reports as a 404 rather than inventing a status.
 */
export async function readOperation(
  supabase,
  { operationId, profileId = null, domain, staleAfterMs = DEFAULT_STALE_AFTER_MS },
) {
  assertDomain(domain, profileId);
  const row = await fetchRow(supabase, { operationId, profileId, domain });
  if (!row) return null;
  const status = effectiveStatus(row, staleAfterMs);
  const stored = TERMINAL.has(status) && row.result && typeof row.result === 'object' ? row.result : null;
  return { operationId, domain: row.domain, kind: row.kind, status, result: stored, createdAt: row.created_at };
}

/** One row, scoped to the owner and domain so another household's id is simply not found. */
async function fetchRow(supabase, { operationId, profileId, domain }) {
  let query = supabase
    .from('operations')
    .select('operation_id, profile_id, domain, kind, status, request_hash, result, created_at')
    .eq('operation_id', operationId)
    .eq('domain', domain);
  // The unauthenticated domain has no owner to scope by; everything else must.
  query = profileId ? query.eq('profile_id', profileId) : query.is('profile_id', null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}
