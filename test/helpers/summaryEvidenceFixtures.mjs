/**
 * Today and Homeguard answers for the saved-summary suites, built by the
 * servers' own computations (lib/dailyPayload.js, lib/homeGuardPayload.js) and
 * mapped by the screens' own StageData builder (lib/frontend/stage-data.ts),
 * so a test compares what a screen would show with what a summary saves.
 */
import { formatDailyPayload } from '../../lib/dailyPayload.js';
import { homeGuardPayload } from '../../lib/homeGuardPayload.js';
import { normalizeBands } from '../../lib/household.js';
import { loadFrontend } from '../frontend-test-loader.mjs';

export const { buildStageData } = await loadFrontend('stage-data');

export const RETRIEVED_AT = '2026-10-20T14:05:00.000Z';
export const PWSID = 'NC0149010';
export const UTILITY_ROW = Object.freeze({
  pwsid: PWSID,
  pws_name: 'Example County Water',
  status: 'Final',
  contaminants: { PFOA: [{ date: '3/14/2024', value_ppt: 6.1 }], PFOS: [{ date: '3/14/2024', value_ppt: 2 }] },
});
export const PUBLIC_PROFILE = Object.freeze({ county: 'Iredell County', state: 'NC', pwsid: PWSID, water_source: 'utility', home_year: 1962 });
export const WELL_PROFILE = Object.freeze({ county: 'Iredell County', state: 'NC', pwsid: null, water_source: 'well', home_year: 1962 });

/** The stored daily_scores columns for a reading (what GET /api/daily-score writes). */
export function dailyRow(over = {}) {
  return {
    aqi: 42,
    aqi_source: 'airnow',
    uv_index: 5.2,
    pollen_level: JSON.stringify({ tree: 2, grass: 1, weed: 0 }),
    mold_risk: 'moderate',
    details: { dominant_pollutant: 'PM2.5', uv_peak_window: { start: '11:00', end: '15:00', max: 5.2 }, mold_basis: { humidity_pct: 80, precip_pct: 40 } },
    created_at: RETRIEVED_AT,
    ...over,
  };
}

export function dailyPayload(over = {}) {
  return formatDailyPayload({
    aqi: 42, aqiSource: 'airnow', aqiIsMeasured: true, dominantPollutant: 'PM2.5', uvIndex: 5.2,
    uvPeakWindow: { start: '11:00', end: '15:00', max: 5.2 }, pollen: { tree: 2, grass: 1, weed: 0 },
    mold: { risk: 'moderate', basis: { humidity_pct: 80, precip_pct: 40 } }, cached: true, retrievedAt: RETRIEVED_AT, bands: normalizeBands(null),
    ...over,
  });
}

/** A Supabase-shaped client answering one ucmr5_utilities row (or none). */
export function utilitiesClient(row = UTILITY_ROW) {
  return {
    from: () => ({
      select: () => ({
        eq: (_column, value) => ({
          single: async () => (row && value === row.pwsid ? { data: row, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } }),
        }),
      }),
    }),
  };
}

export async function homePayload(profileRow = PUBLIC_PROFILE, row = UTILITY_ROW) {
  const built = await homeGuardPayload({ profileRow, given: {}, utilities: utilitiesClient(row), readBands: async () => null });
  return built.ok ? built.payload : null;
}

/** The StageData a screen builds from these answers. */
export async function stageFor({ profileRow = PUBLIC_PROFILE, daily = dailyPayload(), home, homeId = 'home-1' } = {}) {
  const homeGuard = home === undefined ? await homePayload(profileRow) : home;
  return buildStageData(daily, homeGuard, { profile: { ...profileRow }, home_context: homeId ? { id: homeId } : null });
}
