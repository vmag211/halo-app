/**
 * The Today and Homeguard answers a saved household summary freezes (B15,
 * Ruling S15-6 as revised), read server-side from the same computations the
 * score endpoints use, never a second scoring:
 *
 *   Today      the household's newest stored reading for today's local date
 *              (the row GET /api/daily-score stores and serves from its cache),
 *              rebuilt with formatDailyPayload exactly as that route rebuilds a
 *              cached row. No provider is called: a summary records what was
 *              read, with its retrieval time. No reading today is no reading,
 *              never an older day's presented as today's.
 *   Homeguard  homeGuardPayload (lib/homeGuardPayload.js), the computation
 *              GET /api/home-guard answers with, for the household's stored
 *              answers. The population lookup is skipped (no score or factor
 *              reads it). A household with no county answers null, as the
 *              route answers its 400.
 *
 * The route turns these into the screens' StageData with buildStageData
 * (lib/frontend/stage-data.ts), which also drops a reading linked to an
 * earlier home, and composeSummary freezes that as dated lines.
 *
 * Throws a Supabase error as it came; the route then saves both sections as
 * unavailable, said in the report. Pure but for the reads it is given.
 */
import { formatDailyPayload, readingsFromRow, toIsoUtc } from './dailyPayload.js';
import { homeGuardPayload } from './homeGuardPayload.js';
import { BAND_KEYS, normalizeBands } from './household.js';
import { localDate } from './localDate.js';

/**
 * @param {object} p
 * @param {object} p.admin      the service-role client
 * @param {object} p.utilities  the client GET /api/home-guard reads ucmr5_utilities with
 * @param {string} p.profileId  the verified session's user id
 * @param {object|null} p.home  the current home context row, or null
 * @param {Date} [p.now]
 * @returns {Promise<{daily: object|null, homeGuard: object|null, profile: object}>}
 */
export async function readSummaryEvidence({ admin, utilities, profileId, home, now = new Date() }) {
  if (!profileId) throw new Error('summaryEvidence: a summary needs an owner');
  const { data: profileRow, error: profileError } = await admin.from('profiles').select('*').eq('id', profileId).maybeSingle();
  if (profileError) throw profileError;
  // Wording only (§8.2); before 0002 the table is absent and there is no row, as both routes treat it.
  const { data: bandRow } = await admin.from('household_bands').select(BAND_KEYS.join(', ')).eq('profile_id', profileId).maybeSingle();

  const { data: row, error: dailyError } = await admin
    .from('daily_scores')
    .select('*')
    .eq('profile_id', profileId)
    .eq('date', localDate(now))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (dailyError) throw dailyError;
  const daily = row
    ? {
      ...formatDailyPayload({ ...readingsFromRow(row), cached: true, retrievedAt: toIsoUtc(row.created_at), bands: normalizeBands(bandRow ?? null) }),
      // buildStageData drops a reading stored for an earlier home.
      ...(typeof row.home_context_id === 'string' ? { home_context_id: row.home_context_id } : {}),
    }
    : null;

  const built = await homeGuardPayload({ profileRow, given: {}, utilities, readBands: async () => bandRow ?? null, lookupPopulation: null });
  const homeGuard = built.ok ? built.payload : null;

  return { daily, homeGuard, profile: { profile: profileRow ?? null, home_context: home?.id ? { id: home.id } : null } };
}
