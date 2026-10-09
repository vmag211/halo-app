import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { requestIdFor, internalError } from '@/lib/apiErrors';
import { HOME_CONTEXTS_ROW_LIMIT, isTruncated } from '@/lib/boundedRead';
import { contextSummary } from '@/lib/homeContext';
import { HOME_CONTEXT_FIELDS, homeContextUnavailable, isHomeContextUnavailable } from '@/lib/homeContextRpc';

/**
 * GET /api/home-contexts: the homes this household has lived in (migration 0016).
 *
 *   200 { items: [contextSummary, ...], current_id, count, truncated }
 *
 * Newest first (highest sequence). `current_id` is the current home's id, null
 * when there is none. A household that has not onboarded has no homes: that is
 * `items: []` with `current_id: null`, a true answer, not an error. At most 100
 * homes are read; `truncated` says when there are more (the oldest are cut, and
 * the current home, which always has the highest sequence, never is).
 *
 * Each item is lib/homeContext.js contextSummary: the household's own point is
 * included, the owner id and the onboarding request id never are (they are not
 * even read).
 *
 * Until migration 0016 is applied the table does not exist: that is a 503
 * `feature_unavailable` (not retryable), never an empty list.
 *
 * Read-only and owner-scoped: the identity is the verified session token.
 */
export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);

    const { data, error, count } = await supabaseAdmin
      .from('home_contexts')
      .select(HOME_CONTEXT_FIELDS, { count: 'exact' })
      .eq('profile_id', userId)
      .order('sequence', { ascending: false })
      .limit(HOME_CONTEXTS_ROW_LIMIT);
    if (error && isHomeContextUnavailable(error)) return homeContextUnavailable(requestId);
    if (error) throw new Error(error.message);

    const rows = data || [];
    const items = rows.map(contextSummary);
    return NextResponse.json(
      {
        items,
        current_id: items.find((item) => item.current)?.id ?? null,
        count: items.length,
        truncated: isTruncated({ count, returned: rows.length, limit: HOME_CONTEXTS_ROW_LIMIT }),
      },
      { headers },
    );
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`home-contexts failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
