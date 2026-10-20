/**
 * The routes' side of migration 0026: a household's Homeguard workspace
 * collections, read and committed, plus the command planner.
 *
 *   read_household_workspace(p_profile_id, p_collections) -> {<collection>: [record]}
 *   commit_household_workspace(p_profile_id, p_operation_id, p_writes) -> {receipt, changes}
 *
 * B11 plan (docs/backend/plans/b11-homeguard-workspace.md), Rulings W1 to W14.
 * Used by GET /api/frontend/workspace, POST /api/frontend/workspace/commands
 * and the `workspace` reconcile in GET /api/operations.
 *
 * Identity: `profileId` is always the verified session's user id
 * (requireUser), never an id from the request. Records belong to the
 * household; a home-owned record names its home in `homeContextId`, which the
 * commit function checks is this household's (Ruling W10).
 *
 * Until 0026 is applied the functions do not exist (PostgREST PGRST202,
 * Postgres 42883), and until 0017 is applied the ledger table does not
 * (PGRST205, 42P01). Either answers a non-retryable 503 `feature_unavailable`
 * (workspaceUnavailable), never an empty collection that may be false.
 */
import { apiError, ERROR_CODES } from './apiErrors.js';
import { listUnresolvedOperations } from './operations.js';
import { validProductionRecord } from './workspaceRecords.js';

/** The ledger domain the frontend reconciles workspace saves against (adapters.ts:30). */
export const WORKSPACE_DOMAIN = 'workspace';

/** Every collection the provider loads on mount (HomeWorkspaceState.tsx:36). */
export const WORKSPACE_COLLECTIONS = Object.freeze([
  'tests', 'assets', 'observations', 'gardens', 'usage', 'pantryItems', 'foodQuestions', 'fishNotes', 'foodFollows',
  'growerInquiries', 'homeTransitions', 'exploreNotes', 'exploreOutcomes', 'exploreProjects', 'exploreEngagements', 'weekJournal',
]);

/**
 * Collections that are answered unavailable and never stored (Rulings W2 and
 * W3), with the sentence a load carries (the provider shows it as the
 * collection's error, HomeWorkspaceState.tsx:113) and the one a write gets.
 */
export const UNSTORED_COLLECTIONS = Object.freeze({
  weekJournal: Object.freeze({
    load: 'Week journal check-ins are not stored on the server yet.',
    write: 'Week journal check-ins are not saved on the server yet. Nothing was saved.',
  }),
  homeTransitions: Object.freeze({
    load: 'Past home changes are kept with your account and are not listed here yet.',
    write: 'Home changes are saved through your account settings. Nothing was saved here.',
  }),
});

/** The fourteen stored collections (0026's CHECK). */
export const STORED_COLLECTIONS = Object.freeze(WORKSPACE_COLLECTIONS.filter((name) => !Object.hasOwn(UNSTORED_COLLECTIONS, name)));

/** The five collections a record of which belongs to one home (HomeWorkspaceState.tsx:211). */
export const HOME_OWNED_COLLECTIONS = Object.freeze(['assets', 'observations', 'gardens', 'usage', 'pantryItems']);

/** Ruling W7. */
export const LIMITS = Object.freeze({
  bodyBytes: 1_000_000,
  recordBytes: 262_144,
  collectionRecords: 1000,
  collectionBytes: 1_500_000,
  selection: 100,
  idLength: 200,
});

/** The client refuses nothing about the list's length; 100 keeps a load bounded, as for tasks. */
export const MAX_PENDING = 100;

/** Codes the receipt may carry (home-service.ts:29). */
export const RECEIPT_CODES = Object.freeze({ CONFLICT: 'conflict', VALIDATION: 'validation', UNAVAILABLE: 'unavailable' });

/**
 * Every server-authored sentence a refusal carries, by reason. Fixed
 * constants: none interpolates a value, so a stored reason and a replayed
 * sentence can never carry text a person typed. No U+2014 (AGENTS.md).
 */
export const REFUSALS = Object.freeze({
  stale_revision: { code: 'conflict', message: 'This record changed. Your draft is kept. Review the latest version before saving.' },
  notes_changed: { code: 'conflict', message: 'The selected notes changed. Nothing was removed. Review the selection again.' },
  invalid_reference: { code: 'validation', message: 'A linked record or home is no longer available. Your draft is kept. Review the links before saving.' },
  limit: { code: 'validation', message: 'This collection has reached its storage limit. Nothing was saved.' },
  invalid_record: { code: 'validation', message: 'Some details of this record could not be saved. Your draft is kept.' },
  // B16 Ruling J13: a started project keeps the guide it was started with.
  project_guide_locked: { code: 'validation', message: 'The guide of a started project cannot be changed. Nothing was saved. Your draft is kept. Reload the project, then save your own changes again.' },
  attachments_unavailable: { code: 'unavailable', message: 'Private files are not available yet. Nothing was saved.' },
  clear_unsupported: { code: 'unavailable', message: 'Use the privacy review in Settings to clear records. Nothing was deleted.' },
  week_journal_unavailable: { code: 'unavailable', message: UNSTORED_COLLECTIONS.weekJournal.write },
  home_transitions_unavailable: { code: 'unavailable', message: UNSTORED_COLLECTIONS.homeTransitions.write },
  // Never stored: computed when a SUCCEEDED save is read back (settledAnswer).
  changed_elsewhere: { code: 'conflict', message: 'That change was saved, but the record has since changed on another device. Your draft is kept. Reload to see your current records.' },
});

/** The reasons a commit records on its ledger row and replays (against stored state). */
export const STORED_REFUSALS = Object.freeze(['stale_revision', 'notes_changed', 'invalid_reference', 'limit', 'project_guide_locked']);

/** The failed receipt for a reason, as the client receives it (changes required, adapters.ts:15). */
export function refusalReceipt(operationId, reason) {
  const refusal = REFUSALS[reason];
  if (!refusal) throw new Error('workspaceStore: unknown refusal reason');
  return { operationId, status: 'failed', changes: {}, code: refusal.code, reason, message: refusal.message };
}

/** "Not there yet": the function (PostgREST, Postgres), then a table (PostgREST, Postgres). */
const UNAVAILABLE_CODES = new Set(['PGRST202', '42883', 'PGRST205', '42P01']);

const UNAVAILABLE_MESSAGE = 'Homeguard records are not available yet. Nothing was changed.';

/** True when the error says migration 0026 (or the 0017 ledger) is not applied. */
export function isWorkspaceUnavailable(error) {
  return !!error && UNAVAILABLE_CODES.has(error.code);
}

/** The 503 the workspace routes answer while the flag is off or a migration is missing. Not retryable. */
export function workspaceUnavailable(requestId) {
  return apiError({ status: 503, code: ERROR_CODES.FEATURE_UNAVAILABLE, message: UNAVAILABLE_MESSAGE, retryable: false, requestId });
}

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * `{<collection>: [record]}` for each named stored collection, oldest first.
 * Throws the Supabase error as it came, and on a result that is not the
 * function's shape.
 */
export async function readWorkspaceCollections(supabase, profileId, collections) {
  if (!profileId) throw new Error('workspaceStore: reading records requires an owner');
  const names = [...new Set(collections)];
  if (!names.length || !names.every((name) => STORED_COLLECTIONS.includes(name))) {
    throw new Error('workspaceStore: only stored collections are read');
  }
  const { data, error } = await supabase.rpc('read_household_workspace', { p_profile_id: profileId, p_collections: names });
  if (error) throw error;
  if (!isObject(data) || !names.every((name) => Array.isArray(data[name]))) {
    throw new Error('workspaceStore: read_household_workspace returned an unexpected shape');
  }
  return Object.fromEntries(names.map((name) => [name, data[name]]));
}

/**
 * The ledger domain of private file uploads and removals (B14 Ruling A11;
 * lib/attachmentStore.js ATTACHMENTS_DOMAIN). Their unresolved operations are
 * listed with the workspace's, as the contract asks: "attachment operations in
 * the workspace `pendingOperations` array must resolve through the same
 * operation ledger" (HALO_BACKEND_WIRING_CURRENT.md:551).
 */
const ATTACHMENTS_PENDING_DOMAIN = 'attachments';

/**
 * The household's unsettled workspace and attachment operations, each
 * domain's oldest first, at most MAX_PENDING, as the snapshot's
 * `pendingOperations` (home-service.ts:14). `exclude` names ids that must not
 * be listed (an operation's own id).
 */
export async function pendingWorkspaceOperations(supabase, profileId, { exclude = [] } = {}) {
  const excluded = new Set(exclude);
  const listed = [];
  for (const domain of [WORKSPACE_DOMAIN, ATTACHMENTS_PENDING_DOMAIN]) {
    const ids = await listUnresolvedOperations(supabase, { profileId, domains: [domain] });
    for (const operationId of ids) if (!excluded.has(operationId)) listed.push({ operationId, domain });
  }
  return listed.slice(0, MAX_PENDING);
}

/** The refusal codes 0026's commit function raises (SQLSTATE P0001, the code as the message). */
export const WORKSPACE_ERRORS = Object.freeze({
  INVALID_INPUT: 'HALO_INVALID_INPUT',
  OPERATION_NOT_PENDING: 'HALO_OPERATION_NOT_PENDING',
  INVALID_REFERENCE: 'HALO_INVALID_REFERENCE',
  STALE_REVISION: 'HALO_STALE_REVISION',
  LIMIT: 'HALO_LIMIT',
});

/** The HALO_* code a 0026 function raised, or null for any other error. */
export function workspaceRefusal(error) {
  return error?.code === 'P0001' && typeof error.message === 'string' && /^HALO_[A-Z_]+$/.test(error.message) ? error.message : null;
}

/**
 * One call of commit_household_workspace. Returns `{receipt, changes}`: the
 * receipt stored on the ledger row (collection names, ids and revisions only)
 * and the touched collections read in the same transaction.
 */
export async function commitWorkspace(supabase, { profileId, operationId, writes }) {
  if (!profileId) throw new Error('workspaceStore: committing records requires an owner');
  const { data, error } = await supabase.rpc('commit_household_workspace', {
    p_profile_id: profileId,
    p_operation_id: operationId,
    p_writes: writes,
  });
  if (error) throw error;
  const receipt = data?.receipt;
  const changes = data?.changes;
  if (
    !isObject(data) || !isObject(receipt) || receipt.status !== 'succeeded' || !Array.isArray(receipt.collections)
    || !Array.isArray(receipt.affected) || !Array.isArray(receipt.removed)
    || !isObject(changes) || !receipt.collections.every((name) => Array.isArray(changes[name]))
  ) {
    throw new Error('workspaceStore: commit_household_workspace returned an unexpected shape');
  }
  return {
    receipt: { status: 'succeeded', collections: receipt.collections, affected: receipt.affected, removed: receipt.removed, unresolvedOperations: [] },
    changes: Object.fromEntries(receipt.collections.map((name) => [name, changes[name]])),
  };
}

// ---------------------------------------------------------------------------
// The command: parsed without stored state, planned against it.
// ---------------------------------------------------------------------------

const CONTROL = /[\u0000-\u001f\u007f-\u009f\u{2028}\u{2029}]/u;
// A lone UTF-16 surrogate cannot be stored as jsonb text (22P05), like U+0000.
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const validId = (value) => typeof value === 'string' && value.length >= 1 && value.length <= LIMITS.idLength && !CONTROL.test(value) && !LONE_SURROGATE.test(value);

// In the record's JSON text, JSON.stringify writes U+0000 and a lone surrogate as a \u escape; an even run of
// backslashes before the u is an escaped backslash, i.e. literal text, which is fine.
const UNSTORABLE_TEXT = /(?<!\\)(?:\\\\)*\\u(?:0000|[dD][89a-fA-F][0-9a-fA-F]{2})/;
const validRevision = (value) => Number.isSafeInteger(value) && value >= 1 && value < 2147483647;

const field = (name, code, message) => ({ ok: false, fieldErrors: [{ field: name, code, message }] });

/**
 * True when a record names a private file. With the `attachments` flag off
 * such a record is refused (Ruling W4); with it on the route checks the
 * references against 0028 before any claim (B14 Ruling A7).
 */
export function carriesAttachment(collection, record) {
  if (collection === 'tests') return record.attachments !== undefined && !(Array.isArray(record.attachments) && record.attachments.length === 0);
  if (collection === 'observations') return record.photoAttachmentId !== undefined && record.photoAttachmentId !== '';
  if (collection === 'exploreNotes') return record.photoAttachment !== undefined;
  return false;
}

/**
 * Everything decided without stored state, in this order:
 *
 *   { ok: false, fieldErrors }   a 400: malformed, recorded nowhere
 *   { ok: true, refusal }        a 200 failed receipt answered before any claim
 *                                (Rulings W2, W3, W4 while `attachments` is
 *                                false, W7, W9 and an invalid record)
 *   { ok: true, command }        a command to plan inside the ledger claim
 *
 * `command` is `{kind: 'write', collection, record, expectedRevision}`,
 * `{kind: 'remove', collection, recordId, expectedRevision}` or
 * `{kind: 'remove-notes', selection}`.
 */
export function parseWorkspaceCommand(body, { attachments = false } = {}) {
  const kind = body?.kind;
  if (kind === 'clear-private') return { ok: true, refusal: 'clear_unsupported' };
  if (kind === 'write' || kind === 'remove') {
    const collection = body.collection;
    if (!WORKSPACE_COLLECTIONS.includes(collection)) return field('collection', 'invalid_option', 'Choose a known collection.');
    if (body.collectionRevision !== undefined && typeof body.collectionRevision !== 'string' && typeof body.collectionRevision !== 'number') {
      return field('collectionRevision', 'invalid_revision', 'The collection revision is not valid.');
    }
    if (kind === 'remove') {
      if (!validId(body.recordId)) return field('recordId', 'invalid_id', 'That record id is not valid.');
      if (!validRevision(body.expectedRevision)) return field('expectedRevision', 'invalid_revision', 'The expected revision is not valid.');
      if (collection === 'weekJournal') return { ok: true, refusal: 'week_journal_unavailable' };
      if (collection === 'homeTransitions') return { ok: true, refusal: 'home_transitions_unavailable' };
      return { ok: true, command: { kind, collection, recordId: body.recordId, expectedRevision: body.expectedRevision } };
    }
    const record = body.record;
    if (!isObject(record)) return field('record', 'invalid_record', 'The record must be an object.');
    if (!validId(record.id)) return field('record.id', 'invalid_id', 'That record id is not valid.');
    if (body.expectedRevision !== null && !validRevision(body.expectedRevision)) {
      return field('expectedRevision', 'invalid_revision', 'The expected revision is not valid.');
    }
    if (collection === 'weekJournal') return { ok: true, refusal: 'week_journal_unavailable' };
    if (collection === 'homeTransitions') return { ok: true, refusal: 'home_transitions_unavailable' };
    if (!attachments && carriesAttachment(collection, record)) return { ok: true, refusal: 'attachments_unavailable' };
    // The record as it will be stored and read back: the server's revision
    // (Ruling W12). It must pass the client's own row check (trap: one bad
    // row discards the whole collection, HomeWorkspaceState.tsx:107).
    const stored = { ...record, revision: body.expectedRevision === null ? 1 : body.expectedRevision + 1 };
    // A value nested too deeply for JSON.stringify, or text Postgres cannot hold, is an invalid record (a clean
    // refusal), not a 500 that this client would lock on.
    let text;
    try { text = JSON.stringify(stored); } catch { return { ok: true, refusal: 'invalid_record' }; }
    if (Buffer.byteLength(text, 'utf8') > LIMITS.recordBytes) return { ok: true, refusal: 'limit' };
    if (UNSTORABLE_TEXT.test(text)) return { ok: true, refusal: 'invalid_record' };
    if (!validProductionRecord(collection, stored)) return { ok: true, refusal: 'invalid_record' };
    return { ok: true, command: { kind, collection, record: stored, expectedRevision: body.expectedRevision } };
  }
  if (kind === 'remove-notes') {
    const selection = body.selection;
    if (!Array.isArray(selection) || selection.length === 0 || selection.length > LIMITS.selection
      || !selection.every((item) => isObject(item) && validId(item.id) && validRevision(item.revision))
      || new Set(selection.map((item) => item.id)).size !== selection.length) {
      return field('selection', 'invalid_selection', 'Choose between 1 and 100 different notes.');
    }
    return { ok: true, command: { kind, selection: selection.map((item) => ({ id: item.id, revision: item.revision })) } };
  }
  return field('kind', 'invalid_option', 'Choose one of: write, remove, remove-notes, clear-private.');
}

/** The collections a command's plan needs to read first. */
export function collectionsToRead(command) {
  if (command.kind === 'remove-notes') return ['exploreNotes'];
  return [command.collection];
}

/** The note's own case, removed with it (Ruling W11; HomeWorkspaceState.tsx:241,265). */
const noteCase = (id) => `note-case:${id}`;

const changed = (next, previous, key) => typeof next?.[key] === 'string' && next[key] !== '' && next[key] !== previous?.[key];

/**
 * The references a write adds or changes (Ruling W10), as commit_household_workspace
 * takes them: `references` (owned records), `homeContexts`, `contexts` (a home
 * context or a garden).
 */
function referencesFor(collection, record, previous) {
  const references = [];
  const homeContexts = [];
  const contexts = [];
  if (changed(record, previous, 'homeContextId')) homeContexts.push(record.homeContextId);
  const ref = (key, target) => { if (changed(record, previous, key)) references.push({ collection: target, id: record[key] }); };
  if (collection === 'tests' && changed(record, previous, 'contextId')) contexts.push(record.contextId);
  if (collection === 'assets') ref('testId', 'tests');
  if (collection === 'observations') { ref('assetId', 'assets'); ref('testId', 'tests'); }
  if (collection === 'gardens') {
    const before = new Set(Array.isArray(previous?.testIds) ? previous.testIds : []);
    for (const id of new Set(record.testIds)) if (id !== '' && !before.has(id)) references.push({ collection: 'tests', id });
  }
  if (collection === 'foodQuestions') ref('reportId', 'tests');
  if (collection === 'growerInquiries') { ref('siteId', 'gardens'); ref('testId', 'tests'); }
  return { references, homeContexts, contexts };
}

/** Structural equality of two JSON values, ignoring object key order (stored jsonb does not keep it). */
function sameJson(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((item, index) => sameJson(item, b[index]));
  if (!isObject(a) || !isObject(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]));
}

/**
 * B16 Ruling J13: the sourced guide a started project carries is a snapshot.
 * An update may change the person's own fields (status, notes, review date,
 * history) but not the guide, nor the id and version that name it. The stored
 * row is the one at `expectedRevision`, which the commit function checks again
 * under its lock, so a row that changed in between is stale_revision, never a
 * guide change that slips through.
 */
function changesProjectGuide(collection, record, previous) {
  if (collection !== 'exploreProjects' || !previous) return false;
  return !sameJson(record.guide, previous.guide) || record.guideId !== previous.guideId || record.guideVersion !== previous.guideVersion;
}

/**
 * The command against the household's current rows (`current`, from
 * readWorkspaceCollections over collectionsToRead). Returns
 * `{ ok: true, writes }` for commit_household_workspace, or
 * `{ ok: false, reason }` for a stored refusal. The commit function checks
 * every revision again under its locks; this early answer only saves a call.
 */
export function planWorkspaceCommand(command, current) {
  if (command.kind === 'write') {
    const rows = current[command.collection] ?? [];
    const previous = rows.find((row) => row.id === command.record.id);
    if (command.expectedRevision === null ? previous : previous?.revision !== command.expectedRevision) return { ok: false, reason: 'stale_revision' };
    if (!previous && rows.length >= LIMITS.collectionRecords) return { ok: false, reason: 'limit' };
    if (changesProjectGuide(command.collection, command.record, previous)) return { ok: false, reason: 'project_guide_locked' };
    return {
      ok: true,
      writes: {
        upserts: [{ collection: command.collection, id: command.record.id, expectedRevision: command.expectedRevision, record: command.record }],
        ...referencesFor(command.collection, command.record, previous),
        collections: [command.collection],
      },
    };
  }
  if (command.kind === 'remove') {
    const previous = (current[command.collection] ?? []).find((row) => row.id === command.recordId);
    if (previous?.revision !== command.expectedRevision) return { ok: false, reason: 'stale_revision' };
    const deletes = [{ collection: command.collection, id: command.recordId, expectedRevision: command.expectedRevision }];
    const collections = [command.collection];
    if (command.collection === 'exploreNotes') {
      deletes.push({ collection: 'exploreOutcomes', id: noteCase(command.recordId), expectedRevision: null });
      collections.push('exploreOutcomes');
    }
    return { ok: true, writes: { deletes, collections } };
  }
  // remove-notes: every selected note at its reviewed revision, in one commit.
  const notes = current.exploreNotes ?? [];
  if (!command.selection.every((item) => notes.some((row) => row.id === item.id && row.revision === item.revision))) {
    return { ok: false, reason: 'notes_changed' };
  }
  return {
    ok: true,
    writes: {
      deletes: [
        ...command.selection.map((item) => ({ collection: 'exploreNotes', id: item.id, expectedRevision: item.revision })),
        ...command.selection.map((item) => ({ collection: 'exploreOutcomes', id: noteCase(item.id), expectedRevision: null })),
      ],
      collections: ['exploreNotes', 'exploreOutcomes'],
    },
  };
}

/** A stale revision in a remove-notes commit is the selection changing. */
export function refusalForError(code, command) {
  if (code === WORKSPACE_ERRORS.STALE_REVISION) return command.kind === 'remove-notes' ? 'notes_changed' : 'stale_revision';
  if (code === WORKSPACE_ERRORS.INVALID_REFERENCE) return 'invalid_reference';
  if (code === WORKSPACE_ERRORS.LIMIT) return 'limit';
  return null;
}

/** The reason of a succeeded save that cannot be answered as one any more. Computed on read, never stored. */
export const CHANGED_ELSEWHERE = 'changed_elsewhere';

/**
 * A succeeded save read back (reconcile, or a command replay): the CURRENT
 * rows of the collections it touched and whether the receipt's own effect
 * still shows in them. The ledger keeps ids and revisions only, so the saved
 * record itself cannot be repeated once another device has deleted it (or
 * removed it, then added it again): the client accepts a succeeded write only
 * with its row at a higher revision, and a succeeded remove only without the
 * row (home-service.ts:80-85), and a receipt it does not accept locks
 * Homeguard until a reload. `changedElsewhere` is true exactly then.
 */
export async function readSettledWorkspace(supabase, profileId, result) {
  const names = Array.isArray(result.collections) ? result.collections.filter((name) => STORED_COLLECTIONS.includes(name)) : [];
  const changes = names.length ? await readWorkspaceCollections(supabase, profileId, names) : {};
  const has = (collection, id, atLeast) => (changes[collection] ?? []).some((row) => row.id === id && (atLeast === undefined || row.revision >= atLeast));
  const kept = (Array.isArray(result.affected) ? result.affected : []).every((item) => isObject(item) && has(item.collection, item.id, item.revision));
  const stayed = (Array.isArray(result.removed) ? result.removed : []).every((item) => isObject(item) && !has(item.collection, item.id));
  return { changes, changedElsewhere: !(kept && stayed) };
}

/**
 * The answer for a succeeded save whose effect is gone (CHANGED_ELSEWHERE):
 * the failed receipt the client settles on without a lock, with `changes: {}`
 * (it applies none of a failed receipt) and a sentence that tells the person
 * to reload. The same shape as a refusal read from the ledger.
 */
export function changedElsewhereReceipt() {
  const { code, message } = REFUSALS[CHANGED_ELSEWHERE];
  return { status: 'failed', reason: CHANGED_ELSEWHERE, unresolvedOperations: [], changes: {}, code, message };
}

/**
 * Ruling W5: the body GET /api/operations answers for a `workspace`
 * operation. A succeeded one carries the CURRENT rows of the collections it
 * touched (the ledger keeps names, ids and revisions only); every other status
 * carries `changes: {}`, which the adapter requires (adapters.ts:15), and a
 * failed one the sentence its reason names.
 */
export async function workspaceReconcileResult(supabase, profileId, operation) {
  const result = operation.result && typeof operation.result === 'object' ? operation.result : {};
  if (operation.status === 'succeeded') {
    const settled = await readSettledWorkspace(supabase, profileId, result);
    return settled.changedElsewhere ? changedElsewhereReceipt() : { ...result, changes: settled.changes };
  }
  if (operation.status === 'failed') {
    const refusal = REFUSALS[result.reason];
    return {
      ...result,
      changes: {},
      ...(refusal ? { code: refusal.code, message: refusal.message } : { message: INCOMPLETE_MESSAGE }),
    };
  }
  return { ...result, changes: {}, message: IN_FLIGHT_MESSAGE };
}

/** A failed operation that no refusal explains: reaped, or an in-process throw. */
export const INCOMPLETE_MESSAGE = 'That earlier save did not finish, so nothing was saved. Reload before trying again.';
/** A pending or unknown operation. */
export const IN_FLIGHT_MESSAGE = 'That save is still being processed. Check its status again before making another change.';
