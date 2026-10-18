import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody, parseEnum } from '@/lib/validate';
import { featureEnabled, featureDisabledReason } from '@/lib/features';
import { isOperationsUnavailable, operationsUnavailable } from '@/lib/operations';
import {
  ACCOUNT_FEATURES,
  IMPLEMENTED_FEATURES,
  isRecoveryUnavailable,
  readRecoverySnapshot,
  recoverySnapshot,
} from '@/lib/account';

/**
 * GET /api/account?feature=<feature>
 *
 * One feature's `AccountSnapshot`, the shape `useAccountService` validates and
 * discards if it does not match. Only `feature=recovery` is built in this
 * package (B02 task 3); the other four names the contract allows are reported
 * as unavailable rather than answered with an invented snapshot.
 *
 * The capability is off unless its flag is on (BE-351), and while it is off
 * this handler reads neither the database nor the auth provider: the person is
 * told `enabled: false` with a plain reason, and nothing about their account
 * is disclosed by a capability that cannot be used. A deployed UI cannot talk
 * its way past that, because the refusal is here and not in the browser.
 *
 * What it reports when the capability is on:
 *   recovery.method     the linked address as a mask with the date it was
 *                       verified, or null. Never the address itself (BE-201).
 *   recovery.challenge  the one open ownership challenge, or null. The clock
 *                       decides whether a pending row is expired.
 *   recovery.devices    empty. Listing and revoking sessions is task 9; an
 *                       empty list here is not a claim that there are none.
 *   unresolvedOperations  this household's unsettled account work, so the
 *                       client can reconcile a response it lost.
 *
 * Identity comes only from the verified session token. There is no parameter
 * that names another household, and the challenge read is scoped to the owner.
 *
 * Until migrations 0017 and 0018 are applied the route answers a non-retryable
 * 503 `feature_unavailable`. That matters more here than elsewhere: with no
 * challenge table the handler cannot know whether a challenge exists, and
 * answering `challenge: null` would be a claim it has no way to support.
 */
/** A 400 naming the field that failed, using the validator's own code and message. */
function badField(field, result, requestId) {
  return apiError({
    status: 400,
    code: ERROR_CODES.VALIDATION_FAILED,
    message: result.message,
    fieldErrors: [{ field, code: result.code, message: result.message }],
    retryable: false,
    requestId,
  });
}

/** The 503 for a feature the contract names but this package has not built. */
function notBuiltHere(requestId) {
  return apiError({
    status: 503,
    code: ERROR_CODES.FEATURE_UNAVAILABLE,
    message: 'That part of your account is not available yet.',
    retryable: false,
    requestId,
  });
}

export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);
    const url = new URL(request.url);

    const feature = parseEnum(url.searchParams.get('feature'), ACCOUNT_FEATURES);
    if (!feature.ok) return badField('feature', feature, requestId);
    if (!IMPLEMENTED_FEATURES.includes(feature.value)) return notBuiltHere(requestId);

    // Off by default, and off means off: no reads, nothing disclosed.
    if (!featureEnabled('recovery')) {
      return NextResponse.json(
        recoverySnapshot({ enabled: false, reason: featureDisabledReason('recovery') }),
        { headers },
      );
    }

    // The provider holds the address, the database holds the challenge and the
    // ledger holds the revision. All three are needed, and a missing table must
    // surface as "unavailable" rather than as an empty answer. The command
    // route builds its receipts from the same function, so the revision this
    // read publishes is exactly the one a later write checks.
    return NextResponse.json(await readRecoverySnapshot(supabaseAdmin, userId), { headers });
  } catch (err) {
    if (isOperationsUnavailable(err) || isRecoveryUnavailable(err)) return operationsUnavailable(requestId);
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`account read failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}

/**
 * DELETE /api/account  { confirm: "DELETE" }
 *
 * Permanently deletes everything HALO holds about the calling household (§49.3,
 * capability 20). Deleting the auth user is sufficient: every household table
 * cascades from it.
 *   auth.users → profiles (0001) → daily_scores, home_risks (0001),
 *                household_bands (0002), symptom_logs (0003), alerts (0006),
 *                notification_prefs, push_subscriptions (0010),
 *                home_contexts (0016), operations (0017),
 *                recovery_challenges (0018)
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
