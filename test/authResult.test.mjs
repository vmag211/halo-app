import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthRetryableFetchError, AuthApiError } from '@supabase/auth-js';
import { classifyAuthResult, isRetryableAuthError } from '../lib/authResult.js';

const user = { id: 'u1' };

test('a verified user is ok', () => {
  assert.equal(classifyAuthResult({ data: { user }, error: null }), 'ok');
});

test('network failure (auth-js returns AuthRetryableFetchError, status 0) → retry, not reject', () => {
  const error = new AuthRetryableFetchError('fetch failed', 0);
  assert.equal(classifyAuthResult({ data: { user: null }, error }), 'retry');
});

test('auth service 5xx → retry', () => {
  for (const status of [500, 502, 503, 504]) {
    const error = new AuthRetryableFetchError('upstream', status);
    assert.equal(classifyAuthResult({ data: { user: null }, error }), 'retry', String(status));
  }
  // Even a non-retryable class carrying a 5xx status is ours, not the caller's.
  assert.equal(isRetryableAuthError({ name: 'AuthApiError', status: 503 }), true);
});

test('a definitively refused token → reject (401)', () => {
  const error = new AuthApiError('invalid JWT', 401, 'bad_jwt');
  assert.equal(classifyAuthResult({ data: { user: null }, error }), 'reject');
  const forbidden = new AuthApiError('user not found', 403, 'user_not_found');
  assert.equal(classifyAuthResult({ data: { user: null }, error: forbidden }), 'reject');
});

test('no error but no user → reject', () => {
  assert.equal(classifyAuthResult({ data: { user: null }, error: null }), 'reject');
  assert.equal(classifyAuthResult(undefined), 'reject');
});
