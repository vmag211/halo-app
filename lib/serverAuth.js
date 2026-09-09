/**
 * Server-side auth for HALO's route handlers.
 *
 * Every route derives the caller's identity from the verified JWT, never from a
 * request body or query string. Before this existed, `profile_id` was just a
 * string a client sent us -- anyone could pass any UUID and read or overwrite
 * another household's address and scores.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('serverAuth: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

/**
 * Shared service-role client. Bypasses RLS, so it must only ever be used with an
 * id that came out of a verified token.
 *
 * persistSession/autoRefreshToken are off because this runs per-request on the
 * server: there is no browser storage to persist into, and a background refresh
 * timer in a serverless function is just a leak.
 */
export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

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

/**
 * Verifies the caller's session and returns their identity.
 *
 * Verification goes through GoTrue rather than checking the signature locally.
 * That costs one network hop per request, but it needs no extra dependency and
 * no second copy of the signing secret, and it honours revocation -- a signed
 * token from a deleted user is rejected, which a local signature check would
 * happily wave through.
 *
 * @param {Request} request
 * @returns {Promise<{ userId: string, isAnonymous: boolean, email: string|null }>}
 * @throws {AuthError} 401 when the token is missing, malformed, or rejected.
 */
export async function requireUser(request) {
  const token = readBearerToken(request);

  if (!token) {
    throw new AuthError(401, 'Sign-in required.');
  }

  let result;
  try {
    result = await supabaseAdmin.auth.getUser(token);
  } catch (error) {
    // Network failure reaching GoTrue. This is ours, not the caller's, so it is
    // a 503 -- we cannot prove who they are, but we must not imply they lied.
    console.error('requireUser: auth service unreachable:', error.message);
    throw new AuthError(503, 'Could not verify your session right now. Please try again.');
  }

  if (result.error || !result.data?.user) {
    throw new AuthError(401, 'Your session has expired. Please reload the app.');
  }

  const user = result.data.user;

  return {
    userId: user.id,
    isAnonymous: user.is_anonymous === true,
    email: user.email ?? null,
  };
}

/**
 * Guards against a client sending someone else's id alongside its own token.
 *
 * Legacy callers still pass `profile_id`. We ignore it for identity purposes,
 * but a mismatch is worth surfacing loudly rather than silently preferring the
 * token: it means the client is confused about who it is, and quietly returning
 * the wrong household's data is exactly the failure this system exists to stop.
 *
 * @throws {AuthError} 403
 */
export function assertProfileMatches(claimedProfileId, userId) {
  if (claimedProfileId && claimedProfileId !== userId) {
    throw new AuthError(403, 'That profile does not belong to this session.');
  }
}

/**
 * Renders an AuthError (or anything else) as a JSON Response.
 * Returns null for non-auth errors so callers can keep their own handling.
 */
export function authErrorResponse(error) {
  if (error instanceof AuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return null;
}
