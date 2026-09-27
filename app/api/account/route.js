import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';

/**
 * DELETE /api/account  { confirm: "DELETE" }
 *
 * Permanently deletes everything HALO holds about the calling household (§49.3,
 * capability 20). Deleting the auth user is sufficient: every household table
 * cascades from it.
 *   auth.users → profiles (0001) → daily_scores, home_risks (0001),
 *                household_bands (0002), symptom_logs (0003), alerts (0006)
 *
 * The body must carry the literal word DELETE — the same word the interface
 * makes the person type — so a stray or scripted request can't wipe a household
 * by accident. Identity comes only from the verified session; there is no way to
 * name another user. After success the client should discard its session and
 * return to onboarding.
 */
export async function DELETE(request) {
  try {
    const { userId } = await requireUser(request);
    const body = await request.json().catch(() => ({}));

    if (body?.confirm !== 'DELETE') {
      return NextResponse.json(
        { error: 'To delete your data, confirm by sending the word DELETE.' },
        { status: 400 },
      );
    }

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);

    return NextResponse.json({ deleted: true });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
