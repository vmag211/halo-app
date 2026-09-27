/**
 * Facilities and air-monitor map layers (§13.3; punch list v3 item 18).
 * Parsers are pure and unit-tested; the fetchers take an injectable fetch.
 *
 * Facilities: EPA ECHO, scoped to NC-08. ECHO lists ~1,300 regulated facilities
 * in Union County alone, most of them minor, so the layer is the meaningful
 * subset: active MAJOR facilities plus repeat violators (more than 4 of the last
 * 12 quarters in noncompliance), queried per county and kept only if the
 * facility sits inside the NC-08 boundary.
 *
 * Air: AirNow monitoring sites in and around NC-08, one feature per site with
 * the latest hour's AQI (the worst pollutant at that site).
 */
import { normalizePollutant } from './dailyReadings.js';
import { aqiSeverity } from './severity.js';
import { toIsoDate } from './waterPresentation.js';
import { inNc08 } from './geoContainment.js';

// County FIPS for every county wholly or partly in NC-08 (119th Congress):
// Anson, Cabarrus, Mecklenburg, Montgomery, Richmond, Robeson, Scotland, Stanly, Union.
export const NC08_COUNTY_FIPS = ['37007', '37025', '37119', '37123', '37153', '37155', '37165', '37167', '37179'];

// Bounding box of NC-08, padded ~0.15° (~16 km) so the nearest monitors just outside the
// line are included (a household's nearest monitor may be across it).
export const NC08_BBOX = [-81.0, 34.18, -78.79, 35.66];

/** FacComplianceStatus text → the closed set, and its map severity. */
export function complianceStatus(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return 'unknown';
  if (t.includes('significant')) return 'significant_violation';
  if (t.includes('no violation')) return 'no_violation';
  if (t.includes('violation')) return 'violation';
  return 'unknown';
}

const STATUS_SEVERITY = {
  no_violation: 'good',
  violation: 'elevated',
  significant_violation: 'high',
  unknown: 'no_data',
};

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** One ECHO facility row → a map feature, or null when it has no location. */
export function parseEchoFacility(row) {
  const lat = num(row?.FacLat);
  const lng = num(row?.FacLong);
  if (lat === null || lng === null) return null;
  const programs = [
    ['AIRFlag', 'Clean Air Act'],
    ['NPDESFlag', 'Clean Water Act'],
    ['RCRAFlag', 'Hazardous waste (RCRA)'],
    ['SDWISFlag', 'Safe Drinking Water Act'],
    ['TRIFlag', 'Toxics Release Inventory'],
  ]
    .filter(([k]) => row[k] === 'Y')
    .map(([, name]) => name);
  const status = complianceStatus(row.FacComplianceStatus);
  const programStatuses = [row.CAAComplianceStatus, row.CWAComplianceStatus, row.RCRAComplianceStatus, row.SDWAComplianceStatus];
  return {
    id: String(row.RegistryID ?? ''),
    name: row.FacName ?? null,
    lat,
    lng,
    county: row.FacCounty ?? null,
    programs,
    compliance_status: status,
    severity: STATUS_SEVERITY[status],
    // Programs currently reporting a violation.
    open_violations: programStatuses.filter((s) => /violation/i.test(String(s || '')) && !/no violation/i.test(String(s || ''))).length,
    // Quarters in noncompliance over the last 3 years (12 quarters).
    recent_violations: num(row.FacQtrsWithNC) ?? 0,
    // Total penalties over the last 5 years, in dollars.
    penalties: num(row.FacTotalPenalties) ?? 0,
    last_inspection: toIsoDate(row.FacDateLastInspection),
  };
}

/** AirNow data rows (one per site × pollutant × hour) → one feature per site. */
export function parseAirNowStations(rows) {
  const sites = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (typeof r?.AQI !== 'number' || r.AQI < 0) continue;
    const id = String(r.FullAQSCode || r.IntlAQSCode || `${r.Latitude},${r.Longitude}`);
    const prev = sites.get(id);
    // Latest hour wins; within the same hour the worst pollutant sets the AQI.
    if (!prev || r.UTC > prev.UTC || (r.UTC === prev.UTC && r.AQI > prev.AQI)) sites.set(id, r);
  }
  return [...sites.entries()].map(([id, r]) => ({
    id,
    name: r.SiteName ?? null,
    lat: r.Latitude,
    lng: r.Longitude,
    aqi: r.AQI,
    severity: aqiSeverity(r.AQI),
    dominant_pollutant: normalizePollutant(r.Parameter),
    last_reading_at: r.UTC ? `${r.UTC}:00Z` : null,
    agency: r.AgencyName ?? null,
  }));
}

const ECHO = 'https://echodata.epa.gov/echo/echo_rest_services';
// Result columns: name, registry id, county, lat, long, SNC flag, quarters in
// NC, facility + per-program compliance status, last inspection, total
// penalties, program flags.
const ECHO_COLUMNS = '1,6,7,17,18,34,35,36,37,38,39,40,43,60,98,99,100,101,102';

// Government services are sometimes very slow (AirNow once took 75s). Every
// request is capped so a slow source fails fast instead of timing the route out.
export const SOURCE_TIMEOUT_MS = 20000;

async function getJson(fetchImpl, url, timeoutMs = SOURCE_TIMEOUT_MS) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/** Active majors + repeat violators in NC-08's counties, inside the district line. */
export async function fetchFacilities({ fetchImpl = fetch } = {}) {
  const seen = new Map();
  const queries = NC08_COUNTY_FIPS.flatMap((fips) => [`p_fips=${fips}&p_act=Y&p_maj=Y`, `p_fips=${fips}&p_act=Y&p_qiv=GT4`]);
  for (const q of queries) {
    const head = await getJson(fetchImpl, `${ECHO}.get_facilities?output=JSON&p_st=NC&${q}`);
    const qid = head?.Results?.QueryID;
    if (!qid) continue;
    const rows = Number(head.Results.QueryRows) || 0;
    for (let page = 1; page <= Math.max(1, Math.ceil(rows / 1000)); page++) {
      const data = await getJson(fetchImpl, `${ECHO}.get_qid?qid=${qid}&output=JSON&pageno=${page}&qcolumns=${ECHO_COLUMNS}`);
      for (const row of data?.Results?.Facilities || []) {
        const f = parseEchoFacility(row);
        if (f && f.id && inNc08(f.lat, f.lng)) seen.set(f.id, f);
      }
    }
  }
  return [...seen.values()];
}

/** AirNow monitors around NC-08, latest hour. */
export async function fetchAirStations({ fetchImpl = fetch, apiKey = process.env.AIRNOW_API_KEY, now = new Date() } = {}) {
  const hour = (d) => d.toISOString().slice(0, 13);
  const start = hour(new Date(now.getTime() - 3 * 3600 * 1000));
  const end = hour(now);
  const url =
    `https://www.airnowapi.org/aq/data/?startDate=${start}&endDate=${end}&parameters=OZONE,PM25,PM10` +
    `&BBOX=${NC08_BBOX.join(',')}&dataType=A&format=application/json&verbose=1&monitorType=0` +
    `&includerawconcentrations=0&API_KEY=${apiKey}`;
  return parseAirNowStations(await getJson(fetchImpl, url));
}
