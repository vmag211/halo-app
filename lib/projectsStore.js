/**
 * The routes' side of migration 0030 and of starting a project (B16 plan,
 * docs/backend/plans/b16-explore-projects.md, Rulings J1 to J14).
 *
 *   record_project_generation(profile, id, contextKey, status, result) -> {inserted, row}
 *   read_project_generation(profile, id)                               -> row | null
 *   read_current_project_generation(profile)                           -> row | null
 *
 * A row is `{generationId, contextKey, status, result, createdAt}`, `result`
 * the ProjectGenerationResult as answered
 * (lib/frontend/production/explore-service.ts:30-44).
 *
 * Identity: `profileId` is always the verified session's user id
 * (requireUser), never an id from the request.
 *
 * Until 0030 is applied the functions do not exist (PGRST202, 42883), and
 * until 0017 the ledger table does not (PGRST205, 42P01): isProjectsUnavailable.
 */
import { createHash } from 'node:crypto';
import { apiError, ERROR_CODES } from './apiErrors.js';
import { listUnresolvedOperations, requestHash } from './operations.js';
import { LIBRARY_GUIDES } from './projectSelection.js';
import { readCurrentHomeContext } from './homeContextRpc.js';

/** The ledger domain of a generation request and of a cancellation. */
export const PROJECTS_DOMAIN = 'projects';
/** Starting a project writes a workspace record, so it is a workspace operation (0026 settles only those). */
export const START_DOMAIN = 'workspace';
export const START_KIND = 'projects.start';

/** "Not there yet": the function (PostgREST, Postgres), then a table (PostgREST, Postgres). */
const UNAVAILABLE_CODES = new Set(['PGRST202', '42883', 'PGRST205', '42P01']);
export const isProjectsUnavailable = (error) => !!error && UNAVAILABLE_CODES.has(error.code);

/** Fixed sentences (no U+2014, AGENTS.md). None interpolates a value a person typed. */
export const PROJECT_COPY = Object.freeze({
  unavailable: 'Project ideas are not available yet. Your current ideas are kept.',
  homeChanged: 'Your home details changed. Reload HALO before asking for new ideas. Your current ideas are kept.',
  notFinished: 'That request did not finish. Your current ideas are kept. You can ask again.',
  notFound: 'That request was not found. Your current ideas are kept. You can ask again.',
  cancelled: 'Generation cancelled. Your current ideas are kept.',
  startBlocked: 'Check your previous project start before starting another.',
  startUnavailable: 'Starting a project is not available yet. Nothing was saved.',
  guideChanged: 'This guide has a newer version. Reload the project before starting it.',
  guideMissing: 'This project guide is not available.',
  startLimit: 'Your project list has reached its storage limit. Nothing was saved.',
  startGone: 'That project was started, but it has since been removed. Reload to see your projects.',
  startIncomplete: 'That earlier start did not finish, so nothing was saved. Reload before trying again.',
  startInFlight: 'That start is still being processed. Check it again before starting another project.',
  historyNote: (version) => `Started from guide version ${version}.`,
});

/** The non-retryable 503 the read routes answer while the flag is off or 0030 is missing. */
export function projectsUnavailable(requestId) {
  return apiError({ status: 503, code: ERROR_CODES.FEATURE_UNAVAILABLE, message: PROJECT_COPY.unavailable, retryable: false, requestId });
}

/**
 * The runtime's scopeKey for this household as the server sees it
 * (lib/frontend/production/runtime.ts:121): identity, current home, its revision.
 */
export const contextKeyFor = (userId, home) => `${userId}:${home?.id ?? 'none'}:${home?.revision ?? 0}`;

/**
 * The household's current home, `{ known: true, context }` (context null when
 * it has none) or `{ known: false }` before 0016. Throws any other error.
 */
export async function currentHome(db, profileId) {
  const read = await readCurrentHomeContext(db, profileId);
  return read.unavailable ? { known: false, context: null } : { known: true, context: read.context };
}

/**
 * Whether a key the client sent is this household's current context
 * (Ruling J10). `home` is `{ known: false }` when home contexts cannot be read:
 * then only the identity part is checked.
 */
export function contextKeyMatches(key, userId, home) {
  if (typeof key !== 'string' || !key.startsWith(`${userId}:`)) return false;
  return !home.known || key === contextKeyFor(userId, home.context);
}

/** A settled answer that is not a completed set. */
export const terminalResult = (id, contextKey, status, message) => ({ id, status, contextKey, message });

/** The completed ProjectGenerationResult for one request. */
export function completedResult({ id, contextKey, request, generation, selection, evidence }) {
  const guides = selection.items.map((item) => LIBRARY_GUIDES.find((guide) => guide.id === item.id));
  return {
    id,
    status: 'completed',
    contextKey,
    batch: { request, constraints: selection.constraints, items: selection.items, contextKey, generation },
    guides,
    evidence,
    message: selection.message,
  };
}

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * The idea set as stored: without its context key, which names the
 * household's own id (the privacy export never carries an owner id). The key
 * is its own column, withheld from the export, and is put back on read.
 */
function storedIdeaSet(result) {
  const rest = { ...result };
  delete rest.contextKey;
  if (isObject(rest.batch)) {
    rest.batch = { ...rest.batch };
    delete rest.batch.contextKey;
  }
  return rest;
}

function rowOf(value, name) {
  if (value === null || value === undefined) return null;
  if (!isObject(value) || typeof value.generationId !== 'string' || !isObject(value.result) || typeof value.status !== 'string' || typeof value.contextKey !== 'string') {
    throw new Error(`projectsStore: ${name} returned an unexpected shape`);
  }
  const { result, contextKey } = value;
  return {
    ...value,
    result: { ...result, contextKey, ...(isObject(result.batch) ? { batch: { ...result.batch, contextKey } } : {}) },
  };
}

export async function readGeneration(db, profileId, generationId) {
  if (!profileId) throw new Error('projectsStore: reading requires an owner');
  const { data, error } = await db.rpc('read_project_generation', { p_profile_id: profileId, p_generation_id: generationId });
  if (error) throw error;
  return rowOf(data, 'read_project_generation');
}

export async function readCurrentGeneration(db, profileId) {
  if (!profileId) throw new Error('projectsStore: reading requires an owner');
  const { data, error } = await db.rpc('read_current_project_generation', { p_profile_id: profileId });
  if (error) throw error;
  return rowOf(data, 'read_current_project_generation');
}

/** Records `result` under this id unless a row exists; returns the stored row. */
export async function recordGeneration(db, { profileId, generationId, result }) {
  if (!profileId) throw new Error('projectsStore: recording requires an owner');
  const { data, error } = await db.rpc('record_project_generation', {
    p_profile_id: profileId,
    p_generation_id: generationId,
    p_context_key: result.contextKey,
    p_status: result.status,
    p_result: storedIdeaSet(result),
  });
  if (error) throw error;
  if (!isObject(data) || typeof data.inserted !== 'boolean') throw new Error('projectsStore: record_project_generation returned an unexpected shape');
  return { inserted: data.inserted, row: rowOf(data.row, 'record_project_generation') };
}

const CANCEL_NAMESPACE = 'halo:projects:cancel:';

/**
 * A stable ledger id for one cancellation `Idempotency-Key` (the client sends
 * `cancel:<id>`, which the uuid column cannot hold): name based, scoped to the
 * household so two households' keys never meet (the luna/runs/cancel pattern).
 */
export function cancelOperationId(profileId, key) {
  const digest = createHash('sha256').update(`${CANCEL_NAMESPACE}${profileId}:${key}`).digest();
  const bytes = digest.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-');
}

/** The input a start is claimed with; its hash identifies the guide of an unresolved start (Ruling J12). */
export const startInput = (guideId, guideVersion) => ({ guideId, guideVersion });
const START_HASHES = new Map(LIBRARY_GUIDES.map((guide) => [requestHash(startInput(guide.id, guide.version)), { guideId: guide.id, version: guide.version }]));

/**
 * The household's unresolved project starts, oldest first, as
 * `[{ id, guideId, version }]`. The ledger keeps only a hash of a start's
 * input, so the guide is the library guide whose `{guideId, guideVersion}`
 * hashes to it; a start for a guide no longer in the library is listed with
 * `guideId: null` (it still blocks another start).
 */
export async function pendingStarts(db, profileId) {
  if (!profileId) throw new Error('projectsStore: listing starts requires an owner');
  // Reaps this household's abandoned workspace rows first, as every reader does.
  await listUnresolvedOperations(db, { profileId, domains: [START_DOMAIN] });
  const { data, error } = await db
    .from('operations')
    .select('operation_id, request_hash, created_at')
    .eq('profile_id', profileId)
    .eq('domain', START_DOMAIN)
    .eq('kind', START_KIND)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const guide = START_HASHES.get(row.request_hash);
    return { id: row.operation_id, guideId: guide?.guideId ?? null, version: guide?.version ?? null };
  });
}

/** The exploreProjects record a start creates: its own instance id, the guide snapshot (contract :679). */
export function startedRecord(operationId, guide) {
  return {
    id: `project-${operationId}`,
    revision: 1,
    title: guide.title,
    status: 'Active',
    goal: guide.purpose,
    stepNotes: {},
    outcome: '',
    reviewDate: '',
    history: [{ status: 'Active', note: PROJECT_COPY.historyNote(guide.version) }],
    guideId: guide.id,
    guideVersion: guide.version,
    guide,
  };
}
