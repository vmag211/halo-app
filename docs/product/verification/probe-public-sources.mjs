// Read-only public-source diagnostics. No credentials, household data or HALO APIs.
// Run explicitly with: node docs/product/verification/probe-public-sources.mjs
// Results go to stdout only. A successful sample is not production certification.
import { createHash } from 'node:crypto';

const probes = [
  ['open-meteo-uv', 'https://api.open-meteo.com/v1/forecast?latitude=35.41&longitude=-80.58&current=uv_index&hourly=uv_index&forecast_days=1&timezone=America%2FNew_York'],
  ['open-meteo-air', 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=35.41&longitude=-80.58&current=us_aqi,us_aqi_pm2_5,us_aqi_pm10,us_aqi_ozone&hourly=us_aqi&forecast_days=1&timezone=America%2FNew_York'],
  ['nws-points', 'https://api.weather.gov/points/35.41,-80.58'],
  ['usdm-county', 'https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent?aoi=37025&startdate=9/1/2026&enddate=9/30/2026&statisticsType=2'],
  ['openfda-food', 'https://api.fda.gov/food/enforcement.json?limit=1'],
  ['openfda-pfas-search', 'https://api.fda.gov/food/enforcement.json?search=reason_for_recall:PFAS&limit=1'],
  ['water-boundary-schema', 'https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Water_System_Boundaries/FeatureServer/0?f=json'],
  ['echo-query', 'https://echodata.epa.gov/echo/echo_rest_services.get_facilities?output=JSON&p_st=NC&p_fips=37025&p_act=Y&p_maj=Y'],
  ['nc-fish-landing', 'https://epi.dph.ncdhhs.gov/oee/fish/arcg.html'],
  ['nc-fish-schema', 'https://services.arcgis.com/iFBq2AW9XO0jYYF7/arcgis/rest/services/FA_Lakes_Rivers_Points_Complete/FeatureServer/38?f=json'],
  ['nc-fish-sample', 'https://services.arcgis.com/iFBq2AW9XO0jYYF7/arcgis/rest/services/FA_Lakes_Rivers_Points_Complete/FeatureServer/38/query?where=1%3D1&outFields=FID,Wtr_Bdy,Fsh_Spc,Popultn,MlsAllw,Advisory,Site,Lat,Long&returnGeometry=false&resultRecordCount=1&f=json'],
  ['nc-conservation-schema', 'https://services2.arcgis.com/kCu40SDxsCGcuUWO/arcgis/rest/services/NC_Drought_Monitor_Water_System_Conservation_Status/FeatureServer/0?f=json'],
  ['nc-conservation-sample', 'https://services2.arcgis.com/kCu40SDxsCGcuUWO/arcgis/rest/services/NC_Drought_Monitor_Water_System_Conservation_Status/FeatureServer/0/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=1&f=json'],
];

function summary(id, j) {
  if (id.startsWith('open-meteo')) return {
    timezone: j.timezone, current: j.current, current_units: j.current_units,
    hourly_units: j.hourly_units, hourly_count: j.hourly?.time?.length,
    first_period: j.hourly?.time?.[0], last_period: j.hourly?.time?.at(-1),
    error: j.error, reason: j.reason,
  };
  if (id === 'nws-points') return { gridId: j.properties?.gridId, forecastHourly: j.properties?.forecastHourly, timeZone: j.properties?.timeZone };
  if (id === 'nws-hourly') return { generatedAt: j.properties?.generatedAt, updateTime: j.properties?.updateTime, periods: j.properties?.periods?.length, first: j.properties?.periods?.[0] };
  if (id === 'usdm-county') return { count: Array.isArray(j) ? j.length : null, first: Array.isArray(j) ? j[0] : null };
  if (id.startsWith('openfda')) return { meta: j.meta, first: j.results?.[0], error: j.error };
  if (id === 'water-boundary-schema') return { name: j.name, maxRecordCount: j.maxRecordCount, copyrightText: j.copyrightText, fields: j.fields?.map(f => ({name:f.name,type:f.type})), error: j.error };
  if (id === 'echo-query') return { QueryRows: j.Results?.QueryRows, QueryID_present: Boolean(j.Results?.QueryID), keys: Object.keys(j.Results || {}), error: j.error };
  if (id.endsWith('-schema')) return { name: j.name, geometryType: j.geometryType, fields: j.fields?.map(f => ({name:f.name,type:f.type})), error: j.error };
  if (id.endsWith('-sample')) return { first: j.features?.[0]?.attributes, exceededTransferLimit: j.exceededTransferLimit, error: j.error };
  return { keys: Object.keys(j).slice(0, 20) };
}

async function probe(id, url) {
  const started = Date.now();
  try {
    const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json', 'User-Agent': 'HALO-source-audit/1.0 (read-only documentation verification)' } });
    const reader = r.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1024 * 1024) { await reader.cancel(); throw new Error('Response exceeded 1 MiB audit limit'); }
      chunks.push(value);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    let j;
    try { j = JSON.parse(body); } catch { j = null; }
    const result = { id, url, checked_at: new Date().toISOString(), status: r.status, content_type: r.headers.get('content-type'), bytes: size, sha256: createHash('sha256').update(body).digest('hex'), elapsed_ms: Date.now() - started, sample: j ? summary(id, j) : { json: false, title: body.match(/<title[^>]*>(.*?)<\/title>/is)?.[1] || null } };
    console.log(JSON.stringify(result));
    if (id === 'nws-points' && j?.properties?.forecastHourly) {
      const next = new URL(j.properties.forecastHourly);
      if (next.protocol === 'https:' && next.hostname === 'api.weather.gov') await probe('nws-hourly', next.href);
    }
  } catch (e) {
    console.log(JSON.stringify({ id, url, checked_at: new Date().toISOString(), elapsed_ms: Date.now() - started, error: e.message, cause: e.cause?.code || null }));
  }
}

const requested = process.argv.slice(2);
const selected = requested.length ? probes.filter(([id]) => requested.includes(id)) : probes;
if (requested.some(id => !probes.some(([known]) => known === id))) throw new Error('Unknown probe ID');
for (let i = 0; i < selected.length; i += 3) {
  await Promise.all(selected.slice(i, i + 3).map(([id, url]) => probe(id, url)));
}
