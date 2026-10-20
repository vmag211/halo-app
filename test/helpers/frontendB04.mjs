/**
 * The frontend code the B04 routes are judged by. Everything that lives in a
 * TypeScript module is IMPORTED from the real file (compiled in memory by
 * test/frontend-test-loader.mjs, the same way test/frontend-*.test.mjs load
 * it), so a change to a frontend validator changes what these suites see. One
 * copy, shared by every B04 suite that needs it (test/routesSettings.test.mjs,
 * test/routesAlertsState.test.mjs and the contract suite
 * test/contractsB04.test.mjs), so the per-route suites and the contract suite
 * cannot drift apart:
 *
 * - `lib/frontend/settings-preview.ts` (notificationKinds, appearancePreference,
 *   colorPalette);
 * - `lib/frontend/expanded-preview.ts` (validActionDate);
 * - `lib/frontend/production/preferences-service.ts` (validSettingsSnapshot);
 * - `lib/frontend/production/alerts-service.ts` (validAlertSnapshot,
 *   alertReceiptCovers);
 * - `lib/frontend/production/runtime.ts`: the real `createProductionRuntime`,
 *   whose own `request` runs with the route harness as its `fetcher` (the
 *   status mapping, the JSON check and the envelope unwrap are the runtime's
 *   own; see `clientRuntime` and `clientRequest` in test/helpers/frontendB06.mjs),
 *   with its message table read back from the real runtime as
 *   `RUNTIME_MESSAGES`.
 *
 * Still TRANSCRIBED, from `origin/codex/october15-review-refinement`
 * (5ac06f6), because the code lives in a `.tsx` hook that cannot be imported:
 *
 * - `components/production/ProductionPreferences.tsx:15-20` and
 *   `components/expanded/SettingsWorkspace.tsx:88-90` (hydrate, save,
 *   reconcile and the workspace's save body), as `productionPreferences`;
 * - `components/production/ProductionAlerts.tsx:12-24` (the inbox hook), as
 *   `productionAlerts`.
 *
 * In the two hooks React state becomes plain fields, `useProductionResource`
 * and its effect become `reload()`, and `runtime.request` is the real runtime
 * over the real route handlers. Everything else is the hooks' own logic,
 * branch for branch, so a body the validators accept but a hook mishandles
 * fails in whichever suite drives it.
 *
 * A validator that accepted everything would pass every body it is given, so
 * each suite that uses these also shows that they reject what the client
 * rejects (precedent: test/helpers/frontendB05.mjs).
 */
import { BAND_KEYS } from '../../lib/household.js';
import { loadFrontend } from '../frontend-test-loader.mjs';
import { FrontendServiceError, clientRequest, clientRuntime, messages, serviceMessage } from './frontendB06.mjs';

const settingsPreview = await loadFrontend('settings-preview');
const expandedPreview = await loadFrontend('expanded-preview');
const preferencesService = await loadFrontend('production/preferences-service');
const alertsService = await loadFrontend('production/alerts-service');

const { notificationKinds, appearancePreference, colorPalette } = settingsPreview;
const { validActionDate } = expandedPreview;
const { validSettingsSnapshot } = preferencesService;
const { validAlertSnapshot, alertReceiptCovers } = alertsService;

/** The runtime's message table (runtime.ts:91-97), read back from the real runtime. */
const RUNTIME_MESSAGES = messages;

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
  const runtime = clientRuntime(h, who);
  async function request(operation, body, options = {}) {
    sent.push(operation);
    return runtime.request(operation, body, options);
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
  const runtime = clientRuntime(h, as);
  async function request(operation, body, idempotencyKey) {
    sent.push(operation);
    return runtime.request(operation, body, { idempotencyKey });
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
  validSettingsSnapshot, validAlertSnapshot, alertReceiptCovers,
  RUNTIME_MESSAGES, FrontendServiceError, serviceMessage, clientRequest,
  productionPreferences, productionAlerts,
};
