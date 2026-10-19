/**
 * The `forecast.read` snapshot builder (B10 Task 7; plan rulings F12 to F21).
 * Pure: no I/O, no clock of its own (`now` is passed in), no environment. The
 * route (Task 8) resolves the place, reads the caches and adapters, and hands
 * their results here as plain values.
 *
 * INPUTS
 *   place     a resolution from lib/forecast/place.js (Task 2):
 *               {kind: 'home'}                                  the saved home
 *               {kind: 'matched', id, label, timezone}          a gazetteer place
 *               {kind: 'no_home'}                               empty place, no saved home (F1)
 *               {kind: 'unmatched', reason?} | {kind: 'ambiguous', labels} | {kind: 'outside'}
 *   date      the requested 'YYYY-MM-DD' (the route has validated it, F21)
 *   now       epoch milliseconds
 *   openMeteo the Open-Meteo adapter's answer (lib/forecast/openMeteo.js):
 *               {ok: true, timezone, model, runInitialisedAt, runAvailableAt, fetchedAt,
 *                hours: [{t, temperatureF, apparentF, precipPct, precipIn, weatherCode, windMph, uv}]}
 *               {ok: false, reason, retryAfterMs?}
 *   airNow    the AirNow forecast adapter's answer (Task 5, not built yet), or
 *             undefined when it is not wired:
 *               {ok: true, fetchedAt, rows: [{dateIssue, dateForecast, reportingArea, stateCode,
 *                parameter, aqi, category, actionDay}]} | {ok: false, reason}  (reason 'no_key', 'budget', ...)
 *   alerts    the NWS adapter's answer (lib/forecast/nwsAlerts.js):
 *               {ok: true, fetchedAt, alerts: [{id, event, ends}]} | {ok: false, reason}
 *   stale     true when `openMeteo` is the last confirmed forecast, served while
 *             a newer run is unknown (see F18 below); default false
 *
 * OUTPUT
 *   {status: 200, body}                     body is the ForecastSnapshot the client validates
 *   {status: 503, retryAfter, reason}       retryAfter in whole seconds (>= 1), reason for logs
 *
 * RULINGS APPLIED
 *   F12 horizon: date-only, inclusive, local to `zone`. horizonStart is today in
 *       `zone`; horizonEnd is the last date from today to today + 6 on which all
 *       three windows have complete hourly temperature and a documented weather
 *       code. It depends on the data, never on the requested date. Empty
 *       snapshots carry today to today + 6 in America/New_York.
 *   F13 periods: Morning 08:00 to 12:00, Afternoon 12:00 to 17:00, Evening 17:00
 *       to 21:00 local, emitted as UTC instants ending in Z. Instantaneous values
 *       use hours start <= t < end; the model's rain (a preceding-hour sum) uses
 *       start < t <= end. A period is omitted when it has ended or any hour lacks
 *       temperature or a documented weather code. `uv` is null when any hour
 *       lacks UV. `air` and `pollen` are always null (F6, C1; pollen dropped).
 *   F14 `weather` and `tradeoff` from lib/forecast/copy.js. Rain is the model's
 *       amount, never a chance: `precipPct` is ignored (Vibhav, 2026-10-19).
 *   F15 `coverage`: exactly Air, UV, Pollen, Weather, every value a string
 *       beginning with the place.
 *   F16 `source`: the providers that contributed, and the place.
 *   F17 `issuedAt`: the model run's initialisation time; for an empty answer,
 *       the time HALO answered (never displayed: the screen prints Issued only
 *       with periods).
 *   F18 `expiresAt`: the earliest `fetchedAt` of the Open-Meteo and AirNow data
 *       used, plus 90 minutes; empty answers expire 24 hours out. A populated
 *       answer that would already be expired is a 503, never served: the screen
 *       could neither save it nor refresh it into anything newer.
 *       STALE-SERVE (`stale: true`, ruling on the Task 7 report, item 7): Task 8
 *       passes it when it serves the last confirmed forecast during Open-Meteo
 *       `run_unknown`. Then `expiresAt` is now + 30 minutes, the Weather coverage
 *       says a newer run is not yet confirmed, and data fetched more than 8 hours
 *       before now is a 503 `stale` (retryAfter 60). `version` ignores `stale`.
 *   F19 `version`: 'fc1-' and 16 hex of sha256 over the content (place, zone,
 *       horizon, date, run, the hourly values used, the AirNow rows used, the
 *       alert ids, FORECAST_RULES_VERSION), never fetch or answer times.
 *   F20 no `changedMessage`. F21 503 whenever Open-Meteo did not answer (or its
 *       zone or data is unusable); AirNow or NWS failing alone never fails.
 */

import { createHash } from 'node:crypto';
import { AIRNOW_CATEGORIES, COPY, UNMATCHED_ZIP_REASON, WARNINGS_UNAVAILABLE, pollutantName, presentable, wmoCode } from './copy.js';

/** Bump when a rule that shapes a snapshot's content changes, so old versions never match new content. */
export const FORECAST_RULES_VERSION = 'b10-snapshot-1';

/** F13: local windows, contiguous, none containing a 02:00 transition hour. */
export const FORECAST_WINDOWS = Object.freeze([
  Object.freeze({ name: 'Morning', start: '08:00', end: '12:00' }),
  Object.freeze({ name: 'Afternoon', start: '12:00', end: '17:00' }),
  Object.freeze({ name: 'Evening', start: '17:00', end: '21:00' }),
]);

/** F12: at most seven dates, today and the six after it. */
export const HORIZON_DAYS = 6;
/** F12: the gazetteer's zone, used for empty snapshots. */
export const EMPTY_ZONE = 'America/New_York';
/** F18. */
export const POPULATED_TTL_MS = 90 * 60 * 1000;
export const EMPTY_TTL_MS = 24 * 60 * 60 * 1000;
/** Stale-serve: F18's 30-minute floor from now, for the last confirmed run while a newer one is unknown. */
export const STALE_TTL_MS = 30 * 60 * 1000;
/** Stale-serve: the last confirmed run is served for at most one 6-hour cycle plus slack after its fetch. */
export const STALE_MAX_AGE_MS = 8 * 60 * 60 * 1000;
/** F9's negative-cache window, the retry hint when an adapter gives none. */
export const DEFAULT_RETRY_SECONDS = 60;
/** GFS is hourly to this forecast hour, then 3-hourly and interpolated (openMeteo.js GFS_HOURLY_UNTIL_HOURS). */
export const GFS_HOURLY_UNTIL_HOURS = 120;

const HOUR_MS = 3_600_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const EMPTY_KINDS = new Set(['no_home', 'unmatched', 'ambiguous', 'outside']);

// --------------------------------------------------------------- dates and zones

function isCalendarDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function addDays(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const acceptedZones = new Set();
/** True when `Intl` accepts the zone, exactly as the client checks it (WeekSources.tsx:16). */
export function validZone(zone) {
  if (typeof zone !== 'string' || zone === '') return false;
  if (acceptedZones.has(zone)) return true;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
  } catch {
    return false;
  }
  if (acceptedZones.size < 64) acceptedZones.add(zone);
  return true;
}

const wallFormatters = new Map();
function wallParts(ms, zone) {
  let f = wallFormatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    wallFormatters.set(zone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), H: Number(parts.hour), M: Number(parts.minute), S: Number(parts.second) };
}

/** The zone's offset from UTC at an instant, in milliseconds (wall clock minus UTC). */
function offsetAt(ms, zone) {
  const p = wallParts(ms, zone);
  return Date.UTC(p.y, p.m - 1, p.d, p.H, p.M, p.S) - Math.floor(ms / 1000) * 1000;
}

/** 'YYYY-MM-DD' of an instant in a zone. */
export function localDateIn(ms, zone) {
  const p = wallParts(ms, zone);
  return `${String(p.y).padStart(4, '0')}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

function zonedMs(date, hhmm, zone) {
  if (!isCalendarDate(date)) throw new TypeError('zonedInstant: date must be a YYYY-MM-DD calendar date');
  const time = TIME_RE.exec(typeof hhmm === 'string' ? hhmm : '');
  if (!time) throw new TypeError('zonedInstant: time must be HH:MM');
  if (!validZone(zone)) throw new RangeError('zonedInstant: unknown time zone');
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, Number(time[1]), Number(time[2]));
  let t = wall - offsetAt(wall, zone);
  const second = wall - offsetAt(t, zone);
  if (second !== t) t = second;
  const back = wallParts(t, zone);
  if (Date.UTC(back.y, back.m - 1, back.d, back.H, back.M) !== wall) {
    throw new RangeError('zonedInstant: that local time does not exist in this zone');
  }
  return t;
}

const isoSeconds = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * The UTC instant of a local wall time, as 'YYYY-MM-DDTHH:MM:SSZ'. Throws for a
 * local time the zone skips (a spring-forward gap); none of the F13 bounds is
 * one.
 */
export function zonedInstant(date, hhmm, zone) {
  return isoSeconds(zonedMs(date, hhmm, zone));
}

/** '14:20 EDT' for an instant in a zone. */
function clockLabel(ms, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return `${parts.hour}:${parts.minute} ${parts.timeZoneName}`;
}

/** '2026-10-19 12:00 UTC' for an ISO instant. */
const utcLabel = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
/** '2026-10-19T12Z' for an ISO instant (whole hours; minutes kept when not). */
function runLabel(ms) {
  const iso = new Date(ms).toISOString();
  return iso.slice(14, 16) === '00' ? `${iso.slice(0, 13)}Z` : `${iso.slice(0, 16)}Z`;
}

// ------------------------------------------------------------------- helpers

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const instantMs = (v) => (typeof v === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) ? Date.parse(v) : NaN);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function contentVersion(content) {
  return `fc1-${createHash('sha256').update(canonical({ rules: FORECAST_RULES_VERSION, ...content })).digest('hex').slice(0, 16)}`;
}

function requireNow(now) {
  const ms = now instanceof Date ? now.getTime() : now;
  if (!finite(ms)) throw new TypeError('forecast snapshot: now must be epoch milliseconds');
  return ms;
}

function placeLabel(place) {
  if (place.kind === 'home' || place.kind === 'no_home') return { label: COPY.homeLabel, basis: null, id: 'home' };
  if (place.kind === 'matched') return { label: presentable(place.label), basis: COPY.pointBasis, id: String(place.id) };
  return { label: COPY.typedLabel, basis: null, id: place.kind };
}

function fourCoverage(prefix, values) {
  return { Air: `${prefix} ${values.Air}`, UV: `${prefix} ${values.UV}`, Pollen: `${prefix} ${values.Pollen}`, Weather: `${prefix} ${values.Weather}` };
}

const unavailable = (reason, retryAfterMs) => ({
  status: 503,
  retryAfter: finite(retryAfterMs) && retryAfterMs > 0 ? Math.max(1, Math.ceil(retryAfterMs / 1000)) : DEFAULT_RETRY_SECONDS,
  reason,
});

// ------------------------------------------------------------- empty answers

/**
 * A definitive "no forecast" (F21): 200, `periods: []`, full valid metadata, no
 * provider named. `reason` is one of no_home, unmatched, ambiguous, outside;
 * it defaults to `place.kind`.
 * @returns {{status: 200, body: object}}
 */
export function emptySnapshot({ place, date, now, reason = place?.kind }) {
  const at = requireNow(now);
  if (!EMPTY_KINDS.has(reason)) throw new TypeError('emptySnapshot: unknown reason');
  const p = place && typeof place === 'object' ? place : { kind: reason };
  const { label, basis } = placeLabel(reason === 'no_home' ? { kind: 'no_home' } : p);
  let why;
  if (reason === 'unmatched') {
    why = p.reason === UNMATCHED_ZIP_REASON ? COPY.emptyWhy.unmatchedZip : COPY.emptyWhy.unmatched;
  } else if (reason === 'ambiguous') {
    const labels = (Array.isArray(p.labels) ? p.labels : []).filter((l) => typeof l === 'string' && l.trim()).slice(0, 5).map(presentable);
    why = COPY.emptyWhy.ambiguous(labels.length ? labels : ['several places']);
  } else {
    why = COPY.emptyWhy[reason];
  }
  const line = `${COPY.emptyLead} ${why}`;
  const horizonStart = localDateIn(at, EMPTY_ZONE);
  const horizonEnd = addDays(horizonStart, HORIZON_DAYS);
  const body = {
    periods: [],
    issuedAt: new Date(at).toISOString(),
    expiresAt: new Date(at + EMPTY_TTL_MS).toISOString(),
    zone: EMPTY_ZONE,
    source: COPY.sourceEmpty(label),
    version: contentVersion({ empty: reason, label, why, date, horizonStart, horizonEnd }),
    horizonStart,
    horizonEnd,
    warningStatus: WARNINGS_UNAVAILABLE,
    coverage: fourCoverage(COPY.coveragePrefix(label, basis), { Air: line, UV: line, Pollen: line, Weather: line }),
  };
  return { status: 200, body };
}

// ------------------------------------------------------------------- periods

function windowBounds(date, window, zone) {
  return { start: zonedMs(date, window.start, zone), end: zonedMs(date, window.end, zone) };
}

/** The hours start <= t < end, or null when any is missing from the series. */
function hoursIn(series, start, end, { after = false } = {}) {
  const out = [];
  for (let t = after ? start + HOUR_MS : start; after ? t <= end : t < end; t += HOUR_MS) {
    const hour = series.get(t);
    if (!hour) return null;
    out.push(hour);
  }
  return out;
}

const usableHour = (h) => finite(h.temperatureF) && Number.isInteger(h.weatherCode) && wmoCode(h.weatherCode) !== null;

function windowComplete(series, date, window, zone) {
  const { start, end } = windowBounds(date, window, zone);
  const hours = hoursIn(series, start, end);
  return !!hours && hours.every(usableHour);
}

/** °C from the provider's own °F value (F14: arithmetic on the provider's values), rounded once. */
const toC = (f) => Math.round(((f - 32) * 5) / 9);
const allFinite = (values) => values.length > 0 && values.every(finite);

/** One period's figures, or null when it must be omitted (F13). */
function periodFigures(series, date, window, zone) {
  const { start, end } = windowBounds(date, window, zone);
  const hours = hoursIn(series, start, end);
  if (!hours || !hours.every(usableHour)) return null;
  const temps = hours.map((h) => h.temperatureF);
  const codes = hours.map((h) => h.weatherCode);
  const worst = codes.reduce((a, b) => (wmoCode(b).rank > wmoCode(a).rank ? b : a));
  const uvs = hours.map((h) => h.uv);
  const feels = hours.map((h) => h.apparentF);
  const winds = hours.map((h) => h.windMph);
  const rainHours = hoursIn(series, start, end, { after: true });
  const rains = rainHours ? rainHours.map((h) => h.precipIn) : [];
  return {
    window,
    start,
    end,
    lowF: Math.round(Math.min(...temps)),
    highF: Math.round(Math.max(...temps)),
    lowC: toC(Math.min(...temps)),
    highC: toC(Math.max(...temps)),
    code: worst,
    codeVaries: codes.some((c) => c !== codes[0]),
    uv: allFinite(uvs) ? Math.round(Math.max(...uvs) * 10) / 10 : null,
    feelsF: allFinite(feels) ? Math.round(Math.max(...feels)) : null,
    windMph: allFinite(winds) ? Math.round(Math.max(...winds)) : null,
    rainIn: rainHours && allFinite(rains) ? Math.round(rains.reduce((a, b) => a + b, 0) * 1000) / 1000 : null,
    used: [...hours, ...(rainHours ?? [])].map((h) => [h.t, h.temperatureF, h.apparentF, h.precipIn, h.weatherCode, h.windMph, h.uv]),
  };
}

function weatherText(f) {
  const rain = f.rainIn === null ? COPY.rainUnavailable
    : f.rainIn === 0 ? COPY.rainNone
      : f.rainIn < 0.005 ? COPY.rainTrace
        : COPY.rainAmount(f.rainIn.toFixed(2));
  return COPY.weather([
    COPY.temperature(f.lowF, f.highF, f.lowC, f.highC),
    COPY.sky(wmoCode(f.code).text, f.codeVaries),
    f.feelsF === null ? COPY.feelsLikeUnavailable : COPY.feelsLike(f.feelsF),
    rain,
    f.windMph === null ? COPY.windUnavailable : COPY.wind(f.windMph),
  ]);
}

/** Where this period stands among the periods present, for one measure (lower first). */
function standing(value, values, phrases) {
  const known = values.filter(finite);
  if (!finite(value) || known.length < 2) return '';
  const min = Math.min(...known);
  const max = Math.max(...known);
  if (min === max) return '';
  const count = (v) => known.filter((x) => x === v).length;
  if (value === min) return count(min) > 1 ? phrases.lowTie : phrases.low;
  if (value === max) return count(max) > 1 ? phrases.highTie : phrases.high;
  return '';
}

function tradeoffText(f, all, airSentence) {
  let comparison;
  if (all.length < 2) {
    comparison = COPY.onlyPeriod;
  } else {
    comparison = [
      standing(f.uv, all.map((x) => x.uv), COPY.compare.uv),
      standing(f.feelsF, all.map((x) => x.feelsF), COPY.compare.feels),
      standing(f.rainIn, all.map((x) => x.rainIn), COPY.compare.rain),
    ].filter(Boolean).join(' ') || COPY.noDifference;
  }
  return `${comparison} ${airSentence}`;
}

// ----------------------------------------------------------------------- air

const AIR_FAILURE_COPY = (reason) => (reason === 'budget' ? COPY.coverage.airBudget
  : reason === 'no_key' ? COPY.coverage.airNotConnected
    : COPY.coverage.airFailed);

function usableAirRow(row) {
  if (!row || typeof row !== 'object') return false;
  if (typeof row.dateForecast !== 'string' || !isCalendarDate(row.dateForecast.trim())) return false;
  if (typeof row.dateIssue !== 'string' || !isCalendarDate(row.dateIssue.trim())) return false;
  if (typeof row.parameter !== 'string' || !row.parameter.trim()) return false;
  const category = AIRNOW_CATEGORIES.includes(row.category) ? row.category : null;
  const aqi = finite(row.aqi) && row.aqi >= 0 ? row.aqi : null;
  return category !== null || aqi !== null;
}

/**
 * What AirNow says for the requested date (F6, as received): the coverage
 * text, the tradeoff sentence, the rows used (for the version), the issue
 * date (for the period version), and whether AirNow contributed.
 */
function airFor(airNow, date) {
  if (!airNow || typeof airNow !== 'object') {
    return { coverage: COPY.coverage.airNotConnected, tradeoff: COPY.tradeoffAir.notChecked, rows: [], status: 'not_connected', issued: null, contributed: false, fetchedAt: null };
  }
  const fetchedAt = instantMs(airNow.fetchedAt);
  // An answer without a readable fetch time cannot bound expiry (F18), so it is unavailable, as for NWS.
  if (airNow.ok !== true || !Array.isArray(airNow.rows) || !Number.isFinite(fetchedAt)) {
    const reason = airNow.ok === true ? 'invalid' : typeof airNow.reason === 'string' ? airNow.reason : 'failed';
    return { coverage: AIR_FAILURE_COPY(reason), tradeoff: COPY.tradeoffAir.notChecked, rows: [], status: `failed:${reason === 'budget' || reason === 'no_key' ? reason : 'failed'}`, issued: null, contributed: false, fetchedAt: null };
  }
  const rows = airNow.rows.filter(usableAirRow).map((row) => ({
    dateIssue: row.dateIssue.trim(),
    dateForecast: row.dateForecast.trim(),
    area: [row.reportingArea, row.stateCode].filter((x) => typeof x === 'string' && x.trim()).map(presentable).join(', '),
    parameter: presentable(row.parameter),
    aqi: finite(row.aqi) && row.aqi >= 0 ? row.aqi : null,
    category: AIRNOW_CATEGORIES.includes(row.category) ? row.category : null,
    actionDay: row.actionDay === true,
  }));
  const base = { fetchedAt };
  if (rows.length === 0) {
    return { ...base, coverage: COPY.coverage.airNoArea, tradeoff: COPY.tradeoffAir.none, rows: [], status: 'no_area', issued: null, contributed: false };
  }
  const dates = [...new Set(rows.map((r) => r.dateForecast))].sort();
  const areasOf = (rs) => [...new Set(rs.map((r) => r.area).filter(Boolean))];
  const forDate = rows.filter((r) => r.dateForecast === date);
  if (forDate.length === 0) {
    const areas = areasOf(rows);
    return {
      ...base,
      coverage: COPY.coverage.airNotIssued({ area: areas.length ? COPY.airArea(areas) : 'this area', date, dates }),
      tradeoff: COPY.tradeoffAir.none,
      rows: [],
      status: 'not_issued',
      issued: null,
      contributed: false,
    };
  }
  const issued = forDate.map((r) => r.dateIssue).sort().at(-1);
  const used = forDate.filter((r) => r.dateIssue === issued);
  const areas = areasOf(used);
  const readings = used.map((r) => COPY.airReading(
    areas.length > 1 && r.area ? `${r.area} ${pollutantName(r.parameter)}` : pollutantName(r.parameter),
    r.category,
    r.aqi,
  ));
  return {
    ...base,
    coverage: COPY.coverage.airForecast({ area: areas.length ? COPY.airArea(areas) : 'this area', issued, date, readings, actionDay: used.some((r) => r.actionDay), dates }),
    tradeoff: COPY.tradeoffAir.forecast(readings),
    rows: used,
    status: 'forecast',
    issued,
    contributed: true,
  };
}

// -------------------------------------------------------------------- alerts

function warningsFor(alerts, zone) {
  if (!alerts || alerts.ok !== true || !Array.isArray(alerts.alerts)) return { text: WARNINGS_UNAVAILABLE, ids: null, contributed: false };
  const fetchedAt = instantMs(alerts.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return { text: WARNINGS_UNAVAILABLE, ids: null, contributed: false };
  const asOf = clockLabel(fetchedAt, zone);
  const kept = alerts.alerts.filter((a) => a && typeof a.id === 'string' && a.id && typeof a.event === 'string' && a.event.trim());
  if (kept.length !== alerts.alerts.length) return { text: WARNINGS_UNAVAILABLE, ids: null, contributed: false };
  const ids = kept.map((a) => a.id).sort();
  if (kept.length === 0) return { text: COPY.warningsNone(asOf), ids, contributed: true };
  const events = [...new Set(kept.map((a) => presentable(a.event)))];
  return { text: COPY.warningsActive(asOf, events), ids, contributed: true };
}

// ------------------------------------------------------------------ the build

/**
 * The snapshot for one request. See the header for inputs and rulings.
 * @returns {{status: 200, body: object} | {status: 503, retryAfter: number, reason: string}}
 */
export function buildForecastSnapshot({ place, date, now, openMeteo, airNow, alerts, stale = false }) {
  const at = requireNow(now);
  if (!isCalendarDate(date)) throw new TypeError('buildForecastSnapshot: date must be a YYYY-MM-DD calendar date');
  if (!place || typeof place !== 'object') throw new TypeError('buildForecastSnapshot: place is required');
  if (EMPTY_KINDS.has(place.kind)) return emptySnapshot({ place, date, now: at, reason: place.kind });
  if (place.kind !== 'home' && place.kind !== 'matched') throw new TypeError('buildForecastSnapshot: unknown place kind');

  // F21: no weather, no forecast.
  if (!openMeteo || openMeteo.ok !== true) {
    const reason = typeof openMeteo?.reason === 'string' ? openMeteo.reason : 'missing';
    return unavailable(`open_meteo_${reason}`, openMeteo?.retryAfterMs);
  }
  const runMs = instantMs(openMeteo.runInitialisedAt);
  const fetchedMs = instantMs(openMeteo.fetchedAt);
  if (!Number.isFinite(runMs) || !Number.isFinite(fetchedMs) || !Array.isArray(openMeteo.hours)) return unavailable('open_meteo_invalid');

  // F12: the gazetteer place's own zone; the home's from Open-Meteo's resolved zone.
  const zone = place.kind === 'matched' ? place.timezone : openMeteo.timezone;
  if (!validZone(zone)) return unavailable('zone');

  const series = new Map();
  for (const hour of openMeteo.hours) if (hour && finite(hour.t)) series.set(hour.t, hour);

  // F12: the horizon, from the data alone.
  const horizonStart = localDateIn(at, zone);
  let horizonEnd = null;
  for (let i = 0; i <= HORIZON_DAYS; i += 1) {
    const d = addDays(horizonStart, i);
    if (FORECAST_WINDOWS.every((w) => windowComplete(series, d, w, zone))) horizonEnd = d;
  }
  if (horizonEnd === null) return unavailable('open_meteo_incomplete');

  // F13: the requested date's periods. Every complete window enters the version
  // (F19), so a period ending does not change it; only the open ones are emitted.
  const inHorizon = date >= horizonStart && date <= horizonEnd;
  const complete = inHorizon
    ? FORECAST_WINDOWS.map((w) => periodFigures(series, date, w, zone)).filter(Boolean)
    : [];
  const figures = complete.filter((f) => f.end > at);

  const air = airFor(airNow, date);
  const warnings = warningsFor(alerts, zone);

  // F18: earliest fetch of the data used, plus 90 minutes; never served already expired.
  // (`air.fetchedAt` is null whenever AirNow supplied nothing, failed or is not connected.)
  // Stale-serve (ruling on report item 7): the last confirmed run, at most STALE_MAX_AGE_MS
  // old, expires STALE_TTL_MS from now so a selection can be saved and Refresh does not loop.
  let expiresMs;
  if (stale === true) {
    if (at - fetchedMs > STALE_MAX_AGE_MS) return unavailable('stale');
    expiresMs = at + STALE_TTL_MS;
  } else {
    expiresMs = Math.min(fetchedMs, air.fetchedAt ?? Infinity) + POPULATED_TTL_MS;
    if (expiresMs <= at) return unavailable('stale');
  }

  const { label, basis, id } = placeLabel(place);
  const prefix = COPY.coveragePrefix(label, basis);

  // F12 note for coverage: the first date whose periods use interpolated 3-hourly steps.
  const interpolatedFromMs = runMs + GFS_HOURLY_UNTIL_HOURS * HOUR_MS;
  let interpolatedFrom = null;
  for (let i = 0; i <= HORIZON_DAYS && interpolatedFrom === null; i += 1) {
    const d = addDays(horizonStart, i);
    if (d > horizonEnd) break;
    if (windowBounds(d, FORECAST_WINDOWS[FORECAST_WINDOWS.length - 1], zone).end > interpolatedFromMs) interpolatedFrom = d;
  }

  const periodVersion = COPY.periodVersion(runLabel(runMs), air.issued);
  const periods = figures.map((f) => ({
    name: f.window.name,
    start: isoSeconds(f.start),
    end: isoSeconds(f.end),
    air: null,
    uv: f.uv,
    pollen: null,
    weather: weatherText(f),
    tradeoff: tradeoffText(f, figures, air.tradeoff),
    version: periodVersion,
  }));

  const providers = [COPY.providers.openMeteo];
  if (air.contributed) providers.push(COPY.providers.airNow);
  if (warnings.contributed) providers.push(COPY.providers.nws);

  const version = contentVersion({
    place: id,
    zone,
    horizonStart,
    horizonEnd,
    date,
    run: new Date(runMs).toISOString(),
    model: typeof openMeteo.model === 'string' ? openMeteo.model : null,
    hours: complete.map((f) => [f.window.name, f.used]),
    air: { status: air.status, rows: air.rows },
    alerts: warnings.ids,
  });

  const body = {
    periods,
    issuedAt: new Date(runMs).toISOString(),
    expiresAt: new Date(expiresMs).toISOString(),
    zone,
    source: COPY.source(providers, label),
    version,
    horizonStart,
    horizonEnd,
    warningStatus: warnings.text,
    coverage: fourCoverage(prefix, {
      Air: air.coverage,
      UV: COPY.coverage.uv({ horizonEnd }),
      Pollen: COPY.coverage.pollen,
      Weather: COPY.coverage.weather({ run: utcLabel(runMs), zone, horizonStart, horizonEnd, interpolatedFrom, stale: stale === true }),
    }),
  };
  return { status: 200, body };
}
