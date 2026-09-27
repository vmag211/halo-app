/**
 * Builds and stores the map layers and district view (punch list v3 items 18,
 * 19; §13.10, §62.1).
 *
 * The daily job calls buildAndStoreAll(); /api/map and /api/district read the
 * stored result (map_layers, migration 0011), so a slow government service can
 * never slow or break the map. If a stored layer is missing or stale, the route
 * builds it live and stores it. A layer whose source fails keeps its previous
 * stored copy rather than being replaced with an empty one.
 */
import { assembleWaterFeatures, waterCounts, quartersIn, contaminantsInQuarter } from './mapData.js';
import { getWaterGeo, withGeo, POPULATION_SOURCE } from './waterGeo.js';
import { fetchFacilities, fetchAirStations } from './mapLayers.js';
import { buildDistrictView } from './districtView.js';
import { ncRadonZones } from './radonData.js';
import { radonZoneSeverity } from './severity.js';

export const LAYERS = ['water', 'radon', 'facilities', 'air', 'district'];
// A stored layer older than this is rebuilt on request.
const MAX_AGE_MS = 36 * 60 * 60 * 1000;

export async function loadUtilities(db) {
  const { data, error } = await db.from('ucmr5_utilities').select('pwsid, pws_name, status, contaminants').limit(2000);
  if (error) throw new Error(error.message);
  return data || [];
}

/** The water layer (optionally one quarter of it), with geometry joined. */
export function waterPayload(utilities, geoMap, { quarter = null } = {}) {
  const source = quarter
    ? utilities
        .map((u) => ({ ...u, contaminants: contaminantsInQuarter(u.contaminants, quarter) }))
        .filter((u) => Object.keys(u.contaminants).length > 0)
    : utilities;
  const features = withGeo(assembleWaterFeatures(source), geoMap);
  const located = features.filter((f) => f.lat !== null && f.lng !== null).length;
  return {
    layer: 'water',
    quarter,
    quarters: quartersIn(utilities),
    count: features.length,
    located,
    counts: waterCounts(features),
    features,
    population_source: POPULATION_SOURCE,
    assembled_at: new Date().toISOString(),
    note:
      located === features.length
        ? 'Every system has a service-area centroid and, where reported, population served.'
        : `${features.length - located} of ${features.length} systems have no mapped service area; they carry severity but no coordinates.`,
  };
}

export function radonPayload() {
  const features = Object.entries(ncRadonZones).map(([county, zone]) => ({ county, zone, severity: radonZoneSeverity(zone) }));
  return { layer: 'radon', count: features.length, features, assembled_at: new Date().toISOString() };
}

export async function facilitiesPayload(opts = {}) {
  const features = await fetchFacilities(opts);
  return {
    layer: 'facilities',
    scope: 'NC-08',
    selection: 'Active major facilities and repeat violators (more than 4 of the last 12 quarters in noncompliance), from EPA ECHO.',
    count: features.length,
    features,
    assembled_at: new Date().toISOString(),
  };
}

export async function airPayload(opts = {}) {
  const features = await fetchAirStations(opts);
  return { layer: 'air', count: features.length, features, source: 'AirNow monitoring sites', assembled_at: new Date().toISOString() };
}

export function districtPayload(utilities, geoMap) {
  return { ...buildDistrictView({ utilities, geo: geoMap, radonZones: ncRadonZones }), assembled_at: new Date().toISOString() };
}

export async function storeLayer(db, layer, payload) {
  const { error } = await db
    .from('map_layers')
    .upsert({ layer, payload, assembled_at: payload.assembled_at || new Date().toISOString() }, { onConflict: 'layer' });
  if (error) throw new Error(error.message);
}

/** The stored layer if present and fresh; null otherwise (or if the table is missing). */
export async function readLayer(db, layer, { maxAgeMs = MAX_AGE_MS } = {}) {
  const { data, error } = await db.from('map_layers').select('payload, assembled_at').eq('layer', layer).maybeSingle();
  if (error || !data) return null;
  if (Date.now() - Date.parse(data.assembled_at) > maxAgeMs) return null;
  return data.payload;
}

/**
 * Build one layer live. Water and district need the geography (cached); the
 * others fetch their own sources.
 */
export async function buildLayer(db, layer, opts = {}) {
  if (layer === 'radon') return radonPayload();
  if (layer === 'facilities') return facilitiesPayload(opts);
  if (layer === 'air') return airPayload(opts);
  const utilities = await loadUtilities(db);
  const g = await getWaterGeo(utilities.map((u) => u.pwsid));
  return layer === 'water' ? waterPayload(utilities, g.geo) : districtPayload(utilities, g.geo);
}

/**
 * The daily job's pre-build: every layer, stored. The two external layers are
 * fetched in parallel with the geography; each failure is reported, and that
 * layer keeps its previous stored copy.
 * @param {Promise<Map>} geoPromise  the geography the job is already refreshing
 */
export async function buildAndStoreAll(db, geoPromise, opts = {}) {
  const report = {};
  const store = async (layer, payload) => {
    try {
      await storeLayer(db, layer, payload);
      report[layer] = { ok: true, count: payload.count ?? payload.total_systems ?? null };
    } catch (err) {
      report[layer] = { ok: false, error: err.message };
    }
  };
  const external = Promise.all([
    facilitiesPayload(opts).then((p) => store('facilities', p), (err) => (report.facilities = { ok: false, error: err.message })),
    airPayload(opts).then((p) => store('air', p), (err) => (report.air = { ok: false, error: err.message })),
  ]);
  try {
    const [utilities, geoMap] = await Promise.all([loadUtilities(db), geoPromise]);
    await store('water', waterPayload(utilities, geoMap));
    await store('district', districtPayload(utilities, geoMap));
  } catch (err) {
    report.water = report.water || { ok: false, error: err.message };
    report.district = report.district || { ok: false, error: err.message };
  }
  await store('radon', radonPayload());
  await external;
  return report;
}
