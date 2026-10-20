import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, loggableError, requestIdFor, ERROR_CODES } from '@/lib/apiErrors';
import { attachmentsEnabled, attachmentsUnavailable, descriptorOf, isAttachmentsUnavailable, readAttachment } from '@/lib/attachmentStore';

/**
 * GET /api/attachments/inspect?id=<attachment id>  (registry `attachments.inspect`, runtime.ts:25)
 *
 *   200 { id, revision, name, mime, bytes, status, metadataRemoved }
 *
 * The current descriptor of one of the caller's files (B14 plan), which the
 * adapter checks with `attachment()` (adapters.ts:15,22). Another household's
 * id, a malformed id and a removed file are the same 404. Identity only from
 * the verified token; owner scoping is in read_household_attachment's own
 * query. Flag off or 0028 missing: the non-retryable 503 (Ruling A6). Never
 * cached.
 */

export const maxDuration = 30;

export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId, 'Cache-Control': 'private, no-store' };
  try {
    const { userId } = await requireUser(request);
    if (!attachmentsEnabled()) return attachmentsUnavailable(requestId);
    const id = new URL(request.url).searchParams.get('id');
    const file = await readAttachment(supabaseAdmin, userId, typeof id === 'string' ? id.trim().toLowerCase() : '');
    if (!file) return apiError({ status: 404, code: ERROR_CODES.NOT_FOUND, message: 'That file was not found.', retryable: false, requestId });
    return NextResponse.json(descriptorOf(file), { headers });
  } catch (err) {
    if (isAttachmentsUnavailable(err)) return attachmentsUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`attachment inspect failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
