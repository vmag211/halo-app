/**
 * What the Summary screen does with a list, a prepare, a reconcile and a
 * read, TRANSCRIBED from components/homeguard/useProductionSummary.ts in this
 * tree (types stripped, React state as plain fields), and the production
 * request builder from components/homeguard/SummaryWorkspace.tsx. The
 * validators are NOT transcribed: `validSummaryList`, `validSummaryReceipt`
 * and `validSummarySnapshot` are the client's own module
 * (lib/frontend/production/summary-service.ts), as are `serviceMessage`,
 * `FrontendServiceError` (runtime.ts), `defaultSummarySelection`,
 * `summaryDateError` and `withinSummaryDates` (home-maintenance-preview.ts),
 * compiled by test/frontend-test-loader.mjs.
 *
 * Transcribed:
 *   useProductionSummary.ts:8      the list (useProductionResource 'summary.list' {})
 *   useProductionSummary.ts:12     data, unknown
 *   useProductionSummary.ts:13-18  accept
 *   useProductionSummary.ts:19-22  prepare
 *   useProductionSummary.ts:24     reconcile
 *   useProductionSummary.ts:25     open
 *   useProductionSummary.ts:26     the returned view (error, ready, archives, complete)
 *   SummaryWorkspace.tsx:56        the production default selection
 *   SummaryWorkspace.tsx:64        sources
 *   SummaryWorkspace.tsx:68-69     missingSections, selectedRecords
 *   SummaryWorkspace.tsx:109-114   preview (the production branch)
 *
 * Declared seams, none of which changes an outcome a route can cause:
 * - `list.retry()` re-reads the list; here it is awaited, where React would
 *   re-render when it lands.
 * - Drafts (`summary:prepared`, `summary:pending`) are plain fields.
 * - `recordDate` is the server's transcription (lib/summaryStore.js), which
 *   test/summaryCompose.test.mjs proves equal to the TSX's own.
 */
import { loadFrontend } from '../frontend-test-loader.mjs';

const { validSummaryList, validSummaryReceipt, validSummarySnapshot } = await loadFrontend('production/summary-service');
const { FrontendServiceError, serviceMessage } = await loadFrontend('production/runtime');
const { defaultSummarySelection, summaryDateError, withinSummaryDates } = await loadFrontend('home-maintenance-preview');
const { recordDate } = await import('../../lib/summaryStore.js');

export { validSummaryList, validSummaryReceipt, validSummarySnapshot, defaultSummarySelection };

/** The production starting selection (SummaryWorkspace.tsx:56). */
export const productionSelection = (year = new Date().getFullYear()) => ({ ...defaultSummarySelection, start: `${year}-01-01`, end: `${year}-12-31` });

export function productionSummary(runtime) {
  const state = { listData: null, listError: null, listLoading: false, snapshot: null, busy: false, message: '', localUnknown: [], resolved: [] };
  let lock = false;

  async function loadList() {
    state.listLoading = true;
    try { state.listData = await runtime.request('summary.list', {}); state.listError = null; }
    catch (error) { state.listData = null; state.listError = serviceMessage(error); }
    finally { state.listLoading = false; }
  }
  const data = () => (validSummaryList(state.listData) ? state.listData : null);
  const unknown = () => [...new Set([...state.localUnknown, ...(data()?.unresolvedOperations ?? [])])].filter(id => !state.resolved.includes(id));
  const retries = [];

  function accept(value, id) {
    if (!validSummaryReceipt(value, id) || ['pending', 'unknown'].includes(value.status)) { state.localUnknown = [...new Set([...state.localUnknown, id])]; state.message = 'The summary is still being checked. Check its status before creating another.'; return null; }
    state.localUnknown = state.localUnknown.filter(item => item !== id); state.resolved = [...state.resolved, id];
    if (value.status === 'failed') { state.message = value.message?.replaceAll('—', ',') || 'The summary was not created. Your selections are kept.'; retries.push(loadList()); return null; }
    state.snapshot = value.snapshot; state.message = ''; retries.push(loadList()); return value.snapshot;
  }
  async function settle() { while (retries.length) await retries.shift(); }

  async function prepare(input, { idempotencyKey } = {}) {
    if (lock || !data() || unknown().length) return null;
    const id = idempotencyKey ?? crypto.randomUUID(); lock = true; state.busy = true; state.message = '';
    try { const value = await runtime.request('summary.prepare', input, { idempotencyKey: id }); return accept(value, id); }
    catch (error) { if (!(error instanceof FrontendServiceError) || ['unknown_outcome', 'invalid_response'].includes(error.code)) state.localUnknown = [...state.localUnknown, id]; state.message = serviceMessage(error); return null; }
    finally { lock = false; state.busy = false; await settle(); }
  }
  async function reconcile(id) {
    if (lock) return;
    lock = true; state.busy = true;
    try { const value = await runtime.request('operations.read', { domain: 'summary', operationId: id }); accept(value, id); }
    catch (error) { state.message = serviceMessage(error); }
    finally { lock = false; state.busy = false; await settle(); }
  }
  async function open(id) {
    if (lock) return false;
    lock = true; state.busy = true; state.message = '';
    try { const value = await runtime.request('summary.read', { id }); if (!validSummarySnapshot(value) || value.id !== id) throw new Error('invalid'); state.snapshot = value; return true; }
    catch (error) { state.message = serviceMessage(error); return false; }
    finally { lock = false; state.busy = false; }
  }

  return {
    state,
    loadList,
    prepare,
    reconcile,
    open,
    get snapshot() { return state.snapshot; },
    get archives() { return data()?.items ?? []; },
    get complete() { return data()?.complete ?? false; },
    get unknown() { return unknown(); },
    get message() { return state.message; },
    get error() { return state.listError || (!state.listLoading && !data() ? 'Summary history could not be verified.' : null); },
    get ready() { return !!data(); },
    // SummaryWorkspace.tsx:211: the Create button's disabled rule (production).
    get canCreate() { return !(state.busy || state.listLoading || !data() || unknown().length > 0); },
  };
}

const recordSections = ['tests', 'actions', 'maintenance', 'observations', 'gardens'];

/**
 * SummaryWorkspace.tsx:109-114, the production branch of `preview()`, over
 * the Homeguard provider's collections and collection states (the B11
 * provider, test/helpers/frontendB11.mjs) and My Week's actions. Returns
 * `{ error }` when the screen refuses before any request, else
 * `{ input }`, the body `production.prepare` is called with.
 */
export function buildPrepare({ selection, collections, collectionStates, actions = [], currentHomeId }) {
  const invalid = summaryDateError(selection);
  if (invalid) return { error: invalid };
  const sources = { tests: collections.tests ?? [], actions, maintenance: collections.assets ?? [], observations: collections.observations ?? [], gardens: collections.gardens ?? [] };
  const missingSections = recordSections.filter(section => section !== 'actions' && (collectionStates[section === 'maintenance' ? 'assets' : section]?.status !== 'ready' || !collectionStates[section === 'maintenance' ? 'assets' : section]?.complete));
  const selectedRecords = (section) => (sources[section] ?? []).filter(record => !selection.excluded.includes(`${section}:${record.id}`) && withinSummaryDates(recordDate(record), selection));
  if (missingSections.some(section => selection.sections[section])) return { error: 'Load every selected record section before preparing this report, or deselect unavailable sections.' };
  return { input: JSON.parse(JSON.stringify({ selection, records: recordSections.filter(key => selection.sections[key]).flatMap(kind => selectedRecords(kind).map(record => ({ kind, id: record.id, revision: record.revision }))), collectionRevisions: Object.fromEntries(Object.entries(collectionStates).map(([key, value]) => [key, value.revision])), homeContextId: currentHomeId ?? undefined })) };
}

/** SummaryWorkspace.tsx:171, what the production review shows: the report, then the omissions. */
export function reviewText(snapshot) {
  return [snapshot.report.title, ...snapshot.report.introduction, ...snapshot.report.sections.flatMap(section => [section.title, ...section.lines]), 'Omissions', ...snapshot.omissions];
}
/** SummaryWorkspace.tsx:123, what an export (file, image, print, share) carries. */
export function exportLines(snapshot) {
  return [...snapshot.report.introduction, ...snapshot.report.sections.flatMap(section => [section.title, ...section.lines])];
}
