/**
 * The database side of the daily maxima (B08 Task 3; docs/backend/plans/b08-evidence.md,
 * Rulings E4, E8, E9, E19, F2; migration 0025).
 *
 * Every helper takes the service-role Supabase client and holds none of its own. Nothing here
 * reads daily_scores (E1): the recorder's only inputs are the stored home contexts, its own
 * daily_maxima rows and the providers.
 *
 *   listCurrentContexts(supabase, {after, limit})   one keyset page of current home contexts
 *   latestAirKinds(supabase, contextIds)            each context's latest Air row with a source (E8)
 *   readWindowRows(supabase, contextIds, fromDate)  the stored rows of the recorder's window
 *   readStalePending(supabase, beforeDate)          pending rows that left the window (E4)
 *   beginRun, recordRows, finishRun                 the three 0025 functions
 *   isDailyMaximaUnavailable(error)                 0025 (or 0016) not applied
 *   dailyMaximaRefusal(error)                       a 0025 refusal code, or null
 *
 * Errors are thrown as DailyMaximaStoreError, whose message is fixed and whose `code` is the
 * Postgres or PostgREST code only: a database error's details can quote a row (ids, a point),
 * so they are never carried (B04 review of 0021, finding B).
 */
import { METHOD_VERSION } from './dailyMaxima.js';

/** "Not there yet": the function (PostgREST, Postgres), then the table (PostgREST, Postgres). */
const UNAVAILABLE_CODES = new Set(['PGRST202', '42883', 'PGRST205', '42P01']);

/** The stable refusals of the 0025 functions (SQLSTATE P0001, message exactly the code). */
export const DAILY_MAXIMA_REFUSALS = Object.freeze([
  'HALO_INVALID_INPUT',
  'HALO_BEFORE_RECORDING',
  'HALO_RECORDING_NOT_BEGUN',
  'HALO_DAILY_MAXIMUM_FINAL',
]);

/** The home_contexts columns the recorder reads (F2: the shared bulk helper reads too few). */
export const CONTEXT_COLUMNS = 'id, profile_id, lat, lng, state, effective_from';
/** PostgREST's default max_rows. A page never asks for more, and paging never trusts a page's size. */
export const PAGE_LIMIT = 1000;
/** Contexts per bulk read of daily_maxima, as readCurrentHomeContexts chunks households. */
export const CONTEXT_CHUNK = 100;
/** record_daily_maxima takes 1 to 1000 rows (0025). */
export const RECORD_BATCH_LIMIT = 1000;

export class DailyMaximaStoreError extends Error {
  constructor(what, error) {
    super(`daily maxima store: ${what} failed`);
    this.name = 'DailyMaximaStoreError';
    this.code = typeof error?.code === 'string' ? error.code : null;
  }
}

/** True when the error says 0025 (or a table it needs) is not applied. */
export function isDailyMaximaUnavailable(error) {
  return !!error && UNAVAILABLE_CODES.has(error.code);
}

/** The 0025 refusal code an error carries (modelled on haloRefusal), or null. */
export function dailyMaximaRefusal(error) {
  if (!error || error.code !== 'P0001' || typeof error.message !== 'string') return null;
  return DAILY_MAXIMA_REFUSALS.includes(error.message) ? error.message : null;
}

function requireIds(ids, what) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id)) throw new TypeError(`${what} needs an array of ids`);
  return [...new Set(ids)];
}

/**
 * One page of the current home contexts, ordered by id, after `after` (exclusive; null for the
 * first page). Keyset paging (F2): a plain select of every context stops at PostgREST's max_rows
 * with no error, so the caller asks again after the last id until a page comes back empty, and
 * never takes a short page for the last one.
 *
 * @returns {Promise<Array<{id: string, profile_id: string, lat: number|null, lng: number|null,
 *   state: string|null, effective_from: string}>>}
 */
export async function listCurrentContexts(supabase, { after = null, limit = PAGE_LIMIT } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_LIMIT) throw new TypeError(`limit must be 1 to ${PAGE_LIMIT}`);
  let query = supabase.from('home_contexts').select(CONTEXT_COLUMNS).is('effective_to', null);
  if (after !== null) query = query.gt('id', after);
  const { data, error } = await query.order('id', { ascending: true }).limit(limit);
  if (error) throw new DailyMaximaStoreError('reading the current home contexts', error);
  return data ?? [];
}

/**
 * Each context's latest stored Air row that names a source, in this method version (E8):
 * `Map<contextId, {source_code, local_date}>`; a context with none is absent (undecided).
 *
 * One read per CONTEXT_CHUNK contexts, newest first, so the first row seen for a context is its
 * latest. A read that came back short of its exact count (max_rows) is completed for the
 * contexts it left out, one row each, so a decided home is never taken for an undecided one.
 */
export async function latestAirKinds(supabase, contextIds) {
  const ids = requireIds(contextIds, 'latestAirKinds');
  const kinds = new Map();
  const select = () => supabase
    .from('daily_maxima')
    .select('home_context_id, local_date, source_code', { count: 'exact' })
    .eq('factor', 'air')
    .eq('method_version', METHOD_VERSION)
    .not('source_code', 'is', null);
  for (let start = 0; start < ids.length; start += CONTEXT_CHUNK) {
    const chunk = ids.slice(start, start + CONTEXT_CHUNK);
    const { data, error, count } = await select()
      .in('home_context_id', chunk)
      .order('local_date', { ascending: false })
      .limit(PAGE_LIMIT);
    if (error) throw new DailyMaximaStoreError('reading the latest Air rows', error);
    for (const row of data ?? []) {
      if (chunk.includes(row.home_context_id) && !kinds.has(row.home_context_id)) {
        kinds.set(row.home_context_id, { source_code: row.source_code, local_date: row.local_date });
      }
    }
    if (!Number.isInteger(count) || (data ?? []).length >= count) continue;
    for (const id of chunk.filter((candidate) => !kinds.has(candidate))) {
      const one = await select().eq('home_context_id', id).order('local_date', { ascending: false }).limit(1);
      if (one.error) throw new DailyMaximaStoreError('reading the latest Air rows', one.error);
      const row = one.data?.[0];
      if (row) kinds.set(id, { source_code: row.source_code, local_date: row.local_date });
    }
  }
  return kinds;
}

/**
 * The stored rows of the recorder's window (`local_date >= fromDate`) for these contexts:
 * `{rows, complete}`. `complete` is false when any read came back short of its exact count; the
 * caller then treats nothing as settled, which costs only provider calls and `kept` rows, never
 * a value.
 */
export async function readWindowRows(supabase, contextIds, fromDate) {
  const ids = requireIds(contextIds, 'readWindowRows');
  const rows = [];
  let complete = true;
  for (let start = 0; start < ids.length; start += CONTEXT_CHUNK) {
    const chunk = ids.slice(start, start + CONTEXT_CHUNK);
    const { data, error, count } = await supabase
      .from('daily_maxima')
      .select('home_context_id, local_date, factor, missing_code', { count: 'exact' })
      .in('home_context_id', chunk)
      .gte('local_date', fromDate)
      .limit(PAGE_LIMIT);
    if (error) throw new DailyMaximaStoreError('reading the window', error);
    const got = (data ?? []).filter((row) => chunk.includes(row.home_context_id));
    rows.push(...got);
    if (!Number.isInteger(count) || (data ?? []).length < count) complete = false;
  }
  return { rows, complete };
}

/**
 * Up to PAGE_LIMIT rows of this method version still `pending` on a date before `beforeDate`:
 * days that left the window unsettled (a missed run, or a budget or deadline stop). The next
 * run takes any more.
 */
export async function readStalePending(supabase, beforeDate) {
  const { data, error } = await supabase
    .from('daily_maxima')
    .select('profile_id, home_context_id, local_date, factor, unit, source_code, hours_expected')
    .eq('missing_code', 'pending')
    .eq('method_version', METHOD_VERSION)
    .lt('local_date', beforeDate)
    .order('local_date', { ascending: true })
    .limit(PAGE_LIMIT);
  if (error) throw new DailyMaximaStoreError('reading pending rows', error);
  return data ?? [];
}

/** begin_daily_maxima_run: the stored recording_from ('YYYY-MM-DD'), set to `firstDay` only on the first run (E9). */
export async function beginRun(supabase, firstDay) {
  const { data, error } = await supabase.rpc('begin_daily_maxima_run', { p_first_day: firstDay });
  if (error) throw new DailyMaximaStoreError('beginning the run', error);
  if (typeof data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    throw new DailyMaximaStoreError('beginning the run (an unexpected answer)', null);
  }
  return data;
}

const COUNT_KEYS = ['inserted', 'updated', 'kept', 'skipped', 'refused'];

/**
 * record_daily_maxima for 1 to RECORD_BATCH_LIMIT rows: `{inserted, updated, kept, skipped,
 * refused, refusedRules}`. A whole-batch refusal or a database error is thrown (its code kept).
 */
export async function recordRows(supabase, rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > RECORD_BATCH_LIMIT) {
    throw new TypeError(`recordRows takes 1 to ${RECORD_BATCH_LIMIT} rows`);
  }
  const { data, error } = await supabase.rpc('record_daily_maxima', { p_rows: rows });
  if (error) throw new DailyMaximaStoreError('recording a batch', error);
  if (!data || typeof data !== 'object' || COUNT_KEYS.some((key) => !Number.isSafeInteger(data[key]))) {
    throw new DailyMaximaStoreError('recording a batch (an unexpected answer)', null);
  }
  const refusedRules = {};
  for (const [rule, n] of Object.entries(data.refusedRules ?? {})) {
    if (/^[a-z_]{1,40}$/.test(rule) && Number.isSafeInteger(n)) refusedRules[rule] = n;
  }
  return { ...Object.fromEntries(COUNT_KEYS.map((key) => [key, data[key]])), refusedRules };
}

/** finish_daily_maxima_run: the run's counts (integers only; `skipped` and `refused` required). */
export async function finishRun(supabase, counts) {
  const { error } = await supabase.rpc('finish_daily_maxima_run', { p_counts: counts });
  if (error) throw new DailyMaximaStoreError('finishing the run', error);
}
