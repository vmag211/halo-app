import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, requestIdFor, validationError } from '@/lib/apiErrors';
import { readJsonBody } from '@/lib/validate';

/**
 * DELETE /api/account  { confirm: "DELETE" }
 *
 * Permanently deletes everything HALO holds about the calling household (§49.3,
 * capability 20). Deleting the auth user is sufficient: every household table
 * cascades from it.
 *   auth.users → profiles (0001) → daily_scores, home_risks (0001),
 *                household_bands (0002), symptom_logs (0003), alerts (0006),
 *                notification_prefs, push_subscriptions (0010)
 *
 * The body must carry the literal word DELETE — the same word the interface
 * makes the person type — so a stray or scripted request can't wipe a household
 * by accident. Identity comes only from the verified session; there is no way to
 * name another user. After success the client should discard its session and
 * return to onboarding.
 */
// The body is one word.
const MAX_BYTES = 2048;

export async function DELETE(request) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);
    const body = await readJsonBody(request, { maxBytes: MAX_BYTES });
    if (!body.ok) {
      return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    }

    if (body.value.confirm !== 'DELETE') {
      return validationError(
        [{ field: 'confirm', code: 'confirmation_required', message: 'To delete your data, confirm by sending the word DELETE.' }],
        requestId,
      );
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);

    return NextResponse.json({ deleted: true }, { headers: { 'X-Request-Id': requestId } });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    // The detail goes to the log: an auth provider's message is not for the person.
    console.error(`account delete failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
