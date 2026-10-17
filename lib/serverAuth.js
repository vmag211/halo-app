/**
 * Server-side auth for HALO's route handlers.
 *
 * Every route derives the caller's identity from the verified JWT, never from a
 * request body or query string. Before this existed, `profile_id` was just a
 * string a client sent us -- anyone could pass any UUID and read or overwrite
 * another household's address and scores.
 */

import { createClient } from '@supabase/supabase-js';
import { classifyAuthResult } from './authResult.js';
import { authFailureResponse } from './apiErrors.js';

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

  // auth-js RETURNS (rather than throws) network and 5xx failures, so the thrown
  // path above never sees them. A retryable failure is ours → 503 (the client
  // retries); only a definitive refusal is 401 (the client resets its session).
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

/**
 * Adds `email` to the CALLER's own identity, as the caller rather than as the
 * service role (B02 Ruling 10). Used by the account recovery link intent.
 *
 * Why this is an HTTP request and not `supabase.auth.updateUser({ email })`,
 * which is the SDK method for exactly this change: that method reads the session
 * from its own client's storage, and a server holding only the caller's bearer
 * access token cannot put one there. `setSession` refuses without a refresh
 * token, which a browser must never send us, and an Authorization header on the
 * client does not stand in for a session. All three facts are pinned offline in
 * test/recoveryCapability.test.mjs, so if an SDK release removes the obstacle
 * that test fails and this can go back to the method. Until then this sends the
 * request the method would send: the same endpoint, the caller's own JWT, the
 * public anon key, and no service-role credential anywhere near it.
 *
 * What the provider then does with the address is the provider's decision, and
 * the reason this call is worth the trouble: with email confirmation on, the
 * change is staged as a pending address and the provider sends its own
 * confirmation message, so the unique `auth.users.email` column is not claimed
 * by an address nobody has proved yet.
 *
 * Nothing proof-bearing is returned: the caller gets a reason, never the
 * provider's payload, and `detail` is only a status and an error code so that a
 * log line cannot carry an address or a token (BE-201).
 *
 * @param {Request} request the already verified request, for the caller's own token
 * @param {string} email the address, already validated and normalized
 * @returns {Promise<{ ok: true } | { ok: false, reason: string, detail?: string }>}
 *   reason is 'address_taken' (another identity holds it), 'no_session',
 *   'unconfigured', 'unreachable' or 'rejected'.
 */
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
 * Renders an AuthError (or anything else) as a JSON Response in the API error
 * envelope (see apiErrors.js). The status and message are unchanged; the body
 * gains `code`, `retryable` and `request_id` next to the legacy `error` string.
 * Returns null for non-auth errors so callers can keep their own handling.
 *
 * @param {unknown} error
 * @param {string} [requestId] Pass the request's id so the response matches the
 *   rest of that request's logs; omitted, a fresh one is generated.
 */
export function authErrorResponse(error, requestId) {
  if (error instanceof AuthError) {
    return authFailureResponse(error.status, error.message, requestId);
  }
  return null;
}
