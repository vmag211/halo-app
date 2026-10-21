/**
 * Stand-in for lib/serverAuth.js, which builds a Supabase client at import.
 *
 * lib/serverAuth.js stays the source of truth: this file copies its logic, calls
 * the REAL lib/apiErrors.js and lib/authResult.js, and a drift test in
 * test/routeHarness.test.mjs fails if the exported names or the AuthError
 * statuses and messages stop matching. Only `supabaseAdmin` differs: it is the
 * active harness's in-memory fake, and `auth.getUser` resolves `test-token:<name>`
 * against the fake's identity table.
 */
import { classifyAuthResult } from '../../../lib/authResult.js';
import { authFailureResponse } from '../../../lib/apiErrors.js';
import { fakeClient } from './context.mjs';

export const supabaseAdmin = fakeClient;

/** Thrown by requireUser; routes turn it into an HTTP response. */
export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

function readBearerToken(request) {
  const header = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!header) return null;

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;

  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

export async function requireUser(request) {
  const token = readBearerToken(request);

  if (!token) {
    throw new AuthError(401, 'Sign-in required.');
  }

  let result;
  try {
    result = await supabaseAdmin.auth.getUser(token);
  } catch (error) {
    console.error('requireUser: auth service unreachable:', error.message);
    throw new AuthError(503, 'Could not verify your session right now. Please try again.');
  }

  const outcome = classifyAuthResult(result);
  if (outcome === 'retry') {
    console.error('requireUser: auth service unavailable:', result.error?.message);
    throw new AuthError(503, 'Could not verify your session right now. Please try again.');
  }
  if (outcome === 'reject') {
    throw new AuthError(401, 'Your session has expired. Please reload the app.');
  }

  const user = result.data.user;

  return {
    userId: user.id,
    isAnonymous: user.is_anonymous === true,
    email: user.email ?? null,
  };
}

/** Verbatim from lib/serverAuth.js. It talks to the provider over fetch, which the
 * sandbox replaces per call, so the copy needs no change to run in a test. */
export async function linkCallerEmail(request, email) {
  const token = readBearerToken(request);
  if (!token) return { ok: false, reason: 'no_session' };
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!base || !anonKey) return { ok: false, reason: 'unconfigured' };

  let response;
  try {
    response = await fetch(`${base.replace(/\/+$/, '')}/auth/v1/user`, {
      method: 'PUT',
      headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  } catch {
    // The message could carry the host or the request; the reason is enough.
    return { ok: false, reason: 'unreachable' };
  }

  const payload = await response.json().catch(() => null);
  if (response.ok) return { ok: true };

  const code = String(payload?.error_code ?? payload?.code ?? '').toLowerCase();
  const said = String(payload?.msg ?? payload?.message ?? payload?.error_description ?? payload?.error ?? '');
  // The provider's unique address constraint is the only authority on whether an
  // address belongs to another identity. Newer builds name it; older ones only
  // say so in words, and that test is deliberately narrow, so an unrecognised
  // refusal is reported as a refusal rather than quietly called a collision.
  const taken =
    code === 'email_exists' ||
    code === 'user_already_exists' ||
    ([400, 409, 422].includes(response.status) &&
      /already (been )?registered|already exists|already in use|duplicate key/i.test(said));
  if (taken) return { ok: false, reason: 'address_taken' };
  return { ok: false, reason: 'rejected', detail: `${response.status} ${code || 'no_code'}` };
}

export function assertProfileMatches(claimedProfileId, userId) {
  if (claimedProfileId && claimedProfileId !== userId) {
    throw new AuthError(403, 'That profile does not belong to this session.');
  }
}

export function authErrorResponse(error, requestId) {
  if (error instanceof AuthError) {
    return authFailureResponse(error.status, error.message, requestId);
  }
  return null;
}
