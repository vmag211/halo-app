/**
 * Assertions for the API error envelope (lib/apiErrors.js), shared by the route
 * hardening tests.
 *
 *   const body = await expectEnvelope(res, { status: 400, code: 'validation_failed' });
 *
 * Checks the status, the exact set of body keys, the legacy `error` string, that
 * `request_id` is a usable id and that the X-Request-Id header is the same id.
 * Returns the parsed body for further assertions.
 */
import assert from 'node:assert/strict';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const ENVELOPE_KEYS = ['code', 'error', 'field_errors', 'message', 'request_id', 'retryable'];

export async function expectEnvelope(res, { status, code, retryable, extraKeys = [] }) {
  assert.equal(res.status, status);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), [...ENVELOPE_KEYS, ...extraKeys].sort());
  assert.equal(body.code, code);
  assert.equal(typeof body.error, 'string');
  assert.equal(body.error, body.message, 'the legacy error string is the message');
  assert.ok(Array.isArray(body.field_errors));
  assert.equal(typeof body.retryable, 'boolean');
  if (retryable !== undefined) assert.equal(body.retryable, retryable);
  assert.match(body.request_id, /^[A-Za-z0-9._-]{8,64}$/);
  assert.equal(res.headers.get('x-request-id'), body.request_id, 'the header and the body carry the same request id');
  return body;
}

/** The logged line(s) of a muteConsoleError mock as one string. */
export const loggedText = (mock) => mock.mock.calls.map((call) => call.arguments.map(String).join(' ')).join('\n');
