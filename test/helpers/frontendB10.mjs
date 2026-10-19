/**
 * The frontend code `forecast.read` is judged by, TRANSCRIBED, not summarised,
 * from this tree. TypeScript to JavaScript with the types stripped and nothing
 * else changed:
 *
 * - `components/production/WeekSources.tsx:14-17` (the body of
 *   useProductionForecast after its hook call: the envelope's data, the
 *   validator and the error it shows), as `productionForecast(read)`, where
 *   `read` is what useProductionResource returned;
 * - `components/production/WeekSources.tsx:19` (forecastTime);
 * - `components/expanded/WeekOutdoors.tsx:32` (the screen's pure decisions:
 *   far, available, periods, currentPeriod, selectionSignature, existing,
 *   expired, changed, needsReview), verbatim as the body of
 *   `outdoorDecisions`, whose parameters are the component's own locals and
 *   imports of the same names;
 * - fragments of `WeekOutdoors.tsx:31,44,45,46` that turn a validated body into
 *   text on screen (the Source row, the Issued line, the Air, UV and Pollen
 *   cells, the coverage cells, the Horizon, Expiry and Official notices rows).
 *
 * Written by B10 Task 7 (every snapshot body is run through it); Task 9 adds
 * the rest of the screen (validate, nextMeta, the task reason) and the
 * runtime-level contract suite.
 *
 * `TRANSCRIPTIONS` records each source line and the exact annotations removed;
 * `FRAGMENTS` records text that must appear, character for character, both in
 * the frontend line and in the transcribed function. The drift tests in
 * test/forecastSnapshot.test.mjs read the files at test time, so a change to
 * any of those frontend lines fails them.
 */

// ------------------------------------------- transcribed: WeekSources.tsx

export function productionForecast(read){
 const value=read.data;
 let valid=!!value&&Array.isArray(value.periods)&&Number.isFinite(Date.parse(value.issuedAt))&&Number.isFinite(Date.parse(value.expiresAt))&&typeof value.zone==='string'&&typeof value.source==='string'&&typeof value.version==='string'&&typeof value.horizonStart==='string'&&typeof value.horizonEnd==='string'&&typeof value.warningStatus==='string'&&!!value.coverage&&value.periods.every(row=>row&&['Morning','Afternoon','Evening'].includes(row.name)&&Number.isFinite(Date.parse(row.start))&&Number.isFinite(Date.parse(row.end))&&/Z$|[+-]\d{2}:\d{2}$/.test(row.start)&&/Z$|[+-]\d{2}:\d{2}$/.test(row.end)&&Date.parse(row.end)>Date.parse(row.start)&&(row.air===null||typeof row.air==='number'&&Number.isFinite(row.air))&&(row.uv===null||typeof row.uv==='number'&&Number.isFinite(row.uv))&&(row.pollen===null||typeof row.pollen==='string')&&typeof row.weather==='string'&&typeof row.tradeoff==='string'&&typeof row.version==='string');
 try{if(valid)new Intl.DateTimeFormat('en',{timeZone:value.zone});}catch{valid=false;}
 return {...read,data:valid?value:null,error:read.error??(value&&!valid?'Forecast information could not be verified.':null)};
}

export function forecastTime(instant,zone){return new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(instant));}

// ------------------------------------------- transcribed: WeekOutdoors.tsx

/** Line 32, verbatim. `live` is what useProductionForecast returned plus `production`. */
export function outdoorDecisions({live,draft,today,review,state,now,acknowledged,pauseForecast,validActionDate,dayAdd,forecastFixture}){
 const far=Boolean(draft.date&&(live.production?live.data&&draft.date>live.data.horizonEnd.slice(0,10):draft.date>dayAdd(today,2)));const available=Boolean(validActionDate(draft.date)&&draft.date&&!far&&draft.date>=today&&!['unavailable','loading','error'].includes(review.forecast));const periods=pauseForecast?[]:live.production?(live.data?.periods??[]):available?forecastFixture(draft.date,review.forecast):[];const currentPeriod=periods.find(p=>p.name===draft.period);const selectionSignature=`${live.production?live.data?.version??'unavailable':review.forecast}:${draft.date}:${draft.place}:${draft.period}`;const existing=state?.actions.find(a=>a.key===draft.key);const expired=live.production?!!live.data&&Date.parse(live.data.expiresAt)<=now:available&&review.forecast==='expired';const changed=live.production?!!live.data?.changedMessage:available&&review.forecast==='changed';const needsReview=changed&&acknowledged!==selectionSignature;
 return {far,available,periods,currentPeriod,selectionSignature,existing,expired,changed,needsReview};
}

/** The production branches of the text the screen renders from a validated body. */
export function forecastScreenText(live,p){
 const sourceName=live.production?(live.data?.source??'Unavailable'):null;
 const issued=live.production?live.data?.issuedAt:null;
 const cells=p?{air:p.air===null?'Unavailable':`${p.air} AQI`,uv:p.uv===null?'Unavailable':`${p.uv} UV index`,pollen:p.pollen??'Unavailable',weather:p.weather,tradeoff:p.tradeoff}:null;
 const coverage=Object.fromEntries(['Air','UV','Pollen','Weather'].map(f=>[f,(live.data?.coverage[f]??'Unavailable')]));
 const horizon=(live.data?`${live.data.horizonStart} through ${live.data.horizonEnd}`:'Unavailable');
 const expiry=(live.data?.expiresAt??'Unavailable');
 const notices=live.data?.warningStatus??'Warnings unavailable. Check the official site.';
 return {sourceName,issued,cells,coverage,horizon,expiry,notices};
}

// ------------------------------------------------------- the drift record

/**
 * Whole-line transcriptions: the source file, the line its text starts on,
 * how many lines it spans, and the type annotations removed, in order, each
 * exactly once. `body: true` compares the function's first `lines` body lines
 * (the hook's own call and the decisions' return line are not frontend text).
 */
export const TRANSCRIPTIONS = Object.freeze([
  {
    fn: productionForecast,
    file: 'components/production/WeekSources.tsx',
    line: 14,
    lines: 4,
    body: true,
    // The line before the body: the hook reads forecast.read with exactly these keys, only when a date is set.
    before: " const read=useProductionResource<ForecastSnapshot>('forecast.read',{date,place},!!date);",
    strip: [['timeZone:value!.zone', 'timeZone:value.zone']],
  },
  {
    fn: forecastTime,
    file: 'components/production/WeekSources.tsx',
    line: 19,
    lines: 1,
    strip: [['export ', ''], ['(instant:string,zone:string)', '(instant,zone)']],
  },
  {
    fn: outdoorDecisions,
    file: 'components/expanded/WeekOutdoors.tsx',
    line: 32,
    lines: 1,
    body: true,
    strip: [],
  },
]);

/** Text that must occur in the frontend line and in the transcribed function, exactly. */
export const FRAGMENTS = Object.freeze([
  { fn: forecastScreenText, file: 'components/expanded/WeekOutdoors.tsx', line: 31, text: "live.production?(live.data?.source??'Unavailable')" },
  { fn: forecastScreenText, file: 'components/expanded/WeekOutdoors.tsx', line: 44, text: 'live.production?live.data?.issuedAt' },
  { fn: forecastScreenText, file: 'components/expanded/WeekOutdoors.tsx', line: 45, text: "p.air===null?'Unavailable':`${p.air} AQI`" },
  { fn: forecastScreenText, file: 'components/expanded/WeekOutdoors.tsx', line: 45, text: "p.uv===null?'Unavailable':`${p.uv} UV index`" },
  { fn: forecastScreenText, file: 'components/expanded/WeekOutdoors.tsx', line: 45, text: "p.pollen??'Unavailable'" },
  { fn: forecastScreenText, file: 'components/expanded/WeekOutdoors.tsx', line: 46, text: "['Air','UV','Pollen','Weather']" },
  { fn: forecastScreenText, file: 'components/expanded/WeekOutdoors.tsx', line: 46, text: "(live.data?.coverage[f]??'Unavailable')" },
  { fn: forecastScreenText, file: 'components/expanded/WeekOutdoors.tsx', line: 46, text: "(live.data?`${live.data.horizonStart} through ${live.data.horizonEnd}`:'Unavailable')" },
  { fn: forecastScreenText, file: 'components/expanded/WeekOutdoors.tsx', line: 46, text: "(live.data?.expiresAt??'Unavailable')" },
  { fn: forecastScreenText, file: 'components/expanded/WeekOutdoors.tsx', line: 46, text: "live.data?.warningStatus??'Warnings unavailable. Check the official site.'" },
]);
