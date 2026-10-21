/** Explicit review-only normalization. Never import this adapter into a live data client. */
import { airStations, compoundKey, compounds, quarterLabel, readingDate, type Compound, type MapLayer, type WaterFeature } from './map-preview';
import { mapComparisonCopy as c } from './copy/map-comparison';

export type ComparisonValue = {
  analyte: string; value: number | null; unit: string; observedAt: string | null;
  period: string | null; periodLabel: string; method: string | null;
  qualifier: 'reported' | 'estimated' | 'non-detect' | 'unknown';
};
export type PublicComparisonRecord = {
  id: string; name: string; kind: string; scope: string; denominator: string | null;
  sourceVersion: string | null; sourceName: string; sourceUrl: string | null;
  backgroundUrl: string; status: 'available' | 'withdrawn' | 'unavailable';
  coverage: 'partial' | 'complete' | 'unknown'; coverageLabel: string;
  values: ComparisonValue[];
};
export const comparisonCases = [
  ['ready', 'Aligned evidence'], ['units', 'Unlike units'], ['period', 'Different periods'],
  ['method', 'Method unavailable'], ['denominator', 'Different basis'], ['scope', 'Different scope'],
  ['version', 'Revised source'], ['withdrawn', 'Withdrawn record'], ['loading', 'Loading comparison'],
  ['error', 'Comparison request fails'],
] as const;
export type ComparisonCase = typeof comparisonCases[number][0];

function validObservationDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const day = value.slice(0,10);
  return new Date(`${day}T00:00:00Z`).toISOString().slice(0,10) === day;
}
function samplePeriod(date: string | null | undefined) {
  if (!validObservationDate(date)) return null;
  return `${date.slice(0, 4)}Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`;
}

/** Uses existing fixture readings unchanged. Added compatibility metadata is an authored contract example. */
export function comparisonRecords(layer: MapLayer, water: readonly WaterFeature[]): PublicComparisonRecord[] {
  if (layer === 'water') return water.map(record => ({
    id: record.pwsid, name: record.name, kind: c.waterEvidence, scope: c.scopeWater,
    denominator: c.waterBasis, sourceVersion: 'review-water-v1', sourceName: c.sourceWater,
    sourceUrl: null, backgroundUrl: 'https://www.epa.gov/dwucmr', status: 'available',
    coverage: 'partial', coverageLabel: c.waterCoverage,
    values: Object.entries(compoundKey).map(([key, analyte]) => {
      const value = record.contaminants[analyte]; const period = samplePeriod(value?.date_iso);
      return { analyte: compounds.find(item => item[0] === key)?.[1] ?? analyte,
        value: value?.value_ppt ?? null, unit: 'ppt', observedAt: value?.date_iso ?? null,
        period, periodLabel: period ? quarterLabel(period) : c.unknown,
        method: 'review-water-method-v1', qualifier: value?.value_ppt === undefined ? 'unknown' as const : 'reported' as const };
    }).concat([{ analyte: 'Hazard index', value: record.hazard_index?.value ?? null, unit: 'index',
      observedAt: record.latest_sample_iso, period: samplePeriod(record.latest_sample_iso),
      periodLabel: samplePeriod(record.latest_sample_iso) ? quarterLabel(samplePeriod(record.latest_sample_iso)!) : c.unknown,
      method: record.hazard_index ? `review-hazard-v1:${[...record.hazard_index.components].sort().join(',')}` : 'review-hazard-v1',
      qualifier: record.hazard_index ? 'reported' : 'unknown' }]),
  }));
  if (layer === 'air') return airStations.map(record => ({
    id: record.id, name: record.name.replace(/\s*\(sample\)$/i, ''), kind: c.airEvidence, scope: c.scopeAir,
    denominator: c.airBasis, sourceVersion: 'review-air-v1', sourceName: c.sourceAir,
    sourceUrl: null, backgroundUrl: 'https://www.airnow.gov/', status: 'available',
    coverage: 'partial', coverageLabel: c.airCoverage,
    values: [{ analyte: record.dominant_pollutant, value: record.aqi, unit: 'AQI', observedAt: record.last_reading_at,
      period: record.last_reading_at, periodLabel: record.last_reading_at, method: 'review-aqi-v1', qualifier: 'reported' }],
  }));
  return [];
}

export function comparisonRows(first: PublicComparisonRecord, second: PublicComparisonRecord, compound: Compound) {
  const names = first.kind === c.airEvidence ? [first.values[0]?.analyte ?? c.unknown]
    : compound === 'overall' ? first.values.filter(value => value.unit !== 'index').map(value => value.analyte)
      : [compound === 'hazard' ? 'Hazard index' : compounds.find(item => item[0] === compound)?.[1] ?? c.unknown];
  return names.map(analyte => {
    const a = first.values.find(value => value.analyte === analyte);
    // Retain the actual second pollutant for explanation rather than substituting a missing same-pollutant value.
    const b = second.kind === c.airEvidence ? second.values[0] : second.values.find(value => value.analyte === analyte);
    return { analyte, first: a, second: b, ...compareEvidence(first, second, a, b) };
  });
}

export function compareEvidence(first: PublicComparisonRecord, second: PublicComparisonRecord, a?: ComparisonValue, b?: ComparisonValue) {
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (first.id === second.id) reasons.push(c.reasons.same);
  if (first.status !== 'available' || second.status !== 'available') reasons.push(c.reasons.status);
  if (!a || !b || a.value === null || b.value === null || !Number.isFinite(a.value) || !Number.isFinite(b.value)) reasons.push(c.reasons.missing);
  if (!a?.analyte || a.analyte !== b?.analyte) reasons.push(c.reasons.analyte);
  if (!a?.unit || a.unit !== b?.unit) reasons.push(c.reasons.units);
  if (!a?.period || a.period !== b?.period) reasons.push(c.reasons.period);
  if (!validObservationDate(a?.observedAt) || !validObservationDate(b?.observedAt)) reasons.push(c.reasons.date);
  if (!a?.method || a.method !== b?.method) reasons.push(c.reasons.method);
  if (!first.kind || first.kind !== second.kind) reasons.push(c.reasons.kind);
  if (!first.scope || first.scope !== second.scope) reasons.push(c.reasons.scope);
  if (!first.denominator || first.denominator !== second.denominator) reasons.push(c.reasons.denominator);
  if (!first.sourceVersion || first.sourceVersion !== second.sourceVersion) reasons.push(c.reasons.source);
  if (a?.qualifier !== 'reported' || b?.qualifier !== 'reported') reasons.push(c.reasons.qualifier);
  if (a?.observedAt !== b?.observedAt) warnings.push(c.dateDifference);
  if (first.coverage !== 'complete' || second.coverage !== 'complete') warnings.push(c.incomplete);
  return { compatible: reasons.length === 0, reasons, warnings };
}

export function comparisonDisplay(value?: ComparisonValue) {
  if (value?.qualifier === 'non-detect') return c.nonDetect;
  if (!value || value.value === null || !Number.isFinite(value.value)) return c.missing;
  return `${new Intl.NumberFormat('en-US', { maximumSignificantDigits: 21 }).format(value.value)} ${value.unit}`;
}
export function comparisonObserved(value?: ComparisonValue) {
  if (!validObservationDate(value?.observedAt)) return c.unknown;
  return value.observedAt.includes('T') ? new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
  }).format(new Date(value.observedAt)) + ' UTC' : readingDate(value.observedAt);
}

/** Changes only a cloned second-record contract example, not map data or source values. */
export function reviewComparisonRecord(record: PublicComparisonRecord, scenario: ComparisonCase): PublicComparisonRecord {
  const next = { ...record, values: record.values.map(value => ({ ...value })) };
  if (scenario === 'units') next.values.forEach(value => { value.unit = c.unlikeUnit; });
  if (scenario === 'period') next.values.forEach(value => { value.period = 'earlier-period'; value.periodLabel = c.earlierPeriod; value.observedAt = null; });
  if (scenario === 'method') next.values.forEach(value => { value.method = null; });
  if (scenario === 'denominator') next.denominator = null;
  if (scenario === 'scope') next.scope = c.differentScope;
  if (scenario === 'version') next.sourceVersion = 'different-release';
  if (scenario === 'withdrawn') next.status = 'withdrawn';
  return next;
}
