/**
 * The two public water sources behind `water.read` (B12, B19): their parsers,
 * their strict checks and the record text, shared by the hand build
 * (scripts/build-public-evidence.mjs) and the weekly import
 * (lib/publicWaterImport.js), so both turn the same download into the same
 * rows.
 *
 *   U.S. Drought Monitor county statistics (categorical percent of area, NC)
 *     parseDroughtStatistics(rawJson) -> { releases, newestMapDate, mapDates }
 *   NC DEQ DWR "Water System Conservation Status" table (HTML)
 *     parseConservationStatus(html)   -> { notices, summary, total, newestUpdate }
 *
 * A download that fails a check throws a WaterSourceError whose `code` is a
 * fixed token ('shape', 'incomplete' or 'bad_date') and whose message names
 * the row, for the person running the build. The import records the code only
 * and never logs the message, a value or the URL.
 *
 * Pure: no fetch, no database, no clock.
 */
import counties from './data/ncCounties.json' with { type: 'json' };

export const DROUGHT_SOURCE_ID = 'usdm-drought';
export const UTILITY_SOURCE_ID = 'ncdwr-conservation';

export const USDM_STATISTICS_ENDPOINT = 'https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent';
export const USDM_MAP_URL = 'https://droughtmonitor.unl.edu/CurrentMap/StateDroughtMonitor.aspx?NC';
export const WUDC_URL = 'https://www.ncwater.org/WUDC/conservation-status';

export const DROUGHT_ISSUER = 'U.S. Drought Monitor: National Drought Mitigation Center (University of Nebraska-Lincoln), USDA and NOAA';
export const DROUGHT_STATISTIC = 'Categorical percent of county area (statisticsType=2)';
export const UTILITY_ISSUER = 'NC Department of Environmental Quality, Division of Water Resources, Water Use Data Collection';
export const WATER_LICENCE = 'U.S. Drought Monitor maps and data are public; credit the National Drought Mitigation Center, USDA and NOAA. The NC DWR listing is public information of the State of North Carolina.';

/** Every North Carolina county, every weekly map (strict: a map missing one county is refused). */
export const COUNTY_COUNT = 100;
/** Bounds on the drought download: whole weekly maps, at most this many in one window. */
export const MAX_MAPS = 10;
/** Bounds on the conservation table's row count (277 systems on 2026-10-20). Proposed, Vibhav to confirm. */
export const MIN_SYSTEMS = 50;
export const MAX_SYSTEMS = 2000;

export const DWR_STATUSES = new Set(['Not Restricted', 'Voluntary', 'Mandatory', 'Emergency', 'Rationing']);

export class WaterSourceError extends Error {
  /** @param {'shape'|'incomplete'|'bad_date'} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'WaterSourceError';
    this.code = code;
  }
}
const refuse = (code, message) => {
  throw new WaterSourceError(code, message);
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function decode(value) {
  return value.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, name) => {
    if (name[0] === '#') {
      const point = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      // An impossible reference is left as written (and then refused by the name check), not a crash.
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    }
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}
export const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** A real calendar date in YYYY-MM-DD (2026-02-30 is not one). */
export function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** M/D/YYYY, as the USDM service takes its dates. */
const mdy = (isoDate) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${m}/${d}/${y}`;
};

/** The statistics request for North Carolina between two YYYY-MM-DD dates (spec DS-108). */
export function usdmUrl(startDate, endDate) {
  return `${USDM_STATISTICS_ENDPOINT}?aoi=NC&startdate=${mdy(startDate)}&enddate=${mdy(endDate)}&statisticsType=2`;
}

function countyNames() {
  const fips = new Map(counties.counties.map((county) => [county.geoid, county.name]));
  if (fips.size !== COUNTY_COUNT) throw new Error('ncCounties.json: expected 100 counties');
  return fips;
}

/** The 100 counties as water.read lists them, by name. */
export function countyRows() {
  return [...countyNames()].map(([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------- drought

const SHARES = ['none', 'd0', 'd1', 'd2', 'd3', 'd4'];

/**
 * The USDM categorical county statistics for NC, as water.read's releases,
 * newest first within each county. Strict: every row is NC, a known county
 * under its own name, format 2, three real dates with start <= end, shares in
 * 0..100 summing to 100 (within 0.5); no repeated county and map; and every
 * map date carries all 100 counties.
 */
export function parseDroughtStatistics(raw) {
  const fips = countyNames();
  if (!Array.isArray(raw)) refuse('shape', 'usdm: the body is not a list');
  if (raw.length < COUNTY_COUNT || raw.length > COUNTY_COUNT * MAX_MAPS) refuse('incomplete', 'usdm: unexpected row count');
  const releases = [];
  const seen = new Set();
  for (const row of raw) {
    if (!row || typeof row !== 'object' || row.state !== 'NC' || !fips.has(row.fips) || row.statisticFormatID !== 2) refuse('shape', `usdm: unexpected row ${row?.fips}`);
    const date = String(row.mapDate).slice(0, 10);
    const validStart = String(row.validStart).slice(0, 10);
    const validEnd = String(row.validEnd).slice(0, 10);
    for (const value of [date, validStart, validEnd]) if (!isCalendarDate(value)) refuse('bad_date', 'usdm: bad date');
    if (validStart > validEnd) refuse('bad_date', `usdm ${row.fips}: validity ends before it starts`);
    const shares = Object.fromEntries(SHARES.map((key) => {
      const value = Number(row[key]);
      if (typeof row[key] !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) refuse('shape', `usdm ${row.fips}: bad ${key}`);
      return [key, value];
    }));
    const total = Object.values(shares).reduce((sum, value) => sum + value, 0);
    if (Math.abs(total - 100) > 0.5) refuse('shape', `usdm ${row.fips} ${date}: categories sum to ${total}`);
    const county = fips.get(row.fips);
    if (clean(row.county) !== county) refuse('shape', `usdm ${row.fips}: county name ${row.county} is not ${county}`);
    const id = `usdm-${row.fips}-${date}`;
    if (seen.has(id)) refuse('shape', `usdm: duplicate ${id}`);
    seen.add(id);
    releases.push({
      id, countyId: row.fips, date, ...shares,
      validStart, validEnd,
      status: `U.S. Drought Monitor map for ${date}, valid ${validStart} to ${validEnd}`,
      sourceUrl: USDM_MAP_URL,
      scope: `Share of ${county} area in each U.S. Drought Monitor category on the weekly map dated ${date} (categorical, not cumulative). A county area distribution, not a reading for one home or garden, and not a watering rule. Map produced by the National Drought Mitigation Center, USDA and NOAA.`,
    });
  }
  releases.sort((a, b) => a.countyId.localeCompare(b.countyId) || b.date.localeCompare(a.date));
  const perMap = new Map();
  for (const release of releases) perMap.set(release.date, (perMap.get(release.date) ?? 0) + 1);
  if (perMap.size > MAX_MAPS) refuse('incomplete', 'usdm: too many weekly maps');
  for (const [date, count] of perMap) if (count !== COUNTY_COUNT) refuse('incomplete', `usdm: the map for ${date} has ${count} counties, not 100`);
  const mapDates = [...perMap.keys()].sort();
  return { releases, mapDates, newestMapDate: mapDates.at(-1) };
}

// ---------------------------------------------------------------- utility

/**
 * The NC DWR conservation status table, as water.read's notices, by title.
 * Strict: six cells a row, a DWR PWSID, plain names, a known status, a real
 * update date, no repeated system; the row count within bounds, equal to the
 * page's own total, and each status count equal to the page's summary, which
 * must be present and add up to the total.
 */
export function parseConservationStatus(html) {
  if (typeof html !== 'string' || html.length === 0) refuse('shape', 'wudc: the body is not a page');
  const summary = Object.fromEntries([...html.matchAll(/class="status-([A-Z])">\s*<div[^>]*>(\d+)<\/div>\s*<div[^>]*>([A-Za-z ]+)<\/div>/g)].map((m) => [m[3].trim(), Number(m[2])]));
  const totalMatch = /<div style="font-size:24px;">(\d+)<\/div>\s*<div[^>]*>Total Systems<\/div>/.exec(html);
  if (!totalMatch) refuse('shape', 'wudc: no total');
  const total = Number(totalMatch[1]);
  const labels = Object.keys(summary);
  if (labels.length === 0 || !labels.every((label) => DWR_STATUSES.has(label))) refuse('shape', 'wudc: the status summary is missing or unknown');
  if (Object.values(summary).reduce((sum, value) => sum + value, 0) !== total) refuse('incomplete', 'wudc: the summary does not add up to the total');
  const notices = [];
  const seen = new Set();
  let newestUpdate = null;
  for (const [, body] of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => clean(decode(m[1].replace(/<[^>]+>/g, ''))));
    if (cells.length === 0) continue;
    if (cells.length !== 6) refuse('shape', 'wudc: a row without six cells');
    const [pwsid, system, county, status, reason, updated] = cells;
    if (!/^\d{2}-\d{2}-\d{3}$/.test(pwsid)) refuse('shape', `wudc: bad PWSID ${pwsid}`);
    if (!/^[A-Za-z0-9 .,'&()/-]{1,80}$/.test(system) || !/^[A-Za-z ]{2,30}$/.test(county)) refuse('shape', `wudc ${pwsid}: bad name`);
    if (!DWR_STATUSES.has(status)) refuse('shape', `wudc ${pwsid}: unknown status ${status}`);
    if (!/^(?:[A-Za-z /-]{1,40})?$/.test(reason)) refuse('shape', `wudc ${pwsid}: bad reason`);
    if (!isCalendarDate(updated)) refuse('bad_date', `wudc ${pwsid}: bad date`);
    const id = `ncdwr-${pwsid}`;
    if (seen.has(id)) refuse('shape', `wudc: duplicate ${pwsid}`);
    seen.add(id);
    if (!newestUpdate || updated > newestUpdate) newestUpdate = updated;
    notices.push({
      id, title: `${system} (${county} County)`, status, date: `Status last updated ${updated}`,
      instructions: 'The NC Division of Water Resources listing records this water system\'s conservation status only. Any restrictions, exemptions and dates are set out in the water system\'s own notice.',
      scope: `${system} public water system, PWSID ${pwsid}, as reported to the NC DEQ Division of Water Resources. Reason recorded: ${reason && reason !== 'N/A' ? reason : 'none given'}. It applies to that system's customers only, not to a county, a private well or a garden. Confirm your provider against a bill.`,
      sourceUrl: WUDC_URL,
    });
  }
  if (notices.length < MIN_SYSTEMS || notices.length > MAX_SYSTEMS) refuse('incomplete', `wudc: ${notices.length} rows is outside the expected range`);
  if (notices.length !== total) refuse('incomplete', `wudc: ${notices.length} rows but the page totals ${total}`);
  for (const [label, count] of Object.entries(summary)) {
    if (notices.filter((notice) => notice.status === label).length !== count) refuse('incomplete', `wudc: ${label} count differs from the summary`);
  }
  notices.sort((a, b) => a.title.localeCompare(b.title));
  return { notices, summary, total, newestUpdate };
}

// ---------------------------------------------------------------- revisions

/** JSON with every object's keys sorted, so equal content compares equal whatever the key order. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/**
 * Carries revisions forward from the rows of the previous copy: an unchanged
 * row keeps its revision, a changed one gets revision + 1 (and, when the row
 * has a `previous` line, one naming the superseded revision), a new one
 * starts at 1. `retrieved` is the new copy's YYYY-MM-DD.
 */
export function createReviser(existingRows, retrieved) {
  const before = new Map((Array.isArray(existingRows) ? existingRows : []).map((row) => [row.id, row]));
  // Keys are compared sorted: a copy read back from jsonb (0033) has its keys in Postgres's order,
  // not the order they were written in, and that is not a change.
  const strip = (row) => canonical(Object.fromEntries(Object.entries(row).filter(([key]) => !['revision', 'version', 'previous'].includes(key))));
  return (row, key = 'revision') => {
    const old = before.get(row.id);
    if (!old || !Number.isSafeInteger(old[key]) || old[key] < 1) return { ...row, [key]: 1, ...('previous' in row ? { previous: row.previous } : {}) };
    if (strip(old) === strip(row)) return { ...row, [key]: old[key], ...('previous' in row ? { previous: old.previous } : {}) };
    const next = old[key] + 1;
    return { ...row, [key]: next, ...('previous' in row ? { previous: `Revision ${old[key]} was superseded when HALO's copy was refreshed on ${retrieved}.` } : {}) };
  };
}
