/**
 * The daily maximum, and the evidence answer built from recorded maxima
 * (B08 Task 2; docs/backend/plans/b08-evidence.md, rulings E1 to E24).
 *
 * Pure: no database, no network, no clock and no environment. Every function
 * that needs "now" or "today" is handed it. The recorder (Task 3) fetches the
 * hourly series and stores what these functions decide; GET /api/evidence
 * (Task 4) reads the stored rows and answers with `buildHistorySnapshot`.
 *
 * The method, `daily-max-v1`:
 *
 * - The day (E2) is the America/New_York calendar date, local midnight to
 *   local midnight: the UTC hours whose local date is that date. 24 normally,
 *   23 on the spring-forward date, 25 on the fall-back date.
 * - The daily maximum (E3) is the largest hourly value of ONE source series
 *   over those hours, and only when the series covers at least
 *   ceil(0.75 * hours) of them (18 of 24, 18 of 23, 19 of 25). Fewer, and the
 *   day is a source gap. A single hourly value is never a maximum (E6).
 * - Air comes from the nearest AirNow station within 25 miles (40.234 km)
 *   that reported that day, or, for a home with no such station on its first
 *   recorded Air day, from Open-Meteo's modeled us_aqi. The kind is fixed per
 *   home and never mixes (E8): a measured home's station gap is a gap, never a
 *   modeled value, and a modeled home never becomes measured.
 * - UV comes from Open-Meteo's modeled hourly uv_index.
 * - Pollen and Outdoor mold are never recorded (E7) and always answer
 *   unavailable with their reason.
 * - No day before the recorder's first run, or before a home's first full
 *   day, has a maximum (E9). Nothing is backfilled and a missing value is
 *   never 0.
 * - `issued` is 'Unknown' (E16): neither provider publishes an issue time for
 *   these values, and retrieval time is never passed off as one.
 *
 * Every server-authored string is in a frozen table below, and none contains
 * U+2014 (E24, AGENTS.md).
 */
import { HOUSEHOLD_TZ, addDays } from './localDate.js';

export const METHOD_VERSION = 'daily-max-v1';
export const HISTORY_BASIS = 'daily maximum';
export const TIME_ZONE = HOUSEHOLD_TZ;
export const ISSUED_UNKNOWN = 'Unknown';
/** The frontend's factor order (W: components/production/WeekSources.tsx:8). */
export const HISTORY_FACTORS = Object.freeze(['Air', 'UV', 'Pollen', 'Outdoor mold']);
/** 25 miles, the radius of today's AirNow reading (W: lib/dailyReadings.js:147). */
export const STATION_RADIUS_KM = 40.234;
/** The share of a day's hours a series must cover (E3, Open question 3). */
export const COVERAGE_SHARE = 0.75;
/** How many runs look at a day before it is final (E4). */
export const SETTLE_ATTEMPTS = 3;
/** The read window, in days, today included (E14). */
export const WINDOW_DAYS = 84;
/** The longest request span, a whole season (E15). */
export const MAX_SPAN_DAYS = 92;

/** Stored source codes (0025 `source_code`) to their source line (E17). */
export const SOURCE_LABELS = Object.freeze({
  airnow_station: 'AirNow monitoring station, measured, preliminary',
  open_meteo_cams: 'Open-Meteo with the CAMS air quality model, modeled, not measured',
  open_meteo_forecast: 'Open-Meteo forecast model, modeled, not measured',
});
/** The source line of a row that has no stored source. */
export const NOT_RECORDED_SOURCE = 'Not recorded';

/** Missing reasons, one frozen table (E13). The first four are the frontend's own phrases. */
export const MISSING = Object.freeze({
  currentDay: 'Current day is not complete',
  sourceGap: 'Source gap',
  noReading: 'No reading for this day',
  mold: 'No compatible historical mold series',
  pollen: 'Pollen has a daily forecast index, not a daily maximum.',
  notRecordedYet: 'Not recorded yet',
  outsideWindow: 'Outside the twelve-week history window',
  /** Before the recorder's first day or the home's first full day (E9). */
  recordedFrom: (date) => `Recorded from ${date}. Earlier days have no daily maximum.`,
});

/** Stored factor code to the frontend's factor, and back. */
const STORED_FACTOR = Object.freeze({ air: 'Air', uv: 'UV' });
const UNITS = Object.freeze({ Air: 'AQI', UV: 'UV index', Pollen: 'category', 'Outdoor mold': 'category' });
/** The factors that are never recorded, with their reason (E7). */
const NEVER_RECORDED = Object.freeze({ Pollen: MISSING.pollen, 'Outdoor mold': MISSING.mold });
/** Which stored source codes may carry a value for which factor. */
const FACTOR_SOURCES = Object.freeze({
  air: Object.freeze(['airnow_station', 'open_meteo_cams']),
  uv: Object.freeze(['open_meteo_forecast']),
});
const AIR_KIND_SOURCE = Object.freeze({ measured: 'airnow_station', modeled: 'open_meteo_cams' });
const OPEN_METEO_FIELDS = Object.freeze({
  us_aqi: (v) => Math.round(v),
  uv_index: (v) => Math.round(v * 10) / 10,
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_HOUR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const HOUR_MS = 3600000;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** True for a real 'YYYY-MM-DD' calendar date (round-trips through UTC). */
export function isCalendarDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function requireDate(value, name) {
  if (!isCalendarDate(value)) throw new TypeError(`${name} must be a YYYY-MM-DD calendar date`);
  return value;
}

const formatters = new Map();
function localDateOf(ms, tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    formatters.set(tz, f);
  }
  return f.format(new Date(ms));
}

/**
 * The UTC hour starts of the local day `date` (E2), oldest first, as ISO
 * instants ('2026-03-08T05:00:00.000Z'). 23, 24 or 25 of them in New York.
 */
export function localDaySlots(date, tz = TIME_ZONE) {
  requireDate(date, 'date');
  const [y, m, d] = date.split('-').map(Number);
  const midnightUtc = Date.UTC(y, m - 1, d);
  const slots = [];
  // Every zone's local midnight lies within 14 hours of UTC midnight.
  for (let t = midnightUtc - 15 * HOUR_MS; t < midnightUtc + 39 * HOUR_MS; t += HOUR_MS) {
    if (localDateOf(t, tz) === date) slots.push(new Date(t).toISOString());
  }
  return Object.freeze(slots);
}

/** ceil(0.75 * hours): 18 of 24, 18 of 23, 19 of 25 (E3). Takes the slots or their count. */
export function coverageNeeded(slots) {
  const hours = Array.isArray(slots) ? slots.length : slots;
  if (!Number.isInteger(hours) || hours < 1) throw new TypeError('coverageNeeded needs the day\'s slots or a positive hour count');
  return Math.ceil(COVERAGE_SHARE * hours);
}

/** Great-circle distance in kilometres. */
export function haversineKm(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function requirePoint(point) {
  if (!point || !finite(point.lat) || !finite(point.lng)) throw new TypeError('point must be {lat, lng} numbers');
  return point;
}

function requireDates(dates) {
  if (!Array.isArray(dates)) throw new TypeError('dates must be an array of YYYY-MM-DD dates');
  dates.forEach((d) => requireDate(d, 'dates[]'));
  return dates;
}

/** Map of slot instant to local date, for the requested dates. */
function slotIndex(dates) {
  const byInstant = new Map();
  const expected = new Map();
  for (const date of dates) {
    const slots = localDaySlots(date);
    expected.set(date, slots.length);
    for (const s of slots) byInstant.set(s, date);
  }
  return { byInstant, expected };
}

/** One AirNow `aq/data` row to {station, lat, lng, instant, pollutant, aqi}, or null when unusable. */
function airNowRow(r) {
  // `||`, as the map parser does (W: lib/mapLayers.js:91): an empty FullAQSCode falls back.
  const station = r?.FullAQSCode || r?.IntlAQSCode;
  if ((typeof station !== 'string' || !station.trim()) && !finite(station)) return null;
  if (!finite(r.Latitude) || !finite(r.Longitude)) return null;
  if (typeof r.UTC !== 'string' || !LOCAL_HOUR_RE.test(r.UTC) || r.UTC.slice(14) !== '00') return null;
  const at = Date.parse(`${r.UTC}:00Z`);
  if (!Number.isFinite(at)) return null;
  if (typeof r.Parameter !== 'string' || !r.Parameter.trim()) return null;
  // Sentinels (-999) and negatives are not readings (W: lib/mapLayers.js:89).
  if (!finite(r.AQI) || r.AQI < 0) return null;
  return {
    station: String(station).trim(),
    lat: r.Latitude,
    lng: r.Longitude,
    instant: new Date(at).toISOString(),
    pollutant: r.Parameter.trim().toUpperCase().replace(/\s+/g, ''),
    aqi: r.AQI,
  };
}

/**
 * Air from AirNow's hourly `aq/data` rows (E3, E8), one result per date, in
 * `dates` order:
 * `{date, stationFound, stationId, value, hoursExpected, hoursObserved}`.
 *
 * The station is the nearest one within 40.234 km of `point` that reported a
 * usable value that day. Its hourly AQI is the largest over the pollutants it
 * reported that hour; every pollutant it reported that day must cover the
 * day (E3), and `hoursObserved` is the least-covered pollutant's count.
 * `value` is the day's largest hourly AQI, or null when coverage falls short.
 */
export function airNowDailyMaxima(rows, point, dates) {
  requirePoint(point);
  requireDates(dates);
  const { byInstant, expected } = slotIndex(dates);
  // station id -> {id, lat, lng, days: date -> pollutant -> instant -> aqi}
  const stations = new Map();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const r = airNowRow(raw);
    if (!r) continue;
    const date = byInstant.get(r.instant);
    if (!date) continue;
    let s = stations.get(r.station);
    if (!s) {
      s = { id: r.station, lat: r.lat, lng: r.lng, days: new Map() };
      stations.set(r.station, s);
    }
    let day = s.days.get(date);
    if (!day) s.days.set(date, (day = new Map()));
    let hours = day.get(r.pollutant);
    if (!hours) day.set(r.pollutant, (hours = new Map()));
    hours.set(r.instant, Math.max(hours.get(r.instant) ?? -Infinity, r.aqi));
  }
  const nearby = [...stations.values()]
    .map((s) => ({ ...s, km: haversineKm(point, s) }))
    .filter((s) => s.km <= STATION_RADIUS_KM)
    .sort((a, b) => a.km - b.km || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return dates.map((date) => {
    const hoursExpected = expected.get(date);
    const station = nearby.find((s) => s.days.has(date));
    if (!station) return { date, stationFound: false, stationId: null, value: null, hoursExpected, hoursObserved: 0 };
    const pollutants = [...station.days.get(date).values()];
    const hoursObserved = Math.min(...pollutants.map((h) => h.size));
    const peak = Math.max(...pollutants.flatMap((h) => [...h.values()]));
    const value = hoursObserved >= coverageNeeded(hoursExpected) ? Math.round(peak) : null;
    return { date, stationFound: true, stationId: station.id, value, hoursExpected, hoursObserved };
  });
}

/**
 * A modeled series from an Open-Meteo hourly answer (E2, E3), one result per
 * date, in `dates` order: `{date, value, hoursExpected, hoursObserved}`.
 *
 * The answer must be requested with
 * `hourly=<field>&past_days=3&forecast_days=1&timeformat=unixtime` and no
 * `timezone`. Open-Meteo applies one UTC offset, fixed at request time, to
 * every local timestamp and daily boundary in a response and ignores DST
 * changes inside it, so local stamps matched by date would take an hour from
 * the neighbouring day near each change. Unix seconds are absolute: each one
 * is bucketed into the real New York day it falls in, through the same slot
 * index AirNow uses. `utc_offset_seconds` and `timezone` are ignored.
 *
 * `hoursObserved` is the number of the day's hours with a finite,
 * non-negative value. `field` is 'us_aqi' (an integer AQI) or 'uv_index'
 * (rounded to 0.1). Throws on a malformed answer (including ISO string
 * times, from a request that forgot `timeformat=unixtime`, and a repeated
 * instant), which the recorder treats as a provider failure.
 */
export function openMeteoDailyMaxima(json, field, dates) {
  const round = OPEN_METEO_FIELDS[field];
  if (!round) throw new TypeError(`unknown Open-Meteo field ${field}`);
  requireDates(dates);
  const times = json?.hourly?.time;
  const values = json?.hourly?.[field];
  if (!Array.isArray(times) || !Array.isArray(values) || times.length !== values.length) {
    throw new TypeError('malformed Open-Meteo hourly answer');
  }
  const { byInstant, expected } = slotIndex(dates);
  const seen = new Set();
  const byDate = new Map(dates.map((date) => [date, []]));
  times.forEach((t, i) => {
    if (!Number.isSafeInteger(t) || t % 3600 !== 0) throw new TypeError('Open-Meteo hourly times must be whole hours in Unix seconds');
    if (seen.has(t)) throw new TypeError('Open-Meteo hourly answer repeats an hour');
    seen.add(t);
    const date = byInstant.get(new Date(t * 1000).toISOString());
    if (date && finite(values[i]) && values[i] >= 0) byDate.get(date).push(values[i]);
  });
  return dates.map((date) => {
    const hoursExpected = expected.get(date);
    const usable = byDate.get(date);
    const hoursObserved = usable.length;
    const value = hoursObserved >= coverageNeeded(hoursExpected) ? round(Math.max(...usable)) : null;
    return { date, value, hoursExpected, hoursObserved };
  });
}

/**
 * The home's Air kind (E8): 'measured', 'modeled', or null while undecided.
 *
 * `latestAirRow` is the context's latest stored Air row that carries a source
 * code (null when it has none yet). Once a kind is stored it is the answer,
 * whatever `stationFound` says. Without one, the first recorded Air day
 * decides: measured when a station within 25 miles reported that day
 * (`stationFound === true`), modeled when AirNow answered and none did
 * (`false`), and undecided when AirNow did not answer (anything else).
 */
export function chooseAirKind(latestAirRow, stationFound) {
  if (latestAirRow) {
    if (latestAirRow.source_code === 'airnow_station') return 'measured';
    if (latestAirRow.source_code === 'open_meteo_cams') return 'modeled';
    throw new TypeError('chooseAirKind needs the latest Air row that carries an Air source code');
  }
  if (stationFound === true) return 'measured';
  if (stationFound === false) return 'modeled';
  return null;
}

/** The one series a home of `kind` takes its Air from, never the other (E8). */
export function airCoverageFor(kind, { station, modeled }) {
  if (kind === 'measured') return station ?? null;
  if (kind === 'modeled') return modeled ?? null;
  if (kind === null) return null;
  throw new TypeError(`unknown Air kind ${kind}`);
}

/** The stored source code for an Air kind. */
export function airSourceCode(kind) {
  const code = AIR_KIND_SOURCE[kind];
  if (!code) throw new TypeError(`unknown Air kind ${kind}`);
  return code;
}

/**
 * Settle one day of one series on one run (E4). Returns the stored fields
 * `{value, missing_code, source_code, station_id, hours_observed}`.
 *
 * - `attempt` is how many runs have looked at the day, this one included.
 * - `coverage` is the series' result for the day (from `airNowDailyMaxima`
 *   or `openMeteoDailyMaxima`), required when `providerOk`.
 * - `providerOk` is false when the provider did not answer this run.
 * - `kind` is the series' source code ('airnow_station', 'open_meteo_cams',
 *   'open_meteo_forecast'), or null for an Air day whose kind is undecided.
 *
 * The first run records a value only when every hour is present; the second
 * and third take the E3 coverage; the third leaves a short day `source_gap`
 * and a day the provider did not answer `unavailable`. Before that it is
 * `pending`.
 */
export function settleDay({ attempt, coverage, providerOk, kind }) {
  if (!Number.isInteger(attempt) || attempt < 1) throw new TypeError('attempt must be a positive integer');
  if (kind !== null && !Object.hasOwn(SOURCE_LABELS, kind)) throw new TypeError(`unknown source ${kind}`);
  const answered = providerOk === true && kind !== null;
  if (answered && (!coverage || !Number.isInteger(coverage.hoursExpected) || !Number.isInteger(coverage.hoursObserved))) {
    throw new TypeError('settleDay needs the day\'s coverage when the provider answered');
  }
  const stationId = kind === 'airnow_station' && answered && coverage.stationId ? String(coverage.stationId) : null;
  const sourceCode = kind === 'airnow_station' ? (stationId ? kind : null) : kind;
  const hoursObserved = answered ? coverage.hoursObserved : 0;
  const base = { source_code: sourceCode, station_id: stationId, hours_observed: hoursObserved };

  if (answered && finite(coverage.value) && coverage.value >= 0) {
    const needed = attempt === 1 ? coverage.hoursExpected : coverageNeeded(coverage.hoursExpected);
    if (hoursObserved >= needed) return { ...base, value: coverage.value, missing_code: null };
  }
  if (attempt < SETTLE_ATTEMPTS) return { ...base, value: null, missing_code: 'pending' };
  return { ...base, value: null, missing_code: answered ? 'source_gap' : 'unavailable' };
}

/**
 * A home context's first full day (E9): the local date after `effectiveFrom`,
 * so a move day belongs to neither home.
 */
export function firstFullDay(effectiveFrom) {
  // A bare date or a zoneless time would be read in UTC or the host's zone, a day off in the evening.
  const zoned = typeof effectiveFrom === 'string' && /T.*(Z|[+-]\d{2}(:?\d{2})?)$/.test(effectiveFrom);
  const at = effectiveFrom instanceof Date ? effectiveFrom.getTime() : zoned ? Date.parse(effectiveFrom) : NaN;
  if (!Number.isFinite(at)) throw new TypeError('effectiveFrom must be an instant');
  return addDays(localDateOf(at, TIME_ZONE), 1);
}

/**
 * The `count` most recent completed local days before the local date of
 * `now`, oldest first (E4, E5). `now` is injected; nothing here reads the clock.
 */
export function completedDays(now, count = SETTLE_ATTEMPTS) {
  const at = now instanceof Date ? now.getTime() : NaN;
  if (!Number.isFinite(at)) throw new TypeError('now must be a Date');
  if (!Number.isInteger(count) || count < 1) throw new TypeError('count must be a positive integer');
  const today = localDateOf(at, TIME_ZONE);
  return Array.from({ length: count }, (_, i) => addDays(today, i - count));
}

function spanDays(from, to) {
  const [a, b] = [from, to].map((d) => {
    const [y, m, day] = d.split('-').map(Number);
    return Date.UTC(y, m - 1, day);
  });
  return Math.round((b - a) / 86400000) + 1;
}

/** Index the stored rows by date and frontend factor, refusing rows that break the method. */
function indexStored(rows, context, from, to) {
  const stored = new Map();
  const airSources = new Set();
  // A missing list is a caller's bug, not a household with no maxima.
  if (!Array.isArray(rows)) throw new TypeError('rows must be the stored daily_maxima rows');
  for (const row of rows) {
    const factor = STORED_FACTOR[row?.factor];
    if (!factor) throw new TypeError(`stored row has an unknown factor ${row?.factor}`);
    requireDate(row.local_date, 'local_date');
    // Required, so a read that drops the column cannot drop the owner check with it.
    if (row.home_context_id !== context) throw new Error('stored row belongs to another home context');
    const key = `${row.local_date}|${factor}`;
    if (row.value !== null && !(finite(row.value) && row.value >= 0)) throw new TypeError(`stored value for ${key} is not a reading`);
    if (row.source_code != null && !FACTOR_SOURCES[row.factor].includes(row.source_code)) {
      throw new TypeError(`stored source for ${key} does not match its factor`);
    }
    if (row.value !== null && row.source_code == null) throw new TypeError(`stored value for ${key} has no source`);
    // Every Air row that names a source counts, valued or not, so the Dataset line names one kind.
    if (row.factor === 'air' && row.source_code != null) airSources.add(row.source_code);
    if (row.local_date < from || row.local_date > to) continue;
    if (stored.has(key)) throw new Error(`two stored rows for ${key}`);
    stored.set(key, row);
  }
  // Measured and modeled Air are never one series (E8, Vibhav's decision).
  if (airSources.size > 1) throw new Error('measured and modeled Air are mixed in one home context');
  return stored;
}

/**
 * The exact `evidence.read` body for `{kind: 'history', from, to}` (E12 to E18).
 *
 * - `today` is the server's local date ('YYYY-MM-DD'), injected.
 * - `context` is the current home context id, or null for a household
 *   without one (E12: no rows, `context: null`).
 * - `rows` are that context's stored `daily_maxima` rows.
 * - `recordingFrom` is the recorder's first day, or null before it has run.
 * - `firstFullDay` is the context's first full day (see `firstFullDay`).
 *
 * One row per date and factor, every date of the range, oldest first, in
 * the frontend's factor order. A missing value is `null` with a reason,
 * never 0.
 */
export function buildHistorySnapshot({ from, to, today, context, rows, recordingFrom = null, firstFullDay: firstDay = null }) {
  requireDate(from, 'from');
  requireDate(to, 'to');
  requireDate(today, 'today');
  if (from > to) throw new RangeError('from must not be after to');
  if (spanDays(from, to) > MAX_SPAN_DAYS) throw new RangeError(`the range is at most ${MAX_SPAN_DAYS} days`);
  const comparison = { context: null, basis: HISTORY_BASIS, version: METHOD_VERSION };
  if (context === null || context === undefined) return { rows: [], comparison, complete: true };
  if (typeof context !== 'string' || !context) throw new TypeError('context must be a context id or null');
  if (recordingFrom !== null) requireDate(recordingFrom, 'recordingFrom');
  if (firstDay !== null) requireDate(firstDay, 'firstFullDay');

  const stored = indexStored(rows, context, from, to);
  const windowStart = addDays(today, 1 - WINDOW_DAYS);
  const settleStart = addDays(today, -SETTLE_ATTEMPTS);
  // Without a first run nothing has been recorded, so no start is claimed.
  const start = recordingFrom === null ? null : firstDay !== null && firstDay > recordingFrom ? firstDay : recordingFrom;

  const out = [];
  // Counted, not compared: stepping past 9999-12-31 leaves the four-digit form the comparison needs.
  const span = spanDays(from, to);
  for (let step = 0; step < span; step += 1) {
    const date = addDays(from, step);
    for (const factor of HISTORY_FACTORS) {
      const row = stored.get(`${date}|${factor}`);
      const reading = {
        date,
        factor,
        value: null,
        unit: UNITS[factor],
        source: row?.source_code ? SOURCE_LABELS[row.source_code] : NOT_RECORDED_SOURCE,
        issued: ISSUED_UNKNOWN,
        basis: HISTORY_BASIS,
        context,
        version: row?.method_version ?? METHOD_VERSION,
      };
      let missing;
      if (NEVER_RECORDED[factor]) missing = NEVER_RECORDED[factor];
      else if (date === today) missing = MISSING.currentDay;
      else if (date > today) missing = MISSING.notRecordedYet;
      else if (date < windowStart) missing = MISSING.outsideWindow;
      else if (start !== null && date < start) missing = MISSING.recordedFrom(start);
      else if (row && row.value !== null) reading.value = row.value;
      else if (row?.missing_code === 'source_gap') missing = MISSING.sourceGap;
      else if (row?.missing_code === 'pending' || !row) missing = date >= settleStart ? MISSING.notRecordedYet : MISSING.noReading;
      else missing = MISSING.noReading;
      if (missing !== undefined) reading.missing = missing;
      out.push(reading);
    }
  }
  return { rows: out, comparison: { ...comparison, context }, complete: true };
}
