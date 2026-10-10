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
 *
 * Home contexts (migration 0016). Given the household's home context id, the
 * backfill is for that home: a date counts as covered only by a reading at that
 * home (linked to the context, or not linked to any), so after a move the new
 * home gets its own history while the earlier home's readings stay as they are,
 * linked to the earlier home. Every row it adds carries the context id, and
 * backfillHomeContext records the run on the context (backfill_state). Until
 * 0016 is applied there is no id and it works exactly as before.
 */
import { moldFromNws, fetchDailyReadings } from './dailyReadings.js';
import { buildDashboardScore } from './dailyPayload.js';
import { localDate, addDays } from './localDate.js';
import { HOME_CONTEXT_LINK, isMissingContextLink, writeBackfillState } from './homeContextRpc.js';

export const BACKFILL_DAYS = 28;

/**
 * The household-local dates a backfill on `today` covers: from `days` days ago to yesterday.
 * Open-Meteo's history (past_days) ends with today, which is the live reading's, never backfilled.
 */
export function backfillRange(today, days = BACKFILL_DAYS) {
  return { from: addDays(today, -days), to: addDays(today, -1) };
}

/** Every date from `from` to `to`, both included ('YYYY-MM-DD'). */
function datesBetween(from, to) {
  const dates = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

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

/** The row without its home context link. */
function withoutLink(row) {
  const copy = { ...row };
  delete copy[HOME_CONTEXT_LINK];
  return copy;
}

/**
 * Insert rows. Rows carrying home_context_id are inserted without it when this schema lacks
 * the column (migration 0016 not applied; `onContextLinkDropped(error)` is told). Then, as
 * before, the optional `details` column is dropped if this schema lacks it.
 */
async function insertRows(supabase, rows, { onContextLinkDropped } = {}) {
  if (!rows.length) return 0;
  let attempt = rows;
  let { error } = await supabase.from('daily_scores').insert(attempt);
  if (error && attempt.some((row) => HOME_CONTEXT_LINK in row) && isMissingContextLink(error)) {
    onContextLinkDropped?.(error);
    attempt = attempt.map(withoutLink);
    ({ error } = await supabase.from('daily_scores').insert(attempt));
  }
  if (error && isUndefinedColumnError(error)) {
    ({ error } = await supabase.from('daily_scores').insert(attempt.map(({ details, ...r }) => r)));
  }
  if (error) throw new Error(error.message);
  return rows.length;
}

/**
 * The dates from `from` to `to` that already have a reading. With a home context id, only
 * readings at that home count: linked to it, or linked to no home at all (written before the
 * daily writers set the link). Readings of an earlier home do not: that home's history is not
 * this one's.
 * @returns {Promise<{ dates?: Set<string>, error?: object }>}
 */
async function readExistingDates(supabase, profileId, from, to, homeContextId) {
  let query = supabase
    .from('daily_scores')
    .select('date')
    .eq('profile_id', profileId)
    .gte('date', from)
    .lte('date', to);
  if (homeContextId) query = query.or(`${HOME_CONTEXT_LINK}.eq.${homeContextId},${HOME_CONTEXT_LINK}.is.null`);
  const { data, error } = await query;
  if (error) return { error };
  return { dates: new Set((data || []).map((r) => r.date)) };
}

async function existingDates(supabase, profileId, from, to) {
  const { dates, error } = await readExistingDates(supabase, profileId, from, to, null);
  if (error) throw new Error(error.message);
  return dates;
}

/**
 * Backfill one household's recent history. Never throws: it runs after the
 * response, where an error has nowhere useful to go.
 *
 * opts.homeContextId: the household's home context (0016). Only that home's readings count as
 * existing, and every row added is linked to it. When the schema turns out not to have the
 * link, `opts.onContextLinkDropped(error)` is told and the run continues as without an id.
 *
 * @returns {Promise<{inserted:number, error?:string, missing?:string[]}>} `missing`: the dates
 *   of backfillRange that still have no reading at this home afterwards (the history had
 *   nothing usable for them)
 */
export async function backfillHousehold(supabase, profileId, { lat, lng }, opts = {}) {
  try {
    const today = opts.today || localDate();
    const days = opts.days || BACKFILL_DAYS;
    const from = addDays(today, -days);
    let homeContextId = opts.homeContextId || null;
    let read = await readExistingDates(supabase, profileId, from, today, homeContextId);
    if (read.error && homeContextId && isMissingContextLink(read.error)) {
      opts.onContextLinkDropped?.(read.error);
      homeContextId = null;
      read = await readExistingDates(supabase, profileId, from, today, null);
    }
    if (read.error) throw new Error(read.error.message);
    const have = read.dates;
    const { air, weather } = await fetchBackfillSources({ lat, lng }, opts);
    let rows = buildBackfillRows({ air, weather, existingDates: have, today, profileId });
    if (homeContextId) rows = rows.map((row) => ({ ...row, [HOME_CONTEXT_LINK]: homeContextId }));
    const inserted = await insertRows(supabase, rows, opts);
    const covered = new Set([...have, ...rows.map((row) => row.date)]);
    const range = backfillRange(today, days);
    const missing = datesBetween(range.from, range.to).filter((date) => !covered.has(date));
    return { inserted, missing };
  } catch (err) {
    console.error('Backfill failed:', err.message);
    return { inserted: 0, error: err.message };
  }
}

/**
 * The onboarding backfill for one home context, with its progress recorded on the context:
 *
 *   running   when it starts (with the date range it covers)
 *   complete  it finished and every date of the range has a reading at this home
 *   partial   it finished, but some dates still have none: the history had nothing usable for
 *             them (no air, UV or mold value at all), so nothing was recorded rather than a zero
 *   failed    it stopped on an error (reading the existing dates, the history request, or the
 *             insert, which is one statement: nothing of it was saved)
 *
 * backfill_from and backfill_to are the range (backfillRange), backfill_updated_at the time of
 * the write. Pollen is never in the history (lib/backfill.js header), so it does not make a run
 * partial. The state writes are owner-scoped (writeBackfillState) and never stop the backfill:
 * a state that cannot be saved is logged (or, when the table or a column is missing, passed to
 * `onSchemaMissing`), and the readings are still recorded.
 *
 * Never throws: it runs after the response.
 *
 * @param {object} supabase the service-role client
 * @param {string} profileId the verified session's user id
 * @param {{ lat: number, lng: number }} point the home's stored point
 * @param {{ homeContextId: string, onSchemaMissing?: (error: object) => void, today?: string,
 *           days?: number, fetchImpl?: Function, clock?: () => Date }} opts
 * @returns {Promise<{ state: string, from: string, to: string, inserted: number, missing?: string[], error?: string }>}
 */
export async function backfillHomeContext(supabase, profileId, { lat, lng }, opts = {}) {
  const { homeContextId, onSchemaMissing, clock = () => new Date(), ...rest } = opts;
  let range = { from: null, to: null };
  try {
    const today = rest.today || localDate(clock());
    const days = rest.days || BACKFILL_DAYS;
    range = backfillRange(today, days);
    if (!homeContextId) {
      // No home to record it on: the plain backfill.
      const result = await backfillHousehold(supabase, profileId, { lat, lng }, { ...rest, today, days });
      return { ...result, state: null, ...range };
    }
    const record = async (state) => {
      const saved = await writeBackfillState(supabase, { profileId, contextId: homeContextId, state, ...range, at: clock() });
      if (saved.unavailable) onSchemaMissing?.(saved.error);
      else if (saved.failed) console.error(`Backfill state "${state}" not saved for home ${homeContextId}:`, saved.error?.message);
    };
    await record('running');
    const result = await backfillHousehold(supabase, profileId, { lat, lng }, {
      ...rest,
      today,
      days,
      homeContextId,
      onContextLinkDropped: onSchemaMissing,
    });
    const state = result.error ? 'failed' : result.missing.length > 0 ? 'partial' : 'complete';
    await record(state);
    return { ...result, state, ...range };
  } catch (err) {
    console.error(`Backfill for home ${homeContextId} failed:`, err?.message);
    return { inserted: 0, error: err?.message, state: 'failed', ...range };
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
