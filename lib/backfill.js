/**
 * Reading history: backfill and daily recording (§14.4, §23; punch list v3 item 10).
 *
 * Journal's analysis and its first-visit insight need a reading for every day,
 * but a row used to exist only for days the household opened Today. Two fixes:
 *
 *  - Backfill (at onboarding): the last 28 days from Open-Meteo's history —
 *    daily peak modeled AQI, daily max UV, and the mold inputs (daily mean
 *    humidity, max chance of rain). Google Pollen has no history, so backfilled
 *    days record pollen as missing, never as zero.
 *  - Daily recording (the daily job): one live reading per household per day.
 *
 * Rows are only ever added for dates with no reading yet, so a real reading is
 * never overwritten by a modeled one. All dates are household-local.
 */
import { moldFromNws, fetchDailyReadings } from './dailyReadings.js';
import { buildDashboardScore } from './dailyPayload.js';
import { localDate, addDays } from './localDate.js';

export const BACKFILL_DAYS = 28;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Open-Meteo history → daily_scores rows for dates before `today` that have no
 * reading yet. Pure.
 * @param {{air:object, weather:object, existingDates:Set<string>|string[], today:string, profileId:string}} p
 */
export function buildBackfillRows({ air, weather, existingDates, today, profileId }) {
  const existing = existingDates instanceof Set ? existingDates : new Set(existingDates || []);

  // Daily peak of Open-Meteo's hourly US AQI (already EPA-averaged per pollutant).
  const aqiByDate = new Map();
  const times = air?.hourly?.time || [];
  const values = air?.hourly?.us_aqi || [];
  times.forEach((t, i) => {
    const v = values[i];
    if (!finite(v)) return;
    const date = String(t).slice(0, 10);
    if (!aqiByDate.has(date) || v > aqiByDate.get(date)) aqiByDate.set(date, v);
  });

  const d = weather?.daily || {};
  const rows = [];
  (d.time || []).forEach((date, i) => {
    if (date >= today || existing.has(date)) return;
    const aqi = aqiByDate.get(date) ?? null;
    const uv = finite(d.uv_index_max?.[i]) ? d.uv_index_max[i] : null;
    const mold = moldFromNws({
      relativeHumidity: { value: finite(d.relative_humidity_2m_mean?.[i]) ? d.relative_humidity_2m_mean[i] : null },
      probabilityOfPrecipitation: {
        value: finite(d.precipitation_probability_max?.[i]) ? d.precipitation_probability_max[i] : null,
      },
    });
    const pollen = { tree: null, grass: null, weed: null };
    const score = buildDashboardScore({ aqi, uvIndex: uv, pollen, moldRisk: mold.risk });
    rows.push({
      profile_id: profileId,
      date,
      aqi,
      uv_index: uv,
      pollen_level: JSON.stringify(pollen),
      mold_risk: mold.risk,
      score: score.display_score,
      aqi_source: aqi === null ? null : 'open-meteo',
      details: {
        backfilled: true,
        source: 'open-meteo-history',
        aqi_basis: 'daily_peak_modeled',
        uv_basis: 'daily_max',
        mold_basis: mold.basis,
      },
    });
  });
  // Nothing to record for a day with no readings at all.
  return rows.filter((r) => r.aqi !== null || r.uv_index !== null || r.mold_risk !== null);
}

async function getJson(fetchImpl, url) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/** Fetch the Open-Meteo history for a point. Throws if either request fails. */
export async function fetchBackfillSources({ lat, lng }, { fetchImpl = fetch, days = BACKFILL_DAYS } = {}) {
  const tz = encodeURIComponent('America/New_York');
  const [air, weather] = await Promise.all([
    getJson(
      fetchImpl,
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&hourly=us_aqi&past_days=${days}&forecast_days=1&timezone=${tz}`,
    ),
    getJson(
      fetchImpl,
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=uv_index_max,relative_humidity_2m_mean,precipitation_probability_max&past_days=${days}&forecast_days=1&timezone=${tz}`,
    ),
  ]);
  return { air, weather };
}

// Postgres 42703 / PostgREST PGRST204: a column this environment doesn't have.
function isUndefinedColumnError(error) {
  return (
    !!error &&
    (error.code === '42703' ||
      error.code === 'PGRST204' ||
      /column .* does not exist/i.test(error.message || '') ||
      /could not find the .* column/i.test(error.message || ''))
  );
}

/** Insert rows, dropping the optional `details` column if this schema lacks it. */
async function insertRows(supabase, rows) {
  if (!rows.length) return 0;
  let { error } = await supabase.from('daily_scores').insert(rows);
  if (error && isUndefinedColumnError(error)) {
    ({ error } = await supabase.from('daily_scores').insert(rows.map(({ details, ...r }) => r)));
  }
  if (error) throw new Error(error.message);
  return rows.length;
}

async function existingDates(supabase, profileId, from, to) {
  const { data, error } = await supabase
    .from('daily_scores')
    .select('date')
    .eq('profile_id', profileId)
    .gte('date', from)
    .lte('date', to);
  if (error) throw new Error(error.message);
  return new Set((data || []).map((r) => r.date));
}

/**
 * Backfill one household's recent history. Never throws: it runs after the
 * response, where an error has nowhere useful to go.
 * @returns {Promise<{inserted:number, error?:string}>}
 */
export async function backfillHousehold(supabase, profileId, { lat, lng }, opts = {}) {
  try {
    const today = opts.today || localDate();
    const from = addDays(today, -(opts.days || BACKFILL_DAYS));
    const have = await existingDates(supabase, profileId, from, today);
    const { air, weather } = await fetchBackfillSources({ lat, lng }, opts);
    const rows = buildBackfillRows({ air, weather, existingDates: have, today, profileId });
    return { inserted: await insertRows(supabase, rows) };
  } catch (err) {
    console.error('Backfill failed:', err.message);
    return { inserted: 0, error: err.message };
  }
}

/**
 * The daily job's recording: one live reading for a household for today, unless
 * one already exists. Never throws.
 * @returns {Promise<'recorded'|'already_had_one'|'failed'>}
 */
export async function recordToday(supabase, profile, opts = {}) {
  try {
    const today = opts.today || localDate();
    const have = await existingDates(supabase, profile.id, today, today);
    if (have.has(today)) return 'already_had_one';
    const r = await fetchDailyReadings({ lat: profile.lat, lng: profile.lng }, opts);
    const score = buildDashboardScore({ aqi: r.aqi, uvIndex: r.uvIndex, pollen: r.pollen, moldRisk: r.mold.risk });
    const row = {
      profile_id: profile.id,
      date: today,
      aqi: r.aqi,
      uv_index: r.uvIndex,
      pollen_level: JSON.stringify(r.pollen),
      mold_risk: r.mold.risk,
      score: score.display_score,
      aqi_source: r.aqiSource,
      details: {
        recorded_by: 'daily_job',
        dominant_pollutant: r.dominantPollutant,
        uv_peak_window: r.uvPeakWindow,
        uv_source: r.uvSource,
        mold_basis: r.mold.basis,
      },
    };
    await insertRows(supabase, [row]);
    return 'recorded';
  } catch (err) {
    console.error(`Daily recording failed for ${profile?.id}:`, err.message);
    return 'failed';
  }
}
