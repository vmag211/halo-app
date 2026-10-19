/**
 * How the settings and alerts surfaces degrade before migration 0021.
 *
 * Both surfaces in this package need 0021 (B04 plan, Ruling S2), and neither
 * can be served from the tables that already exist:
 *
 *   GET/PATCH /api/settings    public.profile_preferences holds the display,
 *                              quiet-hours, calendar and Luna-context values
 *                              and the settings aggregate `revision`;
 *                              profiles.tenure holds the three-state tenure
 *                              that profiles.renter_mode cannot express.
 *   GET /api/alerts            public.alerts gains `revision`, `category` and
 *   POST /api/alerts/state     the navigation target columns.
 *
 * Four route handlers read those, and they are written by two tasks working in
 * parallel. One predicate and one response live here so they cannot disagree
 * about what a half-applied schema means, the same way lib/operations.js does
 * it for the ledger, lib/account.js for the recovery schema and lib/luna.js
 * for Luna's tables.
 *
 * Pure module apart from the error envelope: no Supabase client, so a test can
 * load it on its own.
 */
import { apiError, ERROR_CODES } from '@/lib/apiErrors';

/**
 * "Not there yet": one of 0021's tables is missing (PGRST205 from PostgREST,
 * 42P01 from Postgres) or one of its columns is (PGRST204, 42703).
 *
 * The column codes matter as much as the table ones here, because 0021 adds
 * columns to two tables that already exist. A missing column is reported as
 * unavailable rather than worked around, for the reason lib/account.js gives
 * for 0019's `intent`: the answer a route could still give would be a claim it
 * has no way to support. Without profiles.tenure the snapshot would have to
 * read renter_mode and call every non-renter an 'owner', which is exactly the
 * distinction Ruling S3 says the boolean cannot make. Without alerts.revision
 * there is no optimistic-concurrency contract at all, so a patch could
 * overwrite a change the caller never saw.
 */
const SETTINGS_ALERTS_SCHEMA_MISSING = new Set(['PGRST205', '42P01', 'PGRST204', '42703']);

/** True when the error says migration 0021 is not applied. */
export function isSettingsAlertsUnavailable(error) {
  return !!error && SETTINGS_ALERTS_SCHEMA_MISSING.has(error.code);
}

/**
 * The one 503 the settings and alerts routes answer with while 0021 is not
 * applied. Not retryable: retrying cannot help, and the production client
 * discards an error body anyway (only the status and Retry-After reach it), so
 * this sentence is for a log, an older caller and anybody reading by hand.
 */
export function settingsAlertsUnavailable(requestId) {
  return apiError({
    status: 503,
    code: ERROR_CODES.FEATURE_UNAVAILABLE,
    message: 'Settings and alerts are not available yet. Nothing was changed. Please try again later.',
    retryable: false,
    requestId,
  });
}
