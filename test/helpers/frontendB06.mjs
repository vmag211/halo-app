/**
 * What My Week does with a save, TRANSCRIBED, not summarised, from
 * `origin/codex/october15-review-refinement` (5ac06f6; read with `git show`,
 * the files are not checked out here). TypeScript to JavaScript with the types
 * stripped and nothing else changed, except where a declared seam below says
 * so. One copy, shared by the commit suites (routesActionsCommit and
 * routesActionsCommitDb), so they cannot drift apart:
 *
 * - `lib/frontend/production/runtime.ts:12-14` (FrontendServiceError),
 *   `:29-30` and `:28` (the three registry entries this surface uses),
 *   `:91-97` (messages), `:107-158` (`request`: the method and mutation rule,
 *   the query string, the headers, the status mapping at :144 and the
 *   envelope unwrap at :147-153);
 * - `lib/frontend/production/adapters.ts:5-12` (`invalid`, and the action
 *   adapter's `receipt` check, `load`, `commit` and `reconcile`);
 * - `lib/frontend/production/action-service.ts:27-53` (actionMetadataError,
 *   object, text, validZone, validActionPreferences), `:86-99`
 *   (validActionSnapshot), `:102-115` (sameValue, actionReceiptCoversCommand);
 * - `lib/frontend/expanded-preview.ts:30-48` (validActionDate,
 *   actionDraftError, revisedActionBatch);
 * - `lib/frontend/week-preview.ts:4-6,11-16` (emptyWeekMeta, dayAdd,
 *   weekStart, eventInstant);
 * - `lib/frontend/week-planning.ts:7-8,12-19` (reviewMetaVersion,
 *   captureReview, prepareReview);
 * - `components/expanded/ExpandedPreviewState.tsx:60-152`, the screen's
 *   decisions as a plain object (`myWeek`): `commitSnapshot` (:60-68), the
 *   load effect (:69-80), `mutate` (:81-106), `reconcile` (:107-118), the
 *   command builders (:136-140), `save` (:141-145) and `changeState`
 *   (:146-152);
 * - `components/expanded/WeekReviewPlanner.tsx:17` (`apply`, the weekly
 *   review's save), as `applyWeekPlan`;
 * - the week strip (B06 Task 5, moved here from routesWeekChanges by Task 6
 *   so the per-route suite and the contract suite share one copy):
 *   `runtime.ts:31-32` (its two registry entries) and `:98`
 *   (`serviceMessage`), `useProductionResource`'s settle
 *   (`components/production/ProductionContext.tsx:14`), `useWeekChanges` and
 *   `WeekUpdateList` (`components/expanded/WeekUpdates.tsx:14-30`), as
 *   `weekStrip`, and `changeEvidenceKey` and `usableWeekChanges`
 *   (`lib/frontend/week-planning.ts:29-30`).
 *
 * Declared seams, none of which changes an outcome a route can cause:
 * - React state becomes plain fields; `setLoadVersion` (a reload) becomes a
 *   counter, `reloads`.
 * - `request` takes the route harness as `fetch`, and drops credentials,
 *   timeouts and the offline branch. `lose` makes it throw after the server
 *   has answered, which is what a dropped connection does: the request was
 *   sent, so a mutation becomes `unknown_outcome` (:118, :156).
 * - `mutate`'s second guard (:83, the workspace `scenario`, `fail` and
 *   `navigator.onLine`) is not modelled: the scenario starts `ready` and is
 *   not a settings dependency (digest 6.2).
 * - `mutate` drops `if (!alive.current || version !== generation.current)
 *   return false` (:90), and `reconcile` its `alive` checks: there is one
 *   mounted screen and no reload in flight here.
 * - `commitSnapshot` drops `workspaceRef.current.applyCanonical(...)` (:67);
 *   the drafts it would apply are kept in `drafts`, as :64-66 builds them.
 * - `applyWeekPlan` drops the planner's first guard (`blocked ||
 *   workspace.pending || state.pending || !navigator.onLine`) and, after a
 *   save, `setDecisions(captureReview(state.getSnapshot()...))` and
 *   `setConfirm(false)`, which only reset the component's own form
 *   (WeekReviewPlanner.tsx:17). It returns the feedback line instead of
 *   setting it.
 * - `changeState` takes `today` instead of `lunaCalendarAnchor(new Date(), zone)`.
 * - `Intl` is this module's binding, so a test can stand in for a browser
 *   whose ICU knows a zone this Node does not (digest 9.5, Ruling H24): see
 *   `setBrowserZones`. By default it is Node's own.
 * - `validReminderStates` is not transcribed: the server never sends
 *   `reminderStates`, so a body carrying it fails here loudly.
 * - `request` also honours `options.lose` (the week strip's acknowledgement
 *   passes it per call), with the same effect as `lose(operation)`.
 * - `weekStrip`: `queueMicrotask` in the restore effect (:17) is synchronous,
 *   `live.retry()` is a counter (`retries`), and the workspace scenario of
 *   :19 is `sourceReady`, which production starts `ready` (digest 6.2).
 *
 * A transcription that accepted everything would prove nothing, so the suites
 * that use this also show it refusing what the client refuses.
 */

const NodeIntl = globalThis.Intl;
let Intl = NodeIntl;

/**
 * Stand in for a browser whose ICU accepts zones this Node rejects: each name
 * in `aliases` is formatted as the zone it maps to. `null` restores Node's own.
 */
export function setBrowserZones(aliases) {
  if (!aliases) { Intl = NodeIntl; return; }
  const DateTimeFormat = function DateTimeFormat(locale, options) {
    const zone = options?.timeZone;
    return new NodeIntl.DateTimeFormat(locale, zone && Object.hasOwn(aliases, zone) ? { ...options, timeZone: aliases[zone] } : options);
  };
  Intl = { DateTimeFormat };
}

// ------------------------------------------------------------ runtime.ts

/** runtime.ts:12-14 */
export class FrontendServiceError extends Error {
  constructor(code, message, operationId, retryAfter, fields) {
    super(message);
    this.code = code;
    this.operationId = operationId;
    this.retryAfter = retryAfter;
    this.fields = fields;
    this.name = 'FrontendServiceError';
  }
}

/** runtime.ts:28-32, the registry entries My Week and its week strip use. */
export const productionOperations = {
  'operations.read': { path: '/api/operations' },
  'actions.load': { path: '/api/frontend/actions' },
  'actions.commit': { path: '/api/frontend/actions/commands', method: 'POST' },
  'week.changes': { path: '/api/week/changes' },
  'week.acknowledge': { path: '/api/week/changes/acknowledge', method: 'POST' },
};

/** runtime.ts:91-97 */
export const messages = {
  offline: 'You are offline. Your changes are still here.', session: 'Please reconnect your session to continue.',
  permission: 'This action is not available for this account.', conflict: 'This item changed. Review the latest version before saving.',
  validation: 'Check the highlighted information and try again.', rate_limited: 'Please wait before trying again.',
  unavailable: 'This service is unavailable. Try again later.', invalid_response: 'The service returned incomplete information. Please retry.',
  aborted: 'Request cancelled.', unknown_outcome: 'The result is not confirmed. Check its status before trying again.',
};

/**
 * `request` (runtime.ts:107-158) with the route harness as `fetch`.
 * `lose(operation)` returning true drops that response after the server has
 * answered it (a lost connection).
 */
export function clientRuntime(h, who, { homeContextId = null, env, lose = () => false } = {}) {
  return {
    async request(operation, body, options = {}) {
      const endpoint = productionOperations[operation];
      const method = endpoint.method ?? 'GET', mutation = method !== 'GET';
      const operationId = mutation ? options.idempotencyKey ?? crypto.randomUUID() : undefined;
      let sent = false;
      try {
        let path = endpoint.path;
        if (!mutation && body && typeof body === 'object') {
          const query = new URLSearchParams();
          for (const [key, value] of Object.entries(body)) if (value !== undefined && value !== null) query.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
          if (query.size) path += `?${query}`;
        }
        const headers = { Accept: 'application/json' };
        if (homeContextId) headers['X-Halo-Home-Context'] = homeContextId;
        if (options.expectedRevision !== undefined) headers['If-Match'] = String(options.expectedRevision);
        if (operationId) headers['Idempotency-Key'] = operationId;
        if (mutation) headers['Content-Type'] = 'application/json';
        sent = true;
        const response = await h.call(endpoint.path, method, { as: who, url: path, headers, env, rawBody: mutation ? JSON.stringify(body ?? {}) : undefined });
        if (lose(operation) || options.lose) throw new DOMException('Request ended', 'AbortError');
        const json = await response.json().catch(() => null);
        if (!response.ok) {
          const code = response.status === 401 ? 'session' : response.status === 403 ? 'permission' : response.status === 409 || response.status === 412 ? 'conflict' : response.status === 400 || response.status === 422 ? 'validation' : response.status === 429 ? 'rate_limited' : response.status >= 500 && mutation ? 'unknown_outcome' : 'unavailable';
          const retry = Number(response.headers.get('Retry-After')); throw new FrontendServiceError(code, messages[code], operationId, Number.isFinite(retry) && retry > 0 ? retry : undefined);
        }
        if (json === null || typeof json !== 'object') throw new FrontendServiceError(mutation ? 'unknown_outcome' : 'invalid_response', messages[mutation ? 'unknown_outcome' : 'invalid_response'], operationId);
        // The response envelope is unwrapped once. Domain adapters validate its canonical schema.
        if (Object.hasOwn(json, 'data')) {
          const envelope = json;
          return (envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data) && envelope.meta ? { ...envelope.data, _meta: envelope.meta } : envelope.data);
        }
        return json;
      } catch (error) {
        if (error instanceof FrontendServiceError) throw error;
        const code = sent && mutation ? 'unknown_outcome' : 'unavailable';
        throw new FrontendServiceError(code, messages[code], operationId);
      }
    },
  };
}

/** runtime.ts:98 */
export function serviceMessage(error) { return error instanceof FrontendServiceError ? error.message : messages.unavailable; }

// ------------------------------------------------------ expanded-preview.ts

/** expanded-preview.ts:30-35 */
export function validActionDate(value) {
  if (value === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
/** expanded-preview.ts:36-40 */
export function actionDraftError(title, date) {
  if (!title.trim() || title.trim().length > 160) return 'Enter a title between 1 and 160 characters.';
  if (!validActionDate(date)) return 'Choose a valid calendar date.';
  return null;
}
/** expanded-preview.ts:43-48 */
export function revisedActionBatch(actions,changes) {
  if(new Set(changes.map(c=>c.id)).size!==changes.length)return null;
  for(const c of changes){const a=actions.find(a=>a.id===c.id);if(!a||(a.revision??1)!==c.revision||actionDraftError(c.patch.title,c.patch.date)||!['saved','waiting','completed'].includes(c.patch.state))return null;}
  return actions.map(a=>{const c=changes.find(c=>c.id===a.id);return c?{...a,...c.patch,title:c.patch.title.trim(),revision:c.revision+1}:a;});
}

// ---------------------------------------------------------- week-preview.ts

/** week-preview.ts:4 */
export const emptyWeekMeta = { note:'', paused:false, archived:false, completedOn:'', time:'', duration:60, zone:'America/New_York', recurrence:'none', reminder:false, history:[] };
/** week-preview.ts:5-6 */
export function dayAdd(day, amount) { const d=new Date(`${day}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+amount);return d.toISOString().slice(0,10); }
export function weekStart(day) {return dayAdd(day,-((new Date(`${day}T12:00:00Z`).getUTCDay()+6)%7));}
/** week-preview.ts:11-16 */
export function eventInstant(day,time,zone) {
  if (!day || !validActionDate(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  try {const target=`${day}T${time}`; const base=Date.parse(`${target}:00Z`);const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});const matches=[];
    for(let offset=-14*60;offset<=14*60;offset+=15){const instant=new Date(base+offset*60000);const p=fmt.formatToParts(instant);const get=(type)=>p.find(x=>x.type===type)?.value; if(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`===target) matches.push(instant.toISOString());}return matches.length===1?matches[0]:null;
  }catch{return null;}
}

// -------------------------------------------------------- action-service.ts

/** action-service.ts:27-36 */
export function actionMetadataError(meta, action) {
  if (!meta || typeof meta !== 'object' || typeof meta.time !== 'string' || typeof meta.completedOn !== 'string' || typeof meta.zone !== 'string' || [meta.paused,meta.archived,meta.reminder].some(value=>typeof value!=='boolean') || meta.estimateSet!==undefined&&typeof meta.estimateSet!=='boolean') return 'The task schedule is invalid.';
  if (typeof meta.note !== 'string' || meta.note.length > 3000 || !Array.isArray(meta.history) || meta.history.some(line => typeof line !== 'string')) return 'The task details are invalid.';
  if (!Number.isInteger(meta.duration) || meta.duration < 15 || meta.duration > 1440) return 'Choose a duration between 15 and 1440 minutes.';
  try { new Intl.DateTimeFormat('en', { timeZone: meta.zone }); } catch { return 'Choose a valid timezone.'; }
  if (meta.time && !eventInstant(action.date, meta.time, meta.zone)) return 'Choose a valid dated time outside clock-change gaps or ambiguous times.';
  if (!['none', 'weekly', 'after-completion'].includes(meta.recurrence) || meta.recurrence !== 'none' && (!action.date || meta.time)) return 'Repeating tasks need an all-day date.';
  if (meta.completedOn && actionDraftError('Completion', meta.completedOn)) return 'The completion date is invalid.';
  return null;
}

/** action-service.ts:38-40 */
const object=(value)=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max=500)=>typeof value==='string'&&value.length<=max;
function validZone(value){if(!text(value,100)||!value)return false;try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}}
/** action-service.ts:41-53 */
export function validActionPreferences(value){
 if(!object(value))return false;
 return Object.entries(value).every(([key,item])=>{
  if(key==='week:focus')return text(item,300);
  if(key==='food-interests')return Array.isArray(item)&&item.length<=5&&new Set(item).size===item.length&&item.every(entry=>['fish','gardens','evidence','growers','water'].includes(entry));
  if(key==='week:availability')return object(item)&&Object.keys(item).length<=1000&&Object.entries(item).every(([day,minutes])=>!!day&&validActionDate(day)&&Number.isInteger(minutes)&&Number(minutes)>=0&&Number(minutes)<=10080);
  if(key==='week:season-dismissals')return Array.isArray(item)&&item.length<=1000&&new Set(item).size===item.length&&item.every(entry=>text(entry,200)&&entry.length>0);
  if(key==='week:review-preferences')return object(item)&&Object.keys(item).every(name=>['enabled','weekday','time','zone'].includes(name))&&typeof item.enabled==='boolean'&&Number.isInteger(item.weekday)&&Number(item.weekday)>=0&&Number(item.weekday)<=6&&typeof item.time==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)&&validZone(item.zone);
  if(key==='outdoorPlan')return object(item)&&Object.keys(item).every(name=>['key','place','period','watchRequested','forecastVersion','forecastIssuedAt','forecastExpiresAt'].includes(name))&&text(item.key,300)&&text(item.place,500)&&text(item.period,100)&&typeof item.watchRequested==='boolean'&&(item.forecastVersion===null||text(item.forecastVersion,300))&&[item.forecastIssuedAt,item.forecastExpiresAt].every(date=>date===null||typeof date==='string'&&Number.isFinite(Date.parse(date)));
  return false;
 });
}

/** action-service.ts:86-99 (validReminderStates not transcribed; see the header) */
export function validActionSnapshot(value) {
  if (!value || typeof value !== 'object') return false;
  const data = value;
  if(data.preferences!==undefined&&!validActionPreferences(data.preferences))return false;
  if(data.unresolvedOperations!==undefined&&(!Array.isArray(data.unresolvedOperations)||data.unresolvedOperations.length>100||data.unresolvedOperations.some(id=>typeof id!=='string'||!id||id.length>200)||new Set(data.unresolvedOperations).size!==data.unresolvedOperations.length))return false;
  if (!Array.isArray(data.actions) || !data.metas || typeof data.metas !== 'object' || Array.isArray(data.metas)) return false;
  const ids = new Set(), keys = new Set();
  for (const action of data.actions) {
    if (!action || typeof action.id !== 'string' || !action.id || typeof action.key !== 'string' || !action.key || ids.has(action.id) || keys.has(action.key) || typeof action.title !== 'string' || typeof action.date !== 'string' || actionDraftError(action.title, action.date) || !['saved', 'waiting', 'completed'].includes(action.state) || !Number.isInteger(action.revision) || (action.revision ?? 0) < 1 || typeof action.reason !== 'string' || typeof action.origin !== 'string') return false;
    ids.add(action.id); keys.add(action.key);
    if (data.metas[action.key] && actionMetadataError({ ...emptyWeekMeta, ...data.metas[action.key] }, action)) return false;
  }
  if (data.reminderStates !== undefined) throw new Error('reminderStates is not transcribed: the server must not send it');
  return Object.keys(data.metas).every(key => keys.has(key));
}

/** action-service.ts:102-115 */
export function sameValue(a,b){if(Object.is(a,b))return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;const left=Object.keys(a),right=Object.keys(b);return left.length===right.length&&left.every(key=>Object.hasOwn(b,key)&&sameValue(a[key],b[key]));}
export function actionReceiptCoversCommand(command,previous,receipt) {
 if(receipt.status!=='succeeded'||!validActionSnapshot(receipt.snapshot))return false;
 const next=receipt.snapshot;
 if(command.kind==='clear')return next.actions.length===0&&Object.keys(next.metas).length===0;
 if(command.kind==='delete'){const old=previous.actions.find(action=>action.id===command.id);return !!old&&!next.actions.some(action=>action.id===command.id)&&!Object.hasOwn(next.metas,old.key);}
 if(command.kind==='revise'&&!command.changes.every(change=>{const action=next.actions.find(item=>item.id===change.id);return action&&Number(action.revision)>change.revision&&action.title===change.patch.title.trim()&&action.date===change.patch.date&&action.state===change.patch.state;}))return false;
 if(command.kind==='add'&&!command.seeds.every(seed=>{const action=next.actions.find(item=>item.key===seed.key),old=previous.actions.find(item=>item.key===seed.key);return !!action&&(old?sameValue(action,old):action.title===seed.title.trim()&&action.date===command.date&&action.state===(command.initialStates?.[seed.key]??'saved'));}))return false;
 for(const [key,meta]of Object.entries(command.metadata??{})){
  if(command.kind==='add'&&previous.actions.some(action=>action.key===key))continue;
  if(meta===null?Object.hasOwn(next.metas,key):!sameValue(next.metas[key],meta))return false;
 }
 return Object.entries(command.preferences??{}).every(([key,value])=>sameValue(next.preferences?.[key],value));
}

// --------------------------------------------------------------- adapters.ts

/** adapters.ts:5 */
function invalid(){return new FrontendServiceError('invalid_response','The service returned incomplete information. Please retry.');}
/** adapters.ts:6-12, the production action adapter. */
export function createActionAdapter(runtime) {
 const receipt=(value,id)=>{if(!value||value.operationId!==id||!['succeeded','failed','pending','unknown','cancelled'].includes(value.status)||value.status==='succeeded'&&(!validActionSnapshot(value.snapshot)||!Array.isArray(value.snapshot?.unresolvedOperations)))throw invalid();return value;};
 return {
  async load(signal){const value=await runtime.request('actions.load',undefined,{signal});if(!validActionSnapshot(value)||!Array.isArray(value.unresolvedOperations))throw invalid();return value;},
  async commit(command,{operationId,signal}){try{return receipt(await runtime.request('actions.commit',{...command,operationId},{signal,idempotencyKey:operationId}),operationId);}catch(error){if(error instanceof FrontendServiceError)return {operationId,status:error.code==='unknown_outcome'||error.code==='invalid_response'?'unknown':'failed',message:error.message};throw error;}},
  async reconcile(operationId,signal){return receipt(await runtime.request('operations.read',{operationId,domain:'actions'},{signal}),operationId);}
 };
}

// ----------------------------------------------------------- week-planning.ts

/** week-planning.ts:7-8 */
export const reviewMetaVersion=(meta)=>JSON.stringify([meta.paused,meta.archived,meta.time,meta.duration,meta.estimateSet,meta.zone,meta.recurrence,meta.completedOn,meta.reminder,meta.note,meta.history]);
export function captureReview(actions,metas){return actions.filter(a=>a.state!=='completed'&&!metas[a.key]?.archived).map(a=>({id:a.id,key:a.key,revision:a.revision??1,choice:'keep',date:a.date,selected:false,metaVersion:reviewMetaVersion({...emptyWeekMeta,...metas[a.key]})}));}
/** week-planning.ts:12-19 */
export function prepareReview(decisions,actions,metas,day){
  const result={error:'',changes:[],metas:{...metas},diffs:[]};const selected=decisions.filter(d=>d.selected&&d.choice!=='keep');const ids=new Set();
  for(const decision of selected){const current=actions.find(a=>a.id===decision.id);if(ids.has(decision.id)||!current||current.key!==decision.key||current.state==='completed'||(current.revision??1)!==decision.revision){result.error='A selected task changed. Reopen the review before applying anything.';return {...result,changes:[],diffs:[]};}ids.add(decision.id);const m={...emptyWeekMeta,...metas[current.key]};if(m.archived||reviewMetaVersion(m)!==decision.metaVersion){result.error='A selected schedule changed. Reopen the review before applying anything.';return {...result,changes:[],diffs:[]};}
    if(decision.choice==='move'&&(!decision.date||!validActionDate(decision.date)||m.time&&!eventInstant(decision.date,m.time,m.zone))){result.error='Choose a valid date for each move, including its saved timezone.';return {...result,changes:[],diffs:[]};}
    const date=decision.choice==='later'?'':decision.choice==='move'?decision.date:current.date;const next={...m,paused:decision.choice==='pause'?true:decision.choice==='move'||decision.choice==='later'?false:m.paused,time:decision.choice==='later'?'':m.time,recurrence:decision.choice==='later'?'none':m.recurrence,history:[...m.history,`Weekly review ${day}: ${decision.choice==='move'?`Moved to ${date}`:decision.choice==='pause'?'Paused':'Kept for later'}.`]};
    result.changes.push({id:current.id,revision:decision.revision,patch:{title:current.title,date,state:current.state}});result.metas[current.key]=next;result.diffs.push(`${current.title}: ${decision.choice==='move'?`${current.date||'Unscheduled'} to ${date}${m.time?` at ${m.time} (${m.zone})`:''}`:decision.choice==='pause'?'Pause, keeping its date':'Save for later, removing its date and time'}`);
  }return result;
}

// ------------------------------------------------- ExpandedPreviewState.tsx

/**
 * `ExpandedPreviewProvider` with a production `service`
 * (ExpandedPreviewState.tsx:43-152), as plain fields. `drafts` is the
 * workspace's draft map the screen writes canonical values into (:64-67).
 */
export function myWeek(service, { today = '2026-10-19' } = {}) {
  const week = {
    actions: [], actionsRef: [], snapshotRef: { actions: [], metas: {} }, drafts: {},
    pending: false, error: '', readiness: service ? 'loading' : 'ready', unknownOperation: '',
    lock: false, reloads: 0, operationIds: [],

    /** :60-68 */
    commitSnapshot(snapshot) {
      week.snapshotRef = snapshot;
      week.actionsRef = snapshot.actions; week.actions = snapshot.actions;
      if (service) { week.unknownOperation = snapshot.unresolvedOperations?.[0] ?? ''; if (snapshot.unresolvedOperations?.length) week.error = 'An earlier save needs checking before changing tasks.'; }
      week.drafts = { ...week.drafts, 'week:metas': snapshot.metas, ...snapshot.preferences };
    },

    /** :69-80, the load effect. */
    async load() {
      week.readiness = 'loading'; week.error = '';
      await service.load(new AbortController().signal).then(snapshot => {
        if (!validActionSnapshot(snapshot)) throw new Error('invalid');
        week.commitSnapshot(snapshot); week.readiness = 'ready';
      }).catch(() => { week.readiness = 'error'; week.error = 'Your tasks could not load. Reconnect and try again.'; });
    },

    /** :81-106 */
    async mutate(command) {
      if (week.lock || week.unknownOperation || service && week.readiness !== 'ready') return false;
      week.lock = true; week.pending = true; week.error = '';
      const operationId = crypto.randomUUID(); week.operationIds.push(operationId);
      try {
        const snapshot = { actions: week.actionsRef, metas: (week.drafts['week:metas'] ?? {}) };
        const receipt = await service.commit(command, { operationId, signal: new AbortController().signal });
        if (receipt.operationId !== operationId) throw new Error('invalid receipt');
        if (receipt.status === 'pending' || receipt.status === 'unknown') { week.unknownOperation = operationId; week.error = 'The save outcome is not confirmed. Check its status before changing tasks again.'; return false; }
        if (receipt.status !== 'succeeded') { week.error = receipt.message || 'Could not save. Your edits are kept.'; return false; }
        if (!validActionSnapshot(receipt.snapshot) || !actionReceiptCoversCommand(command, snapshot, receipt)) throw new Error('invalid snapshot');
        week.commitSnapshot(receipt.snapshot);
        return true;
      } catch {
        week.unknownOperation = operationId; week.error = 'The save outcome is not confirmed. Check its status before trying again.';
        return false;
      } finally { week.lock = false; week.pending = false; }
    },

    /** :107-118 */
    async reconcile() {
      if (!service || !week.unknownOperation || week.lock) return false;
      week.lock = true; week.pending = true;
      try {
        const receipt = await service.reconcile(week.unknownOperation, new AbortController().signal);
        if (receipt.operationId !== week.unknownOperation) return false;
        if (receipt.status === 'succeeded' && validActionSnapshot(receipt.snapshot)) { week.commitSnapshot(receipt.snapshot); week.error = receipt.snapshot.unresolvedOperations?.length ? 'Another earlier save needs checking.' : 'Saved. The existing task result was recovered.'; return true; }
        if (receipt.status === 'failed' || receipt.status === 'cancelled') { week.unknownOperation = ''; week.reloads += 1; week.error = 'No save was applied. Your draft is kept for review.'; return false; }
        week.error = 'The outcome is still unconfirmed. No new save was sent.'; return false;
      } catch { week.error = 'Could not check this save. No new save was sent.'; return false; }
      finally { week.lock = false; week.pending = false; }
    },

    /** :136-140 */
    reviseActions: (changes, options) => week.mutate({ kind: 'revise', changes, ...options }),
    reviseAction: (id, revision, patch, options) => week.reviseActions([{ id, revision, patch }], options),
    addActions: (seeds, date, options) => week.mutate({ kind: 'add', seeds, date, ...options }),
    async updateAction(id, revision, patch, options) { const current = week.actionsRef.find(action => action.id === id); return current ? week.reviseAction(id, revision, { ...patch, state: current.state }, options) : false; },
    deleteAction: (id, revision) => week.mutate({ kind: 'delete', id, revision }),

    /** :141-145, with the editor's draft passed in. */
    async save(draft) {
      if (!draft || actionDraftError(draft.title, draft.date)) return false;
      return draft.id ? await week.updateAction(draft.id, draft.revision ?? 1, { title: draft.title, date: draft.date }) : await week.addActions([{ ...draft.seed, title: draft.title }], draft.date);
    },

    /** :146-152, `today` in place of lunaCalendarAnchor. */
    async changeState(id, state) {
      const current = week.actionsRef.find(action => action.id === id); if (!current) return false;
      const metas = (week.drafts['week:metas'] ?? {});
      const old = { ...emptyWeekMeta, ...metas[current.key] }; if (old.paused || old.archived) return false;
      return week.reviseAction(id, current.revision ?? 1, { title: current.title, date: current.date, state }, { expectedMetadata: { [current.key]: JSON.stringify(metas[current.key] ?? null) }, metadata: { [current.key]: { ...old, completedOn: state === 'completed' ? today : '', history: [...old.history, `${today}: ${state === 'completed' ? 'Completed' : state === 'waiting' ? 'Waiting' : 'Reopened'} by you.`] } } });
    },

    getSnapshot: () => week.snapshotRef,
    canMutate() { return !(week.lock || week.unknownOperation || service && week.readiness !== 'ready'); },
  };
  return week;
}

/**
 * WeekReviewPlanner.tsx:17, `apply`, against `week` (the screen above). The
 * component's own state comes in `review`: the person's `decisions`, the
 * `chosenFocus`, the `capacity` (minutes or null), the week's `start` and
 * `today`. Returns the feedback line the planner shows.
 */
export async function applyWeekPlan(week, { decisions, chosenFocus, capacity, start, today }) {
  const state = week;
  const metas = week.drafts['week:metas'] ?? {};
  const availability = week.drafts['week:availability'] ?? {};
  const capacityInvalid = capacity !== null && (!Number.isInteger(capacity) || capacity < 0 || capacity > 10080);
  const result=prepareReview(decisions,state.actions,metas,today);if(result.error||capacityInvalid){return result.error||'Enter available minutes between 0 and 10080.';}if(chosenFocus&&!state.actions.some(a=>a.key===chosenFocus&&a.state!=='completed'&&!metas[a.key]?.archived)){return 'Your chosen focus is no longer available. Choose it again.';}const nextActions=result.changes.length?revisedActionBatch(state.actions,result.changes):state.actions;const nextAvailability={...availability};if(capacity===null)delete nextAvailability[start];else nextAvailability[start]=capacity;const expectedMetadata=Object.fromEntries(state.actions.map(action=>[action.key,JSON.stringify(metas[action.key]??null)]));if(!nextActions||!await state.reviseActions(result.changes,{metadata:result.metas,expectedMetadata,preferences:{'week:focus':chosenFocus,'week:availability':nextAvailability}})){return 'This plan could not be confirmed. Your choices remain here. Check its save status or reload current tasks.';}
  return 'Week plan saved.';
}

// ------------------------------------------------------------- the week strip

/**
 * U+2014, built from its code point so this file carries no em dash of its
 * own (AGENTS.md). The client's regular expression matches every U+2014 (its
 * unicode escape, global flag); `EM_DASH_ALL` matches the same thing.
 */
const EM_DASH_ALL = new RegExp(String.fromCharCode(0x2014), 'g');

/** week-planning.ts:29 */
export const changeEvidenceKey = (change) => `${change.id}:${change.version}`;
/** week-planning.ts:30 */
export function usableWeekChanges(changes, actions, acknowledged) { return changes.filter((change, index) => Boolean(change.id && change.id.length <= 240 && change.version && change.version.length <= 100 && change.sourceVersion) && ['date-changed', 'cancelled', 'report', 'routine', 'conditions', 'missing-origin'].includes(change.kind) && changes.findIndex(c => changeEvidenceKey(c) === changeEvidenceKey(change)) === index && actions.some(a => a.id === change.actionId && a.key === change.actionKey && a.state !== 'completed') && !acknowledged.includes(changeEvidenceKey(change))).map(change => ({ ...change, title: change.title.replace(EM_DASH_ALL, ',').slice(0, 160), summary: change.summary.replace(EM_DASH_ALL, ',').slice(0, 600), sourceLabel: change.sourceLabel.replace(EM_DASH_ALL, ',').slice(0, 100), date: change.date && validActionDate(change.date) ? change.date : '', sourceUrl: change.sourceUrl && /^https:\/\//i.test(change.sourceUrl) ? change.sourceUrl : undefined })); }

/**
 * `useWeekChanges` in production (WeekUpdates.tsx:14-25) and `WeekUpdateList`'s
 * render decision (:30), as a plain object. `sourceReady` is the workspace
 * scenario check of :19; production starts it `ready` (digest 6.2).
 */
export function weekStrip(runtime, { actions = [], metas = {}, sourceReady = true } = {}) {
  const strip = {
    acknowledged: [], unknown: null, feedback: '', pending: false,
    live: { data: null, loading: true, error: null },
    retries: 0,

    /** ProductionContext.tsx:14, the read `useProductionResource('week.changes',{})` makes. */
    async load() {
      await runtime.request('week.changes', JSON.parse(JSON.stringify({}))).then(
        (data) => { strip.live = { data, loading: false, error: null }; },
        (error) => { strip.live = { data: null, loading: false, error: serviceMessage(error) }; },
      );
      // :17, the restore effect.
      const restored = strip.live.data?.unresolvedOperations?.[0];
      if (typeof restored === 'string' && !strip.unknown) strip.unknown = restored;
    },

    /** :18 */
    liveChanges() {
      const live = strip.live;
      return Array.isArray(live.data?.changes) ? live.data.changes.filter(change => change && change.sample === false && typeof change.id === 'string' && typeof change.version === 'string' && typeof change.title === 'string' && typeof change.summary === 'string' && typeof change.sourceLabel === 'string' && typeof change.sourceVersion === 'string' && actions.some(action => action.id === change.actionId && action.key === change.actionKey) && (!change.sourceUrl || /^https:\/\//.test(change.sourceUrl))) : [];
    },

    /** :21 (the `runtime` branch) and :25 */
    changes() {
      const changes = usableWeekChanges(strip.liveChanges(), actions, strip.acknowledged).filter(change => !metas[change.actionKey]?.archived);
      return sourceReady ? changes : [];
    },

    /** :25 `statusMessage` */
    statusMessage() { return strip.live.error; },

    /** :23, the runtime branch, verbatim apart from React state. */
    async acknowledge(change, { lose = false } = {}) {
      if (strip.pending || !change && !strip.unknown) return;
      strip.pending = true; const operationId = strip.unknown ?? crypto.randomUUID();
      try {
        const receipt = await runtime.request(strip.unknown ? 'operations.read' : 'week.acknowledge', strip.unknown ? { operationId, domain: 'week-updates' } : { operationId, id: change.id, version: change.version, actionId: change.actionId }, { idempotencyKey: operationId, lose });
        if (receipt.operationId === operationId && ['failed', 'cancelled'].includes(receipt.status)) { strip.unknown = null; strip.feedback = 'The update was not applied. You can try again.'; return; }
        if (receipt.operationId !== operationId || receipt.status !== 'succeeded' || !Array.isArray(receipt.acknowledged) || !receipt.acknowledged.every(key => typeof key === 'string')) { strip.unknown = operationId; strip.feedback = 'The update is not confirmed. Select Reviewed again to check its status.'; return; }
        strip.acknowledged = receipt.acknowledged; strip.unknown = null; strip.feedback = 'Update reviewed. Your task is unchanged.'; strip.retries += 1;
      } catch (e) { if (e instanceof FrontendServiceError && e.code === 'unknown_outcome') strip.unknown = operationId; strip.feedback = serviceMessage(e); }
      finally { strip.pending = false; }
    },

    /** :25 `checkStatus` */
    checkStatus() { return strip.acknowledge(); },

    /**
     * :30, what `WeekUpdateList` renders: 'nothing' (null), 'status-check'
     * ("An update needs a status check." or the feedback, with "Check update
     * status"), 'unavailable' ("Plan updates are unavailable." with Try
     * again), or 'list' ("A change to review").
     */
    render() {
      const changes = strip.changes();
      if (!changes.length) return strip.unknown ? { kind: 'status-check', text: strip.feedback || 'An update needs a status check.' } : strip.statusMessage() ? { kind: 'unavailable', text: 'Plan updates are unavailable.' } : null;
      return { kind: 'list', count: changes.length };
    },
  };
  return strip;
}
