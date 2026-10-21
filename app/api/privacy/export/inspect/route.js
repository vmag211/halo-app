import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, loggableError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody } from '@/lib/validate';
import { checkLimit, privacyLimiter } from '@/lib/ratelimit';
import { EXPORT_GROUPS, PRIVACY_SCOPES, fingerprintTables } from '@/lib/privacyInventory';
import { mintReviewToken } from '@/lib/privacyToken';
import {
  isPrivacyUnavailable,
  openPrivacy,
  privacyCounts,
  privacyFingerprint,
  privacyUnavailable,
} from '@/lib/privacyStore';
import {
  EXPORT_TOO_LARGE,
  buildClearPreview,
  buildExportDocument,
  clearTotal,
  exportPreview,
  privacyLimitKey,
} from '@/lib/privacyExport';

/**
 * POST /api/privacy/export/inspect   (registry `privacy.inspect`)
 *
 *   {scope, groups, privateText}  ->  {reviewToken, expiresAt, count, preview}
 *
 * Opens a privacy review: what an export of the selected groups would contain
 * (`scope: 'export'`), or what Clear Journal or clear all would remove
 * (`'journal'`, `'all'`). B07 plan, Task 4; Rulings P1, P5, P6, P8, P10, P11,
 * P15 and P17.
 *
 * The client checks the answer like this (ProductionPrivacy.tsx:22):
 *
 *   if(typeof data.reviewToken!=='string'||!Number.isSafeInteger(data.count)
 *      ||data.count<0||!Number.isFinite(Date.parse(data.expiresAt))
 *      ||Date.parse(data.expiresAt)<=Date.now())throw new Error('invalid');
 *
 * and shows `count` and the pretty-printed `preview`. The preview of an
 * export is its manifest and the field names each table contributes, not the
 * records (MP-388); of a clear, the records to be removed by group, what
 * survives and the limits of a deletion.
 *
 * NOTHING IS WRITTEN. Inspect is never ledgered (trap P-2): a crashed inspect
 * can never appear in `privacy.status`, where no scope would be true for it.
 * It is a POST only because it mints a capability. The `Idempotency-Key` the
 * client sends with it is accepted and ignored.
 *
 * THE TOKEN (P6) is stateless and binds this household, the scope, the
 * selection and a fingerprint of the records the person's own actions write.
 * The fingerprint is read BEFORE the records are counted, so a change between
 * the two can only make the later export or clear refuse with "review
 * changed", never act on records the person was not shown. The household is
 * the verified session's (P1); `X-Halo-Home-Context` is not read.
 *
 * THE BODY is exactly the three fields. `groups` must be distinct export
 * groups; it may be empty for the two clears, which send the export selection
 * too (trap P-3), and must not be for an export. Anything else is a 400.
 *
 * Order: session, then availability (the review key and migration 0024, P11;
 * 0024 refuses to apply without 0017, so its probe covers the ledger too),
 * then the per-household limit, shared with export (30 an hour, FAIL-OPEN, so
 * an Upstash outage never stops a person reading or deleting their own data),
 * then the body. Answers: 200; 400 for a bad body or any `If-Match`; 401; 413
 * over 2,048 bytes; 422 `export_too_large` when the export receipt would pass
 * 4,000,000 bytes (P8); 429; 503 `feature_unavailable` (non-retryable) when
 * privacy is not available; 500 when a record read fails, with nothing minted.
 */

// House value, under the ledger's 120 s staleness window like every privacy route (P17).
export const maxDuration = 60;

const MAX_BYTES = 2048;
const BODY_KEYS = Object.freeze(['scope', 'groups', 'privateText']);

const TOO_LARGE_MESSAGE = 'This export is too large to download at once. Choose fewer groups and try again.';
const LIMITED_MESSAGE = 'Too many privacy requests. Please try again later.';

const fieldError = (field, code, message) => ({ field, code, message });

/** The body's problems, or none. */
function bodyErrors(value) {
  const errors = [];
  const unknown = Object.keys(value).filter((key) => !BODY_KEYS.includes(key)).sort();
  for (const key of unknown) errors.push(fieldError(key, 'unknown_field', 'Only scope, groups and privateText can be sent.'));
  if (!PRIVACY_SCOPES.includes(value.scope)) {
    errors.push(fieldError('scope', 'invalid_scope', 'Choose export, journal or all.'));
  }
  const groups = value.groups;
  if (!Array.isArray(groups)) {
    errors.push(fieldError('groups', 'invalid_groups', 'Groups must be a list.'));
  } else if (groups.some((group) => !EXPORT_GROUPS.includes(group))) {
    errors.push(fieldError('groups', 'invalid_groups', `Groups can only be ${EXPORT_GROUPS.join(', ')}.`));
  } else if (new Set(groups).size !== groups.length) {
    errors.push(fieldError('groups', 'duplicate_group', 'Each group can be chosen once.'));
  } else if (value.scope === 'export' && groups.length === 0) {
    errors.push(fieldError('groups', 'required', 'Choose at least one group to export.'));
  }
  if (typeof value.privateText !== 'boolean') {
    errors.push(fieldError('privateText', 'invalid_boolean', 'Choose whether to include private text.'));
  }
  return errors;
}

export async function POST(request) {
  const requestId = requestIdFor(request);
  // A review token is a capability: never cached anywhere.
  const headers = { 'X-Request-Id': requestId, 'Cache-Control': 'no-store' };
  try {
    const { userId } = await requireUser(request);

    const key = await openPrivacy(supabaseAdmin);
    if (!key) return privacyUnavailable(requestId);

    const allowed = await checkLimit(privacyLimiter, privacyLimitKey(userId), { fallback: true, label: 'privacy limiter' });
    if (!allowed) return apiError({ status: 429, code: ERROR_CODES.RATE_LIMITED, message: LIMITED_MESSAGE, requestId });

    // No privacy call sends a precondition (digest section 1); one that does is confused.
    if (request.headers.get('if-match') !== null) {
      return validationError(
        [fieldError('If-Match', 'unexpected_header', 'Privacy reviews do not take an If-Match header.')],
        requestId,
      );
    }

    const body = await readJsonBody(request, { maxBytes: MAX_BYTES });
    if (!body.ok) return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    const errors = bodyErrors(body.value);
    if (errors.length > 0) return validationError(errors, requestId);
    const { scope, groups, privateText } = body.value;

    const now = new Date();
    const fingerprint = await privacyFingerprint(supabaseAdmin, {
      profileId: userId,
      tables: fingerprintTables(scope, groups),
    });

    let count;
    let preview;
    if (scope === 'export') {
      const built = await buildExportDocument(supabaseAdmin, { profileId: userId, groups, privateText, now });
      if (built.tooLarge) {
        return apiError({ status: 422, code: EXPORT_TOO_LARGE, message: TOO_LARGE_MESSAGE, retryable: false, requestId });
      }
      count = built.total;
      preview = exportPreview(built);
    } else {
      const counts = await privacyCounts(supabaseAdmin, { profileId: userId, scope });
      count = clearTotal(counts);
      preview = buildClearPreview({ scope, counts });
    }

    const minted = mintReviewToken(key, { profileId: userId, scope, groups, privateText, fingerprint, now });
    if (!minted) return privacyUnavailable(requestId);

    return NextResponse.json({ reviewToken: minted.reviewToken, expiresAt: minted.expiresAt, count, preview }, { headers });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    if (isPrivacyUnavailable(err)) return privacyUnavailable(requestId);
    // Code and message only: never a row, a token or a fingerprint.
    console.error(`privacy inspect failed (request ${requestId}):`, loggableError(err));
    return internalError(requestId);
  }
}
