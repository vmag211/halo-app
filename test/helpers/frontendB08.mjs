/**
 * The frontend code `evidence.read` is judged by. `readingLabel` and
 * `analyzeHistory` are IMPORTED from the real `lib/frontend/week-evidence-preview.ts`
 * (compiled in memory by test/frontend-test-loader.mjs), so a change there
 * changes what the suites see. The hook's validator is still TRANSCRIBED,
 * not summarised, from this tree (the frontend is merged in at 1253025,
 * frontend ref 5ac06f6), because it lives in a `.tsx` component that cannot be
 * imported. TypeScript to JavaScript with the types stripped and nothing else
 * changed:
 *
 * - `components/production/WeekSources.tsx:7-9` (the body of
 *   useProductionHistory after its two hook calls: the envelope's data, the
 *   validator and the error it shows), as `productionHistory(read, runtime)`,
 *   where `read` is what useProductionResource returned and `runtime` is
 *   useProductionRuntime().
 *
 * One copy, for every B08 suite that needs it (test/dailyMaxima.test.mjs now;
 * the evidence route and contract suites later), so they cannot drift apart.
 * `TRANSCRIPTIONS` names the source and the exact type annotations removed.
 * The drift test in test/dailyMaxima.test.mjs reads the source at test time,
 * removes those annotations, and requires the result to equal the function
 * below character for character, so a change to that frontend line fails it.
 *
 * A transcription that accepted everything would pass every body it is given,
 * so test/dailyMaxima.test.mjs also shows the validator rejecting what the
 * client rejects.
 */
import { loadFrontend } from '../frontend-test-loader.mjs';

const evidencePreview = await loadFrontend('week-evidence-preview');

// ------------------------------------- imported: week-evidence-preview.ts

export const { readingLabel, analyzeHistory } = evidencePreview;

// ------------------------------------------- transcribed: WeekSources.tsx

export function productionHistory(read,runtime){
 const data=read.data;
 const valid=!!data&&Array.isArray(data.rows)&&typeof data.complete==='boolean'&&data.comparison?.context===runtime?.homeContextId&&data.comparison?.basis==='daily maximum'&&typeof data.comparison?.version==='string'&&data.rows.every(row=>row&&/^\d{4}-\d{2}-\d{2}$/.test(row.date)&&['Air','UV','Pollen','Outdoor mold'].includes(row.factor)&&(row.value===null||typeof row.value==='number'&&Number.isFinite(row.value))&&typeof row.source==='string'&&typeof row.issued==='string'&&typeof row.version==='string'&&typeof row.context==='string');
 return {...read,data:valid?data:null,error:read.error??(data&&!valid?'History could not be verified.':null)};
}

// ------------------------------------------------------- the drift record

/**
 * Each transcription: the source file, the line its text starts on, how many
 * lines it spans, and the type annotations removed, in order, each exactly
 * once. `body: true` compares only the function's body lines (the hook's own
 * first two lines call React and are replaced by the parameters).
 */
export const TRANSCRIPTIONS = Object.freeze([
  {
    fn: productionHistory,
    file: 'components/production/WeekSources.tsx',
    line: 7,
    lines: 3,
    body: true,
    // The line before the body: the hook reads evidence.read with exactly these keys.
    before: " const runtime=useProductionRuntime(),read=useProductionResource<HistorySnapshot>('evidence.read',{kind:'history',from,to});",
    strip: [],
  },
]);

// ------------------------------- transcribed: WeekEvidence.tsx (B08 Task 6)

/**
 * The screen's decisions for test/contractsB08.test.mjs, from
 * components/expanded/WeekEvidence.tsx. Its lines are long JSX, so each
 * function holds the line's pure expressions verbatim (types and `!` removed)
 * and turns its JSX text into the strings the screen renders. FRAGMENTS_T6
 * pins them: each `text` must occur in the function and its `source` (or the
 * same text) in the frontend line, character for character, and the drift
 * test in test/contractsB08.test.mjs reads the file at test time.
 *
 * `readingLabel` is the transcription above. `analyzeHistory`, `dayAdd`,
 * `seasonBounds`, `historyFixture` and `copy` are passed in: the contract
 * suite passes the real ones from lib/frontend (loaded with loadFrontend).
 * Season renders the same Trend over `report.rows` with
 * `live.data?.comparison` (line 44), so its chart is `trendView` too.
 */

/** Line 24 (SourceDetails): the Dataset, Versions and Latest issue cells. */
export function sourceDetails(rows){
 return {dataset:rows.length?[...new Set(rows.map(row=>row.source))].join(', '):'Unavailable',versions:[...new Set(rows.map(r=>r.version))].join(', ')||'Unavailable',latestIssue:rows.map(r=>r.issued).sort().at(-1)||'Unavailable'};
}

/** Lines 25-27 (Trend): the compatible-value filter, the maximum, the chart's bars, its caption and the date-keyed table. */
export function trendView(rows,comparison={basis:'daily maximum',version:'history-v1'}){
 const values=rows.filter(r=>r.value!==null&&r.basis===comparison.basis&&r.version===comparison.version);const maximum=Math.max(1,...values.map(r=>r.value));
 return {values,maximum,
  empty:!values.length?'No compatible values in this range.':null,
  bars:rows.flatMap((r,i)=>r.value!==null&&r.basis===comparison.basis&&r.version===comparison.version?[{key:r.date,x:12+i*294/Math.max(1,rows.length-1)}]:[]),
  caption:values.length?`${rows[0]?.date} to ${rows.at(-1)?.date}. Gaps are missing or incompatible readings, not zero. ${rows[0]?.factor==='Pollen'?'Bars show Low, Moderate and High categories; they are not concentrations.':`${rows[0]?.unit}. Vertical range 0 to ${maximum}.`}`:null,
  table:rows.map(r=>({key:r.date,reading:readingLabel(r),missing:r.missing||null,basis:r.basis,separate:r.version!==comparison.version?'Separate source version, excluded':null}))};
}

/** Line 31: the range Patterns reads (the hook call's arguments). */
export function patternsRequest(today,dayAdd){return {from:dayAdd(today,-83),to:today};}

/** Lines 31, 32, 35, 37 and 38 (WeekPatterns): what the screen decides and shows from `live` (the hook's answer plus `production`). */
export function patternsView({live,entries,today,range,group,factor,selected,review,analyzeHistory,dayAdd,historyFixture,copy}){
 const days=Array.from({length:84},(_,i)=>dayAdd(today,i-83));
 const readings=live.production?(live.data?.rows??[]):historyFixture(today,review.history);const from=dayAdd(today,1-range);const report=analyzeHistory(entries,readings,from,today,group,factor,live.data?.comparison);const visibleEntries=live.production?entries.filter(e=>e.homeContextId===live.data?.comparison.context):entries;const entry=visibleEntries.find(e=>e.band===group&&e.date===selected);const reading=readings.find(r=>r.factor===factor&&r.date===selected);
 const matching=(date)=>visibleEntries.find(e=>e.band===group&&e.date===date);const matchingReading=(date)=>readings.find(r=>r.factor===factor&&r.date===date);
 const busy=live.production?live.loading||!!live.error:['loading','error'].includes(review.history);const category=factor==='Pollen';const comparable=report.enough&&!category;const noDifference=comparable&&Math.abs(report.symptomMean-report.fineMean)<1;
 return {days,readings,from,report,visibleEntries,entry,reading,matching,matchingReading,busy,category,comparable,noDifference,
  status:busy?((live.production?live.loading:review.history==='loading')?'Loading environmental history':(live.production?live.error:copy.historyError)):null,
  unavailable:!busy&&(!live.production&&review.history==='unavailable'||live.production&&!live.data)?copy.historyUnavailable:null,
  pulse:busy?null:[`${report.logged} logged`,`${report.history} history days`,`${report.comparable} comparable readings`],
  heading:comparable?noDifference?copy.noPattern:'A descriptive comparison':copy.insufficient,
  findings:comparable?[`${report.symptomMean.toFixed(1)} ${factor==='Air'?'AQI':'UV index'}`,`${report.fineMean.toFixed(1)} ${factor==='Air'?'AQI':'UV index'}`]:null,
  selectedReading:`${factor}: ${readingLabel(reading)}`,
  selectedDetail:reading?(reading.missing||`${reading.basis}, ${reading.version}. Issued ${reading.issued}.`):null};
}

/** Line 43 (WeekSeason): the season's bounds, the clamp at today, the period's day count and the range it reads. */
export function seasonRange({season,year,today,seasonBounds}){
 const bounds=seasonBounds(season,year);const through=bounds.end<today?bounds.end:today;const periodDays=bounds.start>today?0:Math.round((Date.parse(`${through}T12:00:00Z`)-Date.parse(`${bounds.start}T12:00:00Z`))/86400000)+1;
 return {bounds,through,periodDays,request:{from:bounds.start,to:through<bounds.start?bounds.start:through}};
}

/** Lines 43, 44 and 46 (WeekSeason): the analysis, the status row, the pulse and the coverage sentence. */
export function seasonView({live,entries,today,range:{bounds,through,periodDays},group,factor,review,analyzeHistory,historyFixture}){
 const readings=live.production?(live.data?.rows??[]):historyFixture(today,review.history);const report=analyzeHistory(entries,readings,bounds.start,through,group,factor,live.data?.comparison);
 return {readings,report,
  status:live.production&&(live.loading||live.error)?(live.loading?'Loading history…':live.error):null,
  pulse:[`${report.logged}/${periodDays} logged days`,`${report.history}/${periodDays} history days`,`${report.comparable} comparable readings`],
  coverage:`${report.recalled} recalled entries, ${report.illness} illness flags, ${report.missing} logged days without compatible readings and ${report.incompatible} history days with a different basis.`};
}

/**
 * The drift record of the functions above: `text` occurs in the function's
 * source and `source ?? text` in WeekEvidence.tsx at `line`.
 */
const WE = 'components/expanded/WeekEvidence.tsx';
export const FRAGMENTS_T6 = Object.freeze([
  { fn: sourceDetails, line: 24, text: "rows.length?[...new Set(rows.map(row=>row.source))].join(', '):'Unavailable'" },
  { fn: sourceDetails, line: 24, text: "[...new Set(rows.map(r=>r.version))].join(', ')||'Unavailable'" },
  { fn: sourceDetails, line: 24, text: "rows.map(r=>r.issued).sort().at(-1)||'Unavailable'" },
  { fn: trendView, line: 25, text: "comparison={basis:'daily maximum',version:'history-v1'}" },
  { fn: trendView, line: 26, text: 'const values=rows.filter(r=>r.value!==null&&r.basis===comparison.basis&&r.version===comparison.version);const maximum=Math.max(1,...values.map(r=>r.value' },
  { fn: trendView, line: 27, text: "!values.length?'No compatible values in this range.'", source: '{!values.length?<p>No compatible values in this range.</p>' },
  { fn: trendView, line: 27, text: 'r.value!==null&&r.basis===comparison.basis&&r.version===comparison.version?' },
  { fn: trendView, line: 27, text: '12+i*294/Math.max(1,rows.length-1)' },
  { fn: trendView, line: 27, text: '${rows[0]?.date} to ${rows.at(-1)?.date}. Gaps are missing or incompatible readings, not zero. ', source: '{rows[0]?.date} to {rows.at(-1)?.date}. Gaps are missing or incompatible readings, not zero. ' },
  { fn: trendView, line: 27, text: "rows[0]?.factor==='Pollen'?'Bars show Low, Moderate and High categories; they are not concentrations.':`${rows[0]?.unit}. Vertical range 0 to ${maximum}.`" },
  { fn: trendView, line: 27, text: 'key:r.date', source: 'rows.map(r=><tr key={r.date}>' },
  { fn: trendView, line: 27, text: 'reading:readingLabel(r),missing:r.missing', source: '<td>{readingLabel(r)}{r.missing&&<small>{r.missing}</small>}</td>' },
  { fn: trendView, line: 27, text: "r.version!==comparison.version?'Separate source version, excluded'", source: '{r.version!==comparison.version&&<small>Separate source version, excluded</small>}' },
  { fn: patternsRequest, line: 31, text: 'dayAdd(today,-83),to:today', source: 'useProductionHistory(dayAdd(today,-83),today)' },
  { fn: patternsView, line: 31, text: 'const days=Array.from({length:84},(_,i)=>dayAdd(today,i-83));' },
  { fn: patternsView, line: 31, text: 'const readings=live.production?(live.data?.rows??[]):historyFixture(today,review.history);const from=dayAdd(today,1-range);const report=analyzeHistory(entries,readings,from,today,group,factor,live.data?.comparison);const visibleEntries=live.production?entries.filter(e=>e.homeContextId===live.data?.comparison.context):entries;const entry=visibleEntries.find(e=>e.band===group&&e.date===selected);const reading=readings.find(r=>r.factor===factor&&r.date===selected);' },
  { fn: patternsView, line: 31, text: '=>visibleEntries.find(e=>e.band===group&&e.date===date);' },
  { fn: patternsView, line: 31, text: '=>readings.find(r=>r.factor===factor&&r.date===date);' },
  { fn: patternsView, line: 32, text: "const busy=live.production?live.loading||!!live.error:['loading','error'].includes(review.history);const category=factor==='Pollen';const comparable=report.enough&&!category;const noDifference=comparable&&Math.abs(report.symptomMean" },
  { fn: patternsView, line: 32, text: '-report.fineMean' },
  { fn: patternsView, line: 35, text: '${factor}: ${readingLabel(reading)}', source: '<strong>{factor}: {readingLabel(reading)}</strong>' },
  { fn: patternsView, line: 35, text: 'reading?(reading.missing||`${reading.basis}, ${reading.version}. Issued ${reading.issued}.`)', source: '{reading&&<p className="mw-muted">{reading.missing||`${reading.basis}, ${reading.version}. Issued ${reading.issued}.`}</p>}' },
  { fn: patternsView, line: 37, text: "busy?((live.production?live.loading:review.history==='loading')?'Loading environmental history':(live.production?live.error:copy.historyError))", source: "{busy?<div role=\"status\" className=\"mw-empty\">{(live.production?live.loading:review.history==='loading')?<HaloLoading label=\"Loading environmental history\" />:<p>{live.production?live.error:copy.historyError}</p>}" },
  { fn: patternsView, line: 37, text: "(!live.production&&review.history==='unavailable'||live.production&&!live.data)?copy.historyUnavailable", source: "{(!live.production&&review.history==='unavailable'||live.production&&!live.data)&&<p>{copy.historyUnavailable}</p>}" },
  { fn: patternsView, line: 37, text: '`${report.logged} logged`,`${report.history} history days`,`${report.comparable} comparable readings`', source: '<span><strong>{report.logged}</strong> logged</span><span><strong>{report.history}</strong> history days</span><span><strong>{report.comparable}</strong> comparable readings</span>' },
  { fn: patternsView, line: 38, text: "comparable?noDifference?copy.noPattern:'A descriptive comparison':copy.insufficient" },
  { fn: patternsView, line: 38, text: "${report.symptomMean.toFixed(1)} ${factor==='Air'?'AQI':'UV index'}", source: "{report.symptomMean!.toFixed(1)} {factor==='Air'?'AQI':'UV index'}" },
  { fn: patternsView, line: 38, text: "${report.fineMean.toFixed(1)} ${factor==='Air'?'AQI':'UV index'}", source: "{report.fineMean!.toFixed(1)} {factor==='Air'?'AQI':'UV index'}" },
  { fn: seasonRange, line: 43, text: 'const bounds=seasonBounds(season,year);const through=bounds.end<today?bounds.end:today;const periodDays=bounds.start>today?0:Math.round((Date.parse(`${through}T12:00:00Z`)-Date.parse(`${bounds.start}T12:00:00Z`))/86400000)+1;' },
  { fn: seasonRange, line: 43, text: 'bounds.start,to:through<bounds.start?bounds.start:through', source: 'useProductionHistory(bounds.start,through<bounds.start?bounds.start:through)' },
  { fn: seasonView, line: 43, text: 'const readings=live.production?(live.data?.rows??[]):historyFixture(today,review.history);const report=analyzeHistory(entries,readings,bounds.start,through,group,factor,live.data?.comparison);' },
  { fn: seasonView, line: 44, text: "live.production&&(live.loading||live.error)?(live.loading?'Loading history…':live.error)", source: "{live.production&&(live.loading||live.error)&&<p role=\"status\">{live.loading?'Loading history…':live.error}" },
  { fn: seasonView, line: 44, text: '`${report.logged}/${periodDays} logged days`,`${report.history}/${periodDays} history days`,`${report.comparable} comparable readings`', source: '<span><strong>{report.logged}/{periodDays}</strong> logged days</span><span><strong>{report.history}/{periodDays}</strong> history days</span><span><strong>{report.comparable}</strong> comparable readings</span>' },
  { fn: seasonView, line: 46, text: '${report.recalled} recalled entries, ${report.illness} illness flags, ${report.missing} logged days without compatible readings and ${report.incompatible} history days with a different basis.', source: '{report.recalled} recalled entries, {report.illness} illness flags, {report.missing} logged days without compatible readings and {report.incompatible} history days with a different basis.' },
].map((f) => ({ file: WE, ...f })));
