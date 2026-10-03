/**
 * The API error envelope.
 *
 * Every error body keeps the legacy `error` string the approved frontend reads
 * and adds machine-readable fields next to it, so existing callers keep working
 * while new ones can branch on `code`, show `field_errors` beside inputs, and
 * quote `request_id` when something needs support.
 *
 *   { error, code, message, field_errors: [{ field, code, message }], retryable, request_id }
 *
 * Pure module: no imports, so tests can load it without a Supabase client.
 */

export const ERROR_CODES = {
  BAD_REQUEST: 'bad_request',
  VALIDATION_FAILED: 'validation_failed',
  AUTH_REQUIRED: 'auth_required',
  AUTH_UNAVAILABLE: 'auth_unavailable',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  PAYLOAD_TOO_LARGE: 'payload_too_large',
  RATE_LIMITED: 'rate_limited',
  UPSTREAM_UNAVAILABLE: 'upstream_unavailable',
  INTERNAL_ERROR: 'internal_error',
  FEATURE_UNAVAILABLE: 'feature_unavailable',
};

// Statuses where trying the same request again can reasonably succeed.
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

// A client-supplied id is only trusted when it cannot carry anything but a token.
const CLIENT_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

const VALIDATION_FALLBACK_MESSAGE = 'Some details need another look.';
const INTERNAL_MESSAGE = 'Something went wrong on our side. Please try again.';

/**
 * The id to stamp on this request's response: the caller's `x-request-id` when
 * it is well formed (so a client can correlate its own logs), else a fresh UUID.
 */
export function requestIdFor(request) {
  const incoming = request?.headers?.get('x-request-id');
  if (typeof incoming === 'string' && CLIENT_REQUEST_ID.test(incoming)) return incoming;
  return crypto.randomUUID();
}

function normalizeFieldErrors(fieldErrors) {
  if (!Array.isArray(fieldErrors)) return [];
  return fieldErrors.map(({ field, code, message }) => ({ field, code, message }));
}

/**
 * Builds the JSON error Response.
 *
 * @param {object} args
 * @param {number} args.status HTTP status.
 * @param {string} args.code One of ERROR_CODES.
 * @param {string} args.message Plain-language sentence safe to show in the app.
 * @param {{field: string, code: string, message: string}[]} [args.fieldErrors]
 * @param {boolean} [args.retryable] Defaults to true for 429, 502, 503, 504.
 * @param {number} [args.retryAfterSeconds] Sent as Retry-After when a positive integer.
 * @param {string} [args.requestId] Defaults to a fresh UUID.
 * @returns {Response}
 */
export function apiError({ status, code, message, fieldErrors, retryable, retryAfterSeconds, requestId } = {}) {
  const id = requestId || crypto.randomUUID();
  const headers = { 'X-Request-Id': id };
  if (Number.isInteger(retryAfterSeconds) && retryAfterSeconds > 0) {
    headers['Retry-After'] = String(retryAfterSeconds);
  }

  return Response.json(
    {
      error: message,
      code,
      message,
      field_errors: normalizeFieldErrors(fieldErrors),
      retryable: typeof retryable === 'boolean' ? retryable : RETRYABLE_STATUSES.has(status),
      request_id: id,
    },
    { status, headers },
  );
}

/** 400 for input that parsed but failed a rule; the message is the first field's. */
export function validationError(fieldErrors, requestId) {
  const list = normalizeFieldErrors(fieldErrors);
  return apiError({
    status: 400,
    code: ERROR_CODES.VALIDATION_FAILED,
    message: list[0]?.message || VALIDATION_FALLBACK_MESSAGE,
    fieldErrors: list,
    requestId,
  });
}

/**
 * 500 with a fixed message. Callers log the real error themselves; nothing from
 * a database or provider ever reaches the response.
 */
export function internalError(requestId) {
  return apiError({
    status: 500,
    code: ERROR_CODES.INTERNAL_ERROR,
    message: INTERNAL_MESSAGE,
    retryable: true,
    requestId,
  });
}

/**
 * Renders an auth failure in the envelope. The status and message are kept as
 * given, so the sentences the frontend already shows do not change.
 *
 * @param {number} status 401, 403 or 503; anything else is reported as internal_error.
 * @param {string} message
 * @param {string} [requestId]
 */
export function authFailureResponse(status, message, requestId) {
  if (status === 401) {
    return apiError({ status, code: ERROR_CODES.AUTH_REQUIRED, message, requestId });
  }
  if (status === 403) {
    return apiError({ status, code: ERROR_CODES.FORBIDDEN, message, requestId });
  }
  if (status === 503) {
    return apiError({ status, code: ERROR_CODES.AUTH_UNAVAILABLE, message, retryAfterSeconds: 2, requestId });
  }
  // Response throws on a status outside 200-599; an error handler must not.
  const safeStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
  return apiError({ status: safeStatus, code: ERROR_CODES.INTERNAL_ERROR, message, requestId });
}
