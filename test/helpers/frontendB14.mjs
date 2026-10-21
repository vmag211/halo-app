/**
 * What the private-file screens do with the attachment service, TRANSCRIBED
 * from this tree: TypeScript to JavaScript with the types removed and React
 * state turned into plain fields, nothing else changed. The adapter, runtime
 * and validators are NOT transcribed: test/routesAttachmentsDb.test.mjs loads
 * the real lib/frontend/production/runtime.ts and adapters.ts through
 * test/frontend-test-loader.mjs. The workspace provider is
 * test/helpers/frontendB11.mjs.
 *
 * - `components/homeguard/usePrivateUpload.ts:15-41` (upload, with its
 *   unknown-result reconcile, and reset);
 * - `components/homeguard/PrivateAttachments.tsx:43` (the stored reports a
 *   test shows), `:47-50` (save a report) and `:53-67` (remove one);
 * - `components/homeguard/MaintenanceWorkspace.tsx:130-138` (an observation
 *   photo, production branch);
 * - `components/expanded/ExploreNotes.tsx:104-112` (a note photo, production branch).
 *
 * `FRAGMENTS` lists text that must occur character for character both in the
 * frontend file and in this file; the drift test reads both, so a change to
 * any of those lines fails it.
 */
import { loadFrontend } from '../frontend-test-loader.mjs';

const { FrontendServiceError, serviceMessage } = await loadFrontend('production/runtime');

/** usePrivateUpload(), as plain state. `workspace` is frontendB11's homeWorkspace. */
export function privateUpload(workspace) {
  const state = { attachment: null, busy: false, unknown: false, message: '' };
  const operation = { current: '' }, locked = { current: false }, alive = { current: true };
  const setAttachment = (value) => { state.attachment = value; };
  const setBusy = (value) => { state.busy = value; };
  const setUnknown = (value) => { state.unknown = value; };
  const setMessage = (value) => { state.message = value; };
  async function upload(input) {
    const attachment = state.attachment, unknown = state.unknown;
    const service = workspace.service?.attachments;
    if (locked.current || !service) { if (!service) setMessage('Private file storage is unavailable. Your draft is kept.'); return null; }
    if (workspace.unknownOperations.some(item => item.operationId !== operation.current)) { setMessage('Check earlier changes before uploading another file.'); return null; }
    const controller = new AbortController(); locked.current = true; setBusy(true); setMessage('');
    try {
      let next;
      if (unknown) {
        if (!service.reconcileUpload) { setMessage('Check this upload status before uploading again.'); return null; }
        const receipt = await service.reconcileUpload(operation.current, controller.signal);
        if (receipt.operationId !== operation.current) throw new Error('Upload reference did not match.');
        if (receipt.status === 'failed') { workspace.resolvePendingOperation(operation.current); setUnknown(false); operation.current = ''; setMessage(receipt.message || 'The upload did not complete. You can try again.'); return null; }
        if (receipt.status !== 'succeeded' || !receipt.attachment) { setMessage('The upload is still being checked.'); return null; }
        next = receipt.attachment;
      } else if (attachment) next = await service.inspect(attachment.id, controller.signal);
      else { if (!input) return null; operation.current ||= crypto.randomUUID(); workspace.trackPendingOperation(operation.current, 'attachments'); next = await service.upload({ ...input, operationId: operation.current }, controller.signal); }
      if (!alive.current) return null;
      workspace.resolvePendingOperation(operation.current); setUnknown(false); setAttachment(next);
      setMessage(next.status === 'ready' ? 'Private file stored.' : next.status === 'rejected' ? 'This file did not pass the file checks.' : 'File checks are still in progress.');
      return next;
    } catch (error) {
      if (!alive.current) return null;
      const uncertain = !(error instanceof FrontendServiceError) || ['unknown_outcome', 'invalid_response', 'aborted'].includes(error.code);
      if (uncertain) setUnknown(true); else if (!unknown) { workspace.resolvePendingOperation(operation.current); operation.current = ''; }
      setMessage(uncertain ? 'The upload result is not confirmed. Check its status before uploading again.' : error instanceof FrontendServiceError && error.reason === 'feature_unavailable' ? 'Private files are not available yet. Nothing was uploaded. Your draft is kept.' : serviceMessage(error)); return null;
    } finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  return {
    state,
    get attachment() { return state.attachment; },
    get unknown() { return state.unknown; },
    get message() { return state.message; },
    get operationId() { return operation.current; },
    upload, setMessage,
    reset: () => { if (locked.current || state.unknown) return false; setAttachment(null); operation.current = ''; setMessage(''); return true; },
  };
}

/** PrivateAttachments.tsx:43, the reports a test shows. */
export function storedReports(workspace, recordId) {
  const record = workspace.records.tests?.find(item => item.id === recordId);
  const stored = Array.isArray(record?.attachments) ? record.attachments.filter(item => item && typeof item.id === 'string' && Number.isSafeInteger(item.revision) && ['ready', 'quarantined', 'rejected'].includes(item.status)) : [];
  return stored;
}

/** PrivateAttachments.tsx:47-50, save(). */
export async function saveReport(workspace, upload, { recordId, file, reviewed = true }) {
  if (!file || !reviewed) return null;
  const next = await upload.upload({ collection: 'tests', recordId, file, name: file.name, metadataRemoved: false, reviewed });
  if (next?.status === 'ready') await workspace.retry('tests');
  return next;
}

/** PrivateAttachments.tsx:53-67, remove(), with its state as plain fields. */
export function reportRemoval(workspace, upload) {
  const state = { removeOperation: '', removeUnknown: false, removeBusy: false, removing: null };
  const setRemoveOperation = (value) => { state.removeOperation = value; };
  const setRemoveUnknown = (value) => { state.removeUnknown = value; };
  const setRemoveBusy = (value) => { state.removeBusy = value; };
  const setRemoving = (value) => { state.removing = value; };
  const setFile = () => {}, setReviewed = () => {};
  async function remove() {
    const removing = state.removing, removeOperation = state.removeOperation, removeUnknown = state.removeUnknown, removeBusy = state.removeBusy;
    if (!removing || !workspace.service?.attachments || removeBusy) return;
    const controller = new AbortController(); setRemoveBusy(true);
    const id = removeOperation || crypto.randomUUID(); setRemoveOperation(id);
    workspace.trackPendingOperation(id, 'attachments');
    try {
      const receipt = removeUnknown ? await workspace.service.reconcile(id, controller.signal, 'attachments') : await workspace.service.attachments.remove(removing.id, removing.revision, id, controller.signal);
      if (controller.signal.aborted) return;
      if (receipt.operationId !== id || ['unknown', 'pending'].includes(receipt.status)) { setRemoveUnknown(true); upload.setMessage('Removal is not confirmed. Check its status before changing this file.'); return; }
      if (receipt.status === 'succeeded') workspace.applyCanonical({ collections: receipt.changes });
      else if (receipt.status !== 'failed') throw new Error('Unconfirmed removal result');
      workspace.resolvePendingOperation(id); setRemoveUnknown(false); setRemoveOperation('');
      if (receipt.status !== 'succeeded') { upload.setMessage(receipt.message || 'The private file was not removed.'); return; }
      upload.reset(); setRemoving(null); setFile(null); setReviewed(false); upload.setMessage('Private file removed. Entered results remain.'); await workspace.retry('tests');
    } catch (error) { const uncertain = error instanceof FrontendServiceError ? ['unknown_outcome', 'invalid_response', 'aborted'].includes(error.code) : true; setRemoveUnknown(uncertain); if (!uncertain) workspace.resolvePendingOperation(id); upload.setMessage(serviceMessage(error)); }
    finally { if (!controller.signal.aborted) setRemoveBusy(false); }
  }
  return { state, remove, choose: (item) => { setRemoving(item); setRemoveOperation(''); } };
}

/**
 * MaintenanceWorkspace.tsx:130-138, the production branch of submit() for a
 * photo the screen already prepared (`draft.photoData`, a data URL);
 * `save` is the provider's write('observations', ...).
 */
export async function saveObservation(workspace, upload, { draft, recordId, photoReviewed = true }) {
  const save = (record) => workspace.write('observations', record);
  const next = { ...draft, id: recordId, title: draft.title.trim() };
  if (draft.photoData) {
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(draft.photoData);
    if (!match) return { error: 'Prepare a supported private photo again.' };
    const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
    const attachment = upload.attachment?.status === 'ready' ? upload.attachment : await upload.upload({ collection: 'observations', recordId, file: new Blob([bytes], { type: match[1] }), name: draft.photoName, metadataRemoved: true, reviewed: photoReviewed });
    if (attachment?.status !== 'ready') return { saved: false };
    next.photoAttachmentId = attachment.id; next.photoAttachmentRevision = attachment.revision; next.photoData = '';
  }
  return { saved: await save(next), next };
}

/** ExploreNotes.tsx:104-112, the production photo branch of submit(). */
export async function saveNote(workspace, upload, { draft, stableId }) {
  const save = (record) => workspace.write('exploreNotes', record);
  const pendingId = { current: null };
  pendingId.current ??= stableId;
  const next = { ...draft, id: pendingId.current };
  if (draft.photo) {
    if (draft.photo.metadataRemoved !== true || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(draft.photo.data)) return { error: 'Prepare and review the private photo again.' };
    const bytes = Uint8Array.from(atob(draft.photo.data.split(',')[1]), character => character.charCodeAt(0));
    const file = new Blob([bytes], { type: 'image/png' });
    const attachment = upload.attachment?.status === 'ready' ? upload.attachment : await upload.upload({ collection: 'exploreNotes', recordId: pendingId.current, file, name: 'halo-observation.png', metadataRemoved: true, reviewed: true });
    if (attachment?.status !== 'ready') return { saved: false };
    next.photo = undefined; next.photoAttachment = { id: attachment.id, revision: attachment.revision, name: 'halo-observation.png', metadataRemoved: true };
  }
  return { saved: await save(next), next };
}

/** Text that must stay identical in the frontend and here (the drift test). */
export const FRAGMENTS = Object.freeze([
  ...[
    "if (workspace.unknownOperations.some(item => item.operationId !== operation.current)) { setMessage('Check earlier changes before uploading another file.'); return null; }",
    'const receipt = await service.reconcileUpload(operation.current, controller.signal);',
    "if (receipt.status === 'failed') { workspace.resolvePendingOperation(operation.current); setUnknown(false); operation.current = ''; setMessage(receipt.message || 'The upload did not complete. You can try again.'); return null; }",
    "if (receipt.status !== 'succeeded' || !receipt.attachment) { setMessage('The upload is still being checked.'); return null; }",
    '} else if (attachment) next = await service.inspect(attachment.id, controller.signal);',
    "else { if (!input) return null; operation.current ||= crypto.randomUUID(); workspace.trackPendingOperation(operation.current, 'attachments'); next = await service.upload({ ...input, operationId: operation.current }, controller.signal); }",
    'workspace.resolvePendingOperation(operation.current); setUnknown(false); setAttachment(next);',
    "setMessage(next.status === 'ready' ? 'Private file stored.' : next.status === 'rejected' ? 'This file did not pass the file checks.' : 'File checks are still in progress.');",
    "const uncertain = !(error instanceof FrontendServiceError) || ['unknown_outcome', 'invalid_response', 'aborted'].includes(error.code);",
    "if (uncertain) setUnknown(true); else if (!unknown) { workspace.resolvePendingOperation(operation.current); operation.current = ''; }",
    "setMessage(uncertain ? 'The upload result is not confirmed. Check its status before uploading again.' : error instanceof FrontendServiceError && error.reason === 'feature_unavailable' ? 'Private files are not available yet. Nothing was uploaded. Your draft is kept.' : serviceMessage(error)); return null;",
  ].map((text) => ({ file: 'components/homeguard/usePrivateUpload.ts', text })),
  ...[
    "const stored = Array.isArray(record?.attachments) ? record.attachments.filter(item => item && typeof item.id === 'string' && Number.isSafeInteger(item.revision) && ['ready', 'quarantined', 'rejected'].includes(item.status)) : [];",
    "const next = await upload.upload({ collection: 'tests', recordId, file, name: file.name, metadataRemoved: false, reviewed });",
    "if (next?.status === 'ready') await workspace.retry('tests');",
    "const id = removeOperation || crypto.randomUUID(); setRemoveOperation(id);",
    "workspace.trackPendingOperation(id, 'attachments');",
    "const receipt = removeUnknown ? await workspace.service.reconcile(id, controller.signal, 'attachments') : await workspace.service.attachments.remove(removing.id, removing.revision, id, controller.signal);",
    "if (receipt.operationId !== id || ['unknown', 'pending'].includes(receipt.status)) { setRemoveUnknown(true); upload.setMessage('Removal is not confirmed. Check its status before changing this file.'); return; }",
    "if (receipt.status === 'succeeded') workspace.applyCanonical({ collections: receipt.changes });",
    "workspace.resolvePendingOperation(id); setRemoveUnknown(false); setRemoveOperation('');",
    "if (receipt.status !== 'succeeded') { upload.setMessage(receipt.message || 'The private file was not removed.'); return; }",
    "upload.reset(); setRemoving(null); setFile(null); setReviewed(false); upload.setMessage('Private file removed. Entered results remain.'); await workspace.retry('tests');",
    "catch (error) { const uncertain = error instanceof FrontendServiceError ? ['unknown_outcome', 'invalid_response', 'aborted'].includes(error.code) : true; setRemoveUnknown(uncertain); if (!uncertain) workspace.resolvePendingOperation(id); upload.setMessage(serviceMessage(error)); }",
  ].map((text) => ({ file: 'components/homeguard/PrivateAttachments.tsx', text })),
  ...[
    'const match = /^data:(image\\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(draft.photoData);',
    'const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));',
    "const attachment = upload.attachment?.status === 'ready' ? upload.attachment : await upload.upload({ collection: 'observations', recordId, file: new Blob([bytes], { type: match[1] }), name: draft.photoName, metadataRemoved: true, reviewed: photoReviewed });",
    "next.photoAttachmentId = attachment.id; next.photoAttachmentRevision = attachment.revision; next.photoData = '';",
  ].map((text) => ({ file: 'components/homeguard/MaintenanceWorkspace.tsx', text })),
  ...[
    "const bytes = Uint8Array.from(atob(draft.photo.data.split(',')[1]), character => character.charCodeAt(0));",
    "const attachment = upload.attachment?.status === 'ready' ? upload.attachment : await upload.upload({ collection: 'exploreNotes', recordId: pendingId.current, file, name: 'halo-observation.png', metadataRemoved: true, reviewed: true });",
    "next.photo = undefined; next.photoAttachment = { id: attachment.id, revision: attachment.revision, name: 'halo-observation.png', metadataRemoved: true };",
  ].map((text) => ({ file: 'components/expanded/ExploreNotes.tsx', text })),
  ...[
    "trackPendingOperation: (operationId, domain) => unresolved({ kind: 'recovered', operationId, domain }, 'A private file request needs a status check before another change.', false),",
  ].map((text) => ({ file: 'components/homeguard/HomeWorkspaceState.tsx', text, helper: 'frontendB11.mjs' })),
]);
