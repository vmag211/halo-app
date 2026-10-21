import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { apiError, internalError, requestIdFor, validationError, ERROR_CODES } from '@/lib/apiErrors';
import { readJsonBody, parseUuid } from '@/lib/validate';
import { ABANDONED_REASON, OPERATION_INPUT_MISMATCH, isOperationsUnavailable, runOperation } from '@/lib/operations';
import { exploreAreaUnavailable, isExploreAreaUnavailable, readArea, writeArea } from '@/lib/exploreArea';
import { placeById } from '@/lib/places';
import { readIfMatch } from '@/lib/ifMatch';

/**
 * GET   /api/explore/area                         ->  DiscoveryArea
 * PATCH /api/explore/area   { place, revision }   ->  DiscoveryArea
 *
 * The household's chosen discovery area on the Explore screen (B05 plan, Task
 * 4; Rulings D5 to D10). The answer is always exactly the client's
 * `DiscoveryArea`, `{ place, revision }`, bare (D10): `place` is a county, city or ZIP code from
 * GET /api/locations/search or null, and `revision` is a positive integer the
 * client sends back as `If-Match` on its next save.
 *
 * READ. A household that has never saved reads as `{ place: null, revision: 1 }`
 * (D6), because the client refuses to save while it holds revision 0. The read
 * never carries `pendingOperation` (D7): the ledger keeps only a hash of what
 * was sent, so the place an unsettled save attempted cannot be reported
 * truthfully, and the client parks and replays its own lost-response save.
 *
 * SAVE. The body is exactly `{ place, revision }`, the two fields the client
 * sends (ExploreDiscovery.tsx:60). Anything else is refused rather than
 * ignored, which is also what stops a field naming another household: identity
 * comes only from the verified token, and every statement is scoped to it. The
 * area belongs to the household, so X-Halo-Home-Context is ignored (D5).
 *
 * The server canonicalizes the place (D8). Only `place.id` is read from the
 * client; it is resolved against the gazetteers (lib/places.js placeById) and their own
 * five fields are what is stored and returned. A label, a timezone or anything
 * else the client sent is never stored, and an id the gazetteer does not know is
 * a validation failure. That matters beyond tidiness: migration 0022's checks
 * are stricter than the client's validator, so storing what a client sent would
 * turn a check violation into a 500.
 *
 * `revision` is a JSON number, a whole number from 1 to 2147483647. A string is
 * refused because the client never sends one. The ceiling is the largest value
 * the integer column holds; above it Postgres raises 22003, which would be a
 * 500, so it is a 400 here. At the ceiling itself the next revision cannot be
 * stored, so nothing is sent to the database: the save is refused as a conflict
 * that says why (`revision_exhausted`), or as the ordinary stale revision when
 * the area is not at that revision.
 *
 * IDEMPOTENCY IS THE OPERATION LEDGER (migration 0017), the pattern of POST
 * /api/luna/conversations/clear (D9). The operation id is the required
 * `Idempotency-Key` header, the only place the client puts it. `If-Match`, when
 * present, must equal the body's revision. The precondition is checked inside
 * the operation, so a replay of a save that already moved the revision gets the
 * first outcome rather than a conflict against its own write. The ledger input
 * is `{ place, revision }` as sent, so the same key with a different body is a
 * 409 `operation_mismatch`, never a wrong replay.
 *
 * Refusals are 409s, which the client reads as a conflict and which clear its
 * parked operation (ExploreDiscovery.tsx:60, `error.code!=='unknown_outcome'`):
 *
 *   stale_revision      the area moved on. The current revision is included.
 *   revision_exhausted  the area is at the largest storable revision.
 *   abandoned           a replay of an earlier attempt the ledger reaped because
 *                       it never settled within its window (ABANDONED_REASON).
 *   attempt_failed      a replay of an earlier attempt that threw inside the
 *                       operation (settled failed with no receipt), or whose
 *                       stored reason this route never writes.
 *   operation_mismatch  the key was already used with a different body.
 *
 * The two replay reasons are deliberately terminal 409s and not the in-flight
 * 503 (D9 as amended): that attempt is over and will never settle into anything
 * else, and a 5xx would keep the client's chooser locked on "Check saved area"
 * for ever. Neither says `stale_revision`, because no revision was compared. A
 * pending row inside its window is the one replay that is honestly unknown, and
 * it is the retryable 503 the client shows as "not confirmed".
 *
 * Until migration 0022 (or 0017, for a save) is applied both verbs answer a
 * non-retryable 503 `feature_unavailable`. For a save it is decided before the
 * operation id is claimed: the area table is read first, and a missing ledger
 * fails the claim itself, so "nothing was changed" is true when it says so.
 */

// The ceiling sits under the operation ledger's staleness window
// (DEFAULT_STALE_AFTER_MS, 120 s), so a late settle can never overwrite a row
// the reaper already settled as abandoned. test/operationsMaxDuration.test.mjs
// keeps every ledger route under the window. 60 is the house value.
export const maxDuration = 60;

/** The body is a place of five short strings and an integer. */
const MAX_BYTES = 4096;

/** The only keys the body may carry. */
const BODY_KEYS = Object.freeze(['place', 'revision']);

/** The largest revision the integer column holds; one more raises Postgres 22003. */
const REVISION_MAX = 2147483647;

/** What a person is told when their view of the area is out of date. */
const CONFLICT_MESSAGE = 'Your saved area changed. Please review it again.';

/** What a person is told when the area cannot take another revision. */
const EXHAUSTED_MESSAGE = 'Your saved area cannot be changed any further.';

/**
 * What a person is told when an earlier attempt with this id is over but did
 * not finish. Whether the area changed is not known, so the person is asked to
 * look rather than told.
 */
const INCOMPLETE_MESSAGE = 'That earlier area change did not finish. Please review your area and try again.';

/** 409 for an operation id reused with different input: a client bug or an attack, never a replay. */
const MISMATCH_MESSAGE = 'That request was already made with different details. Please try again.';

/** One 400 naming one field. */
const badField = (field, code, message, requestId) => validationError([{ field, code, message }], requestId);

/**
 * 503 for an attempt on this id that has not settled, so the outcome is not
 * known. The client maps a 5xx on a mutation to `unknown_outcome` and keeps the
 * operation parked to replay, which is exactly right while the earlier attempt
 * may still finish. Retryable, unlike the missing-migration 503.
 */
const inFlight = (requestId) =>
  apiError({
    status: 503,
    code: ERROR_CODES.UPSTREAM_UNAVAILABLE,
    message: 'That request is still being processed. Please check your area before trying again.',
    retryable: true,
    requestId,
  });

/** A 409 the client maps to a conflict, carrying why for a log and a contract test. */
const conflict = (message, requestId, extra) =>
  apiError({ status: 409, code: ERROR_CODES.CONFLICT, message, retryable: false, requestId, extra });

/**
 * The body, validated: `{ ok, place, revision }` with `place` the gazetteer's
 * canonical copy (or null), or `{ ok: false, response }`.
 */
function parseSave(value, requestId) {
  const unknown = Object.keys(value).filter((key) => !BODY_KEYS.includes(key)).sort();
  if (unknown.length > 0) {
    return {
      ok: false,
      response: validationError(
        unknown.map((key) => ({ field: key, code: 'unknown_field', message: 'Only place and revision can be sent.' })),
        requestId,
      ),
    };
  }

  const { revision } = value;
  if (revision === undefined) {
    return { ok: false, response: badField('revision', 'required', 'Send the revision of the area you are changing.', requestId) };
  }
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1 || revision > REVISION_MAX) {
    return {
      ok: false,
      response: badField('revision', 'invalid_revision', `The revision is a whole number from 1 to ${REVISION_MAX}.`, requestId),
    };
  }

  if (!Object.hasOwn(value, 'place')) {
    return { ok: false, response: badField('place', 'required', 'Send the place to save, or null to clear it.', requestId) };
  }
  if (value.place === null) return { ok: true, place: null, revision };
  const sent = value.place;
  if (!sent || typeof sent !== 'object' || Array.isArray(sent) || typeof sent.id !== 'string') {
    return { ok: false, response: badField('place', 'invalid_place', 'Choose a place from the search results.', requestId) };
  }
  // Ruling D8: the id is the only thing read from the client's place.
  const place = placeById(sent.id);
  if (!place) {
    return { ok: false, response: badField('place', 'unknown_place', 'That place was not found. Search for it again.', requestId) };
  }
  return { ok: true, place, revision };
}

/** The 503 for a missing 0022 or 0017, or null for any other error. */
const unavailable = (err, requestId) =>
  isExploreAreaUnavailable(err) || isOperationsUnavailable(err) ? exploreAreaUnavailable(requestId) : null;

export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);
    // Exactly `{ place, revision }`, never `pendingOperation` (D7).
    const area = await readArea(supabaseAdmin, userId);
    return NextResponse.json(area, { headers });
  } catch (err) {
    const missing = unavailable(err, requestId);
    if (missing) return missing;
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`explore area read failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}

export async function PATCH(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);

    const body = await readJsonBody(request, { maxBytes: MAX_BYTES });
    if (!body.ok) {
      return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    }
    const parsed = parseSave(body.value, requestId);
    if (!parsed.ok) return parsed.response;
    const { place, revision } = parsed;

    // `If-Match` carries the same number as the body (runtime.ts:133). A client
    // sending two different preconditions does not know what it is asking for.
    const ifMatch = readIfMatch(request);
    if (ifMatch !== null && ifMatch.trim() !== String(revision)) {
      return badField('revision', 'precondition_mismatch', 'The If-Match header and revision must be the same revision.', requestId);
    }

    const operationId = parseUuid((request.headers.get('idempotency-key') ?? '').trim().toLowerCase());
    if (!operationId.ok) {
      return badField(
        'Idempotency-Key',
        operationId.code,
        'Send an Idempotency-Key header carrying this request\'s own id.',
        requestId,
      );
    }

    // Proves 0022 before the operation id is claimed, so a missing table has
    // changed nothing when the 503 says so.
    await readArea(supabaseAdmin, userId);

    const outcome = await runOperation(
      supabaseAdmin,
      {
        operationId: operationId.value,
        profileId: userId,
        domain: 'explore',
        kind: 'explore.area.save',
        input: { place: body.value.place, revision },
      },
      async () => {
        if (revision === REVISION_MAX) {
          // revision + 1 is not storable, so nothing is written. Whether that is
          // a stale view or a truly full counter is the current row's answer.
          const current = await readArea(supabaseAdmin, userId);
          if (current.revision !== revision) return { status: 'failed', reason: 'conflict', revision: current.revision };
          return { status: 'failed', reason: 'revision_exhausted', revision };
        }
        const saved = await writeArea(supabaseAdmin, { profileId: userId, expectedRevision: revision, place });
        if (saved.ok) return { status: 'succeeded', area: saved.area };
        return { status: 'failed', reason: 'conflict', revision: saved.revision };
      },
    );

    // Unsettled: an attempt still inside its window has no receipt, and the
    // honest answer is that the outcome is not confirmed. Settled as failed with
    // no receipt: the earlier attempt threw, it is over, and a 409 lets the
    // client stop tracking it (D9).
    if (!outcome.result) {
      if (outcome.status === 'failed') return conflict(INCOMPLETE_MESSAGE, requestId, { reason: 'attempt_failed' });
      return inFlight(requestId);
    }
    const result = outcome.result;
    if (result.status === 'succeeded' && result.area) {
      // Exactly the area, which is the only shape the client accepts here.
      return NextResponse.json(result.area, { headers });
    }
    if (result.reason === 'conflict') {
      return conflict(CONFLICT_MESSAGE, requestId, { reason: 'stale_revision', revision: result.revision });
    }
    if (result.reason === 'revision_exhausted') {
      return conflict(EXHAUSTED_MESSAGE, requestId, { reason: 'revision_exhausted', revision: result.revision });
    }
    // Reaped: the claim never settled within the ledger's window.
    if (result.reason === ABANDONED_REASON) return conflict(INCOMPLETE_MESSAGE, requestId, { reason: 'abandoned' });
    // A reason or status this route never writes. No revision was compared, so
    // it is not called stale.
    return conflict(INCOMPLETE_MESSAGE, requestId, { reason: 'attempt_failed' });
  } catch (err) {
    if (err?.message === OPERATION_INPUT_MISMATCH) {
      return conflict(MISMATCH_MESSAGE, requestId, { reason: 'operation_mismatch' });
    }
    const missing = unavailable(err, requestId);
    if (missing) return missing;
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    // The detail goes to the log: a database message is not for the person.
    console.error(`explore area save failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
