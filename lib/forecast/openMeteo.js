/**
 * Open-Meteo forecast adapter for `forecast.read` (B10 Task 4; plan rulings F5 and F17).
 *
 * Pure URL builders and parsers, plus one thin fetch sequence that goes through
 * an injected `getJson` (Task 3's `lib/forecast/http.js`:
 * `getJson(url, {timeoutMs, headers, maxBytes})` resolving to
 * `{ok: true, json, status}` or `{ok: false, reason}`, never throwing). The
 * route binds `fetchImpl`; this module never touches the network itself.
 *
 * MODEL (Vibhav, 2026-10-19, after review R1): `models=ncep_gfs_global`, the GFS
 * page's "GFS Global 0.11°/0.25°" (https://open-meteo.com/en/docs/gfs-api). In
 * Open-Meteo's source (open-meteo/open-meteo, `ForecastapiController.swift`,
 * `gfsGlobalDerivationGroup`) it reads the 0.11° domain (`ncep_gfs013`) as
 * primary and the 0.25° domain (`ncep_gfs025`) as supplemental, "mixed before
 * derivation". The 0.25° domain alone holds CAPE, lifted index, visibility,
 * gusts and categorical freezing rain (`GfsVariable.swift`), which the
 * `weather_code` derivation needs for thunderstorm (95, 96), freezing drizzle
 * and rain (56, 57, 66, 67) and fog (45) codes (`DerivedMapping.swift`,
 * `WeatherCode.swift`). The 0.11° domain alone (`models=ncep_gfs013`, this
 * adapter's first version) can never produce them. Its five variables agreed
 * with `ncep_gfs_global` only on the dry, calm Charlotte day they were compared
 * (2026-10-19, every code 0 to 3); the same day at 25.77,-80.19 (Miami)
 * `ncep_gfs_global` gave code 95 in 22 hours and `ncep_gfs013` in none.
 *
 * METADATA, two files, both from the Model Updates table
 * (https://open-meteo.com/en/docs/model-updates, retrieved 2026-10-19, provider
 * "NOAA NCEP", rows "GFS 0.11°" and "GFS 0.25°"):
 *   https://api.open-meteo.com/data/ncep_gfs013/static/meta.json
 *   https://api.open-meteo.com/data/ncep_gfs025/static/meta.json
 * The two grids are one GFS cycle, but they arrive apart: recorded 2026-10-19,
 * the 06Z run was available at 11:36:06Z (0.11°) and 12:54:43Z (0.25°), and at
 * 19:34Z the 0.11° grid already held 12Z while the 0.25° grid still held 06Z.
 * In that window Open-Meteo serves a mix of runs, so the issue time (F17) is
 * confirmed only when BOTH files report the same `last_run_initialisation_time`,
 * each is past its own availability by the documented wait ("please wait 10
 * minutes after the availability time"), and both read the same immediately
 * before and after the forecast call. "API calls to the metadata API are not
 * counted toward daily or monthly request limits." One forecast therefore costs
 * four metadata calls (two before, two after), not the two Task 8's acceptance
 * counts.
 *
 * Observed the same day, and a limit on what the check proves: two reads of the
 * 0.11° file with the same `last_run_modification_time` reported availability
 * 17:49:33Z (at 19:34Z) and 17:26:10Z (at 20:07Z), and the 0.25° 12Z run first
 * appeared at about 20:07Z although stamped available at 18:29:04Z. The metadata
 * evidently comes from more than one server, so agreement before and after the
 * call is strong evidence, not proof, that the server answering the forecast held
 * the same run. An availability that differs between the two reads fails closed
 * (`run_unknown`), which can happen with no new run at all.
 *
 * RUN UNKNOWN, AND THE ROUTE'S OBLIGATION (Task 8). Every refusal to confirm a
 * run answers `{ok: false, reason: 'run_unknown', retryAfterMs}`:
 *   - inside the wait window, `retryAfterMs` is exact: the later availability
 *     plus 10 minutes, minus the call's start;
 *   - when the grids disagree, a file is unreadable or implausible, or a file
 *     changes during the call, no time is known, and `retryAfterMs` is
 *     RUN_UNKNOWN_RETRY_MS (60 s, F9's negative-cache window).
 * The window recurs every 6-hour cycle for about 90 minutes or more (the 0.25°
 * lag plus the wait). The adapter never falls back to older data. Task 8 MUST
 * serve the last confirmed forecast for the point from its cache while the run
 * is unknown, under a key that is not bucketed by hour (the window spans
 * hours), and answer 503 with `Retry-After = ceil(retryAfterMs / 1000)` only
 * when it holds none. That last forecast keeps its own `runInitialisedAt`, so
 * its `issuedAt` stays honest.
 *
 * VARIABLES. Not requested: `precipitation_probability`, which under
 * `ncep_gfs_global` is a secondary source from the GEFS 0.5° and 0.25°
 * ensembles (`PrecipitationProbability.swift`), another run with its own times
 * ("Share of the 31 GEFS ensemble members with more than 0.1 mm/h", gfs-api
 * docs). So `precipPct` is always `null`. Requested instead: `precipitation`
 * ("Total precipitation (rain, showers, snow) sum of the preceding hour", gfs-api
 * docs) in inches, from the same run, as `precipIn`. Notes binding on Task 7:
 *   - `precipIn` is a MODELLED amount, phrased as such ("model rain up to
 *     0.12 in in an hour" or a period total), never as a chance. It is a
 *     preceding-hour value, so a period uses the hours `start < t <= end` (F13).
 *   - The rain-chance clause, and the rain-chance comparison in `tradeoff`, are
 *     omitted whenever every hour's `precipPct` is null (today, always). A
 *     null must never become "0%".
 *   - GFS is "Hourly, 3-hourly after 120 hours" (gfs-api docs; `GfsDomain`
 *     forecast hours are hourly to 119, then every 3 hours), and Open-Meteo
 *     interpolates the hours between. With `forecast_days=8`, days 6 to 8 are
 *     therefore summarised from interpolated hours: hours at or after
 *     `runInitialisedAt + GFS_HOURLY_UNTIL_HOURS` hours. `coverage.Weather`
 *     should say so, or the horizon should stop there.
 *
 * TIMES. Every timestamp is requested as `timeformat=unixtime` ("timestamps are
 * seconds since 1970-01-01 00:00 UTC", open-meteo.com/en/docs), so no
 * offset-less local time enters the code (trap 15); `timezone=auto` is kept
 * only for the response's IANA `timezone`. `generationtime_ms` is not an issue
 * time (DS-038) and is never read.
 *
 * KNOWN RISK. If Open-Meteo stops serving a variable for this model it reports
 * the unit "undefined"; that, or any unit other than the requested °F, mph and
 * inch, makes the answer `invalid` (fail closed, every forecast a 503).
 *
 * OUTPUT (the plan's fixed shape for Task 7, plus the additive `precipIn` and
 * `retryAfterMs`):
 *   {ok: true, timezone, model, runInitialisedAt, runAvailableAt, fetchedAt,
 *    hours: [{t, temperatureF, apparentF, precipPct, precipIn, weatherCode, windMph, uv}]}
 *   {ok: false, reason, retryAfterMs?}
 * `t` is milliseconds since the epoch. The three times are ISO 8601 UTC strings
 * ending in `Z`; `runAvailableAt` is the LATER of the two grids' availability
 * (when the whole run was in place); `fetchedAt` is when the forecast call
 * started. A missing value is `null`, never 0.
 *
 * FAILURE REASONS this adapter can return (for Tasks 7 and 9):
 *   'run_unknown'  the run behind the data is not confirmed (with retryAfterMs)
 *   'invalid'      the forecast body is not the expected shape, or a usable
 *                  point or getJson was not given, or the helper threw
 *   passed through from getJson for the forecast call: 'timeout', 'network',
 *                  'http_<code>', 'too_large', 'invalid', 'no_timeout',
 *                  'bad_headers'; any other token that is not short
 *                  `[a-z0-9_]` becomes 'invalid', so no URL is ever echoed
 *   (metadata failures of any kind are 'run_unknown')
 *   'budget' is the route's (F10), never this adapter's.
 */

import { providerPoint } from './providerPoint.js';

export const OPEN_METEO_MODEL = 'ncep_gfs_global';
export const OPEN_METEO_FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
/** The domains `ncep_gfs_global` reads, in the order their metadata is checked. */
export const OPEN_METEO_META_DOMAINS = Object.freeze(['ncep_gfs013', 'ncep_gfs025']);

/** F8: the forecast call gets 6 s, each metadata call 3 s; bodies are capped at 2 MB. */
export const OPEN_METEO_FORECAST_TIMEOUT_MS = 6_000;
export const OPEN_METEO_META_TIMEOUT_MS = 3_000;
export const OPEN_METEO_MAX_BYTES = 2 * 1024 * 1024;

/** "please wait 10 minutes after the availability time" (open-meteo.com/en/docs/model-updates). */
export const OPEN_METEO_AVAILABILITY_WAIT_MS = 10 * 60 * 1000;
/** Retry hint when no time is known (grids disagree, a file is unreadable or changed): F9's 60 s. */
export const RUN_UNKNOWN_RETRY_MS = 60_000;
/** GFS is hourly to this forecast hour, then 3-hourly and interpolated by Open-Meteo. */
export const GFS_HOURLY_UNTIL_HOURS = 120;

const HOUR_SECONDS = 3600;

/** Requested hourly variables, in the order the URL lists them, and how each is read. */
const VARIABLES = Object.freeze([
  { name: 'temperature_2m', field: 'temperatureF', units: ['°F'] },
  { name: 'apparent_temperature', field: 'apparentF', units: ['°F'] },
  { name: 'precipitation', field: 'precipIn', units: ['inch'], min: 0 },
  { name: 'weather_code', field: 'weatherCode', integer: true },
  { name: 'wind_speed_10m', field: 'windMph', units: ['mp/h', 'mph'] },
  { name: 'uv_index', field: 'uv' },
]);

function clock(now) {
  if (typeof now === 'function') return now();
  if (typeof now === 'number') return now;
  return Date.now();
}

/** The F5 forecast URL for a point (rounded to 2 decimals here, whatever the caller passed). */
export function openMeteoUrl(point) {
  const p = providerPoint(point);
  if (!p) throw new TypeError('openMeteoUrl: not a usable point');
  const params = [
    ['latitude', p.lat],
    ['longitude', p.lng],
    ['hourly', VARIABLES.map((v) => v.name).join(',')],
    ['models', OPEN_METEO_MODEL],
    ['timezone', 'auto'],
    ['timeformat', 'unixtime'],
    ['forecast_days', '8'],
    ['temperature_unit', 'fahrenheit'],
    ['wind_speed_unit', 'mph'],
    ['precipitation_unit', 'inch'],
  ];
  return `${OPEN_METEO_FORECAST_ENDPOINT}?${params.map(([k, v]) => `${k}=${v}`).join('&')}`;
}

/** The metadata URLs of the domains the model reads, gfs013 first. */
export function metaUrls() {
  return OPEN_METEO_META_DOMAINS.map((domain) => `https://api.open-meteo.com/data/${domain}/static/meta.json`);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unixSeconds(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * The model-run fields of one metadata response, or null when they are missing
 * or implausible: a time of 0 or less, an availability before the
 * initialisation, or (given `now`) an availability later than `now`. Times stay
 * in Unix seconds.
 * @param {unknown} json
 * @param {{now?: number}} [options]
 */
export function parseMeta(json, { now } = {}) {
  if (!isPlainObject(json) || json.error === true) return null;
  const initialisation = unixSeconds(json.last_run_initialisation_time);
  const availability = unixSeconds(json.last_run_availability_time);
  if (initialisation === null || availability === null) return null;
  if (availability < initialisation) return null;
  if (typeof now === 'number' && availability * 1000 > now) return null;
  return { initialisation, availability };
}

/**
 * The hourly series of a forecast response, or `{ok: false, reason: 'invalid'}`.
 * Every array must be present and as long as `time`; `time` must be whole Unix
 * seconds one hour apart; a value is a finite number or null (kept as null).
 */
export function parseForecast(json) {
  const invalid = { ok: false, reason: 'invalid' };
  if (!isPlainObject(json) || json.error === true) return invalid;
  if (typeof json.timezone !== 'string' || json.timezone.trim() === '') return invalid;
  const { hourly, hourly_units: units } = json;
  if (!isPlainObject(hourly) || !isPlainObject(units)) return invalid;

  const time = hourly.time;
  if (!Array.isArray(time) || time.length === 0) return invalid;
  for (let i = 0; i < time.length; i += 1) {
    const t = time[i];
    if (typeof t !== 'number' || !Number.isInteger(t) || t <= 0) return invalid;
    if (i > 0 && t - time[i - 1] !== HOUR_SECONDS) return invalid;
  }

  for (const variable of VARIABLES) {
    const unit = units[variable.name];
    // Open-Meteo names the unit "undefined" for a variable the model does not serve.
    if (typeof unit !== 'string' || unit === 'undefined') return invalid;
    if (variable.units && !variable.units.includes(unit)) return invalid;
    const values = hourly[variable.name];
    if (!Array.isArray(values) || values.length !== time.length) return invalid;
    for (const value of values) {
      if (value === null) continue;
      if (typeof value !== 'number' || !Number.isFinite(value)) return invalid;
      if (variable.integer && !Number.isInteger(value)) return invalid;
      if (typeof variable.min === 'number' && value < variable.min) return invalid;
    }
  }

  const hours = time.map((t, i) => {
    const hour = { t: t * 1000, temperatureF: null, apparentF: null, precipPct: null, precipIn: null, weatherCode: null, windMph: null, uv: null };
    for (const variable of VARIABLES) hour[variable.field] = hourly[variable.name][i];
    return hour;
  });
  return { ok: true, timezone: json.timezone, hours };
}

function failureReason(result) {
  const reason = result?.reason;
  return typeof reason === 'string' && /^[a-z0-9_]{1,40}$/.test(reason) ? reason : 'invalid';
}

async function call(getJson, url, timeoutMs) {
  try {
    const result = await getJson(url, { timeoutMs, maxBytes: OPEN_METEO_MAX_BYTES, headers: { accept: 'application/json' } });
    return result && typeof result === 'object' ? result : { ok: false, reason: 'invalid' };
  } catch {
    // The helper's contract is never to throw; if it does, the answer is a failure, not a crash.
    return { ok: false, reason: 'invalid' };
  }
}

/** Both grids' metadata, read in parallel and parsed against `now` once both have answered; null unless both parse. */
async function readRuns(getJson, now) {
  const answers = await Promise.all(metaUrls().map((url) => call(getJson, url, OPEN_METEO_META_TIMEOUT_MS)));
  const at = clock(now);
  const runs = answers.map((answer) => (answer.ok ? parseMeta(answer.json, { now: at }) : null));
  return { at, runs: runs.every(Boolean) ? runs : null };
}

const iso = (ms) => new Date(ms).toISOString();
const runUnknown = (retryAfterMs) => ({ ok: false, reason: 'run_unknown', retryAfterMs: Math.max(1, Math.ceil(retryAfterMs)) });

/**
 * Metadata (both grids), forecast, metadata (both grids), in that order (F17).
 * Resolves to the adapter shape above; never throws.
 * @param {{lat:number, lng:number}} point
 * @param {{getJson: Function, now?: (() => number) | number}} options
 */
export async function fetchOpenMeteo(point, { getJson, now } = /** @type {any} */ ({})) {
  if (typeof getJson !== 'function') return { ok: false, reason: 'invalid' };
  if (!providerPoint(point)) return { ok: false, reason: 'invalid' };

  const before = await readRuns(getJson, now);
  if (!before.runs) return runUnknown(RUN_UNKNOWN_RETRY_MS);
  const [fine, coarse] = before.runs;
  if (fine.initialisation !== coarse.initialisation) return runUnknown(RUN_UNKNOWN_RETRY_MS);

  const startedAt = before.at;
  const availability = Math.max(fine.availability, coarse.availability);
  const confirmedFrom = availability * 1000 + OPEN_METEO_AVAILABILITY_WAIT_MS;
  if (startedAt < confirmedFrom) return runUnknown(confirmedFrom - startedAt);

  const forecast = await call(getJson, openMeteoUrl(point), OPEN_METEO_FORECAST_TIMEOUT_MS);
  if (!forecast.ok) return { ok: false, reason: failureReason(forecast) };
  const parsed = parseForecast(forecast.json);
  if (!parsed.ok) return parsed;

  const after = await readRuns(getJson, now);
  if (!after.runs) return runUnknown(RUN_UNKNOWN_RETRY_MS);
  const changed = after.runs.some((run, i) => run.initialisation !== before.runs[i].initialisation || run.availability !== before.runs[i].availability);
  if (changed) return runUnknown(RUN_UNKNOWN_RETRY_MS);

  return {
    ok: true,
    timezone: parsed.timezone,
    model: OPEN_METEO_MODEL,
    runInitialisedAt: iso(fine.initialisation * 1000),
    runAvailableAt: iso(availability * 1000),
    fetchedAt: iso(startedAt),
    hours: parsed.hours,
  };
}
