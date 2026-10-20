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
 *   text on screen (the zone and period times, the Source row, the Issued
 *   line, the empty-state message, the Air, UV and Pollen cells, the coverage
 *   cells, the Horizon, Expiry and Official notices rows).
 *
 * Written by B10 Task 7 (every snapshot body is run through it). Task 9 adds,
 * for test/contractsB10.test.mjs:
 *
 * - `components/expanded/WeekOutdoors.tsx:33` (validate, the save check and
 *   its forecast branches), verbatim as the body of `outdoorValidate`;
 * - `components/expanded/WeekOutdoors.tsx:36-38` (nextMeta with `time` and
 *   `zone`, the save options, and the task `reason`), verbatim as the body of
 *   `outdoorCommitTail`, with `:WeekMeta` and one `!` removed;
 * - `components/production/ProductionContext.tsx:9,14` (useProductionResource:
 *   the input's JSON round trip, then data or serviceMessage(error)), as
 *   `resourceRead`;
 * - fragments of `WeekOutdoors.tsx:44,45` (the loading and error row with
 *   Retry forecast, the Issued line, the Refresh forecast and changed notices,
 *   the check-again date), as `forecastNotices` and `checkAgainDate`.
 *
 * Those are recorded in `TRANSCRIPTIONS_T9` and `FRAGMENTS_T9`, checked by the
 * drift tests in test/contractsB10.test.mjs (Task 7's lists, and the test
 * that counts them, are unchanged).
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

/** Line 31: the zone the screen uses and how it prints a period bound (forecastTime passed in). */
export function screenPeriodTime(live,forecastTime){
 const forecastZone=live.data?.zone??'UTC';
 const periodTime=(instant)=>live.production?forecastTime(instant,forecastZone):instant.slice(11);
 return {forecastZone,periodTime};
}

/** Line 45: the message under the period buttons when there are no periods. */
export function emptyStateMessage(far,review,copy){
 return far?copy.future:review.forecast==='loading'?'Loading forecast coverage...':review.forecast==='error'?'Forecasts could not load. Your plan is kept.':copy.forecastUnavailable;
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

/** Line 33, verbatim: the save check. Its free names are the component's locals and imports. */
export function outdoorValidate({placeReview,blocked,navigator,draft,validActionDate,today,expired,live,copy,needsReview}){
 function validate(){if(placeReview)return 'Choose and confirm a planning area of 100 characters or fewer. The full organizer address stays in Opportunity context.';if(blocked||!navigator.onLine)return 'Could not save. Your plan is kept.';if(!draft.activity.trim()||!draft.date||!validActionDate(draft.date)||draft.date<today||!Number.isInteger(draft.duration)||draft.duration<15||draft.duration>480)return 'Add an activity, a current or future date, and 15 to 480 minutes.';if(expired||live.data&&Date.parse(live.data.expiresAt)<=Date.now())return copy.forecastExpired;if(needsReview)return copy.forecastChanged;return '';}
 return validate();
}

/**
 * Lines 36 to 38, verbatim: what a save sends. `nextMeta` (the B06 task meta, with the period's
 * start as `time` in `forecastZone`), the save options and the task `reason`; `state` is the
 * My Week store (addActions or reviseAction), passed in.
 */
export async function outdoorCommitTail({emptyWeekMeta,metas,draft,currentPeriod,periodTime,forecastZone,today,existing,change,live,state,sourceName}){
  const nextMeta={...emptyWeekMeta,...metas[draft.key],duration:draft.duration,estimateSet:true,time:currentPeriod?periodTime(currentPeriod.start):'',zone:forecastZone,note:`${draft.place||'Place not specified'}. ${draft.period}. Preparation checked: ${(draft.preparation??[]).join('; ')||'None'}. Watch: ${draft.watch?'requested, not activated':'off'}. Household context: ${draft.group||'general'}.`,history:[...(metas[draft.key]?.history??[]),`${today}: Outdoor plan ${existing?'updated after review':'saved'}. ${currentPeriod?.version??'No forecast'}.`]};
  const options={metadata:{[draft.key]:nextMeta},expectedMetadata:existing?{[draft.key]:change.signature}:undefined,preferences:{outdoorPlan:{key:draft.key,place:draft.place,period:draft.period,watchRequested:draft.watch,forecastVersion:live.data?.version??null,forecastIssuedAt:live.data?.issuedAt??null,forecastExpiresAt:live.data?.expiresAt??null}}};
  const saved=existing?!!change&&await state?.reviseAction(change.id,change.revision,{title:change.title,date:change.date,state:change.state},options):await state?.addActions([{key:draft.key,title:draft.activity.trim().slice(0,160),origin:'Outdoors',reason:currentPeriod?`Outdoor plan. Forecast ${currentPeriod.version}, ${sourceName}. Review conditions before going.`:'Forecast unavailable. Recheck official conditions before going.'}],draft.date,options);
 return {nextMeta,options,saved};
}

/**
 * components/production/ProductionContext.tsx:9,14: how useProductionResource turns one
 * runtime.request into the read the hook returns (signature round trip, data or the
 * service's own sentence). The abort, scope and attempt bookkeeping are left out.
 */
export async function resourceRead(runtime,operation,input,serviceMessage){
 const signature=JSON.stringify(input);
 let state;
 await runtime.request(operation,signature===undefined?undefined:JSON.parse(signature),{signal:new AbortController().signal}).then(data=>{state={data,loading:false,error:null};},error=>{state={data:null,loading:false,error:serviceMessage(error)};});
 return {...state,production:true,retry:()=>{}};
}

/** Line 44: the loading and error row above the periods, and the notices shown with periods. */
export function forecastNotices(live,{forecastZone,expired,changed,needsReview,copy}){
 const status=live.production&&(live.loading||live.error)?{loading:live.loading?'Loading forecast':null,message:live.loading?null:live.error,retry:!!live.error&&'Retry forecast'}:null;
 const issuedLine=`Times in ${forecastZone}. Issued ${live.production?live.data?.issuedAt:''}.`;
 const expiredNotice=expired?{message:copy.forecastExpired,control:'Refresh forecast'}:null;
 const changedNotice=changed?{message:copy.forecastChanged,detail:live.production?live.data?.changedMessage:null,control:needsReview?'I reviewed these changes':'Changes reviewed'}:null;
 return {status,issuedLine,expiredNotice,changedNotice};
}

/** Line 45: the check-again date offered under a date past the horizon. */
export function checkAgainDate(far,draft,dayAdd){
 return far?(draft.checkDate||dayAdd(draft.date,-2)):null;
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
  { fn: screenPeriodTime, file: 'components/expanded/WeekOutdoors.tsx', line: 31, text: "const forecastZone=live.data?.zone??'UTC';" },
  { fn: screenPeriodTime, file: 'components/expanded/WeekOutdoors.tsx', line: 31, text: 'live.production?forecastTime(instant,forecastZone):instant.slice(11)' },
  // `source` is the delimited form that must occur in the frontend line, so a prefix such as `!` is caught.
  { fn: emptyStateMessage, file: 'components/expanded/WeekOutdoors.tsx', line: 45, text: "far?copy.future:review.forecast==='loading'?'Loading forecast coverage...':review.forecast==='error'?'Forecasts could not load. Your plan is kept.':copy.forecastUnavailable", source: "{far?copy.future:review.forecast==='loading'?'Loading forecast coverage...':review.forecast==='error'?'Forecasts could not load. Your plan is kept.':copy.forecastUnavailable}" },
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

/** Task 9's whole-line transcriptions, in the same form as TRANSCRIPTIONS (checked in test/contractsB10.test.mjs). */
export const TRANSCRIPTIONS_T9 = Object.freeze([
  { fn: outdoorValidate, file: 'components/expanded/WeekOutdoors.tsx', line: 33, lines: 1, body: true, strip: [] },
  {
    fn: outdoorCommitTail,
    file: 'components/expanded/WeekOutdoors.tsx',
    line: 36,
    lines: 3,
    body: true,
    strip: [['const nextMeta:WeekMeta=', 'const nextMeta='], ['change!.signature', 'change.signature']],
  },
]);

/** Task 9's fragments, in the same form as FRAGMENTS. */
export const FRAGMENTS_T9 = Object.freeze([
  { fn: resourceRead, file: 'components/production/ProductionContext.tsx', line: 9, text: 'signature=JSON.stringify(input)' },
  { fn: resourceRead, file: 'components/production/ProductionContext.tsx', line: 14, text: 'signature===undefined?undefined:JSON.parse(signature),{signal:' },
  { fn: resourceRead, file: 'components/production/ProductionContext.tsx', line: 14, text: 'data:null,loading:false,error:serviceMessage(error)' },
  { fn: resourceRead, file: 'components/production/ProductionContext.tsx', line: 14, text: 'data,loading:false,error:null' },
  { fn: forecastNotices, file: 'components/expanded/WeekOutdoors.tsx', line: 44, text: 'live.production&&(live.loading||live.error)' },
  { fn: forecastNotices, file: 'components/expanded/WeekOutdoors.tsx', line: 44, text: 'Loading forecast', source: '<HaloLoading label="Loading forecast" />' },
  { fn: forecastNotices, file: 'components/expanded/WeekOutdoors.tsx', line: 44, text: 'Retry forecast', source: '{live.error&&<button className="mw-text" type="button" onClick={live.retry}>Retry forecast</button>}' },
  { fn: forecastNotices, file: 'components/expanded/WeekOutdoors.tsx', line: 44, text: 'Times in ', source: '<p className="mw-muted">Times in {forecastZone}. Issued {live.production?live.data?.issuedAt:' },
  { fn: forecastNotices, file: 'components/expanded/WeekOutdoors.tsx', line: 44, text: 'Refresh forecast', source: "{expired&&<div className=\"we-notice\" role=\"status\"><p>{copy.forecastExpired}</p><button className=\"mw-text\" type=\"button\" onClick={()=>{if(live.production)live.retry();else setReview({...review,forecast:'current'});setAcknowledged('');}}>Refresh forecast</button></div>}" },
  { fn: forecastNotices, file: 'components/expanded/WeekOutdoors.tsx', line: 44, text: 'live.production?live.data?.changedMessage:', source: "{changed&&<div className=\"we-notice\" role=\"status\"><p>{copy.forecastChanged}</p><p>{live.production?live.data?.changedMessage:" },
  { fn: forecastNotices, file: 'components/expanded/WeekOutdoors.tsx', line: 44, text: "needsReview?'I reviewed these changes':'Changes reviewed'" },
  { fn: checkAgainDate, file: 'components/expanded/WeekOutdoors.tsx', line: 45, text: 'draft.checkDate||dayAdd(draft.date,-2)', source: '{far&&<label>Check again on<DateInput todayDate={today} value={draft.checkDate||dayAdd(draft.date,-2)}' },
]);
