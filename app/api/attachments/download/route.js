import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, loggableError, requestIdFor, ERROR_CODES } from '@/lib/apiErrors';
import { attachmentsEnabled, attachmentsUnavailable, getObject, isAttachmentsUnavailable, readAttachment } from '@/lib/attachmentStore';

/**
 * GET /api/attachments/download?id=<attachment id>&revision=<n>  (registry `attachments.download`, runtime.ts:26)
 *
 *   200 the processed image's bytes, Content-Type its stored type
 *
 * The caller's own file at the exact revision the screen holds (B14 Ruling
 * A10; contract :549, "Private downloads require owner authorization and
 * exact attachment revision"). Streamed, not redirected: the client fetches
 * with `redirect: 'error'` (runtime.ts:132) and accepts only an image, PDF,
 * JSON or CSV blob up to 25 MiB (:134). The bytes are the re-encoded copy;
 * no original or metadata is ever stored, so none can be served.
 *
 * Another household's id, a malformed id and a removed file are the same
 * 404; a revision that is not the file's is a 409. The answer is never cached
 * (`private, no-store`), never sniffed into another type, never run as a page
 * (a sandbox CSP), and named generically: the stored name is private text and
 * the screen names the file itself (PrivateAttachments.tsx:24). Flag off or
 * 0028 missing: the non-retryable 503. Logs carry codes only.
 */

export const maxDuration = 30;

const EXTENSIONS = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' });

export async function GET(request) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);
    if (!attachmentsEnabled()) return attachmentsUnavailable(requestId);
    const params = new URL(request.url).searchParams;
    const revisionText = params.get('revision') ?? '';
    if (!/^[1-9][0-9]{0,8}$/.test(revisionText)) {
      const message = 'Send the revision of the file you are opening.';
      return apiError({ status: 400, code: ERROR_CODES.VALIDATION_FAILED, message, fieldErrors: [{ field: 'revision', code: 'invalid_revision', message }], retryable: false, requestId });
    }
    const id = params.get('id');
    const file = await readAttachment(supabaseAdmin, userId, typeof id === 'string' ? id.trim().toLowerCase() : '');
    if (!file) return apiError({ status: 404, code: ERROR_CODES.NOT_FOUND, message: 'That file was not found.', retryable: false, requestId });
    if (file.revision !== Number(revisionText)) {
      return apiError({ status: 409, code: ERROR_CODES.CONFLICT, message: 'This file changed. Refresh before opening it.', retryable: false, requestId });
    }
    const bytes = await getObject(supabaseAdmin, file.objectPath);
    if (bytes.byteLength !== file.bytes) {
      console.error(`attachment download: the stored object does not match its record (request ${requestId})`);
      return internalError(requestId);
    }
    return new Response(bytes, {
      status: 200,
      headers: {
        'X-Request-Id': requestId,
        'Content-Type': file.mime,
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `attachment; filename="halo-private-file.${EXTENSIONS[file.mime] ?? 'bin'}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    });
  } catch (err) {
    if (isAttachmentsUnavailable(err)) return attachmentsUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`attachment download failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
