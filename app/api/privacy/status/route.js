import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { requestIdFor, internalError, loggableError } from '@/lib/apiErrors';
import { isOperationsUnavailable, listUnresolvedOperations } from '@/lib/operations';
import { privacyReviewKey } from '@/lib/privacyToken';
import { PRIVACY_DOMAIN, privacyUnavailable, probePrivacySchema, purgePrivacyReceipts } from '@/lib/privacyStore';

/**
 * GET /api/privacy/status  (registry `privacy.status`, runtime.ts:86)
 *
 *   200 { unresolvedOperations: [{ operationId, scope }, ...] }
 *
 * The Settings privacy panel reads this before it enables anything
 * (ProductionPrivacy.tsx:17-19). Its `verified` check needs every entry to be
 * an object with a non-empty `operationId` and a `scope` of `export`,
 * `journal` or `all`; an array of bare ids (what listUnresolvedOperations
 * returns) fails it and leaves the whole panel reading "Privacy requests are
 * unavailable." (digest trap P-1). So, Ruling P14:
 *
 *   1. listUnresolvedOperations for the `privacy` domain only, first, because
 *      that is where an abandoned privacy claim is reaped to `failed`, so a
 *      dead export or clear cannot lock the panel for ever;
 *   2. a second, owner-scoped select of `operations` for the `kind` of those
 *      ids (lib/operations.js is not edited), mapped `privacy.export` to
 *      `export`, `privacy.clear.journal` to `journal`, `privacy.clear.all` to
 *      `all`. A kind outside the map is omitted and logged (no route writes
 *      one). At most 100 entries, oldest first: the client locks on the first.
 *
 * Inspect is never ledgered, so a crashed inspect can never be listed (trap
 * P-2). The empty state is exactly `{"unresolvedOperations":[]}`, never a
 * top-level `data` key (runtime.ts:149-153 would unwrap it to null).
 *
 * Availability is reported here, never first discovered by a mutation (P11):
 * a missing or short HALO_PRIVACY_REVIEW_KEY, migration 0024 not applied
 * (probed with privacy_schema_version) or 0017 not applied is a
 * non-retryable 503 `feature_unavailable`, and nothing is written. The client
 * shows its own "Privacy requests are unavailable." with Try again.
 *
 * Receipt retention (P10): before listing, this household's privacy receipts
 * settled more than 24 hours ago are deleted (purge_privacy_receipts, owner
 * scoped). A failed purge is logged by its code and never fails the read; the
 * daily cron purges every household's as well.
 *
 * Identity comes only from the verified token (P1). The query string and
 * X-Halo-Home-Context are ignored: privacy belongs to the household. Logs
 * carry error codes, counts and kinds only, never an id.
 */

// The house ceiling for ledger routes, under the 120 s staleness window (P17).
export const maxDuration = 60;

/** The client takes the first entry as its lock; 100 bounds the body (P14). */
const MAX_UNRESOLVED = 100;

/** The ledger kinds the privacy routes write, and the scope the client knows each by (P14). */
const SCOPE_BY_KIND = Object.freeze({
  'privacy.export': 'export',
  'privacy.clear.journal': 'journal',
  'privacy.clear.all': 'all',
});

/** Deletes this household's settled privacy receipts older than 24 hours; never fatal (P10). */
async function purgeOwnReceipts(profileId) {
  try {
    await purgePrivacyReceipts(supabaseAdmin, { profileId });
  } catch (err) {
    const code = typeof err?.code === 'string' && /^[A-Za-z0-9_]{1,16}$/.test(err.code) ? err.code : 'unexpected';
    console.error('Privacy status: the receipt purge failed; the read goes on:', code);
  }
}

/** `{operationId, scope}` for each unresolved id whose kind maps, in the order given. */
async function withScopes(profileId, ids) {
  if (ids.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('operations')
    .select('operation_id, kind')
    .eq('profile_id', profileId)
    .eq('domain', PRIVACY_DOMAIN)
    .in('operation_id', ids);
  if (error) throw error;
  const kinds = new Map((data || []).map((row) => [row.operation_id, row.kind]));
  const listed = [];
  const unmapped = [];
  for (const operationId of ids) {
    if (!kinds.has(operationId)) continue; // gone between the two reads
    const kind = kinds.get(operationId);
    const scope = Object.hasOwn(SCOPE_BY_KIND, kind) ? SCOPE_BY_KIND[kind] : null;
    if (scope) listed.push({ operationId, scope });
    else unmapped.push(kind);
  }
  if (unmapped.length) {
    const named = [...new Set(unmapped)].map((kind) => (typeof kind === 'string' ? kind.slice(0, 64) : 'unknown'));
    console.error(`Privacy status: omitted ${unmapped.length} unresolved operation(s) of an unmapped kind:`, named.join(', '));
  }
  return listed;
}

export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);
    if (!privacyReviewKey()) return privacyUnavailable(requestId);
    const probe = await probePrivacySchema(supabaseAdmin);
    if (!probe.available) return privacyUnavailable(requestId);

    await purgeOwnReceipts(userId);
    const unresolved = await listUnresolvedOperations(supabaseAdmin, { profileId: userId, domains: [PRIVACY_DOMAIN] });
    const unresolvedOperations = await withScopes(userId, unresolved.slice(0, MAX_UNRESOLVED));
    return NextResponse.json({ unresolvedOperations }, { headers });
  } catch (err) {
    if (isOperationsUnavailable(err)) return privacyUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`Privacy status read failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
