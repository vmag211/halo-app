/**
 * Operator source operations (B13, docs/backend/plans/b13-source-operations.md):
 * the server-side role, the registry of the sources HALO already ingests, and
 * the snapshot the /operations screen reads (`sourceOps.read`,
 * lib/frontend/production/source-operations-service.ts, validSourceOpsSnapshot).
 *
 * WHO. A role comes only from public.operator_roles (0027), looked up by the
 * verified session's user id. Nothing a request carries can name a role, and no
 * route writes that table: roles are granted in the SQL editor. An account with
 * no row is 'denied', and so is an anonymous-auth account whatever its row says
 * (proposed, Vibhav to confirm).
 *
 * WHAT. A source is something HALO already retrieves or bundles. Its freshness
 * is read from what is stored (the newest daily_scores row from that provider,
 * the daily maxima recorder's last run, the shared water-geography cache, the
 * UCMR load, the bundled files' headers, the weekly public water import's
 * runs of 0033) and never invented: a source with no
 * stored record is left out of the page rather than given a status. Only
 * timestamps and counts are read out of household tables; no household id or
 * value is selected for the answer.
 *
 * DECISIONS. Nothing here can approve, quarantine, publish, withdraw,
 * translate, retry or roll back anything: this backend has no release
 * registry, candidate, publication pointer, translation or scoped retry job.
 * So every source's `allowedDecisions` is empty, and the command route refuses
 * whatever is sent, through the ledger and the append-only audit.
 */
import { apiError, ERROR_CODES } from '@/lib/apiErrors';
import { listUnresolvedOperations } from '@/lib/operations';
import { waterGeoRefreshedAt, ARCGIS_WATER_BOUNDARIES } from '@/lib/waterGeo';
import places from './data/ncPlaces.json' with { type: 'json' };
import counties from './data/ncCounties.json' with { type: 'json' };
import district from './data/nc08District.json' with { type: 'json' };
import lead from './data/leadInventoryNC.json' with { type: 'json' };
import water from './data/ncWaterStewardship.json' with { type: 'json' };
import { RUN_TABLE, SNAPSHOT_TABLE } from '@/lib/publicWaterStore';
import { DROUGHT_SOURCE_ID, UTILITY_SOURCE_ID, USDM_STATISTICS_ENDPOINT, WUDC_URL } from '@/lib/publicWaterSources';

/** The ledger domain the screen reconciles in (ProductionSourceOperations.tsx:29). */
export const SOURCE_OPS_DOMAIN = 'source-operations';

/** Roles 0027 can store. 'denied' is the absence of one. */
export const OPERATOR_ROLES = Object.freeze(['viewer', 'reviewer', 'publisher']);

/** Roles that may send a decision at all, and the decisions only a publisher may send (service.ts:31). */
export const DECIDING_ROLES = Object.freeze(['reviewer', 'publisher']);
export const PUBLISHER_DECISIONS = Object.freeze(['publish', 'withdraw', 'rollback', 'publish-translation']);

/** The client's decision set (source-operations-service.ts:2). */
export const SOURCE_DECISIONS = Object.freeze(['approve', 'quarantine', 'publish', 'withdraw', 'translation', 'retry', 'rollback', 'publish-translation']);

/** Audit entries per page, in the snapshot and in each history page. */
export const AUDIT_PAGE = 20;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A live feed is current while its newest stored record is younger than this (proposed). */
export const FEED_CURRENT_MS = 36 * HOUR;
/** A bundled or loaded reference dataset is current for this long after retrieval (proposed). */
export const REFERENCE_CURRENT_DAYS = 365;

/** "Not there yet": the table is missing (PostgREST, then Postgres). */
const MISSING = new Set(['PGRST205', '42P01']);

/** True when the error says 0027 is not applied (or another table a read needs is missing). */
export function isSourceOpsUnavailable(error) {
  return !!error && MISSING.has(error.code);
}

/** The 503 every operator route answers until 0027 is applied. Not retryable. */
export function sourceOpsUnavailable(requestId) {
  return apiError({
    status: 503,
    code: ERROR_CODES.FEATURE_UNAVAILABLE,
    message: 'Source operations are not available yet. Nothing was changed.',
    retryable: false,
    requestId,
  });
}

/** The 403 for a caller whose verified role cannot do this. The screen clears itself on it. */
export function operatorForbidden(requestId) {
  return apiError({
    status: 403,
    code: ERROR_CODES.FORBIDDEN,
    message: 'Source operations require a verified operator role.',
    retryable: false,
    requestId,
  });
}

/**
 * The caller's verified role: 'denied', 'viewer', 'reviewer' or 'publisher'.
 * An anonymous-auth account is denied without a lookup. A missing table is
 * thrown, so the route answers 503 rather than guessing.
 */
export async function operatorRole(db, { userId, isAnonymous }) {
  if (isAnonymous || !userId) return 'denied';
  const { data, error } = await db.from('operator_roles').select('role').eq('profile_id', userId).maybeSingle();
  if (error) throw error;
  return OPERATOR_ROLES.includes(data?.role) ? data.role : 'denied';
}

/** The answer for a caller with no role: no source, no count, no cursor (service.ts:28). */
export function deniedSnapshot() {
  return { role: 'denied', revision: 1, sources: [], unresolvedOperations: [], nextCursor: null };
}

// ---------------------------------------------------------------- text

const EM_DASH = /\u2014/g;
/** Header text from a bundled file, with U+2014 replaced (the client rejects it, AGENTS.md). */
const plain = (value) => String(value ?? '').replace(EM_DASH, ',').replace(/\s+,/g, ',');

/** A stored instant as ISO, or null; a zone-less timestamp is UTC (lib/sources.js). */
function iso(value) {
  if (!value) return null;
  const s = String(value);
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) || /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const plusDays = (isoValue, days) => new Date(Date.parse(isoValue) + days * DAY).toISOString().slice(0, 10);

const NOT_RECORDED = 'Not recorded in HALO. Confirm the provider\'s terms before release.';
const NOT_SCHEDULED = 'Not scheduled';
const NO_REVIEW = 'No recorded review';

// ---------------------------------------------------------------- evidence

/** The newest daily_scores instant matching `filter`, or null. Selects created_at only. */
async function newestReading(db, filter) {
  const { data, error } = await filter(db.from('daily_scores').select('created_at'))
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) {
    if (MISSING.has(error.code)) return null;
    throw error;
  }
  return iso(data?.[0]?.created_at);
}

/** The newest of the last 50 non-null pollen rows that holds a number (lib/sources.js hasPollen). */
async function newestPollen(db) {
  const { data, error } = await db
    .from('daily_scores')
    .select('created_at, pollen_level')
    .not('pollen_level', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    if (MISSING.has(error.code)) return null;
    throw error;
  }
  for (const row of data ?? []) {
    try {
      const p = JSON.parse(row.pollen_level || '{}');
      if ([p?.tree, p?.grass, p?.weed].some((v) => typeof v === 'number')) return iso(row.created_at);
    } catch {
      /* an unparseable row is not a pollen reading */
    }
  }
  return null;
}

/** The daily maxima recorder's last finished run (0025), or null before it exists or first runs. */
async function recorderRun(db) {
  const { data, error } = await db.from('daily_maxima_recorder').select('last_run_at, last_run').maybeSingle();
  if (error) {
    if (MISSING.has(error.code)) return null;
    throw error;
  }
  const at = iso(data?.last_run_at);
  if (!at) return null;
  const counts = {};
  const raw = data.last_run && typeof data.last_run === 'object' && !Array.isArray(data.last_run) ? data.last_run : {};
  // 0025 holds the run's counts only; anything else is ignored rather than echoed.
  for (const [key, value] of Object.entries(raw)) {
    if (/^[A-Za-z]{1,40}$/.test(key) && Number.isSafeInteger(value) && value >= 0) counts[key] = value;
  }
  return { at, counts };
}

/** The newest UCMR load and how many utilities it holds, or null when nothing is loaded. */
async function ucmrLoad(db) {
  const { data, error, count } = await db
    .from('ucmr5_utilities')
    .select('created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) {
    if (MISSING.has(error.code)) return null;
    throw error;
  }
  const at = iso(data?.[0]?.created_at);
  return at ? { at, count: Number.isSafeInteger(count) ? count : 0 } : null;
}

/**
 * The weekly public water import's newest run of one source and its newest
 * stored copy (0033, B19), or null before 0033 or before the first run.
 * Selects times, outcomes, reason codes and counts only, never a body.
 */
async function waterImport(db, source) {
  const runs = await db.from(RUN_TABLE).select('ran_at, outcome, reason, row_count').eq('source', source).order('id', { ascending: false }).limit(1);
  if (runs.error) {
    if (MISSING.has(runs.error.code)) return null;
    throw runs.error;
  }
  const run = runs.data?.[0];
  const ranAt = iso(run?.ran_at);
  if (!ranAt) return null;
  const copies = await db.from(SNAPSHOT_TABLE).select('retrieved_at, source_date, row_count').eq('source', source).order('id', { ascending: false }).limit(1);
  if (copies.error) {
    if (MISSING.has(copies.error.code)) return null;
    throw copies.error;
  }
  const copy = copies.data?.[0];
  const reason = typeof run.reason === 'string' && /^[a-z0-9_]{1,40}$/.test(run.reason) ? run.reason : null;
  return {
    ranAt,
    failed: run.outcome !== 'stored',
    reason,
    rows: Number.isSafeInteger(run.row_count) ? run.row_count : null,
    copy: copy && iso(copy.retrieved_at) ? { at: iso(copy.retrieved_at), sourceDate: String(copy.source_date ?? '').slice(0, 10), rows: copy.row_count } : null,
  };
}

/** A water.read source the weekly import refreshes, listed once the import has run. */
function waterImportSource({ id, name, organization, url, coverage, bundled, parser }) {
  return {
    id,
    name,
    organization,
    url,
    terms: plain(water.source?.licence),
    method: `Weekly import (GET /api/cron/public-evidence, lib/publicWaterImport.js); served by water.read, the bundled copy until a copy is stored`,
    cadence: 'Weekly, Thursdays 18:00 UTC, while HALO_FEATURE_PUBLIC_IMPORT is on',
    coverage,
    kind: 'feed',
    // A weekly source is current until its next run is a day late (proposed, Vibhav to confirm).
    currentMs: 8 * DAY,
    read: async (db) => {
      const last = await waterImport(db, id);
      if (!last) return null;
      // The last good retrieval: the newest stored copy, else the bundled file's own date.
      const success = last.copy?.at ?? iso(bundled?.retrieved);
      if (!success) return null;
      const copyText = last.copy
        ? `Newest stored copy retrieved ${last.copy.at}, source date ${last.copy.sourceDate}, ${last.copy.rows} rows.`
        : `No copy stored yet; water.read serves the bundled copy retrieved ${String(bundled?.retrieved)}.`;
      const runText = last.failed
        ? `Last run ${last.ranAt} stored nothing (${last.reason ?? 'no reason recorded'}); the previous copy is kept.`
        : `Last run ${last.ranAt} stored ${last.rows ?? 0} rows.`;
      return {
        lastSuccess: success,
        state: last.failed ? 'failed' : 'complete',
        run: feedRun(`${RUN_TABLE}:${id}`, parser, `${runText} ${copyText} Only counts and a reason code are recorded for a run.`),
      };
    },
  };
}

// ---------------------------------------------------------------- registry

const feedRun = (requestKey, parser, diagnostic) => ({ requestKey, parser, diagnostic });

const FEED_NOTE =
  'Readings are used as fetched; there is no reviewed publication step. Rejected rows and attempts are not counted for this source, so 0 rejected means none were counted, not that none were dropped. Link state is the latest stored record, not a separate check of the page.';

/**
 * Each source: its fixed description and how its evidence is read. `read`
 * returns null (not listed) or { lastSuccess, run, versions?, current? }.
 */
export const SOURCE_REGISTRY = Object.freeze([
  {
    id: 'airnow-current',
    name: 'AirNow current observations',
    organization: 'U.S. EPA AirNow program',
    url: 'https://www.airnow.gov/',
    method: 'Fetched per household point by the daily job and when Today loads (lib/dailyReadings.js)',
    cadence: 'Daily job at 11:00 UTC, and when a household opens Today',
    coverage: 'Monitors within 25 miles of each onboarded household point',
    kind: 'feed',
    read: async (db) => {
      const at = await newestReading(db, (q) => q.eq('aqi_source', 'airnow'));
      return at && { lastSuccess: at, run: feedRun('daily_scores:aqi_source=airnow', 'parseAirNow (lib/dailyReadings.js)', `Newest stored AirNow reading ${at}. ${FEED_NOTE}`) };
    },
  },
  {
    id: 'open-meteo-air',
    name: 'Open-Meteo modeled air quality',
    organization: 'Open-Meteo',
    url: 'https://open-meteo.com/en/docs/air-quality-api',
    method: 'Fetched when no AirNow monitor answers for the point (lib/dailyReadings.js)',
    cadence: 'Daily job at 11:00 UTC, and when a household opens Today',
    coverage: 'Each onboarded household point without a nearby monitor (modeled, not measured)',
    kind: 'feed',
    read: async (db) => {
      const at = await newestReading(db, (q) => q.eq('aqi_source', 'open-meteo'));
      return at && { lastSuccess: at, run: feedRun('daily_scores:aqi_source=open-meteo', 'parseOpenMeteoAir (lib/dailyReadings.js)', `Newest stored modeled air reading ${at}. ${FEED_NOTE}`) };
    },
  },
  {
    id: 'uv-index',
    name: 'UV index (Open-Meteo, OpenUV fallback)',
    organization: 'Open-Meteo; OpenUV',
    url: 'https://open-meteo.com/en/docs',
    method: 'Open-Meteo first, OpenUV only within its daily call budget (lib/dailyReadings.js)',
    cadence: 'Daily job at 11:00 UTC, and when a household opens Today',
    coverage: 'Each onboarded household point',
    kind: 'feed',
    read: async (db) => {
      const at = await newestReading(db, (q) => q.not('uv_index', 'is', null));
      return at && { lastSuccess: at, run: feedRun('daily_scores:uv_index', 'lib/dailyReadings.js', `Newest stored UV reading ${at}. A stored reading does not record which of the two providers answered. ${FEED_NOTE}`) };
    },
  },
  {
    id: 'nws-hourly',
    name: 'National Weather Service hourly forecast',
    organization: 'NOAA National Weather Service',
    url: 'https://www.weather.gov/documentation/services-web-api',
    method: 'Humidity and rain chance for the mold estimate (lib/dailyReadings.js moldFromNws)',
    cadence: 'Daily job at 11:00 UTC, and when a household opens Today',
    coverage: 'Each onboarded household point',
    kind: 'feed',
    read: async (db) => {
      const at = await newestReading(db, (q) => q.not('mold_risk', 'is', null));
      return at && { lastSuccess: at, run: feedRun('daily_scores:mold_risk', 'moldFromNws (lib/dailyReadings.js)', `Newest stored mold estimate ${at}. ${FEED_NOTE}`) };
    },
  },
  {
    id: 'google-pollen',
    name: 'Google Pollen',
    organization: 'Google',
    url: 'https://developers.google.com/maps/documentation/pollen',
    method: 'Tree, grass and weed index per household point (lib/dailyReadings.js parsePollen)',
    cadence: 'Daily job at 11:00 UTC, and when a household opens Today',
    coverage: 'Each onboarded household point',
    kind: 'feed',
    read: async (db) => {
      const at = await newestPollen(db);
      return at && { lastSuccess: at, run: feedRun('daily_scores:pollen_level', 'parsePollen (lib/dailyReadings.js)', `Newest stored pollen reading with a value ${at}, among the last 50 stored. ${FEED_NOTE}`) };
    },
  },
  {
    id: 'daily-maxima',
    name: 'Daily maxima recorder (AirNow and Open-Meteo hourly)',
    organization: 'U.S. EPA AirNow program; Open-Meteo',
    url: 'https://docs.airnowapi.org/',
    method: 'Each completed day\'s hourly series, largest value per home (lib/dailyMaximaRecorder.js)',
    cadence: 'Daily job (GET /api/cron/daily-maxima)',
    coverage: 'Each current home context inside North Carolina',
    kind: 'feed',
    read: async (db) => {
      const run = await recorderRun(db);
      if (!run) return null;
      const listed = Object.entries(run.counts).map(([key, value]) => `${key} ${value}`).join(', ');
      return {
        lastSuccess: run.at,
        rejected: run.counts.refused ?? 0,
        run: feedRun('daily_maxima_recorder:last_run', 'airNowDailyMaxima, openMeteoDailyMaxima (lib/dailyMaxima.js)', `Last finished run ${run.at}. Counts: ${listed || 'none recorded'}. Rejected is the run's refused rows. Attempts are not counted. Link state is the latest stored record, not a separate check of the page.`),
      };
    },
  },
  {
    id: 'arcgis-water-boundaries',
    name: 'EPA water system service area boundaries',
    organization: 'U.S. EPA (ArcGIS Online)',
    url: ARCGIS_WATER_BOUNDARIES,
    method: 'Map points and population served for each utility, cached for every server (lib/waterGeo.js)',
    cadence: 'Refreshed by the daily job (GET /api/cron/daily)',
    coverage: 'North Carolina public water systems in the UCMR 5 load',
    kind: 'feed',
    read: async () => {
      const at = iso(await waterGeoRefreshedAt());
      return at && { lastSuccess: at, run: feedRun('water-geo-cache', 'parseGeoResponse (lib/waterGeo.js)', `Shared geography cache refreshed ${at} (this server's own copy when the shared cache cannot be reached). Only a lookup with no failed batch is cached. Rejected rows and attempts are not counted.`) };
    },
  },
  {
    id: 'epa-ucmr5',
    name: 'EPA UCMR 5 drinking water results',
    organization: 'U.S. EPA',
    url: 'https://www.epa.gov/dwucmr/occurrence-data-unregulated-contaminant-monitoring-rule',
    method: 'Loaded by hand with uploadData.js from the EPA occurrence file',
    cadence: 'Loaded by hand; no schedule',
    coverage: 'North Carolina public water systems in UCMR 5',
    kind: 'reference',
    read: async (db) => {
      const load = await ucmrLoad(db);
      if (!load) return null;
      const id = `epa-ucmr5@${load.at.slice(0, 10)}`;
      return {
        lastSuccess: load.at,
        retrieved: load.at,
        run: feedRun('ucmr5_utilities:newest', 'uploadData.js', `Newest load ${load.at}, ${load.count} utilities. Loads made before October 25, 2026 keep only results reported with an equals sign, so their non-detects are not stored. Later loads also keep non-detects with their reporting limits.`),
        versions: [version({ id, count: load.count, geography: 'North Carolina', units: 'Parts per trillion, as converted by the import', observed: 'UCMR 5 collection dates, per result', retrieved: load.at, parser: 'uploadData.js', content: `${load.count} utilities`, requiredFields: 'Not checked by HALO', evidence: 'partial' })],
      };
    },
  },
  waterImportSource({
    id: DROUGHT_SOURCE_ID,
    name: 'U.S. Drought Monitor county statistics',
    organization: 'National Drought Mitigation Center (University of Nebraska-Lincoln), USDA and NOAA',
    url: USDM_STATISTICS_ENDPOINT,
    coverage: 'All 100 North Carolina counties, the last four or five weekly maps',
    bundled: water.source?.drought?.input,
    parser: 'parseDroughtStatistics (lib/publicWaterSources.js)',
  }),
  waterImportSource({
    id: UTILITY_SOURCE_ID,
    name: 'NC DWR water system conservation status',
    organization: 'North Carolina Department of Environmental Quality, Division of Water Resources',
    url: WUDC_URL,
    coverage: 'North Carolina public water systems listed by the Division of Water Resources',
    bundled: water.source?.utility?.input,
    parser: 'parseConservationStatus (lib/publicWaterSources.js)',
  }),
  referenceFile({
    id: 'census-places',
    name: 'Census places and ZIP code areas',
    organization: 'U.S. Census Bureau',
    url: places.files?.[0]?.url,
    header: places,
    terms: places.licence,
    method: 'Bundled file built by scripts/build-nc-places.mjs',
    coverage: 'North Carolina places and ZIP Code Tabulation Areas',
    count: (places.places?.length ?? 0) + (places.zctas?.length ?? 0),
    units: 'Not applicable',
    observed: places.vintage,
    parser: 'scripts/build-nc-places.mjs',
    content: (places.files ?? []).map((file) => `sha256 ${file.sha256}`).join('; '),
  }),
  referenceFile({
    id: 'census-counties',
    name: 'Census county boundaries',
    organization: 'U.S. Census Bureau',
    url: 'https://tigerweb.geo.census.gov/',
    header: counties,
    method: 'Bundled file (lib/data/ncCounties.json)',
    coverage: 'North Carolina counties',
    count: counties.counties?.length ?? 0,
    units: 'Not applicable',
    observed: 'Not recorded',
    parser: 'Bundled by hand',
    content: plain(counties.source),
  }),
  referenceFile({
    id: 'census-nc08',
    name: 'Census congressional district 8 boundary',
    organization: 'U.S. Census Bureau',
    url: 'https://tigerweb.geo.census.gov/',
    header: district,
    method: 'Bundled file (lib/data/nc08District.json)',
    coverage: 'North Carolina congressional district 8',
    count: district.nc08 ? 1 : 0,
    units: 'Not applicable',
    observed: 'Not recorded',
    parser: 'Bundled by hand',
    content: plain(district.source),
  }),
  referenceFile({
    id: 'ncdeq-lead-inventory',
    name: 'NC DEQ lead service line inventory',
    organization: 'North Carolina Department of Environmental Quality',
    url: lead.source_url,
    header: lead,
    method: 'Bundled file (lib/data/leadInventoryNC.json)',
    coverage: 'North Carolina public water systems that reported',
    count: Object.keys(lead.systems ?? {}).length,
    units: 'Service line counts',
    observed: 'Per-utility report dates',
    parser: 'Bundled by hand',
    content: plain(lead.source),
  }),
]);

/** One retained version as the client's SourceRevision (service.ts:18). */
function version({ id, count, geography, units, observed, retrieved, parser, content, requiredFields, evidence }) {
  return {
    id,
    count,
    geography,
    units,
    observed: plain(observed),
    published: 'Not recorded',
    retrieved,
    parser,
    content: plain(content) || 'Not recorded',
    requiredFields,
    evidence,
    failures: [],
    status: 'published',
    reviewer: NO_REVIEW,
    translation: 'not-requested',
  };
}

/** A bundled reference file: its header is the record (retrieved date, counts). */
function referenceFile({ id, name, organization, url, header, terms, method, coverage, count, units, observed, parser, content }) {
  return {
    id,
    name,
    organization,
    url,
    terms: terms ? plain(terms) : null,
    method,
    cadence: 'Rebuilt by hand; no schedule',
    coverage,
    kind: 'reference',
    read: async () => {
      const at = iso(header?.retrieved);
      if (!at) return null;
      return {
        lastSuccess: at,
        retrieved: at,
        run: feedRun(`lib/data:${id}`, parser, `${plain(header.source)}. Retrieved ${at.slice(0, 10)}. Rejected rows and attempts are not counted for a bundled file.`),
        versions: [version({ id: `${id}@${at.slice(0, 10)}`, count, geography: 'North Carolina', units, observed, retrieved: at, parser, content, requiredFields: 'Not checked by HALO', evidence: 'measured' })],
      };
    },
  };
}

export const SOURCE_IDS = Object.freeze(SOURCE_REGISTRY.map((source) => source.id));

// ---------------------------------------------------------------- audit and revisions

const AUDIT_COLUMNS = 'id, operation_id, role, source_id, source_revision, target, decision, reason, recorded_at';

/** An applied audit row as the client's SourceOpsAudit (service.ts:19); its revision is the one it produced. */
function auditEntry(row) {
  return {
    requestId: row.operation_id,
    decision: row.decision,
    target: row.target,
    reason: plain(row.reason),
    role: row.role,
    revision: row.source_revision + 1,
    recordedAt: iso(row.recorded_at),
  };
}

/** The keyset cursor after an audit page: the last entry's id. */
export const auditCursor = (rows) => (rows.length ? `a${rows.at(-1).id}` : null);

/** The id an audit cursor names, or null when it is not one this backend issued. */
export function parseAuditCursor(value) {
  if (typeof value !== 'string' || !/^a[1-9]\d{0,15}$/.test(value)) return null;
  const id = Number(value.slice(1));
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * One source's applied audit page (newest first, after `beforeId` when given)
 * and the number of applied entries, which sets its revision. Refusals are
 * audited but never listed: they are not decisions.
 */
export async function auditPage(db, sourceId, { beforeId = null } = {}) {
  const applied = () => db.from('source_ops_audit');
  let query = applied().select(AUDIT_COLUMNS, { count: 'exact' }).eq('source_id', sourceId).eq('outcome', 'applied');
  if (beforeId !== null) query = query.lt('id', beforeId);
  const [page, total] = await Promise.all([
    query.order('id', { ascending: false }).limit(AUDIT_PAGE + 1),
    // A later page's count covers only the entries before its cursor, so the
    // revision is counted on its own over every applied entry.
    beforeId === null
      ? null
      : applied().select('id', { count: 'exact', head: true }).eq('source_id', sourceId).eq('outcome', 'applied'),
  ]);
  if (page.error) throw page.error;
  if (total?.error) throw total.error;
  const count = total ? total.count : page.count;
  const rows = (page.data ?? []).slice(0, AUDIT_PAGE);
  return {
    entries: rows.map(auditEntry),
    nextCursor: (page.data ?? []).length > AUDIT_PAGE ? auditCursor(rows) : null,
    count: Number.isSafeInteger(count) ? count : 0,
  };
}

/** Applied entries for one source and in all: its revision is 1 plus the first, the registry's 1 plus the second. */
export async function revisions(db, sourceId = null) {
  const count = async (filter) => {
    const { error, count: n } = await filter(db.from('source_ops_audit').select('id', { count: 'exact', head: true }).eq('outcome', 'applied'));
    if (error) throw error;
    return Number.isSafeInteger(n) ? n : 0;
  };
  const [all, own] = await Promise.all([count((q) => q), sourceId ? count((q) => q.eq('source_id', sourceId)) : Promise.resolve(0)]);
  return { registry: 1 + all, source: 1 + own };
}

// ---------------------------------------------------------------- snapshot

/** One registered source with its evidence, as the client's SourceOpsSource (service.ts:20-27). */
function sourceRecord(definition, evidence, audit, now) {
  const age = now - Date.parse(evidence.lastSuccess);
  const reference = definition.kind === 'reference';
  const freshness = reference ? (age <= REFERENCE_CURRENT_DAYS * DAY ? 'current' : 'stale') : age <= (definition.currentMs ?? FEED_CURRENT_MS) ? 'current' : 'stale';
  const versions = evidence.versions ?? [];
  return {
    id: definition.id,
    name: definition.name,
    owner: 'Not assigned',
    organization: definition.organization,
    url: definition.url,
    terms: definition.terms ?? NOT_RECORDED,
    method: definition.method,
    cadence: definition.cadence,
    lastSuccess: evidence.lastSuccess,
    nextReview: reference ? plusDays(evidence.retrieved, REFERENCE_CURRENT_DAYS) : NOT_SCHEDULED,
    freshness,
    // The latest stored record is a successful retrieval; HALO does not probe the page.
    link: 'available',
    coverage: definition.coverage,
    revision: 1 + audit.count,
    publishedId: versions[0]?.id ?? null,
    candidateId: null,
    versions,
    run: {
      id: `${definition.id}:${evidence.lastSuccess}`,
      state: evidence.state ?? 'complete',
      parser: evidence.run.parser,
      rejected: evidence.rejected ?? 0,
      diagnostic: evidence.run.diagnostic,
      requestKey: evidence.run.requestKey,
      attempts: 1,
    },
    audit: audit.entries,
    allowedDecisions: [],
    publishedTranslations: [],
    versionsCursor: null,
    auditCursor: audit.nextCursor,
  };
}

/**
 * The snapshot for a caller whose verified role is viewer, reviewer or
 * publisher: every registered source with a stored record, the registry
 * revision, and the caller's own unsettled source-operations ledger entries.
 */
export async function sourceOpsSnapshot(db, { role, profileId, now = Date.now() }) {
  const listed = await Promise.all(
    SOURCE_REGISTRY.map(async (definition) => {
      const [evidence, audit] = await Promise.all([definition.read(db), auditPage(db, definition.id)]);
      return { definition, evidence, audit };
    }),
  );
  const applied = listed.reduce((sum, row) => sum + row.audit.count, 0);
  const unresolvedOperations = await listUnresolvedOperations(db, { profileId, domains: [SOURCE_OPS_DOMAIN] });
  return {
    role,
    revision: 1 + applied,
    sources: listed.filter((row) => row.evidence).map((row) => sourceRecord(row.definition, row.evidence, row.audit, now)),
    unresolvedOperations,
    nextCursor: null,
  };
}
