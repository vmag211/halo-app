import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { internalError, requestIdFor } from '@/lib/apiErrors';
import { featureEnabled, featureDisabledReason } from '@/lib/features';
import { maskEmail } from '@/lib/account';
import { googleIdentityEmail, googleIdentityOf, googleSigninStatus } from '@/lib/googleSignin';

/**
 * GET /api/account/google
 *
 * Whether this household is kept with a Google account (feasibility spike,
 * docs/backend/decisions/google-signin-feasibility.md). Settings reads it to
 * decide whether to offer "Sign in with Google to keep your household", and
 * the callback page reads it before it will adopt a returned session.
 *
 *   { feature: 'google-signin', enabled, reason?, anonymous, linked,
 *     maskedAccount, linkedAt }
 *
 * Off by default (HALO_FEATURE_GOOGLE_SIGNIN), and off means off: no read of
 * the auth provider, nothing disclosed, `linked: false` and `anonymous: null`
 * because the route has not looked. The address is only ever a mask (BE-201).
 * Identity comes only from the verified session token; nothing in the request
 * can name another household.
 *
 * This route does not link anything. Linking happens in the browser through
 * Supabase (`auth.linkIdentity`), which keeps the same user id; this is the
 * reflection of what the provider now holds.
 */
export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId, 'Cache-Control': 'private, no-store' };
  try {
    const { userId } = await requireUser(request);

    if (!featureEnabled('googleSignin')) {
      return NextResponse.json(
        googleSigninStatus({ enabled: false, reason: featureDisabledReason('googleSignin') }),
        { headers },
      );
    }

    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (error) throw new Error(error.message);
    const user = data?.user ?? null;
    const email = googleIdentityEmail(googleIdentityOf(user));
    return NextResponse.json(
      googleSigninStatus({ enabled: true, user, maskedAccount: email ? maskEmail(email) : null }),
      { headers },
    );
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`google sign-in status failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
