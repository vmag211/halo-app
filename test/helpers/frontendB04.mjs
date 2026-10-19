/**
 * The frontend code the B04 routes are judged by, TRANSCRIBED, not summarised,
 * from `origin/codex/october15-review-refinement` (5ac06f6; read with
 * `git show`, the files are not checked out here). TypeScript to JavaScript
 * with the types stripped and nothing else changed in the validators. One
 * copy, shared by every B04 suite that needs it (test/routesSettings.test.mjs,
 * test/routesAlertsState.test.mjs and the contract suite
 * test/contractsB04.test.mjs), so the per-route suites and the contract suite
 * cannot drift apart:
 *
 * - `lib/frontend/settings-preview.ts:2,6,8` (notificationKinds,
 *   appearancePreference, colorPalette);
 * - `lib/frontend/expanded-preview.ts:30-35` (validActionDate);
 * - `lib/frontend/production/preferences-service.ts:4-11` (zone, bool,
 *   validSettingsSnapshot);
 * - `lib/frontend/production/alerts-service.ts:5-14` (destinations, factors,
 *   source, validAlertSnapshot, alertReceiptCovers);
 * - `lib/frontend/production/runtime.ts:91-98,144,147-153` (the message table,
 *   serviceMessage, the status mapping, the JSON check and the envelope
 *   unwrap), as `clientRequest`;
 * - `components/production/ProductionPreferences.tsx:15-20` and
 *   `components/expanded/SettingsWorkspace.tsx:88-90` (hydrate, save,
 *   reconcile and the workspace's save body), as `productionPreferences`;
 * - `components/production/ProductionAlerts.tsx:12-24` (the inbox hook), as
 *   `productionAlerts`.
 *
 * In the two hooks React state becomes plain fields, `useProductionResource`
 * and its effect become `reload()`, and `runtime.request` becomes the real
 * route handlers through `clientRequest`. Everything else is the hooks' own
 * logic, branch for branch, so a body the validators accept but a hook
 * mishandles fails in whichever suite drives it.
 *
 * A transcription that accepted everything would pass every body it is given,
 * so each suite that uses one also shows that it rejects what the client
 * rejects (precedent: test/helpers/frontendB05.mjs).
 */
import { BAND_KEYS } from '../../lib/household.js';

// ------------------------------------------- transcribed: settings-preview.ts

const notificationKinds = ['air_quality_change','weather_advisory','new_water_results','radon_season','season_summary'];
/** settings-preview.ts:6 */
const appearancePreference = (value) => (value === 'light' || value === 'dark' ? value : 'system');
/** settings-preview.ts:8 */
const colorPalette = (value) => (value === 'forest' || value === 'iris' ? value : 'ocean');

// ------------------------------------------- transcribed: expanded-preview.ts

function validActionDate(value) {
  if (value === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// ------------------------------------------ transcribed: preferences-service.ts

function zone(value){if(typeof value!=='string')return false;try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}}
const bool=(value)=>typeof value==='boolean';
function validSettingsSnapshot(value){
 const v=value;if(!v||!Number.isSafeInteger(v.revision)||v.revision<1||!Array.isArray(v.unresolvedOperations)||v.unresolvedOperations.some(id=>typeof id!=='string'||!id)||!v.values?.home||!v.values.quiet||!v.values.notifications||!v.values.luna||!v.display||!v.calendar)return false;
 if(v.display.palette!==undefined&&!['ocean','forest','iris'].includes(v.display.palette))return false;
 const {home,quiet,notifications,luna,language}=v.values;
 return typeof home.year==='string'&&(!home.year||/^\d{4}$/.test(home.year))&&['utility','well','spring','other'].includes(home.water)&&['owner','renter','other'].includes(home.tenure)&&notificationKinds.every(key=>bool(notifications[key]))&&bool(quiet.enabled)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(quiet.from)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(quiet.to)&&zone(quiet.zone)&&['tasks','home','projects'].every(key=>bool(luna[key]))&&['en','es'].includes(language)&&['system','light','dark'].includes(v.display.appearance)&&['100','115','130','150'].includes(v.display.scale)&&['system','full','reduce'].includes(v.display.motion)&&bool(v.display.contrast)&&bool(v.display.ambient)&&zone(v.calendar.zone)&&bool(v.calendar.streak)&&bool(v.calendar.linked);
}

// ----------------------------------------------- transcribed: alerts-service.ts

const destinations={home:['tests','maintenance','food','summary'],plan:['journal','patterns','recap','outdoors','reminders'],today:[]};
const factors=['air','uv','pollen','mold','pfas','radon','lead'];
function source(value){if(!value)return true;try{const url=new URL(value.url);return typeof value.title==='string'&&!!value.title&&url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}}
function validAlertSnapshot(value){
 const v=value;
 return !!v&&Array.isArray(v.unresolvedOperations)&&v.unresolvedOperations.every(id=>typeof id==='string'&&!!id)&&Array.isArray(v.items)&&new Set(v.items.map(item=>item?.id)).size===v.items.length&&v.items.every(item=>item&&typeof item.id==='string'&&!!item.id&&Number.isSafeInteger(item.revision)&&item.revision>0&&typeof item.title==='string'&&!!item.title&&typeof item.body==='string'&&['Home','Your week','Conditions'].includes(item.category)&&!!item.date&&validActionDate(item.date)&&typeof item.read==='boolean'&&typeof item.dismissed==='boolean'&&[...notificationKinds,'app'].includes(item.kind)&&item.target&&Object.hasOwn(destinations,item.target.tab)&&(!item.target.destination||destinations[item.target.tab].includes(item.target.destination))&&(!item.target.learn||factors.includes(item.target.learn))&&source(item.source));
}
function alertReceiptCovers(value,selected,patch){
 return selected.length>0&&selected.every(previous=>{const next=value.items.find(item=>item.id===previous.id);return !!next&&next.revision>previous.revision&&(patch.read===undefined||next.read===patch.read)&&(patch.dismissed===undefined||next.dismissed===patch.dismissed);});
}

// ------------------------------------------------------ transcribed: runtime.ts

const RUNTIME_MESSAGES = {
  offline: 'You are offline. Your changes are still here.', session: 'Please reconnect your session to continue.',
  permission: 'This action is not available for this account.', conflict: 'This item changed. Review the latest version before saving.',
  validation: 'Check the highlighted information and try again.', rate_limited: 'Please wait before trying again.',
  unavailable: 'This service is unavailable. Try again later.', invalid_response: 'The service returned incomplete information. Please retry.',
  aborted: 'Request cancelled.', unknown_outcome: 'The result is not confirmed. Check its status before trying again.',
};
class FrontendServiceError extends Error { constructor(code, message = RUNTIME_MESSAGES[code]) { super(message); this.code = code; } }
const serviceMessage = (error) => (error instanceof FrontendServiceError ? error.message : RUNTIME_MESSAGES.unavailable);

/**
 * What runtime.request does with a response once it has one: the status
 * mapping (:144), the JSON check (:147) and the envelope unwrap (:149-152).
 */
async function clientRequest(response, mutation) {
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const s = response.status;
    throw new FrontendServiceError(s === 401 ? 'session' : s === 403 ? 'permission' : s === 409 || s === 412 ? 'conflict' : s === 400 || s === 422 ? 'validation' : s === 429 ? 'rate_limited' : s >= 500 && mutation ? 'unknown_outcome' : 'unavailable');
  }
  if (json === null || typeof json !== 'object') throw new FrontendServiceError(mutation ? 'unknown_outcome' : 'invalid_response');
  if (Object.hasOwn(json, 'data')) return json.data;
  return json;
}

const operationsRead = (h, as, body) => h.call('/api/operations', 'GET', { as, url: `/api/operations?${new URLSearchParams(body)}` });

// ------------------------------- transcribed: ProductionPreferences.tsx and
// ------------------------------- SettingsWorkspace.tsx (the save body)
//
// What the workspace keeps in drafts (the values, the display block, the
// calendar block) is what `hydrate` puts there. `saveGroup` builds the body
// exactly as SettingsWorkspace.save does in production, `display` included:
// the current display block with its palette run through `colorPalette`, so
// 'ocean' when none is stored, plus the appearance and ambient drafts.

function productionPreferences(h, who = 'alice') {
  const sent = [];
  async function request(operation, body, options = {}) {
    const mutation = operation === 'settings.save';
    sent.push(operation);
    let response;
    if (operation === 'settings.read') response = await h.call('/api/settings', 'GET', { as: who });
    else if (operation === 'operations.read') response = await operationsRead(h, who, body);
    else {
      const headers = { 'idempotency-key': options.idempotencyKey };
      if (options.expectedRevision !== undefined) headers['if-match'] = String(options.expectedRevision);
      response = await h.call('/api/settings', 'PATCH', { as: who, body, headers });
    }
    return clientRequest(response, mutation);
  }

  const read = { data: null, error: null, loading: false };
  const state = { snapshot: null, error: null, pending: false, unknown: null, conflict: false };
  // The workspace drafts hydrate writes (ProductionPreferences.tsx hydrate).
  const drafts = { values: null, appearance: 'system', ambient: false, display: null, zone: 'America/New_York', streak: false, linked: true };
  let lock = false;
  const hydrate = (value) => {
    state.snapshot = value;
    state.unknown = value.unresolvedOperations[0] ?? null;
    drafts.values = value.values;
    drafts.appearance = value.display.appearance;
    drafts.ambient = value.display.ambient;
    drafts.display = value.display;
    drafts.zone = value.calendar.zone;
    drafts.streak = value.calendar.streak;
    drafts.linked = value.calendar.linked;
  };
  async function reload() {
    read.loading = true;
    read.error = null;
    try { read.data = await request('settings.read', {}); } catch (error) { read.data = null; read.error = serviceMessage(error); } finally { read.loading = false; }
    if (read.data) {
      if (validSettingsSnapshot(read.data)) hydrate(read.data);
      else state.error = 'Settings could not be verified. Please retry.';
    }
  }
  async function save(input) {
    if (lock || state.unknown || !state.snapshot) return null;
    lock = true; state.pending = true; state.error = null; state.conflict = false;
    const id = crypto.randomUUID();
    try {
      const receipt = await request('settings.save', { ...input, operationId: id }, { idempotencyKey: id, expectedRevision: state.snapshot.revision });
      if (receipt.operationId === id && ['failed', 'cancelled'].includes(receipt.status)) { state.error = 'The save was not applied. Your draft is still here.'; return null; }
      const value = receipt.snapshot;
      if (receipt.operationId !== id || receipt.status !== 'succeeded' || !validSettingsSnapshot(value)) {
        state.unknown = id;
        throw new FrontendServiceError('unknown_outcome', 'The save is not confirmed. Check its status before trying again.');
      }
      hydrate(value);
      return value;
    } catch (error) {
      state.conflict = error instanceof FrontendServiceError && error.code === 'conflict';
      if (error instanceof FrontendServiceError && error.code === 'conflict') await reload();
      if (error instanceof FrontendServiceError && error.code === 'unknown_outcome') state.unknown = id;
      state.error = serviceMessage(error);
      return null;
    } finally { lock = false; state.pending = false; }
  }
  async function reconcile() {
    if (!state.unknown || lock) return;
    lock = true; state.pending = true;
    try {
      const value = await request('operations.read', { operationId: state.unknown, domain: 'settings' });
      if (value.operationId === state.unknown && value.status === 'succeeded' && validSettingsSnapshot(value.snapshot)) { hydrate(value.snapshot); state.error = null; }
      else if (value.operationId === state.unknown && (value.status === 'failed' || value.status === 'cancelled')) { state.unknown = null; await reload(); state.error = 'The save was not applied. Your draft is still here.'; }
      else state.error = 'The save is still being checked.';
    } catch (error) { state.error = serviceMessage(error); } finally { lock = false; state.pending = false; }
  }
  /**
   * SettingsWorkspace.save in production: the panel's edit over the hydrated
   * values, plus `household` for home and the display and calendar drafts for
   * display. `edit` changes the panel's draft the way a control would.
   */
  function saveGroup(panel, { values: editValues, household, display, calendar, appearance, ambient } = {}) {
    const values = drafts.values;
    const current = structuredClone(values);
    if (editValues) editValues(current);
    const submitted = panel === 'home' ? { ...values, home: current.home }
      : panel === 'notifications' ? { ...values, notifications: current.notifications, quiet: current.quiet }
        : panel === 'luna' ? { ...values, luna: current.luna }
          : panel === 'display' ? { ...values, language: current.language } : values;
    const currentDisplay = { scale: drafts.display.scale, motion: drafts.display.motion, contrast: drafts.display.contrast, palette: colorPalette(drafts.display.palette) };
    const displayDraft = { ...currentDisplay, ...display };
    const calendarDraft = { zone: drafts.zone, streak: drafts.streak, linked: drafts.linked, ...calendar };
    const appearanceDraft = appearance ?? appearancePreference(drafts.appearance);
    const ambientDraft = ambient ?? drafts.ambient;
    return save({
      group: panel,
      values: submitted,
      ...(panel === 'home' ? { household: household ?? Object.fromEntries(BAND_KEYS.map((key) => [key, false])) } : {}),
      ...(panel === 'display' ? { display: { ...displayDraft, appearance: appearanceDraft, ambient: ambientDraft }, calendar: calendarDraft } : {}),
    });
  }
  return {
    sent, reload, reconcile, saveGroup, state, drafts,
    get snapshot() { return state.snapshot; },
    get unknown() { return state.unknown; },
    get error() { return state.error ?? read.error ?? (state.unknown ? 'A settings save needs a status check.' : null); },
  };
}

// ------------------------------------------ transcribed: ProductionAlerts.tsx

function productionAlerts(h, as = 'alice') {
  const sent = [];
  async function request(operation, body, idempotencyKey) {
    const mutation = operation === 'alerts.update';
    sent.push(operation);
    let response;
    if (operation === 'alerts.read') response = await h.call('/api/alerts', 'GET', { as, url: '/api/alerts' });
    else if (operation === 'operations.read') response = await operationsRead(h, as, body);
    else response = await h.call('/api/alerts/state', 'POST', { as, body, headers: { 'idempotency-key': idempotencyKey } });
    return clientRequest(response, mutation);
  }

  const resource = { data: null, error: '', loading: false };
  const state = { items: [], message: '', undo: null, pending: false, unknown: null };
  let lock = false;

  async function reload() {
    resource.loading = true;
    resource.error = '';
    try { resource.data = await request('alerts.read', {}); } catch (error) { resource.data = null; resource.error = serviceMessage(error); } finally { resource.loading = false; }
    if (resource.data) {
      if (validAlertSnapshot(resource.data)) { state.items = resource.data.items; state.unknown = resource.data.unresolvedOperations[0] ?? null; } else state.message = 'Alerts could not be verified. Please retry.';
    }
  }
  async function change(selected, patch) {
    if (lock || state.unknown || resource.loading || resource.error || selected.length === 0) return false;
    if (selected.some((item) => !state.items.some((current) => current.id === item.id && current.revision === item.revision))) { state.message = 'These alerts changed. Reload before trying again.'; return false; }
    lock = true; state.pending = true; const operationId = crypto.randomUUID();
    try {
      const value = await request('alerts.update', { operationId, selection: selected.map(({ id, revision }) => ({ id, revision })), patch }, operationId);
      if (value.operationId === operationId && ['failed', 'cancelled'].includes(value.status)) { state.message = 'The update was not applied.'; return false; }
      if (value.operationId !== operationId || value.status !== 'succeeded' || !validAlertSnapshot(value) || !alertReceiptCovers(value, selected, patch)) { state.unknown = operationId; state.message = 'The update is not confirmed. Check its status.'; return false; }
      state.items = value.items; state.unknown = value.unresolvedOperations[0] ?? null; state.message = ''; return value.items;
    } catch (error) {
      if (error instanceof FrontendServiceError && error.code === 'unknown_outcome') state.unknown = operationId;
      state.message = serviceMessage(error); return false;
    } finally { lock = false; state.pending = false; }
  }
  async function retry() {
    if (!state.unknown) { state.message = ''; await reload(); return; }
    if (lock) return;
    lock = true; state.pending = true;
    try {
      const value = await request('operations.read', { operationId: state.unknown, domain: 'alerts' });
      if (value.operationId === state.unknown && value.status === 'succeeded' && validAlertSnapshot(value)) { state.items = value.items; state.unknown = value.unresolvedOperations[0] ?? null; state.message = ''; }
      else if (value.operationId === state.unknown && (value.status === 'failed' || value.status === 'cancelled')) { state.unknown = null; await reload(); state.message = 'The update was not applied.'; }
      else state.message = 'The update is still being checked.';
    } catch (error) { state.message = serviceMessage(error); } finally { lock = false; state.pending = false; }
  }
  return {
    sent, reload, retry,
    get items() { return state.items; },
    get unread() { return state.items.filter((i) => !i.read && !i.dismissed).length; },
    get message() { return state.message || resource.error || (state.unknown ? 'An alert update needs a status check.' : ''); },
    get undo() { return state.undo; },
    get unknown() { return state.unknown; },
    /** Test only: the lock a load leaves when `id` was the oldest unsettled operation it listed. */
    park: (id) => { state.unknown = id; },
    item: (id) => state.items.find((i) => i.id === id),
    read: (item) => change([item], { read: true }),
    dismiss: async (item) => { const next = await change([item], { dismissed: true }); if (next) { state.undo = next.find((i) => i.id === item.id) ?? null; state.message = 'Alert dismissed.'; } },
    restore: async () => { if (state.undo && await change([state.undo], { dismissed: false })) { state.undo = null; state.message = 'Alert restored.'; } },
    all: () => change(state.items.filter((i) => !i.read && !i.dismissed), { read: true }),
  };
}

export {
  notificationKinds, appearancePreference, colorPalette, validActionDate,
  zone, bool, validSettingsSnapshot,
  destinations, factors, source, validAlertSnapshot, alertReceiptCovers,
  RUNTIME_MESSAGES, FrontendServiceError, serviceMessage, clientRequest,
  productionPreferences, productionAlerts,
};
