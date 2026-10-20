/**
 * What My Week does with a save. The client's modules (TypeScript) are
 * IMPORTED from the real files, compiled in memory by
 * test/frontend-test-loader.mjs, so a change to a frontend validator changes
 * what every suite that uses this file sees. One copy, shared by the commit
 * suites (routesActionsCommit and routesActionsCommitDb) and the contract
 * suites, so they cannot drift apart:
 *
 * - `lib/frontend/production/runtime.ts`: FrontendServiceError,
 *   productionOperations, serviceMessage and `createProductionRuntime`, whose
 *   own `request` runs with the route harness as its `fetcher` (see
 *   `clientRuntime`); the message table is not exported, so `messages` is
 *   read back from the real runtime, one answer per failure code;
 * - `lib/frontend/production/adapters.ts`: createActionAdapter;
 * - `lib/frontend/production/action-service.ts`: actionMetadataError,
 *   validActionPreferences, validActionSnapshot, actionReceiptCoversCommand;
 * - `lib/frontend/expanded-preview.ts`: validActionDate, actionDraftError,
 *   revisedActionBatch;
 * - `lib/frontend/week-preview.ts`: emptyWeekMeta, dayAdd, weekStart,
 *   eventInstant;
 * - `lib/frontend/week-planning.ts`: reviewMetaVersion, captureReview,
 *   prepareReview, changeEvidenceKey, usableWeekChanges.
 *
 * Still TRANSCRIBED (from `origin/codex/october15-review-refinement`, 5ac06f6,
 * types stripped, nothing else changed), because the code lives in a `.tsx`
 * component that cannot be imported, or is not exported by its module:
 *
 * - `lib/frontend/production/action-service.ts:102` (`sameValue`, a private
 *   helper of actionReceiptCoversCommand, not exported);
 * - `components/expanded/ExpandedPreviewState.tsx:60-152`, the screen's
 *   decisions as a plain object (`myWeek`): `commitSnapshot` (:60-68), the
 *   load effect (:69-80), `mutate` (:81-106), `reconcile` (:107-118), the
 *   command builders (:136-140), `save` (:141-145) and `changeState`
 *   (:146-152);
 * - `components/expanded/WeekReviewPlanner.tsx:17` (`apply`, the weekly
 *   review's save), as `applyWeekPlan`;
 * - the week strip: `useProductionResource`'s settle
 *   (`components/production/ProductionContext.tsx:14`), `useWeekChanges` and
 *   `WeekUpdateList` (`components/expanded/WeekUpdates.tsx:14-30`), as
 *   `weekStrip`.
 *
 * Declared seams, none of which changes an outcome a route can cause:
 * - React state becomes plain fields; `setLoadVersion` (a reload) becomes a
 *   counter, `reloads`.
 * - `clientRuntime` is the real `createProductionRuntime` with a `fetcher`
 *   that hands the request to the route harness. It supplies a credential for
 *   the person the harness runs as, and a `navigator` that reports online (a
 *   Node process has none; a browser does). `lose` makes the fetcher throw
 *   after the server has answered, which is what a dropped connection does:
 *   the request was sent, so a mutation becomes `unknown_outcome`.
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
 * - `setBrowserZones` replaces the global `Intl` (which the real modules
 *   read) so a test can stand in for a browser whose ICU knows a zone this
 *   Node does not (digest 9.5, Ruling H24). By default it is Node's own.
 * - `weekStrip`: `queueMicrotask` in the restore effect (:17) is synchronous,
 *   `live.retry()` is a counter (`retries`), and the workspace scenario of
 *   :19 is `sourceReady`, which production starts `ready` (digest 6.2).
 *
 * A validator that accepted everything would prove nothing, so the suites
 * that use this also show it refusing what the client refuses.
 */
import { loadFrontend } from '../frontend-test-loader.mjs';

const runtimeModule = await loadFrontend('production/runtime');
const adapters = await loadFrontend('production/adapters');
const actionService = await loadFrontend('production/action-service');
const expandedPreview = await loadFrontend('expanded-preview');
const weekPreview = await loadFrontend('week-preview');
const weekPlanning = await loadFrontend('week-planning');

// --------------------------------------------------- a browser's Intl and navigator

const NodeIntl = globalThis.Intl;

/**
 * Stand in for a browser whose ICU accepts zones this Node rejects: each name
 * in `aliases` is formatted as the zone it maps to. `null` restores Node's own.
 * The real frontend modules read the global `Intl`, so this replaces it.
 */
export function setBrowserZones(aliases) {
  if (!aliases) { browserIntl = NodeIntl; globalThis.Intl = NodeIntl; return; }
  const DateTimeFormat = function DateTimeFormat(locale, options) {
    const zone = options?.timeZone;
    return new NodeIntl.DateTimeFormat(locale, zone && Object.hasOwn(aliases, zone) ? { ...options, timeZone: aliases[zone] } : options);
  };
  browserIntl = Object.create(NodeIntl, { DateTimeFormat: { value: DateTimeFormat, configurable: true, writable: true } });
  globalThis.Intl = browserIntl;
}
/** The browser's Intl. The server runs in this process too, and keeps Node's own while a request is in its hands (see `clientRuntime`). */
let browserIntl = NodeIntl;

/** A browser reports whether it is online; Node has no `navigator.onLine`. */
function setOnline(online) {
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: online }, configurable: true, writable: true });
}
setOnline(true);

// ------------------------------------------------------------ runtime.ts

export const { FrontendServiceError, productionOperations, serviceMessage, createProductionRuntime } = runtimeModule;

/**
 * One real runtime over a canned `fetcher`, for the person `identityId`.
 * The credential is the one the harness would have verified.
 */
function realRuntime(fetcher, { identityId = 'person', homeContextId = null } = {}) {
  return createProductionRuntime({ identityId, homeContextId, credential: async () => ({ identityId, accessToken: 'test-token' }), fetcher });
}

/**
 * The runtime's message table (runtime.ts:91-97, not exported), read back from
 * the real runtime: one failing answer per code, and the message it carries.
 */
export const messages = await (async () => {
  const answer = (status, body = '{}') => async () => new Response(body, { status, headers: { 'content-type': 'application/json' } });
  const failure = (fetcher, operation, input, options) => realRuntime(fetcher).request(operation, input, options).then(() => null, (error) => error);
  const found = {};
  for (const [name, error] of [
    ['session', await failure(answer(401), 'settings.read')],
    ['permission', await failure(answer(403), 'settings.read')],
    ['conflict', await failure(answer(409), 'settings.read')],
    ['validation', await failure(answer(422), 'settings.read')],
    ['rate_limited', await failure(answer(429), 'settings.read')],
    ['unavailable', await failure(answer(503), 'settings.read')],
    ['invalid_response', await failure(answer(200, 'not json'), 'settings.read')],
    ['unknown_outcome', await failure(answer(500), 'settings.save', {})],
    ['aborted', await failure(answer(200), 'settings.read', undefined, { signal: AbortSignal.abort() })],
  ]) {
    if (error?.code !== name) throw new Error(`the real runtime did not answer ${name}: ${error?.code}`);
    found[name] = error.message;
  }
  setOnline(false);
  try {
    const error = await failure(async () => { throw new Error('network'); }, 'settings.read');
    if (error?.code !== 'offline') throw new Error(`the real runtime did not answer offline: ${error?.code}`);
    found.offline = error.message;
  } finally { setOnline(true); }
  return Object.freeze(found);
})();

/**
 * The real `createProductionRuntime(...).request` with the route harness as
 * `fetcher`. `lose(operation)` returning true drops that response after the
 * server has answered it (a lost connection).
 */
export function clientRuntime(h, who, { homeContextId = null, env, lose = () => false } = {}) {
  return {
    request(operation, body, options = {}) {
      const fetcher = async (requestPath, init) => {
        const route = new URL(requestPath, 'http://client.invalid').pathname;
        const mutation = init.method !== 'GET';
        // The browser's session is the harness's `as`: the runtime's own bearer header is dropped so it cannot override it.
        const headers = { ...init.headers };
        delete headers.Authorization;
        // The server answers with Node's own Intl, not the browser's stand-in.
        globalThis.Intl = NodeIntl;
        let response;
        try { response = await h.call(route, init.method, { as: who, url: requestPath, headers, env, rawBody: mutation ? init.body : undefined }); } finally { globalThis.Intl = browserIntl; }
        if (lose(operation) || options.lose) throw new DOMException('Request ended', 'AbortError');
        return response;
      };
      return realRuntime(fetcher, { identityId: who ?? 'anonymous', homeContextId }).request(operation, body, options);
    },
  };
}

/**
 * What runtime.request does with a response once it has one: the real
 * runtime, handed that one response (the status mapping, the JSON check and
 * the envelope unwrap). `mutation` picks a registry entry that is one.
 */
export function clientRequest(response, mutation) {
  return realRuntime(async () => response).request(mutation ? 'settings.save' : 'settings.read', mutation ? {} : undefined);
}

// ------------------------------------------------------ expanded-preview.ts

export const { validActionDate, actionDraftError, revisedActionBatch } = expandedPreview;

// ---------------------------------------------------------- week-preview.ts

export const { emptyWeekMeta, dayAdd, weekStart, eventInstant } = weekPreview;

// -------------------------------------------------------- action-service.ts

export const { actionMetadataError, validActionPreferences, validActionSnapshot, actionReceiptCoversCommand } = actionService;

/** action-service.ts:102 (private there, so transcribed) */
export function sameValue(a,b){if(Object.is(a,b))return true;if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;const left=Object.keys(a),right=Object.keys(b);return left.length===right.length&&left.every(key=>Object.hasOwn(b,key)&&sameValue(a[key],b[key]));}

// --------------------------------------------------------------- adapters.ts

export const { createActionAdapter } = adapters;

// ----------------------------------------------------------- week-planning.ts

export const { reviewMetaVersion, captureReview, prepareReview, changeEvidenceKey, usableWeekChanges } = weekPlanning;

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
