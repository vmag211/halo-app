/**
 * Open-Meteo forecast adapter for `forecast.read` (B10 Task 4; plan rulings F5 and F17).
 *
 * Pure URL builders and parsers, plus one thin fetch sequence that goes through
 * an injected `getJson` (Task 3's `lib/forecast/http.js` interface:
 * `getJson(url, {timeoutMs, headers, maxBytes})` resolving to
 * `{ok: true, json, status}` or `{ok: false, reason}`, never throwing). The
 * route binds `fetchImpl`; this module never touches the network itself.
 *
 * Pinned model, copied from the Model Updates table
 * (https://open-meteo.com/en/docs/model-updates, retrieved 2026-10-19), provider
 * "NOAA NCEP", row "GFS 0.11°", whose metadata id is `ncep_gfs013`:
 *
 *   models = ncep_gfs013
 *   metadata = https://api.open-meteo.com/data/ncep_gfs013/static/meta.json
 *
 * Why not the GFS page's `ncep_gfs_global` ("GFS Global 0.11°/0.25°",
 * https://open-meteo.com/en/docs/gfs-api): it is itself a blend. Its
 * `precipitation_probability` is "Share of the 31 GEFS ensemble members with
 * more than 0.1 mm/h" (the same page), read from the GEFS 0.5° and 0.25°
 * ensembles (open-meteo/open-meteo, Sources/App/Gfs/PrecipitationProbability.swift,
 * `ProbabilityReader.makeGfsReader`), which have their own run and availability
 * times. A blend has no single honest issue time (F5), so B10 pins the one
 * domain whose metadata is read. Checked live on 2026-10-19 for 35.23,-80.84:
 * with `models=ncep_gfs013` the five variables below were identical, hour for
 * hour, to `ncep_gfs_global`, and `precipitation_probability` came back null in
 * every hour with the unit "undefined".
 *
 * Deviation from F5's parameter list, flagged for the plan's owner:
 * `precipitation_probability` is NOT requested, so every hour's `precipPct` is
 * `null` (missing, never 0) and no rain chance is shown. A run-consistent rain
 * chance needs a second provenance (the GEFS run) that the snapshot cannot carry.
 *
 * Every timestamp is requested as `timeformat=unixtime` ("timestamps are seconds
 * since 1970-01-01 00:00 UTC", open-meteo.com/en/docs), so no offset-less local
 * time ever enters the code (trap 15); `timezone=auto` is kept only for the
 * response's IANA `timezone`. `generationtime_ms` is not an issue time
 * (DS-038) and is never read.
 *
 * `issuedAt` (F17) comes from the metadata API: `last_run_initialisation_time`
 * and `last_run_availability_time`, Unix seconds. The docs ask clients to
 * "wait 10 minutes after the availability time", and "API calls to the metadata
 * API are not counted toward daily or monthly request limits". The metadata is
 * read before and after the forecast call; any failure, any disagreement, or a
 * forecast that would start less than 10 minutes after availability means the
 * run behind the data is not known, and the answer is `run_unknown`.
 *
 * Output (fixed by the plan for Task 7):
 *   {ok: true, timezone, model, runInitialisedAt, runAvailableAt, fetchedAt,
 *    hours: [{t, temperatureF, apparentF, precipPct, weatherCode, windMph, uv}]}
 *   {ok: false, reason}
 * `t` is milliseconds since the epoch; the three times are ISO 8601 UTC strings
 * ending in `Z`. A missing value is `null`, never 0.
 */

import { providerPoint } from './providerPoint.js';

export const OPEN_METEO_MODEL = 'ncep_gfs013';
export const OPEN_METEO_FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
export const OPEN_METEO_META_URL = `https://api.open-meteo.com/data/${OPEN_METEO_MODEL}/static/meta.json`;

/** F8: the forecast call gets 6 s, each metadata call 3 s; bodies are capped at 2 MB. */
export const OPEN_METEO_FORECAST_TIMEOUT_MS = 6_000;
export const OPEN_METEO_META_TIMEOUT_MS = 3_000;
export const OPEN_METEO_MAX_BYTES = 2 * 1024 * 1024;

/** "please wait 10 minutes after the availability time" (open-meteo.com/en/docs/model-updates). */
export const OPEN_METEO_AVAILABILITY_WAIT_MS = 10 * 60 * 1000;

const HOUR_SECONDS = 3600;

/** Requested hourly variables, in the order the URL lists them, and how each is read. */
const VARIABLES = Object.freeze([
  { name: 'temperature_2m', field: 'temperatureF', units: ['°F'] },
  { name: 'apparent_temperature', field: 'apparentF', units: ['°F'] },
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
  ];
  return `${OPEN_METEO_FORECAST_ENDPOINT}?${params.map(([k, v]) => `${k}=${v}`).join('&')}`;
}

/** The pinned model's metadata URL. */
export function metaUrl() {
  return OPEN_METEO_META_URL;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unixSeconds(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * The model-run fields of a metadata response, or null when they are missing or
 * inconsistent. Times stay in Unix seconds here.
 */
export function parseMeta(json) {
  if (!isPlainObject(json) || json.error === true) return null;
  const initialisation = unixSeconds(json.last_run_initialisation_time);
  const availability = unixSeconds(json.last_run_availability_time);
  if (initialisation === null || availability === null) return null;
  if (availability < initialisation) return null;
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
    }
  }

  const hours = time.map((t, i) => {
    const hour = { t: t * 1000, temperatureF: null, apparentF: null, precipPct: null, weatherCode: null, windMph: null, uv: null };
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
    const result = await getJson(url, { timeoutMs, maxBytes: OPEN_METEO_MAX_BYTES, headers: { Accept: 'application/json' } });
    return result && typeof result === 'object' ? result : { ok: false, reason: 'invalid' };
  } catch {
    // The helper's contract is never to throw; if it does, the answer is a failure, not a crash.
    return { ok: false, reason: 'invalid' };
  }
}

const iso = (ms) => new Date(ms).toISOString();

/**
 * Metadata, forecast, metadata, in that order (F17). Resolves to the fixed
 * adapter shape; never throws.
 * @param {{lat:number, lng:number}} point
 * @param {{getJson: Function, now?: (() => number) | number}} options
 */
export async function fetchOpenMeteo(point, { getJson, now } = /** @type {any} */ ({})) {
  if (typeof getJson !== 'function') return { ok: false, reason: 'invalid' };
  if (!providerPoint(point)) return { ok: false, reason: 'invalid' };
  const runUnknown = { ok: false, reason: 'run_unknown' };

  const before = await call(getJson, metaUrl(), OPEN_METEO_META_TIMEOUT_MS);
  const runBefore = before.ok ? parseMeta(before.json) : null;
  if (!runBefore) return runUnknown;

  const startedAt = clock(now);
  if (startedAt - runBefore.availability * 1000 < OPEN_METEO_AVAILABILITY_WAIT_MS) return runUnknown;

  const forecast = await call(getJson, openMeteoUrl(point), OPEN_METEO_FORECAST_TIMEOUT_MS);
  if (!forecast.ok) return { ok: false, reason: failureReason(forecast) };
  const parsed = parseForecast(forecast.json);
  if (!parsed.ok) return parsed;

  const after = await call(getJson, metaUrl(), OPEN_METEO_META_TIMEOUT_MS);
  const runAfter = after.ok ? parseMeta(after.json) : null;
  if (!runAfter) return runUnknown;
  if (runAfter.initialisation !== runBefore.initialisation || runAfter.availability !== runBefore.availability) return runUnknown;

  return {
    ok: true,
    timezone: parsed.timezone,
    model: OPEN_METEO_MODEL,
    runInitialisedAt: iso(runBefore.initialisation * 1000),
    runAvailableAt: iso(runBefore.availability * 1000),
    fetchedAt: iso(startedAt),
    hours: parsed.hours,
  };
}
