import { dayAdd } from './week-preview';

/** Explicit design-review adapters. Never a provider fallback or a production measurement. */
export type EvidenceScenario = 'unavailable' | 'populated' | 'sparse' | 'no-pattern' | 'changed' | 'loading' | 'error';
export type ForecastScenario = 'unavailable' | 'current' | 'partial' | 'changed' | 'expired' | 'loading' | 'error';
export type HistoryFactor = 'Air' | 'UV' | 'Pollen' | 'Outdoor mold';
export type HistoryReading = { date:string; factor:HistoryFactor; value:number|null; unit:string; source:string; issued:string; basis:'daily maximum'|'app-time observation'; context:string; version:string; missing?:string };
export type AnalysisEntry = { date:string; band:string; fine:boolean; recalled:boolean; illness:boolean; symptoms:string[];homeContextId?:string };
export const weekEvidenceCopy = {
  fixtureSource:'HALO illustrative dataset, not provider observations',
  historyUnavailable:'Environmental history is unavailable. Your check-ins remain available.',
  historyError:'Environmental history could not load. Your check-ins are unchanged.',
  limits:'Descriptive only. These records do not establish exposure, a cause or a diagnosis.',
  method:'Only explicitly logged, same-day entries without a possible-illness flag are matched to compatible readings on the same calendar date and home context. Unlogged days are never counted as felt fine. Recalled, illness, missing and incompatible-source days stay visible but are excluded from comparison.',
  basis:'Daily maxima and app-time observations are not pooled. Group records describe a household category, not an individual.',
  noPattern:'No clear difference in these logged days.',
  insufficient:'Not enough comparable logged days.',
  comparisonLimit:'At least 3 symptom days and 3 explicitly fine days are required for this descriptive display. This display threshold is not clinical validation.',
  forecastUnavailable:'Forecasts are unavailable for this place and date. Keep your plan and check official conditions before going.',
  forecastExpired:'These forecasts have expired. Refresh before choosing a forecast-based period.',
  forecastChanged:'Conditions changed. Review the new forecast before saving. Your existing plan has not moved.',
  future:'Beyond the available forecast horizon. Save your plan and choose a day to check again.',
  weatherSource:'Illustrative forecast v1. No live warning or provider connection.',
  noGuarantee:'Compare tradeoffs, not a guaranteed-safe time. Conditions can change.',
  noWatch:'Watch preference only. No notification delivery is connected.',
  seasonLimits:'Completions and participation are user-reported follow-through, not measured environmental or health benefits.',
} as const;

export function historyFixture(today:string,scenario:EvidenceScenario):HistoryReading[] {
  if(['unavailable','loading','error'].includes(scenario))return [];
  const factors:HistoryFactor[]=['Air','UV','Pollen','Outdoor mold'];
  return Array.from({length:84},(_,i)=>dayAdd(today,i-83)).flatMap((date,i)=>factors.map(factor=>{
    const missing=factor==='Outdoor mold'?'No compatible historical mold series':i===83?'Current day is not complete':scenario==='sparse'&&i%5!==0?'No reading for this day':i%11===0?'Source gap':undefined;
    const changed=scenario==='changed'&&i<42;
    const value=missing?null:factor==='Air'?(scenario==='no-pattern'?40:24+(i%7)*9):factor==='UV'?2+i%7:1+i%3;
    return {date,factor,value,unit:factor==='Air'?'AQI':factor==='UV'?'UV index':'category',source:weekEvidenceCopy.fixtureSource,issued:`${i===83?today:dayAdd(date,1)}T06:00:00Z`,basis:changed?'app-time observation':'daily maximum',context:'review-home',version:changed?'history-v0':'history-v1',missing} satisfies HistoryReading;
  }));
}
export function readingLabel(reading:HistoryReading|undefined){if(!reading||reading.value===null)return 'Unavailable';return reading.factor==='Pollen'?['','Low','Moderate','High'][reading.value]??'Unknown category':`${reading.value} ${reading.unit}`;}
export function analyzeHistory(entries:AnalysisEntry[],readings:HistoryReading[],from:string,to:string,group:string,factor:HistoryFactor,comparison?:{context:string;basis:'daily maximum'|'app-time observation';version:string}){
  const days=entries.filter(e=>e.band===group&&e.date>=from&&e.date<=to&&(!comparison||e.homeContextId===comparison.context));
  const rows=readings.filter(r=>r.factor===factor&&r.date>=from&&r.date<=to);
  const compatible=rows.filter(r=>r.value!==null&&r.basis===(comparison?.basis??'daily maximum')&&r.context===(comparison?.context??'review-home')&&r.version===(comparison?.version??'history-v1'));
  const joined=days.flatMap(entry=>{const reading=compatible.find(r=>r.date===entry.date);return !entry.recalled&&!entry.illness&&reading?[{entry,reading}]:[];});
  const symptom=joined.filter(x=>!x.entry.fine&&x.entry.symptoms.length>0);const fine=joined.filter(x=>x.entry.fine);
  const mean=(items:typeof joined)=>items.length?items.reduce((sum,item)=>sum+item.reading.value!,0)/items.length:null;
  return {logged:days.length,fine:days.filter(e=>e.fine).length,recalled:days.filter(e=>e.recalled).length,illness:days.filter(e=>e.illness).length,history:rows.filter(r=>r.value!==null).length,compatibleHistory:compatible.length,incompatible:rows.filter(r=>r.value!==null&&!compatible.includes(r)).length,missing:days.filter(e=>!compatible.some(r=>r.date===e.date)).length,comparable:joined.length,symptomCount:symptom.length,fineCount:fine.length,symptomMean:mean(symptom),fineMean:mean(fine),enough:symptom.length>=3&&fine.length>=3,rows,joined};
}
export function fixtureCheckins(today:string){return Array.from({length:24},(_,i)=>{
  const date=dayAdd(today,-i);const fine=i%2===0;
  return {id:`journal:${date}:household`,title:`${date} check-in`,revision:0,date,band:'household',fine,symptoms:fine?[]:['Sneezing'],severity:fine?'':'mild',illness:i===5,recalled:i===7,note:'',reviewOnly:true};
});}
export type ForecastPeriod={name:'Morning'|'Afternoon'|'Evening';start:string;end:string;air:number|null;airDaily?:string|null;uv:number|null;pollen:string|null;weather:string;tradeoff:string;version:string};
export function forecastFixture(date:string,scenario:ForecastScenario):ForecastPeriod[]{
  if(['unavailable','loading','error'].includes(scenario))return [];
  const changed=scenario==='changed';
  return [
    {name:'Morning',start:`${date}T08:00`,end:`${date}T11:00`,air:34,uv:2,pollen:'Moderate',weather:'18 °C, light breeze',tradeoff:'Lower UV than afternoon. Daily pollen still applies.'},
    {name:'Afternoon',start:`${date}T13:00`,end:`${date}T16:00`,air:changed?82:48,uv:scenario==='partial'?null:6,pollen:'Moderate',weather:changed?'26 °C, thunderstorm possible':'25 °C, partly cloudy',tradeoff:changed?'An updated storm outlook needs a fresh weather check.':'Higher UV than morning; consider shade and timing.'},
    {name:'Evening',start:`${date}T17:00`,end:`${date}T20:00`,air:scenario==='partial'?null:55,uv:1,pollen:'Moderate',weather:'21 °C, easing wind',tradeoff:'Lower UV, but air is not the lowest of these periods.'},
  ].map(p=>({...p,version:changed?'forecast-v2':'forecast-v1'} as ForecastPeriod));
}
export function seasonBounds(season:string,year:string){const start=`${year}-${season==='Spring'?'03':season==='Summer'?'06':season==='Fall'?'09':'12'}-01`;const next=season==='Winter'?`${Number(year)+1}-03-01`:`${year}-${season==='Spring'?'06':season==='Summer'?'09':'12'}-01`;return {start,end:dayAdd(next,-1)};}
