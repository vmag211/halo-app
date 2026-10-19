import { finite, isoDate, nonnegative, record, rows, safeText, safeUrl, severity, textList, timestamp } from './stage-values';
import type { MapLayer, MapSeverity, WaterFeature } from './map-preview';
import type { PublicComparisonRecord } from './map-comparison-preview';
import type { DistrictPreviewData } from './map-district-preview';

export type MapStation = { id:string; name:string; lat:number|null; lng:number|null; aqi:number|null; severity:string; dominant_pollutant:string; last_reading_at:string|null; agency:string };
export type MapFacility = { id:string; name:string; lat:number|null; lng:number|null; county:string; programs:readonly string[]; compliance_status:string; severity:string; recent_violations:number|null; open_violations:number|null; penalties:number|null; last_inspection:string|null };
export type MapCounty = { id:string; name:string; lat:number|null; lng:number|null; severity:string; zone?:number };
export type MapHome = { lat:number; lng:number; county:string; pwsid:string|null; score:number|null };
export type MapLayerSnapshot = {
  layer:MapLayer; water:WaterFeature[]; air:MapStation[]; facilities:MapFacility[]; radon:MapCounty[];
  quarters:string[]; assembledAt:string; partial:boolean; nextCursor:string|null;
  sourceNote:string; ownHome:MapHome|null; comparisons:PublicComparisonRecord[];
};
const nullable = (value:unknown) => safeText(value)||null;
const dayOrTime = (value:unknown) => isoDate(value)??timestamp(value);
const coordinate = (value:unknown,limit:number) => {const n=finite(value);return n!==null&&Math.abs(n)<=limit?n:null;};
const key = (value:unknown) => typeof value==='string' && value.trim() && value.length<=200 && !/[\u0000-\u001f]/.test(value) ? value.trim() : null;
const required = ():never=>{throw new Error('invalid_map_response');};
export const emptyMapSnapshot = (layer:MapLayer):MapLayerSnapshot => ({layer,water:[],air:[],facilities:[],radon:[],quarters:[],assembledAt:'',partial:false,nextCursor:null,sourceNote:'',ownHome:null,comparisons:[]});

/** Maps actual map-layer responses only. No sample data, inferred severity,
 * fabricated dates, nearest-home ranking or missing-as-zero values. */
export function parseMapLayer(value:unknown,layer:MapLayer,publicMode=false):MapLayerSnapshot {
  const envelope=record(value); const body=record(envelope.data??value); const meta=record(envelope.meta??body._meta);
  if(body.layer!==layer||!Array.isArray(body.features))return required();
  const result=emptyMapSnapshot(layer);
  result.assembledAt=timestamp(body.assembled_at)??timestamp(meta.as_of)??'';
  result.quarters=textList(body.quarters).filter(q=>/^\d{4}Q[1-4]$/.test(q)).sort();
  result.nextCursor=nullable(meta.next_cursor??body.next_cursor);
  result.partial=meta.truncated===true||body.truncated===true||meta.availability==='partial'||Boolean(result.nextCursor);
  result.sourceNote=safeText(body.note??body.selection);
  const features=rows(body.features); const seen=new Set<string>();
  for(const row of features){
    const id=key(layer==='water'?row.pwsid:layer==='radon'?row.id??row.county:row.id);
    if(!id||seen.has(id)){result.partial=true;continue;}seen.add(id);
    const lat=coordinate(row.lat,90),lng=coordinate(row.lng,180);
    const point={id,name:safeText(row.name??row.county,id),lat:lat!==null&&lng!==null?lat:null,lng:lat!==null&&lng!==null?lng:null,severity:severity(row.severity)};
    if(layer==='water'){
      const contaminants:WaterFeature['contaminants']={};
      for(const [name,raw] of Object.entries(record(row.contaminants))){
        const item=record(raw),value=nonnegative(item.value_ppt),limit=nonnegative(item.limit_ppt),ratio=nonnegative(item.ratio);
        contaminants[safeText(name)]={limit_ppt:limit,severity:severity(item.severity) as MapSeverity,proposed_for_rescission:item.proposed_for_rescission===true,...(value!==null?{value_ppt:value}:{}),...(ratio!==null?{ratio}:{}),...(isoDate(item.date_iso)?{date_iso:isoDate(item.date_iso)!}:{})};
      }
      const hazard=record(row.hazard_index),hazardValue=nonnegative(hazard.value);
      result.water.push({pwsid:id,name:point.name,lat:point.lat,lng:point.lng,population:nonnegative(row.population),overall_severity:severity(row.overall_severity) as MapSeverity,coverage:safeText(row.coverage,'unknown'),latest_sample_iso:isoDate(row.latest_sample_iso),contaminants,detected_unregulated:textList(row.detected_unregulated),hazard_index:hazardValue===null?null:{value:hazardValue,severity:severity(hazard.severity) as MapSeverity,exceeds:hazard.exceeds===true,proposed_for_rescission:hazard.proposed_for_rescission===true,components:textList(hazard.components)}});
    }else if(layer==='air')result.air.push({...point,aqi:nonnegative(row.aqi),dominant_pollutant:safeText(row.dominant_pollutant,'Not reported'),last_reading_at:timestamp(row.last_reading_at),agency:safeText(row.agency,'Not reported')});
    else if(layer==='facilities')result.facilities.push({...point,county:safeText(row.county),programs:textList(row.programs),compliance_status:['no_violation','violation','significant_violation'].includes(String(row.compliance_status))?String(row.compliance_status):'unknown',recent_violations:nonnegative(row.recent_violations),open_violations:nonnegative(row.open_violations),penalties:nonnegative(row.penalties),last_inspection:dayOrTime(row.last_inspection)});
    else{const zone=finite(row.zone);result.radon.push({...point,...([1,2,3].includes(zone??0)?{zone:zone!}:{})});}
  }
  if(features.length!==body.features.length)result.partial=true;
  const home=record(body.own_home),homeLat=coordinate(home.lat,90),homeLng=coordinate(home.lng,180);
  if(!publicMode&&homeLat!==null&&homeLng!==null)result.ownHome={lat:homeLat,lng:homeLng,county:safeText(home.county),pwsid:key(home.pwsid),score:nonnegative(home.score)};
  result.comparisons=parseMapComparisons(body.comparisons??[],[...seen]);
  return result;
}

export function parseMapComparisons(value:unknown,ids:readonly string[]):PublicComparisonRecord[]{
  if(!Array.isArray(value))return required();
  const seen=new Set(ids);
  return rows(value).flatMap(item=>{
    const id=key(item.id);if(!id||!seen.has(id))return [];
    return [{id,name:safeText(item.name,id),kind:safeText(item.kind),scope:safeText(item.scope),denominator:nullable(item.denominator),sourceVersion:nullable(item.sourceVersion),sourceName:safeText(item.sourceName,'Source not reported'),sourceUrl:safeUrl(item.sourceUrl),backgroundUrl:safeUrl(item.backgroundUrl)??'',status:['available','withdrawn'].includes(String(item.status))?item.status as 'available'|'withdrawn':'unavailable' as const,coverage:['complete','partial'].includes(String(item.coverage))?item.coverage as 'complete'|'partial':'unknown' as const,coverageLabel:safeText(item.coverageLabel,'Coverage not reported'),values:rows(item.values).map(v=>({analyte:safeText(v.analyte),value:finite(v.value),unit:safeText(v.unit),observedAt:dayOrTime(v.observedAt),period:nullable(v.period),periodLabel:safeText(v.periodLabel,'Not reported'),method:nullable(v.method),qualifier:['reported','estimated','non-detect'].includes(String(v.qualifier))?v.qualifier as 'reported'|'estimated'|'non-detect':'unknown' as const}))}];
  });
}

/** Pagination must stay on the same layer and assembled snapshot. */
export function mergeMapPages(current:MapLayerSnapshot,next:MapLayerSnapshot):MapLayerSnapshot{
 if(current.layer!==next.layer||current.assembledAt!==next.assembledAt||current.nextCursor===next.nextCursor&&next.nextCursor!==null)return required();
 const unique=<T>(first:T[],second:T[],id:(row:T)=>string)=>Array.from(new Map([...first,...second].map(row=>[id(row),row])).values());
 return {...next,water:unique(current.water,next.water,row=>row.pwsid),air:unique(current.air,next.air,row=>row.id),facilities:unique(current.facilities,next.facilities,row=>row.id),radon:unique(current.radon,next.radon,row=>row.id),comparisons:unique(current.comparisons,next.comparisons,row=>row.id),ownHome:next.ownHome??current.ownHome,quarters:[...new Set([...current.quarters,...next.quarters])].sort()};
}

export function mapDistance(home:{lat:number;lng:number}|null,lat:number|null,lng:number|null){
  if(!home||lat===null||lng===null)return null;
  const r=Math.PI/180,a=Math.sin((lat-home.lat)*r/2)**2+Math.cos(lat*r)*Math.cos(home.lat*r)*Math.sin((lng-home.lng)*r/2)**2;
  return (3958.8*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)))).toFixed(1);
}

/** This shipped atlas has an NC-08 boundary. Unsupported districts are not
 * silently renamed or drawn on that boundary. */
export function parseMapDistrict(value:unknown):DistrictPreviewData {
  const envelope=record(value),body=record(envelope.data??value);
  if(body.scope!=='NC-08'||!Array.isArray(body.counties)||!body.by_contaminant||!body.state_comparison)return required();
  const count=(v:unknown)=>{const n=nonnegative(v);return n!==null&&Number.isInteger(n)?n:required();};
  const by_contaminant={} as DistrictPreviewData['by_contaminant'];
  for(const name of ['PFOA','PFOS','PFHxS','PFNA','HFPO-DA'] as const){
    const row=record(record(body.by_contaminant)[name]);const limit=nonnegative(row.limit);if(limit===null)return required();
    by_contaminant[name]={tested:count(row.tested),over:count(row.over),limit,proposed_for_rescission:row.proposed_for_rescission===true,population_over:nonnegative(row.population_over),over_population_unknown:count(row.over_population_unknown)};
    if(by_contaminant[name].over>by_contaminant[name].tested)return required();
  }
  const comparison=record(body.state_comparison),share=(v:unknown)=>{const n=nonnegative(v);return n!==null&&n<=1?n:null;};
  const result:DistrictPreviewData={scope:'NC-08',total_systems:count(body.total_systems),systems_tested_any:count(body.systems_tested_any),systems_over_limit:count(body.systems_over_limit),affected_population:nonnegative(body.affected_population),affected_population_complete:body.affected_population_complete===true,over_limit_population_unknown:count(body.over_limit_population_unknown),by_contaminant,counties:rows(body.counties).map(row=>({county:safeText(row.county),in_district:row.in_district==='whole'?'whole':'partial',systems:count(row.systems),systems_over_limit:count(row.systems_over_limit),worst_water_severity:severity(row.worst_water_severity) as MapSeverity,radon_zone:[1,2,3].includes(Number(row.radon_zone))?Number(row.radon_zone):null})),state_comparison:{district_share_over:share(comparison.district_share_over),state_share_over:share(comparison.state_share_over)},unlocated_systems:count(body.unlocated_systems),assembled_at:timestamp(body.assembled_at)??''};
  if(result.systems_over_limit>result.systems_tested_any||result.systems_tested_any>result.total_systems||!result.assembled_at)return required();
  return result;
}
