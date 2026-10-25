import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { lazyClient } from '@/lib/lazyClient';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { readSummaryEvidence } from '@/lib/summaryEvidence';
import { buildStageData } from '@/lib/frontend/stage-data';
import { apiError, internalError, loggableError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody, parseUuid } from '@/lib/validate';
import { featureDisabledReason, featureEnabled } from '@/lib/features';
import { OPERATION_INPUT_MISMATCH, isOperationsUnavailable, listUnresolvedOperations, runOperation } from '@/lib/operations';
import { readCurrentHomeContext } from '@/lib/homeContextRpc';
import { isActionsUnavailable, readActionsState } from '@/lib/actionsStore';
import { readWorkspaceCollections } from '@/lib/workspaceStore';
import {
  LIMITS,
  SECTION_COLLECTIONS,
  STORED_REFUSALS,
  SUMMARY_DOMAIN,
  SUMMARY_KIND,
  categoryLabels,
  commitRefusal,
  commitSummary,
  composeSummary,
  isSummaryUnavailable,
  parseSummaryRequest,
  readCategoryRow,
  readSummaryList,
  recordedReceipt,
  refusalBody,
  requestedRecordsCurrent,
  summaryUnavailable,
  summaryUsage,
} from '@/lib/summaryStore';

/**
 * GET /api/summaries   (registry `summary.list`, runtime.ts:75)
 *
 *   200 { items: [{id, revision, title, createdAt, homeContextId}], complete, unresolvedOperations: [...] }
 *
 * The household's saved summaries, newest first (B15 plan). `validSummaryList`
 * (summary-service.ts:15) needs all three keys in every state, the empty one
 * included, or the screen says "Summary history could not be verified." and
 * blocks a prepare (useProductionSummary.ts:12,26). `unresolvedOperations` is
 * the household's unsettled `summary` operations, read (and reaped) BEFORE
 * the list: a prepare saves and settles in one transaction, so an operation
 * missing from the list is already in the items. Any id there locks the
 * screen behind "Check summary status" (SummaryWorkspace.tsx:185).
 *
 * POST /api/summaries   (registry `summary.prepare`, runtime.ts:74)
 *
 *   { selection, records: [{kind, id, revision}], collectionRevisions, homeContextId }
 *     ->  200 { operationId, status: 'succeeded', snapshot }
 *     ->  200 { operationId, status: 'failed', reason, message }
 *     ->  200 { operationId, status: 'pending' | 'unknown', message }   (a replay in flight)
 *
 * The operation id is the `Idempotency-Key` header and nothing else: the body
 * carries none (SummaryWorkspace.tsx:112; B05 digest 9.6), and the receipt
 * must echo it exactly (summary-service.ts:16). A 5xx parks the id on the
 * screen until GET /api/operations?domain=summary settles it, so every answer
 * the person can act on is a 200 receipt, and only a lost database answer is
 * a 500.
 *
 * ORDER. Session; the body (1,000,000 bytes); the key; the `summaries` and
 * `workspace` flags (off: a 200 failed receipt, recorded nowhere, Ruling
 * S15-10); the request (`parseSummaryRequest`, 400 for anything malformed);
 * 0029 proved by its usage function before the claim (missing: the same
 * failed receipt, recorded nowhere); then the ledger claim, inside which the
 * current home is checked against the body and `X-Halo-Home-Context`
 * (Ruling S15-2), the selected records are read and checked at their
 * revisions (S15-5), the snapshot is composed (S15-6 to S15-9), and
 * commit_household_summary checks the home and every revision again under its
 * locks, saves, and settles this operation `succeeded` with the summary id
 * only. A refusal is stored as a reason code and replayed as the same body.
 *
 * Everything that can fail after the claim fails inside it, so the ledger row
 * always tells the truth and a reconcile can settle it. Log lines carry the
 * error's code and message only (loggableError), never a record or a report.
 * No top-level `data` key in any body; `Cache-Control: no-store` on every
 * answer that carries a summary.
 */

export const maxDuration = 60;

// The public client GET /api/home-guard reads ucmr5_utilities with (built on first use).
const utilities = lazyClient(() =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
);

/**
 * Today and Homeguard as the screens show them for the current home (Ruling
 * S15-6 as revised): the score endpoints' own computations
 * (lib/summaryEvidence.js) turned into the screens' StageData by the screens'
 * own mapper. Read only when a score or factor section is selected.
 */
async function readEvidence(userId, selection, home, requestId) {
  if (!selection.sections.scores && !selection.sections.factors) return null;
  try {
    const { daily, homeGuard, profile } = await readSummaryEvidence({ admin: supabaseAdmin, utilities, profileId: userId, home });
    return { data: buildStageData(daily, homeGuard, profile), privateWater: homeGuard?.water?.status === 'private_well' };
  } catch (err) {
    // The selected records can still be saved: both sections are then saved as
    // unavailable, and the scope line and omissions say so.
    console.error(`summary prepare: the score evidence could not be read (request ${requestId}):`, loggableError(err));
    return null;
  }
}

const NO_STORE = 'no-store';

const MESSAGES = Object.freeze({
  idempotencyKey: 'Send an Idempotency-Key header carrying this request\'s own id.',
  mismatch: 'That request was already made with different details. Please try again.',
});

const respond = (body, requestId) => NextResponse.json(body, { headers: { 'X-Request-Id': requestId, 'Cache-Control': NO_STORE } });

/** Both capabilities this needs (Ruling S15-10). */
const enabled = () => featureEnabled('summaries') && featureEnabled('workspace');

/** The sources the selection reads: workspace sections from 0026, tasks from 0023 when on. Null marks a section unavailable. */
async function readSources(userId, selection) {
  const sources = {};
  const sections = Object.keys(SECTION_COLLECTIONS).filter((section) => selection.sections[section]);
  if (sections.length) {
    const read = await readWorkspaceCollections(supabaseAdmin, userId, sections.map((section) => SECTION_COLLECTIONS[section]));
    for (const section of sections) sources[section] = read[SECTION_COLLECTIONS[section]];
  }
  if (selection.sections.actions) {
    // Ruling S15-7: tasks only while `tasks` is on and 0023 is applied.
    sources.actions = null;
    if (featureEnabled('tasks')) {
      try {
        sources.actions = (await readActionsState(supabaseAdmin, userId)).snapshot.actions;
      } catch (err) {
        if (!isActionsUnavailable(err)) throw err;
      }
    }
  }
  return sources;
}

export async function GET(request) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);
    if (!enabled()) return summaryUnavailable(requestId);
    const unresolvedOperations = (await listUnresolvedOperations(supabaseAdmin, { profileId: userId, domains: [SUMMARY_DOMAIN] }))
      .slice(0, LIMITS.unresolved);
    const { items, complete } = await readSummaryList(supabaseAdmin, userId);
    return respond({ items, complete, unresolvedOperations }, requestId);
  } catch (err) {
    if (isSummaryUnavailable(err) || isOperationsUnavailable(err)) return summaryUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`summary list failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}

export async function POST(request) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);

    const body = await readJsonBody(request, { maxBytes: LIMITS.bodyBytes });
    if (!body.ok) return apiError({ status: body.status, code: body.code, message: body.message, requestId });

    const key = parseUuid((request.headers.get('idempotency-key') ?? '').trim().toLowerCase());
    if (!key.ok) return validationError([{ field: 'Idempotency-Key', code: key.code, message: MESSAGES.idempotencyKey }], requestId);
    // The client compares the receipt's id with the key it sent, byte for
    // byte, so the receipt echoes the header exactly as sent.
    const operationId = key.value;
    const echoId = (request.headers.get('idempotency-key') ?? '').trim();
    const answer = (receipt) => respond({ operationId: echoId, ...receipt }, requestId);

    // Off (Ruling S15-10): nothing read, nothing claimed. A 200 receipt, not
    // a 5xx, which this client would read as unknown and lock on.
    if (!enabled()) return answer({ status: 'failed', reason: 'unavailable', message: featureDisabledReason('summaries') });

    const parsed = parseSummaryRequest(body.value);
    if (!parsed.ok) return validationError(parsed.fieldErrors, requestId);
    const { selection, records, homeContextId } = parsed.value;
    const headerHome = (request.headers.get('x-halo-home-context') ?? '').trim() || null;

    // Proves 0029 before the claim: a missing function is the failed receipt,
    // recording nothing. Any other failure here is the same answer, logged:
    // nothing was claimed or saved, and a 5xx would park an id that no
    // reconcile could ever settle (it was never recorded).
    try {
      await summaryUsage(supabaseAdmin, userId);
    } catch (err) {
      if (!isSummaryUnavailable(err)) console.error(`summary prepare: the usage check failed before any claim (request ${requestId}):`, loggableError(err));
      return answer(refusalBody('unavailable'));
    }

    let committed = null;
    const outcome = await runOperation(
      supabaseAdmin,
      {
        operationId,
        profileId: userId,
        domain: SUMMARY_DOMAIN,
        kind: SUMMARY_KIND,
        input: { selection, records, homeContextId, headerHome },
      },
      async () => {
        const stored = (reason) => ({ status: 'failed', reason, unresolvedOperations: [] });
        try {
          // Ruling S15-2: the server's current home is the summary's; a sent one is a check.
          const current = await readCurrentHomeContext(supabaseAdmin, userId);
          const home = current.unavailable ? null : current.context;
          const homeId = home?.id ?? null;
          if ((homeContextId !== null && homeContextId !== homeId) || (headerHome !== null && headerHome !== homeId)) return stored('home_changed');

          if ((await summaryUsage(supabaseAdmin, userId)) >= LIMITS.perHousehold) return stored('limit');
          const sources = await readSources(userId, selection);
          if (!requestedRecordsCurrent(records, sources)) return stored('changed');
          const categories = selection.categories ? categoryLabels(await readCategoryRow(supabaseAdmin, userId)) : [];
          const evidence = await readEvidence(userId, selection, home, requestId);

          const composed = composeSummary({
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            selection,
            records,
            sources,
            home,
            categories,
            evidence,
          });
          if (!composed.ok) return stored(composed.reason);
          committed = await commitSummary(supabaseAdmin, { profileId: userId, operationId, summary: composed.summary });
          return { status: 'succeeded', summaryId: committed.id, unresolvedOperations: [] };
        } catch (err) {
          const reason = commitRefusal(err) ?? (isSummaryUnavailable(err) ? 'unavailable' : null);
          if (reason) return stored(reason);
          throw err;
        }
      },
    );

    if (!outcome.replayed) {
      const result = outcome.result;
      if (result.status === 'succeeded' && committed) return answer({ status: 'succeeded', snapshot: committed });
      if (result.status === 'failed' && STORED_REFUSALS.includes(result.reason)) return answer(refusalBody(result.reason));
    }
    // A replay of the same key (or an answer this call could not build from
    // its own commit): the recorded outcome, as GET /api/operations gives it.
    return answer(await recordedReceipt(supabaseAdmin, userId, { status: outcome.status, result: outcome.result }));
  } catch (err) {
    if (err?.message === OPERATION_INPUT_MISMATCH) {
      return apiError({ status: 409, code: ERROR_CODES.CONFLICT, message: MESSAGES.mismatch, retryable: false, requestId, extra: { reason: 'operation_mismatch' } });
    }
    if (isOperationsUnavailable(err) || isSummaryUnavailable(err)) {
      // Before the claim (0017 missing): nothing was recorded.
      const echoId = (request.headers.get('idempotency-key') ?? '').trim();
      return respond({ operationId: echoId, ...refusalBody('unavailable') }, requestId);
    }
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`summary prepare failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
