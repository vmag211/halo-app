/**
 * The routes' side of migration 0028: a household's private files, their
 * storage objects and the deletion sweep (B14 plan,
 * docs/backend/plans/b14-private-attachments.md, Rulings A1 to A12).
 *
 *   read_household_attachment(profile, id)                 -> descriptor + place, or null
 *   household_attachment_usage(profile, collection, record) -> {files, bytes, recordFiles}
 *   check_attachment_references(profile, collection, record, ids) -> [descriptor]
 *   reserve_attachment_object(profile, operation, id)      -> object path
 *   commit_household_attachment(profile, operation, file)  -> {receipt, attachment, changes}
 *   remove_household_attachment(profile, operation, id, revision) -> {receipt, objectPath, changes}
 *   expire_staged_attachments(limit), due_attachment_objects(profile, limit), forget_attachment_objects(paths)
 *
 * Identity: `profileId` is always the verified session's user id
 * (requireUser), never an id from the request. Object paths are built in SQL
 * from that id and a server uuid (Ruling A9); a path the database did not
 * hand out is never read, written or deleted here.
 *
 * Storage: the private bucket `household-attachments`, through the service
 * role client's Storage API (`supabase.storage.from(bucket)`). Its errors are
 * logged as a fixed sentence and the status code only: a storage message can
 * quote a path, and a path holds a household id.
 *
 * Until 0028 is applied its functions do not exist (PGRST202, 42883); before
 * 0026 or 0017 a table is missing (PGRST205, 42P01). Either is "unavailable"
 * (Ruling A6), never a 500.
 */
import { apiError, ERROR_CODES } from './apiErrors.js';
import { featureEnabled, featureDisabledReason } from './features.js';
import { readWorkspaceCollections } from './workspaceStore.js';

/** The ledger domain the client reconciles uploads and removals against (adapters.ts:23; PrivateAttachments.tsx:59). */
export const ATTACHMENTS_DOMAIN = 'attachments';

export const ATTACHMENT_KINDS = Object.freeze({ upload: 'attachments.upload', remove: 'attachments.remove' });

/** The private bucket 0028 creates. */
export const ATTACHMENT_BUCKET = 'household-attachments';

/** The collections whose records may reference a file (home-records.ts:29,31,40; 0028's CHECK). */
export const ATTACHMENT_COLLECTIONS = Object.freeze(['tests', 'observations', 'exploreNotes']);

/** Ruling A3 (proposed); 0028's commit function holds the same numbers. */
export const ATTACHMENT_LIMITS = Object.freeze({
  recordFiles: 20,
  householdFiles: 200,
  householdBytes: 500 * 1024 * 1024,
  nameLength: 200,
  idLength: 200,
  sweepBatch: 100,
});

/** Both flags: files belong to workspace records (Ruling A1). */
export function attachmentsEnabled() {
  return featureEnabled('attachments') && featureEnabled('workspace');
}

/** The sentence every "not available" answer carries. */
export const UNAVAILABLE_MESSAGE = featureDisabledReason('attachments');

const UNAVAILABLE_CODES = new Set(['PGRST202', '42883', 'PGRST205', '42P01']);

/** True when the error says 0028 (or 0026, or the 0017 ledger) is not applied. */
export function isAttachmentsUnavailable(error) {
  return !!error && UNAVAILABLE_CODES.has(error.code);
}

/** Inspect, download and the reconcile: the non-retryable 503 (Ruling A6). */
export function attachmentsUnavailable(requestId) {
  return apiError({ status: 503, code: ERROR_CODES.FEATURE_UNAVAILABLE, message: UNAVAILABLE_MESSAGE, retryable: false, requestId });
}

/**
 * Upload: a 403, which the client reads as a definite "not available" and
 * keeps the draft; a 5xx would lock it on an operation never recorded (Ruling A6).
 */
export function uploadUnavailable(requestId) {
  return apiError({ status: 403, code: ERROR_CODES.FEATURE_UNAVAILABLE, message: UNAVAILABLE_MESSAGE, retryable: false, requestId });
}

/**
 * Server-authored sentences by reason. Fixed constants: none interpolates a
 * value, so a stored reason never carries text a person typed. No U+2014.
 */
export const ATTACHMENT_REFUSALS = Object.freeze({
  invalid_reference: { code: 'validation', message: 'Save the record before attaching a file to it. Nothing was saved.' },
  limit: { code: 'validation', message: 'This record or household has reached its file limit. Nothing was saved.' },
  not_found: { code: 'conflict', message: 'This file is no longer available. Refresh before trying again.' },
  stale_revision: { code: 'conflict', message: 'This file changed. Review it again before removing it.' },
});

/** The reasons stored on a ledger row and replayed. */
export const STORED_ATTACHMENT_REFUSALS = Object.freeze(Object.keys(ATTACHMENT_REFUSALS));

/** The HALO_* code a 0028 function raised, or null. */
export function attachmentErrorCode(error) {
  return error?.code === 'P0001' && typeof error.message === 'string' && /^HALO_[A-Z_]+$/.test(error.message) ? error.message : null;
}

/** A 0028 refusal as a stored reason, or null for any other error. */
export function refusalForAttachmentError(error) {
  const code = attachmentErrorCode(error);
  if (code === 'HALO_INVALID_REFERENCE') return 'invalid_reference';
  if (code === 'HALO_LIMIT') return 'limit';
  if (code === 'HALO_NOT_FOUND') return 'not_found';
  if (code === 'HALO_STALE_REVISION') return 'stale_revision';
  return null;
}

/** The ledger's copy of a refusal: the reason code only. */
export const storedAttachmentRefusal = (reason) => ({ status: 'failed', reason, unresolvedOperations: [] });

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OBJECT_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The client's own descriptor check, transcribed from adapters.ts:15
 * (`attachment`) and home-records.ts:18; test/attachmentsConformance.test.mjs
 * runs the client's compiled module over what the routes answer.
 */
export function validDescriptor(value) {
  return isObject(value) && typeof value.id === 'string' && Number.isSafeInteger(value.revision) && value.revision >= 1
    && typeof value.name === 'string' && typeof value.mime === 'string' && Number.isSafeInteger(value.bytes) && value.bytes >= 1
    && ['quarantined', 'ready', 'rejected'].includes(value.status) && typeof value.metadataRemoved === 'boolean';
}

/** The HomeAttachment the client receives (home-service.ts:31-35), from a stored row's read. */
export function descriptorOf(file) {
  return {
    id: file.id, revision: file.revision, name: file.name, mime: file.mime,
    bytes: file.bytes, status: file.status, metadataRemoved: file.metadataRemoved,
  };
}

/** One file of this household, or null. Throws the Supabase error as it came. */
export async function readAttachment(supabase, profileId, attachmentId) {
  if (!profileId) throw new Error('attachmentStore: reading a file requires an owner');
  if (typeof attachmentId !== 'string' || !UUID.test(attachmentId)) return null;
  const { data, error } = await supabase.rpc('read_household_attachment', { p_profile_id: profileId, p_attachment_id: attachmentId });
  if (error) throw error;
  if (data === null || data === undefined) return null;
  if (!validDescriptor(data) || typeof data.objectPath !== 'string' || !OBJECT_PATH.test(data.objectPath)
      || !ATTACHMENT_COLLECTIONS.includes(data.collection) || typeof data.recordId !== 'string') {
    throw new Error('attachmentStore: read_household_attachment returned an unexpected shape');
  }
  return data;
}

/** `{files, bytes, recordFiles}` for the early limit answer. Proves 0028 before a claim. */
export async function attachmentUsage(supabase, profileId, collection, recordId) {
  const { data, error } = await supabase.rpc('household_attachment_usage', { p_profile_id: profileId, p_collection: collection, p_record_id: recordId });
  if (error) throw error;
  const count = (value) => Number(value);
  if (!isObject(data) || !['files', 'bytes', 'recordFiles'].every((key) => Number.isFinite(count(data[key])))) {
    throw new Error('attachmentStore: household_attachment_usage returned an unexpected shape');
  }
  return { files: count(data.files), bytes: count(data.bytes), recordFiles: count(data.recordFiles) };
}

/** True when a new file of `bytes` would pass a limit (the commit checks again under its locks). */
export function overLimit(usage, bytes) {
  return usage.recordFiles >= ATTACHMENT_LIMITS.recordFiles || usage.files >= ATTACHMENT_LIMITS.householdFiles
    || usage.bytes + bytes > ATTACHMENT_LIMITS.householdBytes;
}

/**
 * The files a workspace record references (home-records.ts:29,31,40), as
 * `[{id, revision}]`. Values are taken as they are; the record already passed
 * the client's row check.
 */
export function attachmentReferences(collection, record) {
  if (!isObject(record)) return [];
  if (collection === 'tests') {
    return Array.isArray(record.attachments) ? record.attachments.map((item) => ({ id: item?.id, revision: item?.revision })) : [];
  }
  if (collection === 'observations') {
    return typeof record.photoAttachmentId === 'string' && record.photoAttachmentId !== ''
      ? [{ id: record.photoAttachmentId, revision: record.photoAttachmentRevision }] : [];
  }
  if (collection === 'exploreNotes') {
    return isObject(record.photoAttachment) ? [{ id: record.photoAttachment.id, revision: record.photoAttachment.revision }] : [];
  }
  return [];
}

/**
 * The route's early answer for a workspace write naming files (Ruling A7):
 * true when every reference is a ready file of this household, staged or
 * linked for exactly this collection and record, at its revision, and named
 * once. 0028's trigger is the authority under its locks. Throws the Supabase
 * error as it came (a missing function means 0028 is not applied).
 */
export async function referencesAreOwned(supabase, profileId, collection, recordId, references) {
  const ids = references.map((item) => item.id);
  if (!ids.every((id) => typeof id === 'string' && UUID.test(id)) || new Set(ids).size !== ids.length || ids.length > 100) return false;
  const { data, error } = await supabase.rpc('check_attachment_references', {
    p_profile_id: profileId, p_collection: collection, p_record_id: recordId, p_ids: ids,
  });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('attachmentStore: check_attachment_references returned an unexpected shape');
  return references.every((item) => data.some((file) => file?.id === item.id && file.revision === item.revision && file.status === 'ready'));
}

/** Queues the object path before any byte is written, and returns it. */
export async function reserveAttachmentObject(supabase, { profileId, operationId, attachmentId }) {
  const { data, error } = await supabase.rpc('reserve_attachment_object', {
    p_profile_id: profileId, p_operation_id: operationId, p_attachment_id: attachmentId,
  });
  if (error) throw error;
  if (typeof data !== 'string' || data !== `${profileId}/${attachmentId}`) {
    throw new Error('attachmentStore: reserve_attachment_object returned an unexpected path');
  }
  return data;
}

/** One commit_household_attachment call: `{receipt, attachment, changes}`. */
export async function commitAttachment(supabase, { profileId, operationId, file }) {
  const { data, error } = await supabase.rpc('commit_household_attachment', {
    p_profile_id: profileId, p_operation_id: operationId, p_file: file,
  });
  if (error) throw error;
  const receipt = data?.receipt;
  if (!isObject(data) || !isObject(receipt) || receipt.status !== 'succeeded' || receipt.attachmentId !== file.attachmentId
      || !Array.isArray(receipt.collections) || !validDescriptor(data.attachment) || !isObject(data.changes)) {
    throw new Error('attachmentStore: commit_household_attachment returned an unexpected shape');
  }
  return {
    receipt: { status: 'succeeded', attachmentId: receipt.attachmentId, collections: receipt.collections, unresolvedOperations: [] },
    attachment: descriptorOf(data.attachment),
    changes: data.changes,
  };
}

/** One remove_household_attachment call: `{receipt, objectPath, changes}`. */
export async function commitRemoval(supabase, { profileId, operationId, attachmentId, expectedRevision }) {
  const { data, error } = await supabase.rpc('remove_household_attachment', {
    p_profile_id: profileId, p_operation_id: operationId, p_attachment_id: attachmentId, p_expected_revision: expectedRevision,
  });
  if (error) throw error;
  const receipt = data?.receipt;
  if (!isObject(data) || !isObject(receipt) || receipt.status !== 'succeeded' || !Array.isArray(receipt.collections)
      || typeof data.objectPath !== 'string' || !OBJECT_PATH.test(data.objectPath) || !isObject(data.changes)) {
    throw new Error('attachmentStore: remove_household_attachment returned an unexpected shape');
  }
  return {
    receipt: { status: 'succeeded', attachmentId: receipt.attachmentId, collections: receipt.collections, unresolvedOperations: [] },
    objectPath: data.objectPath,
    changes: data.changes,
  };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Thrown for a failed Storage API call; its message is fixed and carries no path. */
export class AttachmentStorageError extends Error {
  constructor(action, status) {
    super(`attachment storage ${action} failed`);
    this.name = 'AttachmentStorageError';
    this.code = Number.isInteger(Number(status)) && status !== undefined && status !== null ? `storage_${Number(status)}` : 'storage';
  }
}

const bucket = (supabase) => supabase.storage.from(ATTACHMENT_BUCKET);
const statusOf = (error) => error?.statusCode ?? error?.status ?? null;

/** Writes the processed bytes; never overwrites (a path is used once). */
export async function putObject(supabase, path, bytes, mime) {
  if (!OBJECT_PATH.test(path)) throw new Error('attachmentStore: refusing a path the database did not hand out');
  const { error } = await bucket(supabase).upload(path, bytes, { contentType: mime, upsert: false, cacheControl: '0' });
  if (error) throw new AttachmentStorageError('upload', statusOf(error));
}

/** The stored bytes. */
export async function getObject(supabase, path) {
  if (!OBJECT_PATH.test(path)) throw new Error('attachmentStore: refusing a path the database did not hand out');
  const { data, error } = await bucket(supabase).download(path);
  if (error || !data) throw new AttachmentStorageError('download', statusOf(error));
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Deletes an object that was written but never recorded (an upload refused
 * at commit). Best effort: its queue entry, due an hour after the
 * reservation, deletes it then if this fails.
 */
export async function discardObject(supabase, path) {
  if (!OBJECT_PATH.test(path)) return;
  try {
    await bucket(supabase).remove([path]);
  } catch {
    // Left queued.
  }
}

/**
 * Deletes due objects and forgets them (Ruling A9). `profileId` limits it to
 * one household (the remove and clear routes); null is everyone (the cron).
 * `expire` first deletes staged uploads past 24 hours. Returns counts, or
 * `{unavailable: true}` before 0028. A Storage failure leaves the paths
 * queued for the next sweep and is counted, not thrown.
 */
export async function sweepAttachmentObjects(supabase, { profileId = null, limit = ATTACHMENT_LIMITS.sweepBatch, expire = false } = {}) {
  let expired = 0;
  if (expire) {
    const result = await supabase.rpc('expire_staged_attachments', { p_limit: limit });
    if (result.error) {
      if (isAttachmentsUnavailable(result.error)) return { unavailable: true };
      throw result.error;
    }
    expired = Number(result.data) || 0;
  }
  const due = await supabase.rpc('due_attachment_objects', { p_profile_id: profileId, p_limit: limit });
  if (due.error) {
    if (isAttachmentsUnavailable(due.error)) return { unavailable: true };
    throw due.error;
  }
  const paths = Array.isArray(due.data) ? due.data.filter((path) => typeof path === 'string' && OBJECT_PATH.test(path)) : [];
  if (!paths.length) return { expired, removed: 0, failed: 0 };
  const removal = await bucket(supabase).remove(paths);
  if (removal.error) return { expired, removed: 0, failed: paths.length };
  const forgot = await supabase.rpc('forget_attachment_objects', { p_paths: paths });
  if (forgot.error) throw forgot.error;
  return { expired, removed: paths.length, failed: 0 };
}

// ---------------------------------------------------------------------------
// The reconcile (Ruling A11)
// ---------------------------------------------------------------------------

/** A failed operation no refusal explains: reaped, or an in-process throw. */
export const INCOMPLETE_MESSAGE = 'That earlier file request did not finish, so nothing was changed. Try again.';
/** A pending or unknown operation. */
export const IN_FLIGHT_MESSAGE = 'That file request is still being processed. Check its status again before making another change.';

/**
 * The body GET /api/operations answers for an `attachments` operation. Every
 * status carries `changes` (adapters.ts:15 requires it for a removal's
 * reconcile; the provider's recovered reconcile needs it too). A succeeded one
 * carries the CURRENT rows of the collections it touched (the ledger keeps
 * names and the id only) and, for an upload whose file still exists, its
 * current descriptor as `attachment` (adapters.ts:23).
 */
export async function attachmentReconcileResult(supabase, profileId, operation) {
  const result = isObject(operation.result) ? operation.result : {};
  if (operation.status === 'succeeded') {
    const names = Array.isArray(result.collections) ? result.collections.filter((name) => ATTACHMENT_COLLECTIONS.includes(name)) : [];
    const changes = names.length ? await readWorkspaceCollections(supabase, profileId, names) : {};
    let attachment = null;
    if (operation.kind === ATTACHMENT_KINDS.upload && typeof result.attachmentId === 'string') {
      const file = await readAttachment(supabase, profileId, result.attachmentId);
      if (file) attachment = descriptorOf(file);
    }
    return { ...result, changes, ...(attachment ? { attachment } : {}) };
  }
  if (operation.status === 'failed') {
    const refusal = ATTACHMENT_REFUSALS[result.reason];
    return { ...result, changes: {}, ...(refusal ? { code: refusal.code, message: refusal.message } : { message: INCOMPLETE_MESSAGE }) };
  }
  return { ...result, changes: {}, message: IN_FLIGHT_MESSAGE };
}
