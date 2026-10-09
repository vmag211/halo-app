import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ERROR_CODES,
  requestIdFor,
  apiError,
  validationError,
  internalError,
  authFailureResponse,
} from '../lib/apiErrors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FIXED_ID = 'req-12345678';

function requestWith(headers = {}) {
  return new Request('http://localhost/api/x', { headers });
}

// ---------------------------------------------------------------- ERROR_CODES

test('ERROR_CODES lists every code with an upper-snake key and a lower-snake value', () => {
  assert.deepEqual(ERROR_CODES, {
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
  });
});

// --------------------------------------------------------------- requestIdFor

test('requestIdFor accepts a well-formed client x-request-id', () => {
  assert.equal(requestIdFor(requestWith({ 'x-request-id': 'abc-123_DEF.456' })), 'abc-123_DEF.456');
});

test('requestIdFor accepts the 8 and 64 character boundaries', () => {
  const eight = 'a'.repeat(8);
  const sixtyFour = 'b'.repeat(64);
  assert.equal(requestIdFor(requestWith({ 'x-request-id': eight })), eight);
  assert.equal(requestIdFor(requestWith({ 'x-request-id': sixtyFour })), sixtyFour);
});

test('requestIdFor rejects a client header that is too short, too long, or has bad characters', () => {
  for (const bad of ['a'.repeat(7), 'a'.repeat(65), 'has space inside', 'slash/inside-id', 'semi;colon-id', 'caf\u00E9-12345']) {
    const id = requestIdFor(requestWith({ 'x-request-id': bad }));
    assert.notEqual(id, bad, `accepted ${JSON.stringify(bad)}`);
    assert.match(id, UUID_RE);
  }
});

test('requestIdFor generates a fresh UUID when the header is missing', () => {
  const a = requestIdFor(requestWith());
  const b = requestIdFor(requestWith());
  assert.match(a, UUID_RE);
  assert.match(b, UUID_RE);
  assert.notEqual(a, b);
});

test('requestIdFor reads the header case-insensitively', () => {
  assert.equal(requestIdFor(requestWith({ 'X-Request-ID': FIXED_ID })), FIXED_ID);
});

// ------------------------------------------------------------------- apiError

test('apiError builds the documented JSON body and headers', async () => {
  const res = apiError({
    status: 404,
    code: ERROR_CODES.NOT_FOUND,
    message: 'We could not find that.',
    requestId: FIXED_ID,
  });
  assert.ok(res instanceof Response);
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.equal(res.headers.get('x-request-id'), FIXED_ID);
  assert.equal(res.headers.get('retry-after'), null);
  assert.deepEqual(await res.json(), {
    error: 'We could not find that.',
    code: 'not_found',
    message: 'We could not find that.',
    field_errors: [],
    retryable: false,
    request_id: FIXED_ID,
  });
});

test('apiError adds `extra` fields after the envelope, and none of them can replace an envelope field', async () => {
  const res = apiError({
    status: 409,
    code: ERROR_CODES.CONFLICT,
    message: 'Changed meanwhile.',
    requestId: FIXED_ID,
    extra: { reason: 'stale_revision', revision: 4, error: 'forged', code: 'forged', request_id: 'forged', retryable: true },
  });
  assert.deepEqual(await res.json(), {
    error: 'Changed meanwhile.',
    code: 'conflict',
    message: 'Changed meanwhile.',
    field_errors: [],
    retryable: false,
    request_id: FIXED_ID,
    reason: 'stale_revision',
    revision: 4,
  });
  for (const extra of [undefined, null, 'text', ['x']]) {
    const plain = await apiError({ status: 404, code: ERROR_CODES.NOT_FOUND, message: 'x', requestId: FIXED_ID, extra }).json();
    assert.deepEqual(Object.keys(plain).sort(), ['code', 'error', 'field_errors', 'message', 'request_id', 'retryable'], String(extra));
  }
});

test('apiError keeps field_errors as { field, code, message } entries', async () => {
  const res = apiError({
    status: 400,
    code: ERROR_CODES.VALIDATION_FAILED,
    message: 'Check the date.',
    fieldErrors: [{ field: 'from', code: 'invalid_date', message: 'Check the date.', extra: 'dropped' }],
    requestId: FIXED_ID,
  });
  const body = await res.json();
  assert.deepEqual(body.field_errors, [{ field: 'from', code: 'invalid_date', message: 'Check the date.' }]);
});

test('apiError treats a missing or non-array fieldErrors as an empty array', async () => {
  for (const fieldErrors of [undefined, null, 'nope', {}]) {
    const res = apiError({ status: 400, code: 'bad_request', message: 'x', fieldErrors, requestId: FIXED_ID });
    assert.deepEqual((await res.json()).field_errors, []);
  }
});

test('apiError defaults retryable to true for 429, 502, 503, 504 and false otherwise', async () => {
  for (const status of [429, 502, 503, 504]) {
    const res = apiError({ status, code: 'upstream_unavailable', message: 'x', requestId: FIXED_ID });
    assert.equal((await res.json()).retryable, true, `status ${status}`);
  }
  for (const status of [400, 401, 403, 404, 409, 413, 500]) {
    const res = apiError({ status, code: 'bad_request', message: 'x', requestId: FIXED_ID });
    assert.equal((await res.json()).retryable, false, `status ${status}`);
  }
});

test('apiError lets an explicit boolean override the retryable default', async () => {
  const forcedOff = apiError({ status: 503, code: 'feature_unavailable', message: 'x', retryable: false, requestId: FIXED_ID });
  const forcedOn = apiError({ status: 500, code: 'internal_error', message: 'x', retryable: true, requestId: FIXED_ID });
  assert.equal((await forcedOff.json()).retryable, false);
  assert.equal((await forcedOn.json()).retryable, true);
});

test('apiError sets Retry-After only for a positive integer', () => {
  const withHeader = apiError({ status: 429, code: 'rate_limited', message: 'x', retryAfterSeconds: 30, requestId: FIXED_ID });
  assert.equal(withHeader.headers.get('retry-after'), '30');
  for (const bad of [0, -1, 1.5, '5', NaN, Infinity, null, undefined]) {
    const res = apiError({ status: 429, code: 'rate_limited', message: 'x', retryAfterSeconds: bad, requestId: FIXED_ID });
    assert.equal(res.headers.get('retry-after'), null, `retryAfterSeconds ${String(bad)}`);
  }
});

test('apiError defaults requestId to a fresh UUID and mirrors it in header and body', async () => {
  const res = apiError({ status: 400, code: 'bad_request', message: 'x' });
  const body = await res.json();
  assert.match(body.request_id, UUID_RE);
  assert.equal(res.headers.get('x-request-id'), body.request_id);
  const other = await apiError({ status: 400, code: 'bad_request', message: 'x' }).json();
  assert.notEqual(other.request_id, body.request_id);
});

// ------------------------------------------------------------ validationError

test('validationError is a 400 validation_failed whose message is the first field error', async () => {
  const fieldErrors = [
    { field: 'lat', code: 'invalid_coordinate', message: 'Latitude must be a number.' },
    { field: 'lng', code: 'invalid_coordinate', message: 'Longitude must be a number.' },
  ];
  const res = validationError(fieldErrors, FIXED_ID);
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('x-request-id'), FIXED_ID);
  assert.deepEqual(await res.json(), {
    error: 'Latitude must be a number.',
    code: 'validation_failed',
    message: 'Latitude must be a number.',
    field_errors: fieldErrors,
    retryable: false,
    request_id: FIXED_ID,
  });
});

test('validationError falls back to a generic message for an empty or missing array', async () => {
  for (const input of [[], undefined]) {
    const body = await validationError(input, FIXED_ID).json();
    assert.equal(body.message, 'Some details need another look.');
    assert.equal(body.error, 'Some details need another look.');
    assert.deepEqual(body.field_errors, []);
    assert.equal(body.code, 'validation_failed');
  }
});

// ------------------------------------------------------------- internalError

test('internalError is a retryable 500 with a fixed, generic message', async () => {
  const res = internalError(FIXED_ID);
  assert.equal(res.status, 500);
  assert.equal(res.headers.get('x-request-id'), FIXED_ID);
  assert.deepEqual(await res.json(), {
    error: 'Something went wrong on our side. Please try again.',
    code: 'internal_error',
    message: 'Something went wrong on our side. Please try again.',
    field_errors: [],
    retryable: true,
    request_id: FIXED_ID,
  });
});

// ------------------------------------------------------- authFailureResponse

test('authFailureResponse maps 401 to auth_required, not retryable', async () => {
  const res = authFailureResponse(401, 'Sign-in required.', FIXED_ID);
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('x-request-id'), FIXED_ID);
  assert.equal(res.headers.get('retry-after'), null);
  assert.deepEqual(await res.json(), {
    error: 'Sign-in required.',
    code: 'auth_required',
    message: 'Sign-in required.',
    field_errors: [],
    retryable: false,
    request_id: FIXED_ID,
  });
});

test('authFailureResponse maps 403 to forbidden, not retryable', async () => {
  const res = authFailureResponse(403, 'That profile does not belong to this session.', FIXED_ID);
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('retry-after'), null);
  const body = await res.json();
  assert.equal(body.code, 'forbidden');
  assert.equal(body.retryable, false);
  assert.equal(body.error, 'That profile does not belong to this session.');
});

test('authFailureResponse maps 503 to auth_unavailable, retryable, with Retry-After 2', async () => {
  const message = 'Could not verify your session right now. Please try again.';
  const res = authFailureResponse(503, message, FIXED_ID);
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('retry-after'), '2');
  assert.equal(res.headers.get('x-request-id'), FIXED_ID);
  const body = await res.json();
  assert.equal(body.code, 'auth_unavailable');
  assert.equal(body.retryable, true);
  assert.equal(body.error, message);
  assert.equal(body.message, message);
  assert.equal(body.request_id, FIXED_ID);
});

test('authFailureResponse maps an unknown status to internal_error and passes the message through', async () => {
  const res = authFailureResponse(418, 'Teapot.', FIXED_ID);
  assert.equal(res.status, 418);
  assert.equal(res.headers.get('retry-after'), null);
  const body = await res.json();
  assert.equal(body.code, 'internal_error');
  assert.equal(body.error, 'Teapot.');
  assert.equal(body.message, 'Teapot.');
  assert.equal(body.retryable, false);
});

test('authFailureResponse never throws on a status Response cannot carry', async () => {
  for (const status of [undefined, 0, 200, 700, 'abc']) {
    const res = authFailureResponse(status, 'Odd.', FIXED_ID);
    assert.equal(res.status, 500, `status ${String(status)}`);
    assert.equal((await res.json()).code, 'internal_error');
  }
});

test('authFailureResponse generates a request id when none is passed', async () => {
  const res = authFailureResponse(401, 'Sign-in required.');
  const body = await res.json();
  assert.match(body.request_id, UUID_RE);
  assert.equal(res.headers.get('x-request-id'), body.request_id);
});

// ------------------------------------------------- serverAuth.authErrorResponse

test('serverAuth.authErrorResponse delegates AuthError to the envelope and ignores other errors', async () => {
  // serverAuth builds a Supabase client at import time. Synthetic values only;
  // createClient does not open a connection, so nothing leaves this process.
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-synthetic-service-key';
  const { AuthError, authErrorResponse } = await import('../lib/serverAuth.js');

  const withId = authErrorResponse(new AuthError(401, 'Your session has expired. Please reload the app.'), FIXED_ID);
  assert.equal(withId.status, 401);
  assert.equal(withId.headers.get('x-request-id'), FIXED_ID);
  const body = await withId.json();
  assert.equal(body.error, 'Your session has expired. Please reload the app.');
  assert.equal(body.code, 'auth_required');
  assert.equal(body.request_id, FIXED_ID);

  // Existing callers pass only the error.
  const legacy = authErrorResponse(new AuthError(503, 'Could not verify your session right now. Please try again.'));
  assert.equal(legacy.status, 503);
  assert.equal(legacy.headers.get('retry-after'), '2');
  assert.match((await legacy.json()).request_id, UUID_RE);

  assert.equal(authErrorResponse(new Error('boom'), FIXED_ID), null);
  assert.equal(authErrorResponse(undefined), null);
});

// ------------------------------------------------------------------ copy rule

test('apiErrors source has no em dashes', () => {
  const source = readFileSync(new URL('../lib/apiErrors.js', import.meta.url), 'utf8');
  assert.equal(source.includes('\u2014'), false);
});
