/**
 * Fetch today's environmental readings for a point (§11, punch list v3 items 4, 9).
 *
 * Shared by /api/daily-score and the daily job (item 10), so both record the
 * same things the same way. Every provider degrades on its own: a failure costs
 * that reading (null), never the others, and never becomes a benign default —
 * missing is missing (§62.5, §65.1).
 *
 * Network access goes through an injectable `fetchImpl`; the parsing helpers are
 * exported and unit-tested.
 */

const NWS_HEADERS = { 'User-Agent': 'HALO/1.0' };

/** AirNow ParameterName → the closed set the frontend binds to. */
export function normalizePollutant(name) {
  if (typeof name !== 'string') return null;
  const n = name.trim().toUpperCase().replace(/\s+/g, '');
  if (n === 'PM2.5' || n === 'PM25') return 'PM2.5';
  if (n === 'PM10') return 'PM10';
  if (n === 'O3' || n === 'OZONE') return 'O3';
  return null;
}

/**
 * AirNow's current observations by latitude/longitude. The service this used,
 * `/aq/observation/latLong/current/`, was retired on 2026-09-30 (AirNow's June
 * 2026 notice); its replacement is "Current Observations by Latitude/Longitude
 * or ZIP Code", `/aq/observation/current/ziplatlong/`. It ignores `distance`
 * (its radius is fixed per reporting area, 50 miles in the recorded answers),
 * answers in lowerCamelCase (`parameterName`, `nowcastAQI`, `aqiCategoryName`,
 * `dateObserved`, `hourObserved`, `siteID`, `reportingAreaName`), and says "no
 * observations" with a 200 `{"WebServiceError":[{"Message":"There are no
 * observations available ..."}]}`. Sources and recorded answers:
 * docs/backend/decisions/airnow-forecast-docs.md.
 */
export const AIRNOW_OBSERVATION_ENDPOINT = 'https://www.airnowapi.org/aq/observation/current/ziplatlong/';

export function airNowObservationUrl(lat, lng, key) {
  const params = new URLSearchParams({ format: 'application/json', latitude: String(lat), longitude: String(lng), API_KEY: String(key ?? '') });
  return `${AIRNOW_OBSERVATION_ENDPOINT}?${params}`;
}

/** A reported AQI, or null: -1 (AirNow's "no value"), missing or not a finite number of 0 or more is unknown. */
function observedAqi(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * AirNow returns one entry per pollutant; EPA's reported AQI is the MAXIMUM of
 * them, and the pollutant that set it is the dominant one. Reads the current
 * service's `nowcastAQI`/`parameterName` and the retired service's
 * `AQI`/`ParameterName`. An unknown AQI (-1) never counts as a reading, so a
 * body with only unknown values is no measurement and the caller falls back to
 * the modeled source. `error` is 'provider_error' for a WebServiceError other
 * than "no observations" (worth a log line), else null.
 */
export function parseAirNow(entries) {
  if (entries && typeof entries === 'object' && !Array.isArray(entries) && Array.isArray(entries.WebServiceError)) {
    const messages = entries.WebServiceError.map((e) => (typeof e?.Message === 'string' ? e.Message : ''));
    const noData = messages.length > 0 && messages.every((m) => /no observations/i.test(m));
    return { aqi: null, dominant: null, error: noData ? null : 'provider_error' };
  }
  if (!Array.isArray(entries)) return { aqi: null, dominant: null, error: 'invalid' };
  let best = null;
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const aqi = observedAqi(e.nowcastAQI ?? e.AQI);
    if (aqi === null) continue;
    if (!best || aqi > best.aqi) best = { aqi, parameter: e.parameterName ?? e.ParameterName };
  }
  return best ? { aqi: best.aqi, dominant: normalizePollutant(best.parameter), error: null } : { aqi: null, dominant: null, error: null };
}

/** Open-Meteo's modeled us_aqi, plus the sub-index that sets it when reported. */
export function parseOpenMeteoAir(current) {
  const aqi = typeof current?.us_aqi === 'number' && Number.isFinite(current.us_aqi) ? current.us_aqi : null;
  if (aqi === null) return { aqi: null, dominant: null };
  const subs = [
    ['PM2.5', current.us_aqi_pm2_5],
    ['PM10', current.us_aqi_pm10],
    ['O3', current.us_aqi_ozone],
  ].filter(([, v]) => typeof v === 'number' && Number.isFinite(v));
  if (!subs.length) return { aqi, dominant: null };
  const top = subs.reduce((a, b) => (b[1] > a[1] ? b : a));
  return { aqi, dominant: top[0] };
}

/**
 * Today's UV peak window from Open-Meteo hourly data (local times).
 * start = the first hour at or above UV 3; end = the END of the last such hour;
 * max = today's highest hourly value. Null when UV never reaches 3.
 */
export function uvPeakWindow(hourly, threshold = 3) {
  const times = hourly?.time;
  const values = hourly?.uv_index;
  if (!Array.isArray(times) || !Array.isArray(values) || times.length !== values.length) return null;
  let first = -1;
  let last = -1;
  let max = null;
  values.forEach((v, i) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    if (max === null || v > max) max = v;
    if (v >= threshold) {
      if (first === -1) first = i;
      last = i;
    }
  });
  if (first === -1) return null;
  const hhmm = (t) => (typeof t === 'string' ? t.slice(11, 16) : null);
  const endHour = (parseInt(hhmm(times[last]), 10) + 1) % 24;
  return {
    start: hhmm(times[first]),
    end: `${String(endHour).padStart(2, '0')}:00`,
    max: Math.round(max * 10) / 10,
  };
}

/**
 * Google Pollen dailyInfo → { tree, grass, weed } index values (null = no data).
 * Google marks a type `inSeason: false` when it is not pollinating there, often
 * with no index at all; those types are listed in `out_of_season` (present only
 * when there are some) so the app can say so instead of showing an empty reading.
 * The index values are left exactly as Google sent them.
 */
export function parsePollen(json) {
  const out = { tree: null, grass: null, weed: null };
  const types = json?.dailyInfo?.[0]?.pollenTypeInfo;
  if (!Array.isArray(types)) return out;
  const outOfSeason = [];
  for (const info of types) {
    const key = { TREE: 'tree', GRASS: 'grass', WEED: 'weed' }[info?.code];
    if (!key) continue;
    const v = info?.indexInfo?.value;
    out[key] = typeof v === 'number' && Number.isFinite(v) ? v : null;
    if (info?.inSeason === false) outOfSeason.push(key);
  }
  if (outOfSeason.length) out.out_of_season = outOfSeason;
  return out;
}

/**
 * Mold estimate from the NWS hourly forecast's current period. Returns
 * { risk: null, basis: null } when either input is missing — the estimate is
 * never invented (it used to default to 'low', which let a total outage look like
 * a near-perfect day).
 */
export function moldFromNws(period) {
  const humidity = period?.relativeHumidity?.value;
  const precip = period?.probabilityOfPrecipitation?.value;
  const h = typeof humidity === 'number' && Number.isFinite(humidity) ? humidity : null;
  // NWS reports probability of precipitation as null when it is 0%.
  const p = typeof precip === 'number' && Number.isFinite(precip) ? precip : precip === null && h !== null ? 0 : null;
  if (h === null || p === null) return { risk: null, basis: null };
  let risk = 'low';
  if (h > 70 && p > 0) risk = 'high';
  else if (h > 60 || p > 0) risk = 'moderate';
  return { risk, basis: { humidity_pct: h, precip_pct: p } };
}

async function getJson(fetchImpl, url, init) {
  const res = await fetchImpl(url, init);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/**
 * @param {{lat:number|string, lng:number|string}} point
 * @param {{fetchImpl?:Function, env?:object, openuvAllowed?:()=>Promise<boolean>}} [opts]
 */
export async function fetchDailyReadings({ lat, lng }, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const env = opts.env || process.env;
  const r = {
    aqi: null,
    aqiSource: null,
    aqiIsMeasured: null,
    dominantPollutant: null,
    uvIndex: null,
    uvSource: null,
    uvPeakWindow: null,
    pollen: { tree: null, grass: null, weed: null },
    mold: { risk: null, basis: null },
  };

  // Providers are independent, so they run in parallel.
  const air = (async () => {
    try {
      const entries = await getJson(fetchImpl, airNowObservationUrl(lat, lng, env.AIRNOW_API_KEY));
      const { aqi, dominant, error } = parseAirNow(entries);
      if (error) console.error('AirNow failed:', error);
      if (aqi !== null) Object.assign(r, { aqi, aqiSource: 'airnow', aqiIsMeasured: true, dominantPollutant: dominant });
    } catch (err) {
      console.error('AirNow failed:', err.message);
    }
    // No AirNow reading (no monitor inside the reporting area's lookup boundary,
    // common in NC-08; only unknown -1 values; or a failure): Open-Meteo's CAMS
    // model, labelled as modeled.
    if (r.aqi === null) {
      try {
        const j = await getJson(
          fetchImpl,
          `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=us_aqi,us_aqi_pm2_5,us_aqi_pm10,us_aqi_ozone&timezone=auto`,
        );
        const { aqi, dominant } = parseOpenMeteoAir(j.current);
        if (aqi !== null) Object.assign(r, { aqi, aqiSource: 'open-meteo', aqiIsMeasured: false, dominantPollutant: dominant });
      } catch (err) {
        console.error('Open-Meteo AQI failed:', err.message);
      }
    }
  })();

  const uv = (async () => {
    try {
      const j = await getJson(
        fetchImpl,
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=uv_index&hourly=uv_index&forecast_days=1&timezone=auto`,
      );
      const v = j?.current?.uv_index;
      if (typeof v === 'number' && Number.isFinite(v)) Object.assign(r, { uvIndex: v, uvSource: 'open-meteo' });
      r.uvPeakWindow = uvPeakWindow(j?.hourly);
    } catch (err) {
      console.error('Open-Meteo UV failed:', err.message);
    }
    // OpenUV's free tier is 45 calls/day globally, so it is only a fallback and
    // only when its budget guard allows.
    if (r.uvIndex === null && opts.openuvAllowed && (await opts.openuvAllowed().catch(() => false))) {
      try {
        const j = await getJson(fetchImpl, `https://api.openuv.io/api/v1/uv?lat=${lat}&lng=${lng}`, {
          headers: { 'x-access-token': env.OPENUV_API_KEY },
        });
        const v = j?.result?.uv;
        if (typeof v === 'number' && Number.isFinite(v)) Object.assign(r, { uvIndex: v, uvSource: 'openuv' });
      } catch (err) {
        console.error('OpenUV failed:', err.message);
      }
    }
  })();

  const pollen = (async () => {
    try {
      const j = await getJson(
        fetchImpl,
        `https://pollen.googleapis.com/v1/forecast:lookup?key=${env.GOOGLE_POLLEN_API_KEY}&location.longitude=${lng}&location.latitude=${lat}&days=1`,
      );
      r.pollen = parsePollen(j);
    } catch (err) {
      console.error('Google Pollen failed:', err.message);
    }
  })();

  const mold = (async () => {
    try {
      const points = await getJson(fetchImpl, `https://api.weather.gov/points/${lat},${lng}`, { headers: NWS_HEADERS });
      const forecast = await getJson(fetchImpl, points.properties.forecastHourly, { headers: NWS_HEADERS });
      r.mold = moldFromNws(forecast?.properties?.periods?.[0]);
    } catch (err) {
      console.error('NWS failed:', err.message);
    }
  })();

  await Promise.all([air, uv, pollen, mold]);
  return r;
}
