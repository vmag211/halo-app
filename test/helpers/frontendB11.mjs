/**
 * What the Homeguard provider does with a load and a save, TRANSCRIBED from
 * components/homeguard/HomeWorkspaceState.tsx in this tree (types stripped,
 * React state as plain fields, the production branches only). Its validators
 * are NOT transcribed: `validHomeRecords`, `validHomeChanges`,
 * `acceptedHomeReceipt`, `homeReceiptCoversCommand` (home-service.ts),
 * `validProductionCollection` (home-records.ts) and `recordFingerprint`
 * (settings-preview.ts) are the client's own modules, compiled by
 * test/frontend-test-loader.mjs.
 *
 * Transcribed:
 *   :98-118   loadCollection
 *   :138-142  unresolved
 *   :143-165  applyReceipt
 *   :167-179  execute
 *   :180-188  reconcile
 *   :205-214  write (production branch)
 *   :233-238  remove (production branch)
 *   :251-256  removeNotes (production branch)
 *   :270-276  clearPrivate (production branch)
 *   :86-96    applyCanonical (collections only)
 *   :282-283  trackPendingOperation, resolvePendingOperation (B14)
 *
 * Declared seams, none of which changes an outcome a route can cause:
 * - `navigator.onLine` is true, the session is alive and no request is
 *   aborted; `loadVersions` is kept so a stale load is still ignored.
 * - Drafts are not modelled (clearPrivate's draft reset is left out).
 * - `retry()` after a recovered reconcile reloads every collection already
 *   loaded, as :186 does through retry().
 */
import { loadFrontend } from '../frontend-test-loader.mjs';

const { acceptedHomeReceipt, homeReceiptCoversCommand, validHomeChanges, validHomeRecords } = await loadFrontend('production/home-service');
const { validProductionCollection } = await loadFrontend('production/home-records');
const { recordFingerprint } = await loadFrontend('settings-preview');

export { validProductionCollection, homeReceiptCoversCommand, validHomeChanges, recordFingerprint };

export function homeWorkspace(service) {
  const state = {
    collections: {},
    collectionStates: {},
    unknownOperations: [],
    message: '',
    pending: false,
    operationIds: [],
  };
  const unknown = new Map();
  const resolved = new Set();
  const loadVersions = new Map();
  const locks = new Set();

  const commit = (next) => { state.collections = next; };
  const collectionState = (key, next) => { state.collectionStates = { ...state.collectionStates, [key]: next }; };

  function applyCanonical(change) {
    if (change.collections) {
      if (!validHomeChanges(change.collections) || !Object.entries(change.collections).every(([key, rows]) => validProductionCollection(key, rows))) throw new Error('Invalid canonical workspace response.');
      for (const key of Object.keys(change.collections)) {
        loadVersions.set(key, (loadVersions.get(key) ?? 0) + 1);
        collectionState(key, { ...state.collectionStates[key], status: 'ready', complete: true });
      }
      commit({ ...state.collections, ...change.collections });
    }
  }

  async function loadCollection(key, force = false) {
    if (!force && state.collectionStates[key]) return;
    const version = (loadVersions.get(key) ?? 0) + 1; loadVersions.set(key, version);
    const request = new AbortController();
    collectionState(key, { ...state.collectionStates[key], status: 'loading', complete: false });
    try {
      const snapshot = await service.load(key, request.signal);
      if (loadVersions.get(key) !== version) return;
      if (!validHomeRecords(snapshot.records) || !validProductionCollection(key, snapshot.records)) throw new Error('The records could not be read. Try again.');
      if (!Array.isArray(snapshot.pendingOperations) || !snapshot.pendingOperations.every(item => item && typeof item.operationId === 'string' && item.operationId && ['workspace', 'attachments'].includes(item.domain))) throw new Error('Pending changes could not be checked. Refresh before editing.');
      for (const item of snapshot.pendingOperations) if (!resolved.has(item.operationId) && !unknown.has(item.operationId)) unknown.set(item.operationId, { kind: 'recovered', operationId: item.operationId, domain: item.domain });
      if (unknown.size) { state.unknownOperations = [...unknown.keys()].map(operationId => ({ operationId, message: 'An earlier change needs a status check.' })); state.message = 'Check earlier changes before making another change.'; }
      if (snapshot.availability === 'unavailable') throw new Error(snapshot.message || 'This collection is unavailable. Your saved records are unchanged.');
      commit({ ...state.collections, [key]: snapshot.records });
      collectionState(key, { status: 'ready', revision: snapshot.revision, complete: snapshot.complete !== false && !snapshot.nextCursor && snapshot.availability !== 'partial', message: snapshot.message });
    } catch (error) {
      if (loadVersions.get(key) === version) collectionState(key, { ...state.collectionStates[key], status: 'error', complete: false, ...(error?.reason === 'feature_unavailable' ? { featureUnavailable: true } : {}), message: error instanceof Error ? error.message.replaceAll(String.fromCharCode(0x2014), ',') : 'This collection could not load. Try again.' });
    }
  }
  async function retry(key) {
    await Promise.all((key ? [key] : Object.keys(state.collectionStates)).map(name => loadCollection(name, true)));
  }
  function unresolved(command, message) {
    unknown.set(command.operationId, command);
    state.unknownOperations = [...unknown.keys()].map(operationId => ({ operationId, message }));
    state.message = message;
  }
  function applyReceipt(command, receipt) {
    if (receipt.operationId !== command.operationId || !['succeeded', 'failed', 'pending', 'unknown'].includes(receipt.status)) {
      unresolved(command, 'The save result could not be verified. Check its status before trying another change.'); return false;
    }
    if (receipt.status === 'pending' || receipt.status === 'unknown') {
      unresolved(command, receipt.message || 'The save is not yet confirmed. Check its status before trying another change.'); return false;
    }
    if (receipt.status === 'succeeded' && !(command.kind === 'recovered' ? acceptedHomeReceipt(receipt, command.operationId) : homeReceiptCoversCommand(command, receipt))) {
      unresolved(command, 'The saved response could not be read. Check its status before trying another change.'); return false;
    }
    if (receipt.status === 'succeeded') applyCanonical({ collections: receipt.changes });
    resolved.add(command.operationId);
    unknown.delete(command.operationId);
    state.unknownOperations = state.unknownOperations.filter(item => item.operationId !== command.operationId);
    if (receipt.status === 'failed') { state.message = receipt.message || 'The change was not saved. Your draft is kept.'; return false; }
    for (const [key, revision] of Object.entries(receipt.revisions ?? {})) collectionState(key, { ...state.collectionStates[key], status: 'ready', complete: true, revision });
    if (command.kind === 'clear-private') {
      if (command.scope === 'all') commit(Object.fromEntries(Object.keys(state.collections).map(key => [key, []])));
    }
    state.message = 'Saved.'; return true;
  }
  async function execute(command) {
    if (state.pending || locks.size) return false;
    if (unknown.size) { state.message = 'Check the pending save status before making another change. Your draft is kept.'; return false; }
    const request = new AbortController(); locks.add(command.operationId); state.pending = true; state.message = 'Saving...';
    state.operationIds.push(command.operationId);
    try {
      const receipt = await service.execute(command, request.signal);
      return applyReceipt(command, receipt);
    } catch {
      unresolved(command, 'The connection ended before the result was confirmed. Check save status before retrying.');
      return false;
    } finally { locks.delete(command.operationId); state.pending = locks.size > 0; }
  }
  async function reconcile(operationId) {
    const command = unknown.get(operationId);
    if (!command || locks.size) return false;
    const request = new AbortController(); locks.add(operationId); state.pending = true;
    try { const receipt = await service.reconcile(operationId, request.signal, command.kind === 'recovered' ? command.domain : 'workspace'); const accepted = applyReceipt(command, receipt); if (accepted && command.kind === 'recovered') await retry(); return accepted; }
    catch { state.message = 'Save status is still unavailable. Your draft remains here. Do not repeat the change.'; return false; }
    finally { locks.delete(operationId); state.pending = false; }
  }
  async function write(key, record) {
    if (state.collectionStates[key]?.featureUnavailable) { state.message = 'Saving these records is not available yet. Nothing was saved, and your draft is kept.'; return false; }
    if (state.collectionStates[key]?.status !== 'ready') { state.message = 'Load the current records before saving. Your draft is kept.'; void loadCollection(key); return false; }
    const current = state.collections[key]?.find(item => item.id === record.id);
    if (current && current.revision !== record.revision) { state.message = 'This record changed. Your draft is kept. Review the latest version before saving.'; return false; }
    const homeOwned = ['assets','observations','gardens','usage','pantryItems'].includes(key);
    const scoped = !current && homeOwned && !record.homeContextId ? { ...record, homeContextId: service.context?.currentHomeId ?? undefined } : record;
    if (homeOwned && !scoped.homeContextId) { state.message = 'Choose a home before saving this record. Your draft is kept.'; return false; }
    return execute({ kind: 'write', collection: key, record: scoped, expectedRevision: current?.revision ?? null, collectionRevision: state.collectionStates[key]?.revision, operationId: crypto.randomUUID() });
  }
  async function remove(key, id, expectedRevision) {
    const current = state.collections[key]?.find(item => item.id === id);
    if (!current) { state.message = 'This record is no longer available. Refresh the list before making another change.'; return false; }
    if (expectedRevision === undefined || current.revision !== expectedRevision) { state.message = 'This record changed. Reopen its deletion review before continuing.'; return false; }
    return execute({ kind: 'remove', collection: key, recordId: id, expectedRevision: current.revision, collectionRevision: state.collectionStates[key]?.revision, operationId: crypto.randomUUID() });
  }
  async function removeNotes(selection) {
    const current = state.collections.exploreNotes ?? [];
    if (!selection.length || new Set(selection.map(item => item.id)).size !== selection.length || !selection.every(item => current.some(record => record.id === item.id && record.revision === item.revision))) { state.message = 'The selected notes changed. Nothing was removed. Review the selection again.'; return false; }
    return execute({ kind: 'remove-notes', selection, operationId: crypto.randomUUID() });
  }
  async function clearPrivate(scope, expected, checkOther) {
    if (checkOther) { state.message = 'Use the account privacy review to clear connected records together. Nothing was deleted.'; return false; }
    if (recordFingerprint(state.collections, scope) !== expected) { state.message = 'Records changed. Nothing was deleted. Reopen the review.'; return false; }
    return execute({ kind: 'clear-private', scope, expectedFingerprint: expected, operationId: crypto.randomUUID() });
  }

  return {
    state,
    get records() { return state.collections; },
    status: (key) => state.collectionStates[key],
    loadCollection,
    loadAll: (keys) => Promise.all(keys.map((key) => loadCollection(key))),
    retry,
    write,
    remove,
    removeNotes,
    clearPrivate,
    reconcile,
    canMutate: () => !state.pending && !locks.size && !unknown.size,
    // B14 (test/helpers/frontendB14.mjs): the private-file hooks read these.
    // HomeWorkspaceState.tsx:281-283, the context's service, unknownOperations,
    // applyCanonical, trackPendingOperation and resolvePendingOperation.
    service,
    get unknownOperations() { return state.unknownOperations; },
    applyCanonical,
    trackPendingOperation: (operationId, domain) => unresolved({ kind: 'recovered', operationId, domain }, 'A private file request needs a status check before another change.'),
    resolvePendingOperation: operationId => { resolved.add(operationId); unknown.delete(operationId); state.unknownOperations = state.unknownOperations.filter(item => item.operationId !== operationId); },
  };
}
