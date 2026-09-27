/**
 * Classify a GoTrue getUser() result (punch list item 2).
 *
 * @supabase/auth-js does NOT throw on a network failure or a 5xx from the auth
 * service: it RETURNS { data: { user: null }, error: AuthRetryableFetchError }
 * (status 0 for a network failure, the HTTP status for 5xx). Treating that as a
 * rejected token made an auth-service blip look like "your session expired",
 * and the client — correctly, for a real 401 — then discards the session and
 * creates a new anonymous user, orphaning the household's profile, history and
 * journal. Only a definitive rejection may become a 401.
 *
 * Pure module.
 *
 * @returns {'ok' | 'retry' | 'reject'}
 *   ok     → a verified user is present
 *   retry  → the auth service couldn't answer (503; the client retries, never resets)
 *   reject → the token was definitively refused (401; the client resets silently)
 */
export function classifyAuthResult(result) {
  const error = result?.error;
  if (!error && result?.data?.user) return 'ok';
  if (error && isRetryableAuthError(error)) return 'retry';
  return 'reject';
}

export function isRetryableAuthError(error) {
  if (!error) return false;
  if (error.name === 'AuthRetryableFetchError') return true;
  const status = typeof error.status === 'number' ? error.status : null;
  return status === 0 || (status !== null && status >= 500);
}
