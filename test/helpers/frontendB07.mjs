/**
 * The Settings privacy panel's whole consumption logic, for the B07 contract
 * suite (test/contractsB07.test.mjs), TRANSCRIBED from this tree (the
 * frontend as merged at 1253025, ref 5ac06f6), not summarised:
 *
 * - components/production/ProductionPrivacy.tsx:18-25: `verified`, the
 *   first-entry lock effect, `selected`, `inspect` (its guards and its
 *   validator), `accept`, `confirm` (its guards) and `reconcile`;
 * - components/expanded/SettingsWorkspace.tsx:52: the settings `blocked`
 *   derivation that gates every privacy button;
 * - lib/frontend/production/runtime.ts:28,86-89: the registry entries the
 *   panel calls, now READ from the real runtime (REGISTRY_LINES still pins
 *   their text). The real runtime's own request (its status mapping and
 *   envelope unwrap) runs over the route harness as test/helpers/frontendB06.mjs's
 *   `clientRuntime`, shared with the B06 and B07 route suites. Only the
 *   `.tsx` component lines below remain transcribed.
 *
 * CLIENT_LINES are the component's lines exactly as they stand, leading
 * space included; the drift test in the contract suite requires the component
 * to contain each one. What runs is that text with the TypeScript annotations
 * in TYPE_STRIPS removed (each must occur exactly once, so a changed
 * annotation fails loudly) and nothing else changed, compiled with
 * `new Function`. React state becomes plain fields; a render is a fresh
 * compile over the current state, so a function's closure sees the values of
 * the render it was called from, as in React. useEffect and queueMicrotask
 * run at once; `status.retry` reloads `privacy.status` and the panel awaits
 * that reload before an action returns; `downloadWeekFile`,
 * `workspace.retry`, `tasks.retryLoad` and `workspace.clearDraft` record
 * that they ran. `unresolved` (line 21, other surfaces' parked operations) is
 * an input, false unless a test says otherwise.
 *
 * Every transcribed function has a negative control in the contract suite:
 * the suite compiles a deliberately altered copy and shows a scenario
 * assertion failing on it.
 */
import { FrontendServiceError, clientRuntime, productionOperations, serviceMessage } from './frontendB06.mjs';

export const COMPONENT = 'components/production/ProductionPrivacy.tsx';
export const SETTINGS_COMPONENT = 'components/expanded/SettingsWorkspace.tsx';
export const RUNTIME_FILE = 'lib/frontend/production/runtime.ts';

/** The component's lines, verbatim. */
export const CLIENT_LINES = Object.freeze({
  /** ProductionPrivacy.tsx:18 */
  verified: " const verified=Array.isArray(status.data?.unresolvedOperations)&&status.data.unresolvedOperations.every(value=>typeof value.operationId==='string'&&!!value.operationId&&['export','journal','all'].includes(value.scope));",
  /** ProductionPrivacy.tsx:19 */
  lock: " useEffect(()=>{const pending=status.data?.unresolvedOperations?.[0];if(pending&&['export','journal','all'].includes(pending.scope)&&typeof pending.operationId==='string')queueMicrotask(()=>setUnknown({id:pending.operationId,scope:pending.scope}));},[status.data]);",
  /** ProductionPrivacy.tsx:20 */
  selected: " const selected=JSON.stringify({groups,privateText});",
  /** ProductionPrivacy.tsx:22 */
  inspect: " async function inspect(scope:Review['scope']){if(lock.current||unknown||blocked||unresolved||!verified||status.loading||!!status.error)return;lock.current=true;setBusy(true);setMessage('');setWord('');try{const data=await runtime.request<Omit<Review,'selection'|'scope'>>('privacy.inspect',{scope,groups,privateText},{idempotencyKey:crypto.randomUUID()});if(typeof data.reviewToken!=='string'||!Number.isSafeInteger(data.count)||data.count<0||!Number.isFinite(Date.parse(data.expiresAt))||Date.parse(data.expiresAt)<=Date.now())throw new Error('invalid');setReview({...data,scope,selection:selected});}catch(e){setMessage(serviceMessage(e));}finally{lock.current=false;setBusy(false);}}",
  /** ProductionPrivacy.tsx:23 */
  accept: " function accept(value:Outcome,scope:Review['scope'],id:string){if(value.operationId!==id||value.status!=='succeeded'){if(value.operationId===id&&(value.status==='failed'||value.status==='cancelled')){setUnknown(null);setMessage('The request was not applied. Your data is unchanged.');}else{setUnknown({id,scope});setMessage('The request is still being checked.');}return;}if(scope==='export'){const file=value.file;if(!file||!['application/json','text/csv'].includes(file.mime)||typeof file.text!=='string'||file.text.length>10*1024*1024||!/^halo[-\\w]*\\.(json|csv)$/.test(file.name)){setUnknown({id,scope});setMessage('The export is not ready to download. Check its status.');return;}downloadWeekFile(file.name,file.text,file.mime);setMessage('Your export was downloaded.');}else{void workspace.retry();tasks.retryLoad();if(scope==='all'){for(const key of Object.keys(workspace.drafts))workspace.clearDraft(key);}setMessage(scope==='journal'?'Journal cleared.':'Your records were cleared.');}setUnknown(null);setReview(null);status.retry();}",
  /** ProductionPrivacy.tsx:24 */
  confirm: " async function confirm(){if(!review||lock.current||unknown||blocked||unresolved)return;if(review.selection!==selected||Date.parse(review.expiresAt)<=Date.now()){setReview(null);setMessage('This review expired or changed. Review again.');return;}if(review.scope==='all'&&word!=='DELETE')return;lock.current=true;setBusy(true);const id=crypto.randomUUID();try{const value=await runtime.request<Outcome>(review.scope==='export'?'privacy.export':'privacy.clear',{reviewToken:review.reviewToken,scope:review.scope,operationId:id},{idempotencyKey:id});accept(value,review.scope,id);}catch(e){if(e instanceof FrontendServiceError&&e.code==='unknown_outcome')setUnknown({id,scope:review.scope});setMessage(serviceMessage(e));}finally{lock.current=false;setBusy(false);}}",
  /** ProductionPrivacy.tsx:25 */
  reconcile: " async function reconcile(){if(!unknown||lock.current)return;lock.current=true;setBusy(true);try{accept(await runtime.request<Outcome>('operations.read',{operationId:unknown.id,domain:'privacy'}),unknown.scope,unknown.id);}catch(e){setMessage(serviceMessage(e));}finally{lock.current=false;setBusy(false);}}",
});

/** SettingsWorkspace.tsx:52, verbatim. */
export const BLOCKED_LINE = " const blocked=props.offline||workspace.pending||pending||!!production&&(production.loading||production.pending||!!production.unknown||!production.snapshot)||['offline','loading','error','save-error','conflict'].includes(workspace.scenario)||preview.fail;";

/** runtime.ts:28 and 86-89, verbatim: the registry entries the panel uses. */
export const REGISTRY_LINES = Object.freeze([
  "  'operations.read': {path:'/api/operations'},",
  "  'privacy.status': {path:'/api/privacy/status'},",
  "  'privacy.inspect': {path:'/api/privacy/export/inspect',method:'POST'},",
  "  'privacy.export': {path:'/api/privacy/exports',method:'POST'},",
  "  'privacy.clear': {path:'/api/privacy/clear',method:'POST'},",
]);

/** The TypeScript annotations removed before a line runs: [typed, plain], each occurring exactly once. */
export const TYPE_STRIPS = Object.freeze({
  inspect: [["async function inspect(scope:Review['scope']){", 'async function inspect(scope){'], ["runtime.request<Omit<Review,'selection'|'scope'>>(", 'runtime.request(']],
  accept: [["function accept(value:Outcome,scope:Review['scope'],id:string){", 'function accept(value,scope,id){']],
  confirm: [['runtime.request<Outcome>(', 'runtime.request(']],
  reconcile: [['runtime.request<Outcome>(', 'runtime.request(']],
});

/** The client's registry entries the panel calls, read from the real runtime (not parsed from REGISTRY_LINES). */
export const PRIVACY_OPERATIONS = Object.freeze(Object.fromEntries(REGISTRY_LINES.map((line) => {
  const [, name] = line.match(/^ {2}'([a-z.]+)': \{/);
  if (!productionOperations[name]) throw new Error(`frontendB07: the real runtime has no ${name}`);
  return [name, productionOperations[name]];
})));

/** The lines with their annotations removed. `lines` lets a negative control pass an altered copy. */
export function plainLines(lines = CLIENT_LINES) {
  const out = { ...lines };
  for (const [name, strips] of Object.entries(TYPE_STRIPS)) {
    for (const [typed, plain] of strips) {
      const at = out[name].indexOf(typed);
      if (at < 0 || out[name].indexOf(typed, at + 1) >= 0) throw new Error(`frontendB07: ${name} must hold ${typed} exactly once`);
      out[name] = out[name].replace(typed, plain);
    }
  }
  return out;
}

const RENDER_ARGS = ['status', 'groups', 'privateText', 'review', 'word', 'unknown', 'blocked', 'unresolved', 'lock', 'runtime',
  'setBusy', 'setMessage', 'setWord', 'setReview', 'setUnknown', 'serviceMessage', 'FrontendServiceError', 'downloadWeekFile', 'workspace', 'tasks'];

function compile(lines) {
  const plain = plainLines(lines);
  const render = new Function(...RENDER_ARGS, [plain.verified, plain.selected, plain.inspect, plain.accept, plain.confirm, plain.reconcile,
    'return {verified,selected,inspect,accept,confirm,reconcile};'].join('\n'));
  const effect = new Function('status', 'useEffect', 'queueMicrotask', 'setUnknown', plain.lock);
  return { render, effect };
}

/** SettingsWorkspace.tsx:52 over a production preferences state, with the preview inputs at their production values. */
export function settingsBlocked(production, { line = BLOCKED_LINE } = {}) {
  const run = new Function('props', 'workspace', 'pending', 'production', 'preview', `${line} return blocked;`);
  return run({ offline: false }, { pending: false, scenario: 'ready' }, false, production, { fail: false });
}

/**
 * The privacy panel over a client runtime. `blocked` is the settings gate
 * (settingsBlocked), `unresolved` other surfaces' parked operations.
 */
export function privacyPanel(runtime, { lines = CLIENT_LINES, blocked = false, unresolved = false, drafts = { 'week:focus': 'kept until clear all', 'luna:draft': 'a typed question' } } = {}) {
  const { render, effect } = compile(lines);
  const reloads = [];
  const s = {
    groups: ['tasks'], privateText: false, review: null, word: '', message: '', busy: false, unknown: null,
    downloads: [], workspaceRetries: 0, taskReloads: 0, statusRetries: 0, drafts: { ...drafts },
  };
  const lock = { current: false };
  const status = { data: null, loading: true, error: null, retry: () => { s.statusRetries += 1; reloads.push(load()); } };
  const set = (key) => (value) => { s[key] = value; };
  const workspace = {
    get drafts() { return s.drafts; },
    retry: async () => { s.workspaceRetries += 1; },
    clearDraft: (key) => { const next = { ...s.drafts }; delete next[key]; s.drafts = next; },
  };
  const tasks = { retryLoad: () => { s.taskReloads += 1; } };
  const downloadWeekFile = (name, text, mime) => { s.downloads.push({ name, text, mime }); };

  /** useProductionResource('privacy.status', {}) and its settle (ProductionContext.tsx:12-14), then the lock effect. */
  async function load() {
    Object.assign(status, { data: null, loading: true, error: null });
    try {
      Object.assign(status, { data: await runtime.request('privacy.status', {}), loading: false, error: null });
    } catch (error) {
      Object.assign(status, { data: null, loading: false, error: serviceMessage(error) });
    }
    effect(status, (run) => run(), (task) => task(), set('unknown'));
  }
  const now = () => render(status, s.groups, s.privateText, s.review, s.word, s.unknown, blocked, unresolved, lock, runtime,
    set('busy'), set('message'), set('word'), set('review'), set('unknown'), serviceMessage, FrontendServiceError, downloadWeekFile, workspace, tasks);
  const settle = async () => { while (reloads.length) await reloads.shift(); };
  const act = (name) => async (...args) => { await now()[name](...args); await settle(); return panel; };

  const panel = {
    state: s,
    status,
    load: async () => { await load(); return panel; },
    get verified() { return now().verified; },
    get selected() { return now().selected; },
    /** The two checkboxes' onChange (ProductionPrivacy.tsx:26): a new selection drops any open review. */
    choose(groups, privateText = s.privateText) { s.review = null; s.groups = [...groups]; s.privateText = privateText; return panel; },
    /** The DELETE field's onChange. */
    type(word) { s.word = word; return panel; },
    inspect: act('inspect'),
    confirm: act('confirm'),
    reconcile: act('reconcile'),
    accept: (...args) => now().accept(...args),
  };
  return panel;
}

/** A client runtime for `who` over the route harness (frontendB06 clientRuntime), recording every request it sends. */
export function recordingRuntime(h, who = 'alice', options = {}) {
  const runtime = clientRuntime(h, who, options);
  const sent = [];
  return {
    sent,
    async request(operation, body, requestOptions = {}) {
      sent.push({ operation, body, options: requestOptions });
      return runtime.request(operation, body, requestOptions);
    },
  };
}

export { FrontendServiceError, serviceMessage };
