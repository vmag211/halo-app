/**
 * The privacy panel's handling of a clear's answer, TRANSCRIBED from
 * components/production/ProductionPrivacy.tsx in this tree (the frontend as
 * merged at 1253025, ref 5ac06f6), for the B07 Task 6 suites
 * (test/routesPrivacyClear.test.mjs and test/routesPrivacyClearDb.test.mjs)
 * and the Task 5 suite (test/routesPrivacyExport.test.mjs), where an export's
 * answer reaches the same accept and `downloadWeekFile` records the file:
 *
 * - `accept` (ProductionPrivacy.tsx:23), VERBATIM with the parameter types
 *   removed and nothing else changed. ACCEPT_SOURCE below is the function's
 *   own text, and the drift test in routesPrivacyClear compares it with the
 *   line in the component, so an edit to either side fails there.
 * - what `confirm` (:24) does once the request has been sent: `accept` on an
 *   answer, and on a failure `setUnknown` only for `unknown_outcome`, then the
 *   failure's message.
 * - what `reconcile` (:25) does: `accept` on the `operations.read` answer for
 *   the parked id, the failure's message otherwise.
 *
 * React state becomes plain fields on `panel`; `downloadWeekFile`,
 * `workspace.retry`, `tasks.retryLoad`, `workspace.clearDraft` and
 * `status.retry` record that they ran. The runtime's status mapping and
 * envelope unwrap (runtime.ts:144-153) are test/helpers/frontendB04.mjs's
 * `clientRequest`, shared with the B04 suites.
 *
 * Task 7 (contracts) transcribes the whole panel, guards included; this is
 * only what a clear's receipt reaches.
 */
import { FrontendServiceError, clientRequest, serviceMessage } from './frontendB04.mjs';

/** The component file the transcription is checked against. */
export const COMPONENT = 'components/production/ProductionPrivacy.tsx';

/** The component's own signature, and what it is once its types are removed. */
export const ACCEPT_SIGNATURE = Object.freeze({
  typed: "function accept(value:Outcome,scope:Review['scope'],id:string){",
  plain: 'function accept(value,scope,id){',
});

export const MESSAGES = Object.freeze({
  cleared: 'Your records were cleared.',
  journal: 'Journal cleared.',
  unchanged: 'The request was not applied. Your data is unchanged.',
  checking: 'The request is still being checked.',
  unconfirmed: 'The result is not confirmed. Check its status before trying again.',
  conflict: 'This item changed. Review the latest version before saving.',
  validation: 'Check the highlighted information and try again.',
  unavailable: 'This service is unavailable. Try again later.',
  downloaded: 'Your export was downloaded.',
  notReady: 'The export is not ready to download. Check its status.',
  rateLimited: 'Please wait before trying again.',
});

/**
 * One privacy panel, holding a review of `scope` and the drafts the workspace
 * had when the clear was confirmed.
 */
export function privacyPanel({ drafts = { 'week:focus': 'kept until clear all', 'luna:draft': 'a typed question' } } = {}) {
  const panel = {
    unknown: null,
    message: '',
    review: { scope: 'all' },
    downloads: [],
    workspaceRetries: 0,
    taskReloads: 0,
    statusRetries: 0,
    drafts: { ...drafts },
  };
  const setUnknown = (value) => { panel.unknown = value; };
  const setMessage = (value) => { panel.message = value; };
  const setReview = (value) => { panel.review = value; };
  const downloadWeekFile = (name, text, mime) => { panel.downloads.push({ name, text, mime }); };
  const workspace = {
    get drafts() { return panel.drafts; },
    retry: async () => { panel.workspaceRetries += 1; },
    clearDraft: (key) => { const next = { ...panel.drafts }; delete next[key]; panel.drafts = next; },
  };
  const tasks = { retryLoad: () => { panel.taskReloads += 1; } };
  const status = { retry: () => { panel.statusRetries += 1; } };

  // ProductionPrivacy.tsx:23, verbatim (types removed). Do not reformat this line.
  function accept(value,scope,id){if(value.operationId!==id||value.status!=='succeeded'){if(value.operationId===id&&(value.status==='failed'||value.status==='cancelled')){setUnknown(null);setMessage('The request was not applied. Your data is unchanged.');}else{setUnknown({id,scope});setMessage('The request is still being checked.');}return;}if(scope==='export'){const file=value.file;if(!file||!['application/json','text/csv'].includes(file.mime)||typeof file.text!=='string'||file.text.length>10*1024*1024||!/^halo[-\w]*\.(json|csv)$/.test(file.name)){setUnknown({id,scope});setMessage('The export is not ready to download. Check its status.');return;}downloadWeekFile(file.name,file.text,file.mime);setMessage('Your export was downloaded.');}else{void workspace.retry();tasks.retryLoad();if(scope==='all'){for(const key of Object.keys(workspace.drafts))workspace.clearDraft(key);}setMessage(scope==='journal'?'Journal cleared.':'Your records were cleared.');}setUnknown(null);setReview(null);status.retry();}

  panel.accept = accept;

  /**
   * confirm (:24) after `runtime.request('privacy.clear', ...)`: the route's
   * Response goes through the runtime's mapping, then into accept or the catch.
   */
  panel.answer = async (response, scope, id) => {
    try {
      const value = await clientRequest(response, true);
      accept(value, scope, id);
    } catch (e) {
      if (e instanceof FrontendServiceError && e.code === 'unknown_outcome') setUnknown({ id, scope });
      setMessage(serviceMessage(e));
    }
    return panel;
  };

  /** reconcile (:25): `operations.read` for the parked id, through the runtime's mapping. */
  panel.reconcile = async (read) => {
    if (!panel.unknown) throw new Error('privacyPanel: nothing to reconcile');
    const { id, scope } = panel.unknown;
    try {
      accept(await clientRequest(await read(id), false), scope, id);
    } catch (e) {
      setMessage(serviceMessage(e));
    }
    return panel;
  };

  return panel;
}

/** The text of the transcribed accept, for the drift test. */
export const ACCEPT_SOURCE = privacyPanel().accept.toString();
