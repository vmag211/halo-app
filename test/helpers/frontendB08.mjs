/**
 * The frontend code `evidence.read` is judged by, TRANSCRIBED, not summarised,
 * from this tree (the frontend is merged in at 1253025, frontend ref 5ac06f6).
 * TypeScript to JavaScript with the types stripped and nothing else changed:
 *
 * - `lib/frontend/week-evidence-preview.ts:39` (readingLabel);
 * - `lib/frontend/week-evidence-preview.ts:40-48` (analyzeHistory);
 * - `components/production/WeekSources.tsx:7-9` (the body of
 *   useProductionHistory after its two hook calls: the envelope's data, the
 *   validator and the error it shows), as `productionHistory(read, runtime)`,
 *   where `read` is what useProductionResource returned and `runtime` is
 *   useProductionRuntime().
 *
 * One copy, for every B08 suite that needs it (test/dailyMaxima.test.mjs now;
 * the evidence route and contract suites later), so they cannot drift apart.
 * `TRANSCRIPTIONS` names each source and the exact type annotations removed.
 * The drift test in test/dailyMaxima.test.mjs reads the source at test time,
 * removes those annotations, and requires the result to equal the functions
 * below character for character, so a change to any of those frontend lines
 * fails it.
 *
 * A transcription that accepted everything would pass every body it is given,
 * so test/dailyMaxima.test.mjs also shows the validator rejecting what the
 * client rejects.
 */

// ------------------------------------- transcribed: week-evidence-preview.ts

export function readingLabel(reading){if(!reading||reading.value===null)return 'Unavailable';return reading.factor==='Pollen'?['','Low','Moderate','High'][reading.value]??'Unknown category':`${reading.value} ${reading.unit}`;}

export function analyzeHistory(entries,readings,from,to,group,factor,comparison){
  const days=entries.filter(e=>e.band===group&&e.date>=from&&e.date<=to&&(!comparison||e.homeContextId===comparison.context));
  const rows=readings.filter(r=>r.factor===factor&&r.date>=from&&r.date<=to);
  const compatible=rows.filter(r=>r.value!==null&&r.basis===(comparison?.basis??'daily maximum')&&r.context===(comparison?.context??'review-home')&&r.version===(comparison?.version??'history-v1'));
  const joined=days.flatMap(entry=>{const reading=compatible.find(r=>r.date===entry.date);return !entry.recalled&&!entry.illness&&reading?[{entry,reading}]:[];});
  const symptom=joined.filter(x=>!x.entry.fine&&x.entry.symptoms.length>0);const fine=joined.filter(x=>x.entry.fine);
  const mean=(items)=>items.length?items.reduce((sum,item)=>sum+item.reading.value,0)/items.length:null;
  return {logged:days.length,fine:days.filter(e=>e.fine).length,recalled:days.filter(e=>e.recalled).length,illness:days.filter(e=>e.illness).length,history:rows.filter(r=>r.value!==null).length,compatibleHistory:compatible.length,incompatible:rows.filter(r=>r.value!==null&&!compatible.includes(r)).length,missing:days.filter(e=>!compatible.some(r=>r.date===e.date)).length,comparable:joined.length,symptomCount:symptom.length,fineCount:fine.length,symptomMean:mean(symptom),fineMean:mean(fine),enough:symptom.length>=3&&fine.length>=3,rows,joined};
}

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
    fn: readingLabel,
    file: 'lib/frontend/week-evidence-preview.ts',
    line: 39,
    lines: 1,
    strip: [['export ', ''], ['(reading:HistoryReading|undefined)', '(reading)']],
  },
  {
    fn: analyzeHistory,
    file: 'lib/frontend/week-evidence-preview.ts',
    line: 40,
    lines: 9,
    strip: [
      ['export ', ''],
      ["(entries:AnalysisEntry[],readings:HistoryReading[],from:string,to:string,group:string,factor:HistoryFactor,comparison?:{context:string;basis:'daily maximum'|'app-time observation';version:string})", '(entries,readings,from,to,group,factor,comparison)'],
      ['(items:typeof joined)=>', '(items)=>'],
      ['item.reading.value!,0', 'item.reading.value,0'],
    ],
  },
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
