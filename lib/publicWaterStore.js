/**
 * The stored copies of `water.read`'s two public sources (migration 0033, B19
 * plan docs/backend/plans/b19-public-evidence-refresh.md), and the file
 * water.read projects: the newest stored copy of each source, or the bundled
 * copy (lib/data/ncWaterStewardship.json) for a source with none.
 *
 * Each source stands alone: a stored drought copy and the bundled utility
 * table can be served together, and the answer's `copies` says, per source,
 * which it is and on what date HALO retrieved it.
 *
 * Reads select only the newest row's id, dates and hash; the body (a few
 * hundred kilobytes) is read only when that id and hash are not already
 * held by this server, so an unchanged week costs two small reads.
 */
import { DROUGHT_SOURCE_ID, UTILITY_SOURCE_ID, isCalendarDate } from './publicWaterSources.js';

export const SNAPSHOT_TABLE = 'public_evidence_snapshots';
export const RUN_TABLE = 'public_evidence_runs';
export const RECORD_RUN_RPC = 'record_public_evidence_run';
export const WATER_SOURCE_IDS = Object.freeze([DROUGHT_SOURCE_ID, UTILITY_SOURCE_ID]);

/** "Not there yet": a table or function from 0033 is missing (PostgREST, then Postgres). */
const MISSING = new Set(['PGRST205', '42P01', 'PGRST202', '42883']);
export const isSnapshotStoreMissing = (error) => !!error && MISSING.has(error.code);

/** Bodies already read, by `${id}:${sha256}`; at most a few, newest kept. */
const bodies = new Map();
const BODY_CACHE_SIZE = 4;
function remember(key, body) {
  bodies.delete(key);
  bodies.set(key, body);
  while (bodies.size > BODY_CACHE_SIZE) bodies.delete(bodies.keys().next().value);
}
/** Test seam: forget every held body. */
export function _clearSnapshotCacheForTest() {
  bodies.clear();
}

const isoDate = (value) => {
  const date = typeof value === 'string' ? value.slice(0, 10) : null;
  return isCalendarDate(date) ? date : null;
};

/** The newest stored copy of one source, or null. A database error is thrown as is. */
async function newestSnapshot(db, source) {
  const { data, error } = await db
    .from(SNAPSHOT_TABLE)
    .select('id, source_date, retrieved_at, content_sha256')
    .eq('source', source)
    .order('id', { ascending: false })
    .limit(1);
  if (error) throw error;
  const head = data?.[0];
  if (!head) return null;
  const key = `${head.id}:${head.content_sha256}`;
  let body = bodies.get(key);
  if (!body) {
    const read = await db.from(SNAPSHOT_TABLE).select('body').eq('id', head.id).maybeSingle();
    if (read.error) throw read.error;
    body = read.data?.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    remember(key, body);
  }
  const retrieved = isoDate(head.retrieved_at);
  const sourceDate = isoDate(head.source_date);
  return retrieved && sourceDate ? { id: head.id, retrieved, sourceDate, body } : null;
}

/**
 * The newest stored copy of each source: { drought, utility, missing }.
 * `missing` is true when 0033 is not applied (both copies are then null).
 * Any other database error is thrown.
 */
export async function storedWaterSnapshots(db) {
  try {
    const [drought, utility] = await Promise.all(WATER_SOURCE_IDS.map((source) => newestSnapshot(db, source)));
    return { drought, utility, missing: false };
  } catch (error) {
    if (isSnapshotStoreMissing(error)) return { drought: null, utility: null, missing: true };
    throw error;
  }
}

/** The bundled file's copy dates, from its own header. */
function bundledCopy(input, sourceDate) {
  return { origin: 'bundled', retrieved: isoDate(input?.retrieved), sourceDate };
}

const newest = (rows, field) => (Array.isArray(rows) ? rows.reduce((top, row) => (typeof row?.[field] === 'string' && row[field] > top ? row[field] : top), '') : '');

/**
 * The water file to project: the bundled file with each source replaced by its
 * stored copy when there is one. `copies` names each source's origin
 * ('scheduled' or 'bundled'), the date HALO retrieved it and the source's own
 * newest date (the newest weekly map; the newest status update).
 */
export function composeWaterFile(bundled, { drought = null, utility = null } = {}) {
  const droughtCopy = drought
    ? { origin: 'scheduled', retrieved: drought.retrieved, sourceDate: drought.sourceDate }
    : bundledCopy(bundled?.source?.drought?.input, newest(bundled?.releases, 'date') || null);
  const utilityCopy = utility
    ? { origin: 'scheduled', retrieved: utility.retrieved, sourceDate: utility.sourceDate }
    : bundledCopy(bundled?.source?.utility?.input, (newest(bundled?.notices, 'date').match(/\d{4}-\d{2}-\d{2}$/) ?? [null])[0]);
  const latest = [droughtCopy.retrieved, utilityCopy.retrieved].filter(Boolean).sort().at(-1);
  return {
    ...bundled,
    source: {
      ...bundled?.source,
      drought: drought ? drought.body.source : bundled?.source?.drought,
      utility: utility ? utility.body.source : bundled?.source?.utility,
    },
    version: drought || utility ? `nc-water-${latest}` : bundled?.version,
    releases: drought ? drought.body.releases : bundled?.releases,
    notices: utility ? utility.body.notices : bundled?.notices,
    copies: { drought: droughtCopy, utility: utilityCopy },
  };
}
