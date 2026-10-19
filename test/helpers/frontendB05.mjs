/**
 * The frontend code the B05 routes are judged by, TRANSCRIBED, not summarised,
 * from `origin/codex/october15-review-refinement` (5ac06f6; read with
 * `git show`, the files are not checked out here). TypeScript to JavaScript
 * with the types stripped and nothing else changed. One copy, shared by every
 * B05 suite that needs it, so the per-route suites and the contract suite
 * (test/contractsB05.test.mjs) cannot drift apart:
 *
 * - `lib/frontend/stage-values.ts:2-4,6-27` (record, finite, nonnegative,
 *   safeText, textList, rows, severity, safeUrl, isoDate, timestamp);
 * - `lib/frontend/map-service.ts:15-20,24-56,58-65,82-96` (nullable,
 *   dayOrTime, coordinate, key, required, emptyMapSnapshot, parseMapLayer,
 *   parseMapComparisons, parseMapDistrict);
 * - `lib/frontend/map-preview.ts:5` (compounds) and the strings of
 *   `lib/frontend/copy/map-comparison.ts:39,45,48-49,55-56,64-71` that the
 *   comparison functions use, as a subset of `mapComparisonCopy`;
 * - `lib/frontend/map-comparison-preview.ts:25-29,65-96` (validObservationDate,
 *   comparisonRows, compareEvidence);
 * - `components/map-preview/MapComparison.tsx:64` (the row label, as a function);
 * - `lib/frontend/production/explore-service.ts:8-9,66-69` (object, text,
 *   validPlaces, validDiscoveryArea).
 *
 * A transcription that accepted everything would pass every body it is given,
 * so each suite that uses one also shows that it rejects what the client
 * rejects (precedent: test/contractsB03.test.mjs).
 */

// ------------------------------------------------- transcribed: stage-values.ts

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
const finite = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const nonnegative = (value) => { const number = finite(value); return number !== null && number >= 0 ? number : null; };
function safeText(value, fallback = '') {
  return typeof value === 'string' ? value.replace(/\s*\u2014\s*/g, ', ').trim() : fallback;
}
const textList = (value) => Array.isArray(value) ? value.filter((item) => typeof item === 'string').map(item => safeText(item)).filter(Boolean) : [];
const rows = (value) => Array.isArray(value) ? value.filter(item => item !== null && typeof item === 'object' && !Array.isArray(item)).map(record) : [];
function severity(value) {
  return ['good', 'moderate', 'elevated', 'high', 'severe', 'no_data'].includes(String(value)) ? String(value) : 'no_data';
}
function safeUrl(value) {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function isoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

// -------------------------------------------------- transcribed: map-service.ts

const nullable = (value) => safeText(value)||null;
const dayOrTime = (value) => isoDate(value)??timestamp(value);
const coordinate = (value,limit) => {const n=finite(value);return n!==null&&Math.abs(n)<=limit?n:null;};
const key = (value) => typeof value==='string' && value.trim() && value.length<=200 && !/[\u0000-\u001f]/.test(value) ? value.trim() : null;
const required = ()=>{throw new Error('invalid_map_response');};
const emptyMapSnapshot = (layer) => ({layer,water:[],air:[],facilities:[],radon:[],quarters:[],assembledAt:'',partial:false,nextCursor:null,sourceNote:'',ownHome:null,comparisons:[]});

/** Maps actual map-layer responses only. No sample data, inferred severity,
 * fabricated dates, nearest-home ranking or missing-as-zero values. */
function parseMapLayer(value,layer,publicMode=false) {
  const envelope=record(value); const body=record(envelope.data??value); const meta=record(envelope.meta??body._meta);
  if(body.layer!==layer||!Array.isArray(body.features))return required();
  const result=emptyMapSnapshot(layer);
  result.assembledAt=timestamp(body.assembled_at)??timestamp(meta.as_of)??'';
  result.quarters=textList(body.quarters).filter(q=>/^\d{4}Q[1-4]$/.test(q)).sort();
  result.nextCursor=nullable(meta.next_cursor??body.next_cursor);
  result.partial=meta.truncated===true||body.truncated===true||meta.availability==='partial'||Boolean(result.nextCursor);
  result.sourceNote=safeText(body.note??body.selection);
  const features=rows(body.features); const seen=new Set();
  for(const row of features){
    const id=key(layer==='water'?row.pwsid:layer==='radon'?row.id??row.county:row.id);
    if(!id||seen.has(id)){result.partial=true;continue;}seen.add(id);
    const lat=coordinate(row.lat,90),lng=coordinate(row.lng,180);
    const point={id,name:safeText(row.name??row.county,id),lat:lat!==null&&lng!==null?lat:null,lng:lat!==null&&lng!==null?lng:null,severity:severity(row.severity)};
    if(layer==='water'){
      const contaminants={};
      for(const [name,raw] of Object.entries(record(row.contaminants))){
        const item=record(raw),value=nonnegative(item.value_ppt),limit=nonnegative(item.limit_ppt),ratio=nonnegative(item.ratio);
        contaminants[safeText(name)]={limit_ppt:limit,severity:severity(item.severity),proposed_for_rescission:item.proposed_for_rescission===true,...(value!==null?{value_ppt:value}:{}),...(ratio!==null?{ratio}:{}),...(isoDate(item.date_iso)?{date_iso:isoDate(item.date_iso)}:{})};
      }
      const hazard=record(row.hazard_index),hazardValue=nonnegative(hazard.value);
      result.water.push({pwsid:id,name:point.name,lat:point.lat,lng:point.lng,population:nonnegative(row.population),overall_severity:severity(row.overall_severity),coverage:safeText(row.coverage,'unknown'),latest_sample_iso:isoDate(row.latest_sample_iso),contaminants,detected_unregulated:textList(row.detected_unregulated),hazard_index:hazardValue===null?null:{value:hazardValue,severity:severity(hazard.severity),exceeds:hazard.exceeds===true,proposed_for_rescission:hazard.proposed_for_rescission===true,components:textList(hazard.components)}});
    }else if(layer==='air')result.air.push({...point,aqi:nonnegative(row.aqi),dominant_pollutant:safeText(row.dominant_pollutant,'Not reported'),last_reading_at:timestamp(row.last_reading_at),agency:safeText(row.agency,'Not reported')});
    else if(layer==='facilities')result.facilities.push({...point,county:safeText(row.county),programs:textList(row.programs),compliance_status:['no_violation','violation','significant_violation'].includes(String(row.compliance_status))?String(row.compliance_status):'unknown',recent_violations:nonnegative(row.recent_violations),open_violations:nonnegative(row.open_violations),penalties:nonnegative(row.penalties),last_inspection:dayOrTime(row.last_inspection)});
    else{const zone=finite(row.zone);result.radon.push({...point,...([1,2,3].includes(zone??0)?{zone:zone}:{})});}
  }
  if(features.length!==body.features.length)result.partial=true;
  const home=record(body.own_home),homeLat=coordinate(home.lat,90),homeLng=coordinate(home.lng,180);
  if(!publicMode&&homeLat!==null&&homeLng!==null)result.ownHome={lat:homeLat,lng:homeLng,county:safeText(home.county),pwsid:key(home.pwsid),score:nonnegative(home.score)};
  result.comparisons=parseMapComparisons(body.comparisons??[],[...seen]);
  return result;
}

function parseMapComparisons(value,ids){
  if(!Array.isArray(value))return required();
  const seen=new Set(ids);
  return rows(value).flatMap(item=>{
    const id=key(item.id);if(!id||!seen.has(id))return [];
    return [{id,name:safeText(item.name,id),kind:safeText(item.kind),scope:safeText(item.scope),denominator:nullable(item.denominator),sourceVersion:nullable(item.sourceVersion),sourceName:safeText(item.sourceName,'Source not reported'),sourceUrl:safeUrl(item.sourceUrl),backgroundUrl:safeUrl(item.backgroundUrl)??'',status:['available','withdrawn'].includes(String(item.status))?item.status:'unavailable',coverage:['complete','partial'].includes(String(item.coverage))?item.coverage:'unknown',coverageLabel:safeText(item.coverageLabel,'Coverage not reported'),values:rows(item.values).map(v=>({analyte:safeText(v.analyte),value:finite(v.value),unit:safeText(v.unit),observedAt:dayOrTime(v.observedAt),period:nullable(v.period),periodLabel:safeText(v.periodLabel,'Not reported'),method:nullable(v.method),qualifier:['reported','estimated','non-detect'].includes(String(v.qualifier))?v.qualifier:'unknown'}))}];
  });
}

/** This shipped atlas has an NC-08 boundary. Unsupported districts are not
 * silently renamed or drawn on that boundary. */
function parseMapDistrict(value) {
  const envelope=record(value),body=record(envelope.data??value);
  if(body.scope!=='NC-08'||!Array.isArray(body.counties)||!body.by_contaminant||!body.state_comparison)return required();
  const count=(v)=>{const n=nonnegative(v);return n!==null&&Number.isInteger(n)?n:required();};
  const by_contaminant={};
  for(const name of ['PFOA','PFOS','PFHxS','PFNA','HFPO-DA']){
    const row=record(record(body.by_contaminant)[name]);const limit=nonnegative(row.limit);if(limit===null)return required();
    by_contaminant[name]={tested:count(row.tested),over:count(row.over),limit,proposed_for_rescission:row.proposed_for_rescission===true,population_over:nonnegative(row.population_over),over_population_unknown:count(row.over_population_unknown)};
    if(by_contaminant[name].over>by_contaminant[name].tested)return required();
  }
  const comparison=record(body.state_comparison),share=(v)=>{const n=nonnegative(v);return n!==null&&n<=1?n:null;};
  const result={scope:'NC-08',total_systems:count(body.total_systems),systems_tested_any:count(body.systems_tested_any),systems_over_limit:count(body.systems_over_limit),affected_population:nonnegative(body.affected_population),affected_population_complete:body.affected_population_complete===true,over_limit_population_unknown:count(body.over_limit_population_unknown),by_contaminant,counties:rows(body.counties).map(row=>({county:safeText(row.county),in_district:row.in_district==='whole'?'whole':'partial',systems:count(row.systems),systems_over_limit:count(row.systems_over_limit),worst_water_severity:severity(row.worst_water_severity),radon_zone:[1,2,3].includes(Number(row.radon_zone))?Number(row.radon_zone):null})),state_comparison:{district_share_over:share(comparison.district_share_over),state_share_over:share(comparison.state_share_over)},unlocated_systems:count(body.unlocated_systems),assembled_at:timestamp(body.assembled_at)??''};
  if(result.systems_over_limit>result.systems_tested_any||result.systems_tested_any>result.total_systems||!result.assembled_at)return required();
  return result;
}

// ------------------------------------- transcribed: map-preview.ts, copy subset

const compounds = [ ['overall', 'Overall water'], ['pfoa', 'PFOA'], ['pfos', 'PFOS'], ['pfhxs', 'PFHxS'], ['pfna', 'PFNA'], ['genx', 'GenX'], ['hazard', 'Hazard index'] ];
const c = {
  matched: 'Aligned evidence', limited: 'Limited comparison', unavailable: 'Not comparable',
  unknown: 'Not supplied',
  dateDifference: 'Observation dates differ. Read the dates before interpreting the values.',
  incomplete: 'Coverage is incomplete. These records do not describe all testing or all time periods.',
  scopeWater: 'Public water system', scopeAir: 'Monitoring station',
  waterEvidence: 'Reported water result', airEvidence: 'Hourly monitor observation',
  reasons: {
    same: 'Choose two different public records.', missing: 'A comparable value is missing.', status: 'A record is unavailable or withdrawn.',
    analyte: 'The analytes or pollutants differ.', units: 'The original units differ. No conversion is assumed.',
    period: 'The observation periods do not align.', date: 'An observation date is missing or invalid.', method: 'The methods are different or not supplied.',
    kind: 'The evidence kinds differ.', scope: 'The geographic scopes differ.',
    denominator: 'The comparison bases differ or are unknown.', source: 'Source versions differ or are unknown.',
    qualifier: 'An estimated, censored or unqualified value cannot be treated as an exact measurement.',
  },
};

// --------------------------------------- transcribed: map-comparison-preview.ts

function validObservationDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const day = value.slice(0,10);
  return new Date(`${day}T00:00:00Z`).toISOString().slice(0,10) === day;
}

function comparisonRows(first, second, compound) {
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

function compareEvidence(first, second, a, b) {
  const reasons = [];
  const warnings = [];
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

// ------------------------------------------ transcribed: MapComparison.tsx:64

const rowLabel = (row) => row.compatible ? (row.warnings.length ? c.limited : c.matched) : c.unavailable;

// ------------------------------------------- transcribed: explore-service.ts

const object = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 10000) => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
function validPlaces(value){return object(value)&&Array.isArray(value.candidates)&&value.candidates.length<=20&&value.candidates.every(place=>object(place)&&['id','place','state','label','timezone'].every(key=>text(place[key],300))&&!!place.id);}
function validDiscoveryArea(value){return object(value)&&Number.isSafeInteger(value.revision)&&Number(value.revision)>0&&(value.place===null||validPlaces({candidates:[value.place]}))&&(value.pendingOperation===undefined||object(value.pendingOperation)&&text(value.pendingOperation.id,200)&&!!value.pendingOperation.id&&(value.pendingOperation.place===null||validPlaces({candidates:[value.pendingOperation.place]})));}

export {
  record, finite, nonnegative, safeText, textList, rows, severity, safeUrl, isoDate, timestamp,
  nullable, dayOrTime, coordinate, key, required, emptyMapSnapshot, parseMapLayer, parseMapComparisons, parseMapDistrict,
  compounds, c, validObservationDate, comparisonRows, compareEvidence, rowLabel,
  object, text, validPlaces, validDiscoveryArea,
};
