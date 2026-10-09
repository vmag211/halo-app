import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { requestIdFor, apiError, validationError, internalError } from '@/lib/apiErrors';
import { parseUuid, readJsonBody } from '@/lib/validate';
import { contextSummary } from '@/lib/homeContext';
import { parseHomeContextPatch } from '@/lib/homeContextInput';
import {
  HOME_CONTEXT_FIELDS,
  homeContextConflict,
  homeContextNotFound,
  homeContextUnavailable,
  isConflictRefusal,
  isHomeContextUnavailable,
  updateHomeContextAttributes,
} from '@/lib/homeContextRpc';

/**
 * One of the household's homes (migration 0016).
 *
 *   GET   /api/home-contexts/<id>  200 { context: contextSummary }
 *   PATCH /api/home-contexts/<id>  { expected_revision, water_source?, home_year? }
 *                                  200 { context: contextSummary } with the revision bumped
 *
 * The id must be a UUID (400 `validation_failed` on field `id` otherwise). The
 * lookup is one owner-scoped statement (this household's id and the given id),
 * so a home that belongs to another household and one that does not exist are
 * the identical 404 `not_found`: same status, body and headers, and the same
 * statement. A closed home (the household moved on) can still be read.
 *
 * PATCH changes the answers about the current home through
 * update_home_context_attributes, which also keeps the profile's two columns in
 * step. The body is read with a 2048 byte limit (413 above it, 400 for invalid
 * JSON) and checked by lib/homeContextInput.js before the function is called: a
 * bad value or any other key (the owner id included) is a 400 with field_errors.
 * Then:
 *   409 `conflict`, reason 'stale_revision', with the home's current `revision`:
 *       it changed since the client read it; reload and retry with that revision.
 *   409 `conflict`, reason 'context_closed': no longer the current home.
 *   404 as GET: another household's home, a missing one, or no profile row.
 * The function refusing input the route accepted (HALO_INVALID_INPUT) means the
 * two disagree, and is a 500.
 *
 * Until migration 0016 is applied (PGRST205 or 42P01 for the table, PGRST202 or
 * 42883 for the function) both methods answer 503 `feature_unavailable`, not
 * retryable, and nothing is written.
 *
 * Identity comes from the verified session token; the id in the path is only a
 * lookup key next to it. Next.js 16 passes `params` as a Promise.
 */

const PATCH_MAX_BYTES = 2048;

/** The path id as a lowercase UUID, or the 400 that says it is not one. */
async function contextIdFrom(params, requestId) {
  const { id: raw } = await params;
  const id = parseUuid(raw);
  if (!id.ok) return { response: validationError([{ field: 'id', code: id.code, message: id.message }], requestId) };
  return { id: id.value };
}

export async function GET(request, { params }) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);
    const { id, response } = await contextIdFrom(params, requestId);
    if (response) return response;

    // One statement, owner first: another household's id finds nothing, exactly like a missing one.
    const { data, error } = await supabaseAdmin
      .from('home_contexts')
      .select(HOME_CONTEXT_FIELDS)
      .eq('profile_id', userId)
      .eq('id', id)
      .maybeSingle();
    if (error && isHomeContextUnavailable(error)) return homeContextUnavailable(requestId);
    if (error) throw new Error(error.message);
    if (!data) return homeContextNotFound(requestId);

    return NextResponse.json({ context: contextSummary(data) }, { headers: { 'X-Request-Id': requestId } });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`home-context read failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}

export async function PATCH(request, { params }) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);
    const { id, response } = await contextIdFrom(params, requestId);
    if (response) return response;

    const body = await readJsonBody(request, { maxBytes: PATCH_MAX_BYTES });
    if (!body.ok) {
      return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    }
    const input = parseHomeContextPatch(body.value);
    if (!input.ok) return validationError(input.fieldErrors, requestId);

    const saved = await updateHomeContextAttributes(supabaseAdmin, {
      profileId: userId,
      contextId: id,
      expectedRevision: input.value.expected_revision,
      attributes: input.value.attributes,
    });
    if (saved.unavailable) return homeContextUnavailable(requestId);
    if (saved.refusal) {
      const { code } = saved.refusal;
      if (code === 'HALO_CONTEXT_NOT_FOUND' || code === 'HALO_PROFILE_NOT_FOUND') return homeContextNotFound(requestId);
      if (isConflictRefusal(saved.refusal)) return homeContextConflict(saved.refusal, requestId);
      // HALO_INVALID_INPUT: the route accepted what the function refuses, so the two rules disagree.
      throw new Error(`update_home_context_attributes refused input the route accepted: ${code} (${saved.refusal.detail})`);
    }

    return NextResponse.json({ context: contextSummary(saved.context) }, { headers: { 'X-Request-Id': requestId } });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`home-context update failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
