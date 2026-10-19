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
 * dead process must never look like work still in progress. The next time that
 * household's inventory is read (listUnresolvedOperations), such a row is
 * reaped to 'failed', because an abandoned claim would otherwise lock its
 * surface forever.
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
  return { status, result: storedReceipt(row, status), replayed: true };
}

/**
 * The receipt to replay for a row, or null when there is none to act on. It
 * always carries the row's own operationId: a receipt runOperation stored
 * already does, and one the reaper wrote is given it here, because the client
 * rejects a receipt whose operationId does not match the one it sent. A row
 * settled without a receipt (an in-process throw) stays null, as it always was.
 */
function storedReceipt(row, status) {
  if (!TERMINAL.has(status) || !row.result || typeof row.result !== 'object') return null;
  return { ...row.result, operationId: row.operation_id };
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
  return { operationId, domain: row.domain, kind: row.kind, status, result: storedReceipt(row, status), createdAt: row.created_at };
}

/**
 * The `reason` a reaped receipt carries: the process that claimed the
 * operation never settled it within its window. A code rather than copy, so
 * each domain's client keeps showing its own "was not applied" message.
 */
export const ABANDONED_REASON = 'abandoned';

/**
 * Settle this owner's abandoned operations in these domains as 'failed'.
 *
 * Why it exists. Only an in-process throw settles a row as failed, so a
 * serverless timeout or a killed instance leaves its claim pending for good.
 * `unresolvedOperations` is a lock on the frontend, so one such row would keep
 * its whole surface read-only forever. Reaping where the inventory is read
 * means every caller of `listUnresolvedOperations` is covered without a
 * scheduler and without route changes.
 *
 * What it may touch, all enforced by the one conditional UPDATE below rather
 * than by a read followed by a write:
 *   - `status = 'pending'` at write time. Postgres re-checks the WHERE clause
 *     against the latest committed row before updating it, so an operation
 *     that settles concurrently is skipped, and a second reaper racing this
 *     one finds nothing left to do.
 *   - `created_at` older than `staleAfterMs`: exactly the rows
 *     `effectiveStatus` already reports as 'unknown', so nothing a reader would
 *     still call 'pending' is reaped. The same window, not a second number.
 *   - this owner and these domains only. The owner is the verified one the
 *     caller passed; there is no unscoped sweep, and unowned recovery rows are
 *     never reached from here.
 *
 * 'failed', never 'cancelled': the summary client's `validSummaryReceipt`
 * rejects 'cancelled', so a cancelled row could never be cleared. The receipt
 * is the operation id, the status and a reason code. Nothing from the request
 * goes in, so nothing proof-bearing can be disclosed by a replay of it.
 *
 * A missing table is rethrown, so the caller reports the feature unavailable
 * exactly as it did before the reaper. Any other failure is logged and the
 * read goes on: the rows stay pending and listed, which is the honest state,
 * and the next read tries again.
 */
async function reapAbandonedOperations(supabase, { profileId, domains, staleAfterMs }) {
  const cutoff = new Date(Date.now() - staleAfterMs).toISOString();
  const { error } = await supabase
    .from('operations')
    .update({
      status: 'failed',
      // No operationId: one statement cannot copy a column into the receipt
      // through PostgREST. Every replay and read adds it from the row
      // (storedReceipt), so the receipt a client gets still carries its id.
      result: { status: 'failed', reason: ABANDONED_REASON },
      updated_at: new Date().toISOString(),
    })
    .eq('profile_id', profileId)
    .in('domain', domains)
    .eq('status', 'pending')
    .lt('created_at', cutoff);
  if (!error) return;
  if (isOperationsUnavailable(error)) throw error;
  console.error('operations: could not reap abandoned operations:', error.code ?? '', error.message);
}

/**
 * The operation ids this household started and that are not settled yet, for
 * the `unresolvedOperations` inventory every initial read carries.
 *
 * Abandoned work is reaped first (reapAbandonedOperations), using the same
 * `staleAfterMs` the domain reports with, so a row past its window is settled
 * as failed and drops out instead of locking the surface forever. A caller
 * whose domain passes a longer window to runOperation and readOperation must
 * pass the same one here.
 *
 * Settled ids are deliberately absent, which is how the client learns an
 * operation it was tracking is finished.
 */
export async function listUnresolvedOperations(
  supabase,
  { profileId, domains, staleAfterMs = DEFAULT_STALE_AFTER_MS },
) {
  if (!profileId) throw new Error('operations: listing unresolved work requires an owner');
  for (const domain of domains) {
    if (!OPERATION_DOMAINS.includes(domain)) throw new Error(`operations: unknown domain "${domain}"`);
  }
  await reapAbandonedOperations(supabase, { profileId, domains, staleAfterMs });
  const { data, error } = await supabase
    .from('operations')
    .select('operation_id, status, created_at')
    .eq('profile_id', profileId)
    .in('domain', domains)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  // Stored 'pending' is the right filter: a reader may call such a row
  // 'pending' or, past its window, 'unknown', and both are unresolved. The
  // staleness line matters when reporting one operation's outcome, not when
  // listing what is still outstanding.
  return (data || []).map((row) => row.operation_id);
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
