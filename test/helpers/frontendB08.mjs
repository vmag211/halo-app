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
