/**
 * EPA AirNow daily air forecast adapter for `forecast.read` (B10 Task 5; plan
 * ruling F6). Sources, request and field mapping, with retrieval dates:
 * docs/backend/decisions/airnow-forecast-docs.md.
 *
 * Request: AirNow's "Current Forecasts by Reporting Area" service,
 * `https://www.airnowapi.org/aq/forecast/current/`, which replaced the
 * retired "Forecast by Latitude/Longitude" (`/aq/forecast/latLong/`, retired
 * 2026-09-30) by AirNow's June 2026 notice. Sent: `format=application/json`,
 * the 2-decimal point (F3) and `API_KEY` from `AIRNOW_API_KEY`, the variable
 * and parameter spelling the observation call already uses
 * (lib/dailyReadings.js). No `date` (one call returns every validity date the
 * agency issued, so one cached answer serves every planned date) and no
 * `distance` (the new service ignores it). The key is in the query string, so
 * the URL is never echoed: failures carry a fixed token only.
 *
 * Response: an array, one row per pollutant per validity date. The new
 * service's camelCase fields are read first and the retired service's
 * PascalCase names are accepted as the same fields (`dateValid` or
 * `DateForecast`, `categoryName` or `Category.Name`, and so on), so a
 * recorded answer of either shape parses the same way.
 *
 * Parsing, as received (AirNow's guidelines forbid altering forecasts):
 *   - dates are trimmed and kept only as YYYY-MM-DD calendar dates, else null;
 *   - `aqi` of -1, missing, or not a finite number of 0 or more is null: no
 *     number was issued, which is unknown, never a low or favourable value;
 *   - a category is kept only if it is one of AirNow's six names (in any
 *     letter case, returned in AirNow's spelling); number 7 ("Unavailable")
 *     and anything else is null. A row with neither a category nor a number
 *     is still returned: the snapshot lists it as not issued rather than
 *     letting a better pollutant stand for the day;
 *   - every received row becomes exactly one output row, nothing averaged or
 *     spread across hours; `discussion` is not used (F6).
 *
 * "No forecast here" and "could not check" stay distinct:
 *   {ok: true, rows: []}  an empty array, or AirNow's 200 answer
 *                         `{"WebServiceError":[{"Message":"Error - There is no
 *                         reporting area at your searched location"}]}`
 *   {ok: false, reason}   anything else that is not a readable forecast
 *
 * Output (fixed by the plan for Task 7):
 *   {ok: true, fetchedAt, rows: [{dateIssue, dateForecast, reportingArea, stateCode, parameter, aqi, category, actionDay}]}
 *   {ok: false, reason}
 *
 * Failure reasons:
 *   'no_key'          AIRNOW_API_KEY unset or unusable; no request was made
 *   'provider_error'  AirNow answered with a WebServiceError other than "no
 *                     reporting area" (for example a limit reached)
 *   'invalid'         the body is not a forecast array, a row is not an
 *                     object, no usable point or getJson was given, or the
 *                     helper threw
 *   passed through from getJson: 'timeout', 'network', 'http_<code>',
 *                     'too_large', 'invalid', 'no_timeout', 'bad_headers'; any
 *                     other token that is not short `[a-z0-9_]` becomes 'invalid'
 *   'budget' is the route's (F10), never this adapter's.
 */

import { providerPoint } from './providerPoint.js';
import { AIRNOW_CATEGORIES } from './copy.js';

export const AIRNOW_FORECAST_ENDPOINT = 'https://www.airnowapi.org/aq/forecast/current/';
export const AIRNOW_TIMEOUT_MS = 6_000;
export const AIRNOW_MAX_BYTES = 2 * 1024 * 1024;

/** AirNow's 200 answer for a point no reporting area covers (recorded; see the docs record). */
const NO_REPORTING_AREA = /no reporting area/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clock(now) {
  if (typeof now === 'function') return now();
  if (typeof now === 'number') return now;
  return Date.now();
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The first of `names` that the row carries (not undefined). */
function field(row, ...names) {
  for (const name of names) if (row[name] !== undefined) return row[name];
  return undefined;
}

function calendarDate(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!DATE_RE.test(text)) return null;
  const [y, m, d] = text.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? text : null;
}

function text(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** An issued AQI number, or null for -1, missing or anything that is not a finite number of 0 or more. */
function issuedAqi(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function categoryName(row) {
  const legacy = isPlainObject(row.Category) ? row.Category.Name : undefined;
  const name = text(field(row, 'categoryName', 'CategoryName') ?? legacy);
  if (name === null) return null;
  // AirNow's own name in AirNow's own spelling, whatever the case or spacing it arrived in.
  const key = name.replace(/\s+/g, ' ').toLowerCase();
  return AIRNOW_CATEGORIES.find((c) => c.toLowerCase() === key) ?? null;
}

/** The key, or null when unset or not a plausible key (it goes into a URL, so nothing that would need encoding). */
export function airNowKey(env) {
  // Written as `env.AIRNOW_API_KEY` (not `env?.`) so the sandbox drift scan in test/routeSandbox.test.mjs sees it.
  const raw = env && typeof env === 'object' ? env.AIRNOW_API_KEY : undefined;
  if (typeof raw !== 'string') return null;
  const key = raw.trim();
  return /^[A-Za-z0-9-]{8,128}$/.test(key) ? key : null;
}

/** The request URL for a point (rounded to 2 decimals here, whatever the caller passed). */
export function airNowForecastUrl(point, env) {
  const p = providerPoint(point);
  if (!p) throw new TypeError('airNowForecastUrl: not a usable point');
  const key = airNowKey(env);
  if (!key) throw new TypeError('airNowForecastUrl: no AirNow key');
  const params = new URLSearchParams({ format: 'application/json', latitude: p.lat, longitude: p.lng, API_KEY: key });
  return `${AIRNOW_FORECAST_ENDPOINT}?${params}`;
}

/**
 * The rows of a forecast response, or `{ok: false, reason}`.
 * @param {unknown} json
 */
export function parseAirNowForecast(json) {
  if (isPlainObject(json) && Array.isArray(json.WebServiceError)) {
    const messages = json.WebServiceError.map((e) => (isPlainObject(e) && typeof e.Message === 'string' ? e.Message : ''));
    return messages.length > 0 && messages.every((m) => NO_REPORTING_AREA.test(m))
      ? { ok: true, rows: [] }
      : { ok: false, reason: 'provider_error' };
  }
  if (!Array.isArray(json)) return { ok: false, reason: 'invalid' };
  const rows = [];
  for (const row of json) {
    // A row that cannot be read could be the worst pollutant: the whole answer is unreadable, never quietly shorter.
    if (!isPlainObject(row)) return { ok: false, reason: 'invalid' };
    rows.push({
      dateIssue: calendarDate(field(row, 'dateIssue', 'DateIssue')),
      dateForecast: calendarDate(field(row, 'dateValid', 'DateForecast', 'dateForecast')),
      reportingArea: text(field(row, 'reportingArea', 'ReportingArea')),
      stateCode: text(field(row, 'stateCode', 'StateCode')),
      parameter: text(field(row, 'parameterName', 'ParameterName')),
      aqi: issuedAqi(field(row, 'aqi', 'AQI')),
      category: categoryName(row),
      actionDay: field(row, 'actionDay', 'ActionDay') === true,
    });
  }
  return { ok: true, rows };
}

function failureReason(result) {
  const reason = result?.reason;
  return typeof reason === 'string' && /^[a-z0-9_]{1,40}$/.test(reason) ? reason : 'invalid';
}

/**
 * The daily AirNow forecast for a point. Resolves to the fixed adapter shape; never throws.
 * @param {{lat:number, lng:number}} point
 * @param {{getJson: Function, env?: Record<string, string | undefined>, now?: (() => number) | number}} options
 */
export async function fetchAirNowForecast(point, { getJson, env = process.env, now } = /** @type {any} */ ({})) {
  if (typeof getJson !== 'function') return { ok: false, reason: 'invalid' };
  if (!airNowKey(env)) return { ok: false, reason: 'no_key' };
  if (!providerPoint(point)) return { ok: false, reason: 'invalid' };

  const fetchedAt = clock(now);
  let result;
  try {
    result = await getJson(airNowForecastUrl(point, env), {
      timeoutMs: AIRNOW_TIMEOUT_MS,
      maxBytes: AIRNOW_MAX_BYTES,
      headers: { accept: 'application/json' },
    });
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!result || typeof result !== 'object' || !result.ok) return { ok: false, reason: failureReason(result) };
  const parsed = parseAirNowForecast(result.json);
  if (!parsed.ok) return parsed;
  return { ok: true, fetchedAt: new Date(fetchedAt).toISOString(), rows: parsed.rows };
}
