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
