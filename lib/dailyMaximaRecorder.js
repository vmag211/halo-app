/**
 * The daily maxima recorder (B08 Task 3; docs/backend/plans/b08-evidence.md, Rulings E2 to E9,
 * E21, F2; the method is lib/dailyMaxima.js, the storage migration 0025).
 *
 *   const result = await runRecorder({ supabase, fetchImpl, now, env, budget, deadlineMs, clock });
 *     -> { unavailable: true, code }            0025 (or 0016) is not applied; nothing was fetched
 *     -> { counts, stopped, refusedRules }      counts only; stopped is null, 'budget' or 'deadline'
 *
 * One run:
 *
 *  1. The window is the three most recent completed America/New_York days, D-3 to D-1 (E4, E5).
 *     A day's attempt is how far back it lies: D-1 is looked at for the first time, D-3 for the
 *     third and last. The attempt is positional, so a missed cron day means fewer looks.
 *  2. begin_daily_maxima_run with D-3. The first run fixes recording_from there and no later run
 *     moves it (E9). This is also the probe: before 0025 it fails, and nothing is fetched.
 *  3. Every current home context, keyset paged by id until a page comes back empty (F2).
 *     A context is skipped and counted when it has no stored point, its state is set and is not
 *     NC, or its point is outside North Carolina padded by 0.5 degrees (E8). A context with no
 *     state (an older home) is recorded when its point is inside that box. Its days are the window's days
 *     on or after recording_from and its first full day, the local date after effective_from, so
 *     a move day belongs to neither home (E9).
 *  4. The stored rows of the window: a day and factor already final (a value, 'source_gap' or
 *     'unavailable') is not fetched again.
 *  5. Each context's Air kind from its latest stored Air row with a source (E8). An undecided
 *     context is decided on its first day that AirNow answers for: measured when a station within
 *     25 miles reported that day, modeled otherwise, and never changed afterwards.
 *  6. ONE AirNow aq/data call for the padded NC box over the window's UTC hours (E5, E21), only
 *     when some context needs measured or undecided Air. An answer that is not an array, or has
 *     no usable hour on any of the window's days, is a provider failure: the measured homes stay
 *     pending, never modeled (E8), and an undecided home stays undecided.
 *  7. Per distinct stored point (as stored, no further rounding, DS-034), at most one Open-Meteo
 *     forecast call (UV) and one air-quality call (modeled Air), each with past_days reaching back
 *     to D-3 and timeformat=unixtime (lib/dailyMaxima.js openMeteoDailyMaxima). An answer with no
 *     hour on any of the window's days is a provider failure, not three gaps (Task 2 review N3),
 *     so three such runs can never store a false final "Source gap". Points are taken oldest
 *     unsettled day first; at most `budget` points a run make calls, and none starts after the
 *     deadline (E21). The contexts at a point that was not reached are untouched, and the next
 *     run takes them while their days are still in the window.
 *  8. lib/dailyMaxima.js settles each day (settleDay): a value on the first look only with every
 *     hour, on the second and third with 75 percent; a day still short on the third look is a
 *     final source_gap, and one whose provider never answered a final unavailable.
 *  9. Pending rows that left the window unsettled (a missed run, a budget or deadline stop) are
 *     stored final as 'unavailable': no answer was taken on a last look.
 * 10. The rows go through record_daily_maxima in batches of at most 1000. A final row is kept as
 *     it is, a deleted context's rows are skipped, and a row that would break a CHECK is refused
 *     and counted by rule name, all inside the function.
 * 11. finish_daily_maxima_run with the counts.
 *
 * Never an input: daily_scores, or any app-time reading (E1, E6). Never called: Mapbox, Google
 * Pollen, NWS, OpenUV (E21). Logs carry error codes, fixed reason tokens, rule names and counts,
 * never a key, an id, a coordinate, a URL or a value.
 */
import { getJson } from './forecast/http.js';
import { localDate } from './localDate.js';
import {
  METHOD_VERSION,
  TIME_ZONE,
  airCoverageFor,
  airNowDailyMaxima,
  airSourceCode,
  chooseAirKind,
  completedDays,
  firstFullDay,
  haversineKm,
  localDaySlots,
  STATION_RADIUS_KM,
  openMeteoDailyMaxima,
  settleDay,
  SETTLE_ATTEMPTS,
} from './dailyMaxima.js';
import {
  RECORD_BATCH_LIMIT,
  beginRun,
  finishRun,
  isDailyMaximaUnavailable,
  latestAirKinds,
  listCurrentContexts,
  readStalePending,
  readWindowRows,
  recordRows,
} from './dailyMaximaStore.js';

/** North Carolina's extent padded by 0.5 degrees: [west, south, east, north] (E8). */
export const NC_PADDED_BBOX = Object.freeze([-84.83, 33.34, -74.96, 37.09]);
/**
 * Points with Open-Meteo calls per run, unless DAILY_MAXIMA_MAX_POINTS says otherwise (E21).
 * 250 points is at most 500 calls, which stays under Open-Meteo's free tier of 600 calls a minute
 * (open-meteo.com/en/terms) even when a whole run falls inside one minute. A run the budget stops
 * is finished by the next run (coordinator ruling 2026-10-20; the plan's 400 is lowered).
 */
export const DEFAULT_MAX_POINTS = 250;
/** No provider call starts this long after the run began (E21), leaving the rest of 60 s to write. */
export const DEFAULT_DEADLINE_MS = 45000;
/** Every provider request's timeout (lib/mapLayers.js SOURCE_TIMEOUT_MS). */
export const PROVIDER_TIMEOUT_MS = 20000;
/** AirNow's window answer for the padded box: thousands of site-hours, so above getJson's 2 MB default. */
export const AIRNOW_MAX_BYTES = 16 * 1024 * 1024;
/** Points fetched at once. */
export const POINT_CONCURRENCY = 4;
/** 0025's station CHECK (N4): a code that fails it is not a station this method can store. */
export const STATION_CODE = /^[0-9A-Za-z-]{1,32}$/;

const AIRNOW_URL = 'https://www.airnowapi.org/aq/data/';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const DAY_MS = 86400000;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** The run's point budget: a positive integer, else the default. */
export function pointBudget(value) {
  const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return Number.isSafeInteger(n) && n > 0 ? n : DEFAULT_MAX_POINTS;
}

function insideBox(lat, lng) {
  const [west, south, east, north] = NC_PADDED_BBOX;
  return lat >= south && lat <= north && lng >= west && lng <= east;
}

/** 'YYYY-MM-DDTHH' (AirNow's hour form) of an ISO instant. */
const airNowHour = (iso) => iso.slice(0, 13);

/** Whole UTC days from the UTC date of `iso` to the UTC date of `now`. */
function utcDaysBetween(iso, now) {
  const start = Date.UTC(...iso.slice(0, 10).split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((end - start) / DAY_MS);
}

/** Every hour slot of the window's days, for "did the answer cover any requested day". */
function windowSlots(days) {
  return new Set(days.flatMap((day) => localDaySlots(day)));
}

const AIRNOW_HOUR = /^\d{4}-\d{2}-\d{2}T\d{2}:00$/;

/** The station code of an AirNow row, as lib/dailyMaxima.js reads it. */
const stationCodeOf = (row) => String(row?.FullAQSCode || row?.IntlAQSCode).trim();

/**
 * The AirNow rows this method can use, with the same tests lib/dailyMaxima.js's row reader
 * applies (numeric point, a pollutant, a whole UTC hour, a reading), plus a station code 0025
 * accepts (N4). Applying them here is what lets the coverage check below see a changed answer
 * shape as a failure rather than as "no station reported" (which would fix a home as modeled).
 */
function usableAirNowRows(json) {
  return json.filter((row) => {
    const code = row?.FullAQSCode || row?.IntlAQSCode;
    if (!(typeof code === 'string' || finite(code)) || !STATION_CODE.test(String(code).trim())) return false;
    return finite(row.Latitude) && finite(row.Longitude) && typeof row.Parameter === 'string' && row.Parameter.trim() !== ''
      && typeof row.UTC === 'string' && AIRNOW_HOUR.test(row.UTC) && finite(row.AQI) && row.AQI >= 0;
  });
}

/** True when some usable row is an hour inside the window (an empty or foreign answer is a failure). */
function airNowCoversWindow(rows, slots) {
  return rows.some((row) => {
    const at = Date.parse(`${row.UTC}:00Z`);
    return Number.isFinite(at) && slots.has(new Date(at).toISOString());
  });
}

/**
 * True when some hour of the window carries a reading in an Open-Meteo answer (Task 2 review
 * N3): an answer of foreign hours, or of the window's hours with every value null, is a provider
 * failure, so three of them end 'unavailable', never a false final 'source_gap'.
 */
function openMeteoCoversWindow(json, field, slots) {
  const times = json?.hourly?.time;
  const values = json?.hourly?.[field];
  return Array.isArray(times) && Array.isArray(values) && times.some((t, i) => Number.isSafeInteger(t)
    && slots.has(new Date(t * 1000).toISOString()) && finite(values[i]) && values[i] >= 0);
}

/**
 * The AirNow rows near each point, from one index of the answer's stations (built once a run):
 * only the stations within the radius are handed to airNowDailyMaxima, so a run's cost grows with
 * the stations near each point, not with every row of the box times every home.
 */
function airNowNearby(rows) {
  const stations = new Map();
  for (const row of rows) {
    const code = stationCodeOf(row);
    if (!stations.has(code)) stations.set(code, { lat: row.Latitude, lng: row.Longitude, rows: [] });
    stations.get(code).rows.push(row);
  }
  const memo = new Map();
  return (point) => {
    const key = `${point.lat},${point.lng}`;
    if (!memo.has(key)) {
      // A little beyond the radius: airNowDailyMaxima applies the exact one (per row's own point).
      const near = [...stations.values()].filter((s) => haversineKm(point, s) <= STATION_RADIUS_KM + 1);
      memo.set(key, near.flatMap((s) => s.rows));
    }
    return memo.get(key);
  };
}

async function mapLimit(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await fn(items[index], index);
    }
  });
  await Promise.all(workers);
}

/**
 * A row with no value keeps the source and station its stored pending row already names. A
 * measured home's rows carry no source on a day without a station answer (settleDay), so without
 * this a home whose only sourced rows were pending would lose them on a failed look, be read back
 * as undecided and could then be decided modeled: measured turned modeled, against E8. Only a
 * missing value keeps it; a value always carries the source it was computed from.
 */
function keepSource(settled, stored) {
  if (!stored || settled.value !== null || settled.source_code !== null) return settled;
  if (stored.source_code === 'airnow_station') {
    if (typeof stored.station_id !== 'string' || !STATION_CODE.test(stored.station_id)) return settled;
    return { ...settled, source_code: stored.source_code, station_id: stored.station_id };
  }
  return { ...settled, source_code: stored.source_code, station_id: null };
}

/** A 0025 row (exactly the keys record_daily_maxima accepts). */
function storedRow(ctx, date, factor, settled, hoursExpected, retrievedAt) {
  return {
    profile_id: ctx.profile_id,
    home_context_id: ctx.id,
    local_date: date,
    factor,
    value: settled.value,
    unit: factor === 'air' ? 'AQI' : 'UV index',
    source_code: settled.source_code,
    station_id: settled.station_id,
    method_version: METHOD_VERSION,
    time_zone: TIME_ZONE,
    hours_expected: hoursExpected,
    hours_observed: settled.hours_observed,
    missing_code: settled.missing_code,
    retrieved_at: retrievedAt,
  };
}

/**
 * One recorder run. See the file header.
 *
 * @param {object} args
 * @param {object} args.supabase the service-role client
 * @param {Function} [args.fetchImpl] the providers' fetch
 * @param {Date} [args.now] the run's instant (which days are complete)
 * @param {Record<string, string|undefined>} [args.env] AIRNOW_API_KEY, DAILY_MAXIMA_MAX_POINTS
 * @param {number} [args.budget] points with Open-Meteo calls this run (overrides the env)
 * @param {number} [args.deadlineMs] no provider call starts after this many ms
 * @param {() => number} [args.clock] milliseconds now, for the deadline
 */
export async function runRecorder({
  supabase,
  fetchImpl = globalThis.fetch,
  now = new Date(),
  env = process.env,
  budget,
  deadlineMs = DEFAULT_DEADLINE_MS,
  clock = () => Date.now(),
} = {}) {
  const deadlineAt = clock() + deadlineMs;
  const maxPoints = pointBudget(budget ?? env.DAILY_MAXIMA_MAX_POINTS);
  const runAt = now.toISOString();
  const today = localDate(now);
  const days = completedDays(now); // [D-3, D-2, D-1]
  const attemptOf = (date) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY_MS);
  const counts = {
    contexts: 0, eligible: 0, outside: 0, noPoint: 0, notYet: 0, upToDate: 0, deferred: 0,
    points: 0, pointsCalled: 0, airnowCalls: 0, openMeteoCalls: 0,
    airnowFailed: 0, forecastFailed: 0, airQualityFailed: 0,
    rows: 0, inserted: 0, updated: 0, kept: 0, skipped: 0, refused: 0,
    finalized: 0, batches: 0, failedBatches: 0, finishFailed: 0,
  };
  const refusedRules = {};
  let stopped = null;

  // 2. recording_from, and the probe.
  let recordingFrom;
  try {
    recordingFrom = await beginRun(supabase, days[0]);
  } catch (error) {
    if (isDailyMaximaUnavailable(error)) return { unavailable: true, code: error.code };
    throw error;
  }

  // 3. Every current home context, keyset paged until an empty page.
  const contexts = [];
  try {
    for (let after = null; ;) {
      const page = await listCurrentContexts(supabase, { after });
      if (page.length === 0) break;
      contexts.push(...page);
      after = page[page.length - 1].id;
    }
  } catch (error) {
    if (isDailyMaximaUnavailable(error)) return { unavailable: true, code: error.code };
    throw error;
  }
  counts.contexts = contexts.length;

  const work = [];
  for (const ctx of contexts) {
    if (!finite(ctx.lat) || !finite(ctx.lng)) { counts.noPoint += 1; continue; }
    // A home with no state (older homes) is recorded when its point is inside the box; any other
    // state is outside (E8; coordinator ruling 2026-10-20).
    const stateOk = ctx.state === 'NC' || ctx.state === null || ctx.state === undefined;
    if (!stateOk || !insideBox(ctx.lat, ctx.lng)) { counts.outside += 1; continue; }
    let firstDay;
    try {
      firstDay = firstFullDay(ctx.effective_from);
    } catch {
      counts.noPoint += 1;
      continue;
    }
    const dates = days.filter((day) => day >= recordingFrom && day >= firstDay);
    if (dates.length === 0) { counts.notYet += 1; continue; }
    work.push({ ctx, dates, point: `${ctx.lat},${ctx.lng}` });
  }

  // 4. What is already final in the window.
  const final = new Set();
  // A pending row's stored source and station, kept when this run has no answer (keepSource).
  const storedSource = new Map();
  if (work.length) {
    const window = await readWindowRows(supabase, work.map((w) => w.ctx.id), days[0]);
    if (window.complete) {
      for (const row of window.rows) {
        const key = `${row.home_context_id}|${row.local_date}|${row.factor}`;
        if (row.missing_code !== 'pending') final.add(key);
        else if (row.source_code) storedSource.set(key, { source_code: row.source_code, station_id: row.station_id ?? null });
      }
    }
  }
  const pending = [];
  for (const w of work) {
    w.airDates = w.dates.filter((d) => !final.has(`${w.ctx.id}|${d}|air`));
    w.uvDates = w.dates.filter((d) => !final.has(`${w.ctx.id}|${d}|uv`));
    if (w.airDates.length === 0 && w.uvDates.length === 0) counts.upToDate += 1;
    else pending.push(w);
  }
  counts.eligible = pending.length;

  // 5. Air kinds, from the stored rows (E8).
  const needAir = pending.filter((w) => w.airDates.length);
  const stored = needAir.length ? await latestAirKinds(supabase, needAir.map((w) => w.ctx.id)) : new Map();
  for (const w of needAir) w.kind = chooseAirKind(stored.get(w.ctx.id) ?? null, undefined);

  // 6. One AirNow call for the whole window and box.
  const slots = windowSlots(days);
  const firstSlot = localDaySlots(days[0])[0];
  const lastDaySlots = localDaySlots(days[days.length - 1]);
  const lastSlot = lastDaySlots[lastDaySlots.length - 1];
  let airNow = null; // the usable rows, or null when AirNow did not answer
  let airNowAt = runAt;
  if (needAir.some((w) => w.kind !== 'modeled')) {
    const key = env.AIRNOW_API_KEY;
    if (!key) {
      counts.airnowFailed += 1;
      console.error('Daily maxima: AirNow is not configured (no key); measured Air stays pending.');
    } else {
      counts.airnowCalls += 1;
      const url = `${AIRNOW_URL}?startDate=${airNowHour(firstSlot)}&endDate=${airNowHour(lastSlot)}`
        + '&parameters=OZONE,PM25,PM10'
        + `&BBOX=${NC_PADDED_BBOX.join(',')}&dataType=A&format=application/json&verbose=1&monitorType=0`
        + `&includerawconcentrations=0&API_KEY=${encodeURIComponent(key)}`;
      const answer = await getJson(url, { fetchImpl, timeoutMs: PROVIDER_TIMEOUT_MS, maxBytes: AIRNOW_MAX_BYTES });
      airNowAt = new Date(clock()).toISOString();
      const rows = answer.ok && Array.isArray(answer.json) ? usableAirNowRows(answer.json) : null;
      if (rows && airNowCoversWindow(rows, slots)) {
        airNow = rows;
      } else {
        counts.airnowFailed += 1;
        console.error('Daily maxima: AirNow did not answer for the window; measured Air stays pending:', answer.ok ? 'no_hours' : answer.reason);
      }
    }
  }
  const nearby = airNow ? airNowNearby(airNow) : null;
  const stationDays = new Map(); // one airNowDailyMaxima per point
  for (const w of needAir) {
    if (w.kind === 'modeled') continue;
    if (!airNow) continue; // measured stays measured with no answer; undecided stays undecided
    if (!stationDays.has(w.point)) {
      const point = { lat: w.ctx.lat, lng: w.ctx.lng };
      stationDays.set(w.point, airNowDailyMaxima(nearby(point), point, days));
    }
    w.station = stationDays.get(w.point);
    if (w.kind === null) {
      // The first day AirNow answered for decides, once (E8).
      const first = w.station.find((s) => s.date === w.airDates[0]);
      w.kind = chooseAirKind(null, first.stationFound);
    }
  }

  // 7. Points, oldest unsettled day first.
  const byPoint = new Map();
  for (const w of pending) {
    if (!byPoint.has(w.point)) byPoint.set(w.point, { key: w.point, lat: w.ctx.lat, lng: w.ctx.lng, members: [] });
    byPoint.get(w.point).members.push(w);
  }
  const points = [...byPoint.values()].map((p) => {
    p.needUv = p.members.some((w) => w.uvDates.length);
    p.needAirQuality = p.members.some((w) => w.airDates.length && w.kind === 'modeled');
    p.oldest = p.members.flatMap((w) => [...w.airDates, ...w.uvDates]).sort()[0];
    return p;
  });
  points.sort((a, b) => (a.oldest < b.oldest ? -1 : a.oldest > b.oldest ? 1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  counts.points = points.length;

  const pastDays = Math.max(1, utcDaysBetween(firstSlot, now));
  const openMeteo = async (base, field, p) => {
    counts.openMeteoCalls += 1;
    const url = `${base}?latitude=${p.lat}&longitude=${p.lng}&hourly=${field}&past_days=${pastDays}&forecast_days=1&timeformat=unixtime`;
    const answer = await getJson(url, { fetchImpl, timeoutMs: PROVIDER_TIMEOUT_MS });
    const at = new Date(clock()).toISOString();
    if (!answer.ok || !openMeteoCoversWindow(answer.json, field, slots)) return { ok: false, at, reason: answer.ok ? 'no_hours' : answer.reason };
    try {
      return { ok: true, at, byDate: new Map(openMeteoDailyMaxima(answer.json, field, days).map((r) => [r.date, r])) };
    } catch {
      return { ok: false, at, reason: 'malformed' };
    }
  };

  const rows = [];
  const settleRow = (w, date, factor, { providerOk, coverage, kind, at }) => {
    const settled = keepSource(
      settleDay({ attempt: attemptOf(date), coverage, providerOk, kind }),
      storedSource.get(`${w.ctx.id}|${date}|${factor}`),
    );
    // hours_expected from the day itself when the provider gave nothing (Task 2 review N2).
    const hoursExpected = coverage?.hoursExpected ?? localDaySlots(date).length;
    rows.push(storedRow(w.ctx, date, factor, settled, hoursExpected, at));
  };

  const failures = new Map();
  const recordPoint = async (p) => {
    const calls = p.needUv || p.needAirQuality;
    if (calls) {
      if (counts.pointsCalled >= maxPoints) { stopped ??= 'budget'; counts.deferred += p.members.length; return; }
      if (clock() >= deadlineAt) { stopped ??= 'deadline'; counts.deferred += p.members.length; return; }
      counts.pointsCalled += 1;
    }
    const [uv, cams] = await Promise.all([
      p.needUv ? openMeteo(FORECAST_URL, 'uv_index', p) : null,
      p.needAirQuality ? openMeteo(AIR_QUALITY_URL, 'us_aqi', p) : null,
    ]);
    if (uv && !uv.ok) { counts.forecastFailed += 1; failures.set(`forecast:${uv.reason}`, (failures.get(`forecast:${uv.reason}`) ?? 0) + 1); }
    if (cams && !cams.ok) { counts.airQualityFailed += 1; failures.set(`air_quality:${cams.reason}`, (failures.get(`air_quality:${cams.reason}`) ?? 0) + 1); }
    for (const w of p.members) {
      for (const date of w.uvDates) {
        settleRow(w, date, 'uv', { providerOk: !!uv?.ok, coverage: uv?.byDate?.get(date) ?? null, kind: 'open_meteo_forecast', at: uv?.at ?? runAt });
      }
      for (const date of w.airDates) {
        if (w.kind === null) {
          settleRow(w, date, 'air', { providerOk: false, coverage: null, kind: null, at: airNowAt });
          continue;
        }
        const measured = w.kind === 'measured';
        const station = w.station?.find((s) => s.date === date) ?? null;
        const coverage = airCoverageFor(w.kind, { station, modeled: cams?.byDate?.get(date) ?? null });
        settleRow(w, date, 'air', {
          providerOk: measured ? airNow !== null : !!cams?.ok,
          coverage,
          kind: airSourceCode(w.kind),
          at: measured ? airNowAt : cams?.at ?? runAt,
        });
      }
    }
  };
  await mapLimit(points, POINT_CONCURRENCY, recordPoint);
  for (const [reason, n] of failures) console.error('Daily maxima: Open-Meteo did not answer for some points:', `${reason}=${n}`);

  // 9. Pending rows that left the window: final, with no answer on a last look.
  const stale = await readStalePending(supabase, days[0]);
  for (const row of stale) {
    const settled = keepSource(
      settleDay({ attempt: SETTLE_ATTEMPTS + 1, coverage: null, providerOk: false, kind: row.source_code ?? null }),
      row.source_code ? { source_code: row.source_code, station_id: row.station_id ?? null } : undefined,
    );
    rows.push(storedRow({ id: row.home_context_id, profile_id: row.profile_id }, row.local_date, row.factor, settled, row.hours_expected, runAt));
    counts.finalized += 1;
  }

  // 10. Write, in batches.
  counts.rows = rows.length;
  for (let start = 0; start < rows.length; start += RECORD_BATCH_LIMIT) {
    counts.batches += 1;
    try {
      const out = await recordRows(supabase, rows.slice(start, start + RECORD_BATCH_LIMIT));
      for (const key of ['inserted', 'updated', 'kept', 'skipped', 'refused']) counts[key] += out[key];
      for (const [rule, n] of Object.entries(out.refusedRules)) refusedRules[rule] = (refusedRules[rule] ?? 0) + n;
    } catch (error) {
      counts.failedBatches += 1;
      console.error('Daily maxima: a batch was not recorded:', error?.refusal ?? error?.code ?? 'unexpected');
    }
  }
  if (counts.refused) {
    console.warn('Daily maxima: rows refused by rule:', Object.entries(refusedRules).map(([rule, n]) => `${rule}=${n}`).join(', '));
  }

  // 11. The run's counts.
  try {
    await finishRun(supabase, { ...counts });
  } catch (error) {
    counts.finishFailed = 1;
    console.error('Daily maxima: the run\'s counts were not stored:', error?.code ?? 'unexpected');
  }
  return { counts, stopped, refusedRules };
}
