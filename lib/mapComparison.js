/**
 * The public records `GET /api/map/comparison` answers with (operation
 * `map.comparison`, B05 ruling D3). Pure.
 *
 * Honestly degraded by rule. The client calls two records "Aligned evidence"
 * only when both name the same analytical method and source version, every
 * value is a `reported` exact measurement and coverage is `complete`
 * (F: lib/frontend/map-comparison-preview.ts:77-96). HALO holds none of that
 * provenance: the stored readings keep a value and a date, nothing more
 * (lib/mapData.js:143-151). So every record carries, fixed and never derived:
 *
 *   method: null, sourceVersion: null, qualifier: 'unknown',
 *   coverage: 'partial', status: 'available'
 *
 * and every pair renders "Not comparable" with its reasons. Nothing here may
 * fill those fields from a timestamp, a hash or HALO's own formula; the only
 * route to an aligned comparison is acquiring the provenance (HO-074), not
 * code. For the same reason there is no hazard-index entry: the index is
 * HALO's arithmetic over the latest samples, not a reported result.
 *
 * `denominator` is the one basis that is truly ours: the map keeps one latest
 * scored result per compound and system (lib/mapData.js:134-137).
 *
 * Every string a person reads is the frontend's own copy
 * (F: lib/frontend/copy/map-comparison.ts:55-63), so `scope` is the literal
 * 'Public water system' the comparison sheet keys its compound selector on
 * (F: components/map-preview/MapComparison.tsx:36, finding F2).
 */

/** The copy these records use, verbatim from F: lib/frontend/copy/map-comparison.ts:45,55-60,63. */
export const COMPARISON_COPY = Object.freeze({
  unknown: 'Not supplied',
  scopeWater: 'Public water system',
  scopeAir: 'Monitoring station',
  waterEvidence: 'Reported water result',
  airEvidence: 'Hourly monitor observation',
  waterCoverage: 'Detection-only release. Complete testing coverage is unknown.',
  airCoverage: 'One hourly observation. Continuous coverage is not supplied.',
  waterBasis: 'One reported result per compound and system, not an annual average.',
  airBasis: 'One station\u2019s reported AQI for its dominant pollutant and hour.',
  sourceWater: 'Water monitoring release',
  sourceAir: 'Air monitoring release',
});

export const WATER_BACKGROUND_URL = 'https://www.epa.gov/dwucmr';
export const AIR_BACKGROUND_URL = 'https://www.airnow.gov/';

/**
 * The regulated compounds, in the map's order, with the label the comparison
 * sheet looks values up by (F: lib/frontend/map-preview.ts:5,7: GenX is the
 * label of HFPO-DA).
 */
export const WATER_ANALYTES = Object.freeze([
  ['PFOA', 'PFOA'],
  ['PFOS', 'PFOS'],
  ['PFHxS', 'PFHxS'],
  ['PFNA', 'PFNA'],
  ['HFPO-DA', 'GenX'],
]);

/** The provenance every record carries, fixed by D3. Never computed. */
const RECORD_PROVENANCE = Object.freeze({ sourceVersion: null, sourceUrl: null, status: 'available', coverage: 'partial' });
const VALUE_PROVENANCE = Object.freeze({ method: null, qualifier: 'unknown' });

export const MAX_COMPARISON_IDS = 2000;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finiteOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const textOrNull = (value) => (typeof value === 'string' && value.trim() ? value : null);
/** The client's `key()` rule (F: lib/frontend/map-service.ts:18). */
export const comparisonKey = (value) =>
  typeof value === 'string' && value.trim() && value.length <= 200 && !/[\u0000-\u001f]/.test(value) ? value.trim() : null;

function waterRecord(feature) {
  const id = comparisonKey(feature.pwsid);
  if (!id) return null;
  const contaminants = isObject(feature.contaminants) ? feature.contaminants : {};
  return {
    id,
    name: textOrNull(feature.name) ?? id,
    kind: COMPARISON_COPY.waterEvidence,
    scope: COMPARISON_COPY.scopeWater,
    denominator: COMPARISON_COPY.waterBasis,
    sourceName: COMPARISON_COPY.sourceWater,
    backgroundUrl: WATER_BACKGROUND_URL,
    coverageLabel: COMPARISON_COPY.waterCoverage,
    ...RECORD_PROVENANCE,
    values: WATER_ANALYTES.map(([name, analyte]) => {
      const reading = isObject(contaminants[name]) ? contaminants[name] : {};
      const value = finiteOrNull(reading.value_ppt);
      const date = textOrNull(reading.date_iso);
      return {
        analyte,
        value,
        unit: 'ppt',
        observedAt: date,
        period: date,
        periodLabel: date ?? COMPARISON_COPY.unknown,
        ...VALUE_PROVENANCE,
      };
    }),
  };
}

function airRecord(feature) {
  const id = comparisonKey(feature.id);
  if (!id) return null;
  const readAt = textOrNull(feature.last_reading_at);
  return {
    id,
    name: textOrNull(feature.name) ?? id,
    kind: COMPARISON_COPY.airEvidence,
    scope: COMPARISON_COPY.scopeAir,
    denominator: COMPARISON_COPY.airBasis,
    sourceName: COMPARISON_COPY.sourceAir,
    backgroundUrl: AIR_BACKGROUND_URL,
    coverageLabel: COMPARISON_COPY.airCoverage,
    ...RECORD_PROVENANCE,
    values: [
      {
        // No pollutant named stays empty, so two such stations never match on analyte.
        analyte: textOrNull(feature.dominant_pollutant),
        value: finiteOrNull(feature.aqi),
        unit: 'AQI',
        observedAt: readAt,
        period: readAt,
        periodLabel: readAt ?? COMPARISON_COPY.unknown,
        ...VALUE_PROVENANCE,
      },
    ],
  };
}

/**
 * One comparison record per map feature of `layer`. Water features are the
 * map's (lib/mapData.js assembleWaterFeatures), air features AirNow stations
 * (lib/mapLayers.js parseAirNowStations). Facilities and radon supply no
 * comparable numeric observation (F: MapPreview.tsx:319), so they give [].
 * A feature without a usable id, or repeating one already seen, is skipped.
 *
 * @param {string} layer
 * @param {unknown[]} features
 * @returns {object[]}
 */
export function comparisonRecords(layer, features) {
  const build = layer === 'water' ? waterRecord : layer === 'air' ? airRecord : null;
  if (!build || !Array.isArray(features)) return [];
  const seen = new Set();
  const records = [];
  for (const feature of features) {
    if (!isObject(feature)) continue;
    const record = build(feature);
    if (!record || seen.has(record.id)) continue;
    seen.add(record.id);
    records.push(record);
  }
  return records;
}

/**
 * The `ids` parameter: one JSON array of 1 to 2,000 ids in a single query
 * value, as the client sends it (F: runtime.ts:125-129, MapPreview.tsx:316).
 * Each id must pass the client's own `key()` rule; it is kept trimmed, as the
 * client compares it.
 *
 * @param {string|null} raw
 * @returns {{ok: true, ids: Set<string>} | {ok: false, code: string, message: string}}
 */
export function parseComparisonIds(raw) {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: false, code: 'ids_required', message: 'ids is a JSON array of record ids.' };
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'invalid_json', message: 'ids is a JSON array of record ids.' };
  }
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, code: 'invalid_ids', message: 'ids is a JSON array of record ids.' };
  }
  if (value.length > MAX_COMPARISON_IDS) {
    return { ok: false, code: 'too_many_ids', message: `ids holds at most ${MAX_COMPARISON_IDS} record ids.` };
  }
  const ids = new Set();
  for (const item of value) {
    const id = comparisonKey(item);
    if (!id) return { ok: false, code: 'invalid_id', message: 'Each id is text of 1 to 200 characters with no control characters.' };
    ids.add(id);
  }
  return { ok: true, ids };
}
