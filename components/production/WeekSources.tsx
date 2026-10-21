'use client';
import {useProductionResource,useProductionRuntime} from './ProductionContext';
import type {HistoryReading,ForecastPeriod} from '@/lib/frontend/week-evidence-preview';
export type HistorySnapshot={rows:HistoryReading[];comparison:{context:string;basis:'daily maximum'|'app-time observation';version:string};complete:boolean;nextCursor?:string|null};
export function useProductionHistory(from:string,to:string){
 const runtime=useProductionRuntime(),read=useProductionResource<HistorySnapshot>('evidence.read',{kind:'history',from,to});
 const data=read.data;
 const valid=!!data&&Array.isArray(data.rows)&&typeof data.complete==='boolean'&&data.comparison?.context===runtime?.homeContextId&&data.comparison?.basis==='daily maximum'&&typeof data.comparison?.version==='string'&&data.rows.every(row=>row&&/^\d{4}-\d{2}-\d{2}$/.test(row.date)&&['Air','UV','Pollen','Outdoor mold'].includes(row.factor)&&(row.value===null||typeof row.value==='number'&&Number.isFinite(row.value))&&typeof row.source==='string'&&typeof row.issued==='string'&&typeof row.version==='string'&&typeof row.context==='string');
 return {...read,data:valid?data:null,error:read.error??(data&&!valid?'History could not be verified.':null)};
}
export type ForecastSnapshot={periods:ForecastPeriod[];issuedAt:string;expiresAt:string;zone:string;source:string;version:string;horizonStart:string;horizonEnd:string;warningStatus:string;changedMessage?:string;coverage:Record<string,string>};
export function useProductionForecast(date:string,place:string){
 const read=useProductionResource<ForecastSnapshot>('forecast.read',{date,place},!!date);
 const value=read.data;
 let valid=!!value&&Array.isArray(value.periods)&&Number.isFinite(Date.parse(value.issuedAt))&&Number.isFinite(Date.parse(value.expiresAt))&&typeof value.zone==='string'&&typeof value.source==='string'&&typeof value.version==='string'&&typeof value.horizonStart==='string'&&typeof value.horizonEnd==='string'&&typeof value.warningStatus==='string'&&!!value.coverage&&value.periods.every(row=>row&&['Morning','Afternoon','Evening'].includes(row.name)&&Number.isFinite(Date.parse(row.start))&&Number.isFinite(Date.parse(row.end))&&/Z$|[+-]\d{2}:\d{2}$/.test(row.start)&&/Z$|[+-]\d{2}:\d{2}$/.test(row.end)&&Date.parse(row.end)>Date.parse(row.start)&&(row.air===null||typeof row.air==='number'&&Number.isFinite(row.air))&&(row.uv===null||typeof row.uv==='number'&&Number.isFinite(row.uv))&&(row.pollen===null||typeof row.pollen==='string')&&typeof row.weather==='string'&&typeof row.tradeoff==='string'&&typeof row.version==='string');
 try{if(valid)new Intl.DateTimeFormat('en',{timeZone:value!.zone});}catch{valid=false;}
 return {...read,data:valid?value:null,error:read.error??(value&&!valid?'Forecast information could not be verified.':null)};
}
export function forecastTime(instant:string,zone:string){return new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(instant));}
export function forecastIssued(instant:string,zone:string){return `${new Intl.DateTimeFormat('en-US',{timeZone:zone,month:'short',day:'numeric'}).format(new Date(instant))}, ${forecastTime(instant,zone)}`;}
