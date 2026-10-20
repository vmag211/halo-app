/**
 * Stand-in providers for the daily maxima recorder's tests (B08 Task 3): AirNow aq/data and the
 * two Open-Meteo hosts, answering from the request's own window the way the real services do, and
 * throwing on every other host, so a call to Mapbox, Google Pollen, NWS or OpenUV fails the test.
 *
 *   const p = providers({ stations: [STATION_NEAR], airnow: 'ok' });
 *   // fetch: p.fetch; p.calls lists {host, url}; p.count('airnow' | 'forecast' | 'air_quality')
 *
 * Options, each changeable between runs (p.set({...})):
 *   stations     AirNow sites: {code, lat, lng, params: ['OZONE','PM2.5'], aqi: (instantMs) => n}
 *   airnow       'ok' | 'http_500' | 'empty' | 'object' (a 200 with an error object)
 *   forecast     'ok' | 'http_500' | 'foreign' (times that fall on no requested day) | 'nulls' (every value null)
 *   airQuality   the same, for air-quality-api
 *   drop         (instantMs, kind) => true to leave that hour out (kind 'airnow', 'uv_index', 'us_aqi')
 *   reshape      (row) => row, applied to each AirNow row (to change the answer's shape)
 *   onCall       async ({host, url}) => void, before answering (to change the world mid-run)
 */
export const ALLOWED_HOSTS = Object.freeze(['www.airnowapi.org', 'api.open-meteo.com', 'air-quality-api.open-meteo.com']);

const HOUR = 3600000;

export const aqiAt = (ms) => 30 + (Math.floor(ms / HOUR) % 17); // 30 to 46
export const uvAt = (ms) => (Math.floor(ms / HOUR) % 24) / 2; // 0 to 11.5

export function providers(initial = {}) {
  const options = { stations: [], airnow: 'ok', forecast: 'ok', airQuality: 'ok', drop: () => false, reshape: (row) => row, onCall: null, ...initial };
  const calls = [];

  const airnow = (url) => {
    if (options.airnow === 'http_500') return new Response('down', { status: 500 });
    if (options.airnow === 'object') return Response.json({ WebServiceError: [{ Message: 'Invalid request' }] });
    if (options.airnow === 'empty') return Response.json([]);
    const start = Date.parse(`${url.searchParams.get('startDate')}:00:00Z`);
    const end = Date.parse(`${url.searchParams.get('endDate')}:00:00Z`);
    const rows = [];
    for (const s of options.stations) {
      for (let t = start; t <= end; t += HOUR) {
        if (options.drop(t, 'airnow', s)) continue;
        for (const param of s.params ?? ['OZONE', 'PM2.5']) {
          rows.push({
            Latitude: s.lat, Longitude: s.lng, UTC: new Date(t).toISOString().slice(0, 16), Parameter: param,
            Unit: 'PPB', AQI: (s.aqi ?? aqiAt)(t, param), Category: 1, SiteName: 'SITE NAME TEXT', AgencyName: 'Agency',
            FullAQSCode: s.code, IntlAQSCode: s.code,
          });
        }
      }
    }
    return Response.json(rows.map(options.reshape));
  };

  const openMeteo = (url, mode, field) => {
    if (mode === 'http_500') return new Response('down', { status: 500 });
    const past = Number(url.searchParams.get('past_days'));
    const forecastDays = Number(url.searchParams.get('forecast_days'));
    const now = new Date();
    let start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - past * 24 * HOUR;
    if (mode === 'foreign') start -= 30 * 24 * HOUR;
    const time = [];
    const values = [];
    for (let i = 0; i < (past + forecastDays) * 24; i += 1) {
      const t = start + i * HOUR;
      time.push(t / 1000);
      values.push(mode === 'nulls' || options.drop(t, field) ? null : field === 'uv_index' ? uvAt(t) : aqiAt(t));
    }
    return Response.json({ latitude: 1, longitude: 1, utc_offset_seconds: 0, timezone: 'GMT', hourly: { time, [field]: values } });
  };

  const fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const call = { host: url.host, url: url.href };
    calls.push(call);
    if (!ALLOWED_HOSTS.includes(url.host)) throw new Error(`dailyMaximaProviders: the recorder called ${url.host}`);
    if (options.onCall) await options.onCall(call);
    if (url.host === 'www.airnowapi.org') return airnow(url);
    if (url.host === 'api.open-meteo.com') return openMeteo(url, options.forecast, url.searchParams.get('hourly'));
    return openMeteo(url, options.airQuality, url.searchParams.get('hourly'));
  };

  const kindOf = (call) => ({ 'www.airnowapi.org': 'airnow', 'api.open-meteo.com': 'forecast', 'air-quality-api.open-meteo.com': 'air_quality' })[call.host] ?? 'other';
  return {
    fetch,
    calls,
    set: (changes) => Object.assign(options, changes),
    count: (kind) => calls.filter((call) => kindOf(call) === kind).length,
    reset: () => { calls.length = 0; },
  };
}
