/** Editable Map review fixtures. Never imported by a live API adapter. */
export type MapLayer = 'water' | 'radon' | 'facilities' | 'air';
export type MapSeverity = 'good' | 'moderate' | 'elevated' | 'high' | 'severe' | 'no_data';
export const mapLayers: MapLayer[] = ['water', 'radon', 'facilities', 'air'];
export const compounds = [ ['overall', 'Overall water'], ['pfoa', 'PFOA'], ['pfos', 'PFOS'], ['pfhxs', 'PFHxS'], ['pfna', 'PFNA'], ['genx', 'GenX'], ['hazard', 'Hazard index'] ] as const;
export type Compound = typeof compounds[number][0];
export const compoundKey = { pfoa: 'PFOA', pfos: 'PFOS', pfhxs: 'PFHxS', pfna: 'PFNA', genx: 'HFPO-DA' } as const;
export const quarters = ['2023Q1', '2023Q2', '2023Q3', '2023Q4', '2024Q1', '2024Q2', '2024Q3', '2024Q4', '2025Q1', '2025Q2', '2025Q3', '2025Q4'];
export const mapScenarios = [
  ['ready', 'All features'], ['loading', 'Loading layer'], ['slow', 'Slow source'], ['layer-error', 'Layer unavailable'],
  ['empty', 'No features in view'], ['offline', 'Offline, saved data'], ['offline-empty', 'Offline, no saved layer'],
  ['quarter-error', 'Quarter request fails'], ['quarter-empty', 'Quarter with no samples'], ['single-quarter', 'No timeline'],
  ['no-location', 'No household location'], ['outside-nc', 'Household outside NC'], ['unranked', 'County not ranked'],
  ['district-error', 'District unavailable'], ['district-geography', 'District geography unavailable'],
  ['population-missing', 'District population missing'], ['population-partial', 'District population incomplete'],
  ['district-zero', 'District zero exceedances'], ['comparison-missing', 'Comparison unavailable'],
  ['map-unavailable', 'Map unavailable, text fallback'], ['long-text', 'Long labels'], ['session-required', 'Session needs verification'],
] as const;
export type MapScenario = typeof mapScenarios[number][0];
export type Reading = { value_ppt?: number; limit_ppt: number | null; ratio?: number; severity: MapSeverity; date_iso?: string; proposed_for_rescission: boolean };
export type WaterFeature = { pwsid: string; name: string; lat: number | null; lng: number | null; population: number | null; overall_severity: MapSeverity; coverage: string; latest_sample_iso: string | null; contaminants: Record<string, Reading>; hazard_index: null | { value: number; severity: MapSeverity; exceeds: boolean; proposed_for_rescission: boolean; components: string[] }; detected_unregulated: string[] };
export const sampleHome = { lat: 35.04, lng: -80.52, county: 'Union County', pwsid: 'SAMPLE-01', score: 78 };
export const assembledAt = '2026-10-01T11:00:00Z';
const locations = [
  ['Meadow Water', 35.04, -80.55, 42600], ['Piedmont Community Water',35.28,-80.40,18000], ['Riverbend Water',34.99,-80.06,7400],
  ['Longleaf Water',35.35,-79.91,9400], ['Cedar Water',35.42,-80.18,24000], ['Sandhill Water',34.94,-79.76,6100],
  ['Juniper Water',34.77,-79.46,9200], ['Brookside Water',35.18,-80.82,84000], ['Oak Water',35.44,-80.64,32000],
  ['Blue Ridge Water',35.61,-82.52,42000], ['Coastal Water',34.28,-77.94,34000], ['Capital Water',35.79,-78.63,60000],
  ['Small Springs Water',35.14,-80.29,null], ['Unmapped Community Water',null,null,1200], ['Unmapped Springs',null,null,null],
] as const;
const sets: Array<[number | undefined, number | undefined, number | undefined, number | undefined, number | undefined]> = [
  [5.8,8.3,2.1,undefined,undefined],[2.1,3.2,undefined,undefined,undefined],[undefined,1.8,undefined,undefined,undefined],
  [0.0,0.8,undefined,undefined,undefined],[8.6,12.4,12.0,undefined,undefined],[undefined,undefined,undefined,undefined,undefined],
  [1.2,2.2,undefined,undefined,undefined],[2.8,5.3,undefined,undefined,undefined],[4.5,6.2,undefined,undefined,undefined],
  [0.6,1.1,undefined,undefined,undefined],[3.1,4.9,undefined,undefined,undefined],[2,3,undefined,undefined,undefined],
  [undefined,undefined,undefined,undefined,undefined],[6.2,9.0,undefined,undefined,undefined],[undefined,undefined,undefined,undefined,undefined],
];
const levels: MapSeverity[] = ['high','moderate','good','good','severe','no_data','moderate','elevated','high','good','elevated','moderate','no_data','high','no_data'];
export function waterFeatures(quarter: string = 'latest'): WaterFeature[] {
  const qi = quarters.indexOf(quarter);
  return locations.flatMap(([name, lat, lng, population], i) => {
    // Each fixture is a different quarter response, not interpolation of live history.
    if (qi >= 0 && (i + qi) % 4 === 0) return [];
    const date = qi >= 0 ? `${quarter.slice(0,4)}-${String(Number(quarter.slice(-1)) * 3).padStart(2,'0')}-04` : '2025-11-04';
    const contaminants: Record<string, Reading> = {};
    const earlierSample = qi >= 0 && qi < 4 && i === 0;
    const sampleValues = earlierSample ? [2.1, 3.3, undefined, undefined, undefined] : sets[i];
    const sampleSeverity = earlierSample ? 'moderate' : levels[i];
    Object.values(compoundKey).forEach((key, k) => {
      const value = sampleValues[k]; const limit = k < 2 ? 4 : 10;
      // Authored sample severity, not a frontend scoring rule.
      contaminants[key] = { limit_ppt: limit, severity: value === undefined ? 'no_data' : k < 2 ? sampleSeverity : value > 10 ? 'elevated' : 'good', proposed_for_rescission: k > 1,
        ...(value === undefined ? {} : { value_ppt: value, ratio: value / limit, date_iso: date }) };
    });
    return [{ pwsid: `SAMPLE-${String(i+1).padStart(2,'0')}`, name, lat, lng, population, overall_severity: sampleSeverity, coverage: i === 5 ? 'unscoreable' : 'full', latest_sample_iso: i === 12 ? null : date,
      contaminants, hazard_index: [0,4,8].includes(i) ? { value: i === 4 ? 1.6 : .7, severity: i === 4 ? 'high' : 'good', exceeds: i === 4, proposed_for_rescission: true, components: ['PFHxS', 'PFNA'] } : null,
      detected_unregulated: i === 5 ? ['Lithium'] : [] }];
  });
}
export const facilities = [
  { id:'facility-1',name:'Piedmont Works (sample)',lat:35.09,lng:-80.46,county:'Union County',programs:['CAA','CWA'],compliance_status:'significant_violation',severity:'high',recent_violations:6,open_violations:2,penalties:12500,last_inspection:'2026-06-03' },
  { id:'facility-2',name:'Meadow Manufacturing (sample)',lat:35.13,lng:-80.42,county:'Union County',programs:['CWA'],compliance_status:'violation',severity:'elevated',recent_violations:5,open_violations:1,penalties:0,last_inspection:'2026-03-11' },
  { id:'facility-3',name:'River Materials (sample)',lat:35.16,lng:-80.49,county:'Union County',programs:['RCRA'],compliance_status:'unknown',severity:'no_data',recent_violations:0,open_violations:0,penalties:0,last_inspection:null },
  { id:'facility-4',name:'Sandhill Operations (sample)',lat:34.89,lng:-79.78,county:'Richmond County',programs:['CAA'],compliance_status:'no_violation',severity:'good',recent_violations:0,open_violations:0,penalties:0,last_inspection:'2026-08-07' },
] as const;
export const airStations = [
  {id:'air-1',name:'Meadow monitoring station (sample)',lat:35.16,lng:-80.64,aqi:42,severity:'good',dominant_pollutant:'PM2.5',last_reading_at:'2026-10-01T10:00:00Z',agency:'Sample state monitoring agency'},
  {id:'air-2',name:'Piedmont monitoring station (sample)',lat:35.41,lng:-80.20,aqi:87,severity:'moderate',dominant_pollutant:'Ozone',last_reading_at:'2026-10-01T10:00:00Z',agency:'Sample state monitoring agency'},
  {id:'air-3',name:'Sandhill monitoring station (sample)',lat:34.96,lng:-79.65,aqi:106,severity:'elevated',dominant_pollutant:'PM2.5',last_reading_at:'2026-09-30T21:00:00Z',agency:'Sample state monitoring agency'},
] as const;
export function waterSeverity(feature: WaterFeature, compound: Compound): MapSeverity {
  if (compound === 'overall') return feature.overall_severity;
  if (compound === 'hazard') return feature.hazard_index?.severity ?? 'no_data';
  return feature.contaminants[compoundKey[compound]]?.severity ?? 'no_data';
}
export function quarterLabel(value: string) { return value === 'latest' ? 'Latest' : `Q${value.slice(-1)} ${value.slice(0,4)}`; }
export function waterMapReading(feature: WaterFeature, compound: Compound) {
  if (compound === 'hazard') return feature.hazard_index ? `Index ${feature.hazard_index.value}` : 'No index available';
  if (compound !== 'overall') {
    const value = feature.contaminants[compoundKey[compound]]?.value_ppt;
    return value === undefined ? 'No detection reported' : `${value} ppt`;
  }
  const readings = Object.values(feature.contaminants);
  if (!readings.some(r => r.value_ppt !== undefined)) return 'No comparable result';
  const count = readings.filter(r => (r.ratio ?? 0) > 1).length;
  return count ? `${count} over limit` : 'No over-limit detection';
}
export function waterSampleDate(feature: WaterFeature, compound: Compound) {
  return compound === 'overall' || compound === 'hazard' ? feature.latest_sample_iso : feature.contaminants[compoundKey[compound]]?.date_iso;
}
export function observationTime(value: string | null | undefined) {
  if (!value) return 'No observation time available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'No observation time available' : new Intl.DateTimeFormat('en-US', { month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', timeZone:'UTC', timeZoneName:'short' }).format(date);
}
export function readingDate(value: string | null | undefined) { if (!value) return 'No date available'; const d = new Date(value.length === 10 ? `${value}T12:00:00Z` : value); return Number.isNaN(d.getTime()) ? 'No date available' : new Intl.DateTimeFormat('en-US', {month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(d); }
export function milesFromHome(lat: number, lng: number) { const r = Math.PI / 180; const a = Math.sin((lat-sampleHome.lat)*r/2)**2 + Math.cos(lat*r)*Math.cos(sampleHome.lat*r)*Math.sin((lng-sampleHome.lng)*r/2)**2; return Math.max(.1,3958.8*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))).toFixed(1); }
export function readMapQuery(params: URLSearchParams) {
  const layer = mapLayers.includes(params.get('layer') as MapLayer) ? params.get('layer') as MapLayer : 'water';
  const compound = layer === 'water' && compounds.some(c=>c[0] === params.get('contaminant')) ? params.get('contaminant') as Compound : 'overall';
  const quarter = layer === 'water' && quarters.includes(params.get('quarter') ?? '') ? params.get('quarter')! : 'latest';
  return {layer,compound,quarter};
}
