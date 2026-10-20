import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse } from '@/lib/serverAuth';
import { apiError, internalError, loggableError, requestIdFor, validationError } from '@/lib/apiErrors';
import { readJsonBody } from '@/lib/validate';
import { featureEnabled } from '@/lib/features';
import { parseNeed, resolveContacts, sourcesUsable, writeUnavailable } from '@/lib/outreach';

/**
 * POST /api/outreach/contacts  { topic, recipient, water, area }  (registry `contacts.resolve`, runtime.ts:50)
 *
 *   200 { contacts: PublicContact[], coverage: 'matched' | 'none', message? }
 *
 * Official public offices for a question and an area (B17 Ruling O3), from
 * the static directory lib/data/ncOutreachContacts.json: never a person's
 * address, never one constructed from a pattern, and never a search or a
 * network call. `email` is null unless the official page prints an
 * organizational mailbox. When no office is known the list is empty and
 * `message` says so. The answer passes the client's `validContacts`
 * (explore-service.ts:59-60); the screen reads only that.
 *
 * A POST that reads nothing private and writes nothing, so there is no ledger
 * claim; the `Idempotency-Key` the runtime sends is not needed. The area is
 * read by its `id` only and resolved against the gazetteer (lib/places.js),
 * so a label or anything else the client sent is never used. Flag `outreach`
 * off: 403 `feature_unavailable` (Ruling O1), which the client reads as a
 * definite answer; a 5xx would be `unknown_outcome` for a POST.
 */

export const maxDuration = 60;

export async function POST(request) {
  const requestId = requestIdFor(request);
  try {
    await requireUser(request);
    if (!featureEnabled('outreach')) return writeUnavailable(requestId);
    if (!sourcesUsable()) return writeUnavailable(requestId);

    const body = await readJsonBody(request, { maxBytes: 8192 });
    if (!body.ok) return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    const need = parseNeed(body.value);
    if (!need.ok) return validationError(need.fieldErrors, requestId);

    return NextResponse.json(resolveContacts(need.value), { headers: { 'X-Request-Id': requestId, 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`outreach contacts failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
