/**
 * The database side of the daily maxima (B08; docs/backend/plans/b08-evidence.md, migration
 * 0025). This file holds the two reads GET /api/evidence makes (Task 4, Rulings E11, E14, E19);
 * the recorder's helpers (Task 3) are added beside them.
 *
 *   readEvidenceRows(supabase, profileId, contextId, from, to)   one home's stored rows of a range
 *   readRecordingFrom(supabase)                                  the recorder's first day, or null
 *
 * Every helper takes the service-role Supabase client and holds none of its own. Nothing here
 * reads daily_scores (E1). A database error is thrown as an Error whose message is fixed and
 * whose `code` is the Postgres or PostgREST code only: a database error's details can quote a
 * row (ids, a point), so they are never carried (B04 review of 0021, finding B).
 */
import { MAX_SPAN_DAYS } from './dailyMaxima.js';

/** The columns buildHistorySnapshot reads: the owner check, the key, the value and its source. */
export const EVIDENCE_COLUMNS = 'home_context_id, local_date, factor, value, source_code, method_version, missing_code';
/** At most two stored factors (air, uv) on each day of the longest range (E15): 184 rows. */
export const EVIDENCE_MAX_ROWS = 2 * MAX_SPAN_DAYS;
/** The explicit row limit of the read, above EVIDENCE_MAX_ROWS so an overflow is seen, not cut. */
export const EVIDENCE_READ_LIMIT = 500;

function storeFailed(what, error) {
  const failure = new Error(`daily maxima store: ${what} failed`);
  failure.name = 'DailyMaximaStoreError';
  failure.code = typeof error?.code === 'string' ? error.code : null;
  return failure;
}

/**
 * The stored daily_maxima rows of one home context from `from` to `to` (inclusive, both
 * 'YYYY-MM-DD'), oldest first. Scoped on the query itself to the verified caller
 * (`profileId`) AND the context (E11), so an earlier home's rows and another household's are
 * never read. The range is at most MAX_SPAN_DAYS, so at most EVIDENCE_MAX_ROWS rows exist;
 * the read asks for EVIDENCE_READ_LIMIT and throws if more than EVIDENCE_MAX_ROWS come back,
 * since that would mean the table breaks its primary key or the factor check.
 *
 * @returns {Promise<Array<{home_context_id: string, local_date: string, factor: string,
 *   value: number|null, source_code: string|null, method_version: string, missing_code: string|null}>>}
 */
export async function readEvidenceRows(supabase, profileId, contextId, from, to) {
  if (typeof profileId !== 'string' || !profileId) throw new TypeError('readEvidenceRows needs the caller\'s id');
  if (typeof contextId !== 'string' || !contextId) throw new TypeError('readEvidenceRows needs a home context id');
  const { data, error } = await supabase
    .from('daily_maxima')
    .select(EVIDENCE_COLUMNS)
    .eq('profile_id', profileId)
    .eq('home_context_id', contextId)
    .gte('local_date', from)
    .lte('local_date', to)
    .order('local_date', { ascending: true })
    .order('factor', { ascending: true })
    .limit(EVIDENCE_READ_LIMIT);
  if (error) throw storeFailed('reading the evidence rows', error);
  const rows = data ?? [];
  if (rows.length > EVIDENCE_MAX_ROWS) throw storeFailed('reading the evidence rows (more rows than the range holds)', null);
  return rows;
}

/** The recorder's `recording_from` ('YYYY-MM-DD'), or null before its first run (E9). */
export async function readRecordingFrom(supabase) {
  const { data, error } = await supabase
    .from('daily_maxima_recorder')
    .select('recording_from')
    .eq('singleton', true)
    .maybeSingle();
  if (error) throw storeFailed('reading the recorder state', error);
  const value = data?.recording_from ?? null;
  if (value !== null && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))) {
    throw storeFailed('reading the recorder state (an unexpected answer)', null);
  }
  return value;
}
