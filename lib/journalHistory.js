/**
 * The environmental side of Journal: one record per local date, as severity
 * words (§14; punch list v3 items 10, 13). Shared by findings, the first-visit
 * retrospective, the season summary, the assistant and the daily job's alert
 * inputs, so they read history identically. GET /api/history reads its rows
 * through the same pieces (readHistoryRows, inScope, latestPerDay).
 *
 * Home contexts (migration 0016). A reading belongs to the home it was taken
 * at (daily_scores.home_context_id). After a move a date can have the earlier
 * home's real reading and the new home's modeled backfill row (lib/backfill.js
 * header), so the home is chosen first and only then the latest refresh of a
 * date. By default a reader is bound to the household's CURRENT home: readings
 * linked to it, plus readings with no home recorded, which are assumed to be
 * the current home's (lib/homeContext.js comparability: 'current_context' and
 * 'legacy_assumed'). An earlier home's reading ('earlier_home') is left out,
 * never shown in place of the current home's, even when it is newer. History
 * can also be read for every home ('all') or one home ({ contextId }); that is
 * what GET /api/history?context= offers.
 *
 * Until 0016 is applied (no home_contexts table, or no home_context_id
 * column) nothing is linked: every reading is read and kept exactly as before,
 * and nothing is left out.
 */
import { aqiSeverity, uvSeverity, pollenSeverity, moldSeverity } from './severity.js';
import { HISTORY_ROW_LIMIT, isTruncated } from './boundedRead.js';
import { comparability } from './homeContext.js';
import { HOME_CONTEXT_LINK, isMissingContextLink, readCurrentHomeContext } from './homeContextRpc.js';

/** The daily_scores columns the Journal records are made from. */
const JOURNAL_COLUMNS = 'date, aqi, uv_index, pollen_level, mold_risk, created_at';

/**
 * History that is not attributed to homes: before 0016, or when the household's home could not be
 * read for a whole run (the daily job). Every reading counts as the current home's, as before.
 */
export const UNLINKED_HOME = Object.freeze({ linked: false, current: null });

/**
 * @typedef {{ linked: false, current: null }
 *   | { linked: true, current: { id: string, origin?: string|null } | null }} HistoryHome
 *   `current`: the household's current home context (null when it has none); its origin tells a
 *   home made by 0016's legacy migration ('legacy_migration') from one saved by onboarding
 */

/**
 * The household's current home as history needs it, from one owner-scoped read
 * (lib/homeContextRpc.js readCurrentHomeContext).
 *
 * @param {object} supabase the service-role client
 * @param {string} profileId the verified session's user id
 * @returns {Promise<HistoryHome>} UNLINKED_HOME when 0016 is not applied
 * @throws {Error} on any other database error
 */
export async function historyHome(supabase, profileId) {
  const read = await readCurrentHomeContext(supabase, profileId);
  if (read.unavailable) return UNLINKED_HOME;
  const context = read.context;
  return { linked: true, current: context ? { id: context.id, origin: context.origin ?? null } : null };
}

/**
 * How one reading relates to the household's current home: lib/homeContext.js comparability, with
 * the current home's origin for a reading linked to it. Before 0016 (not linked) every reading is
 * 'legacy_assumed'.
 *
 * @param {{ home_context_id?: string|null }} row a daily_scores row
 * @param {HistoryHome} home
 * @returns {'current_context'|'earlier_home'|'legacy_assumed'}
 */
export function readingComparability(row, home) {
  if (!home?.linked) return 'legacy_assumed';
  const currentId = home.current?.id ?? null;
  const contextId = row?.home_context_id ?? null;
  const origin = contextId !== null && contextId === currentId ? home.current.origin ?? null : null;
  return comparability({ home_context_id: contextId, home_context_origin: origin }, currentId);
}

/** True for a reading of the current home (measured or assumed): what history shows by default. */
export const atCurrentHome = (row, home) => readingComparability(row, home) !== 'earlier_home';

/**
 * The readings a history scope keeps. Pure.
 *
 *   'current' (the default)  the current home's and those with no home recorded
 *   'all'                    every reading of the household
 *   { contextId }            the readings linked to that one home (none before 0016). The caller
 *                            checks that the home is the household's own first.
 *
 * @param {Array<object>} rows daily_scores rows
 * @param {HistoryHome} home
 * @param {'current'|'all'|{ contextId: string }} [scope]
 */
export function inScope(rows, home, scope = 'current') {
  const list = rows || [];
  if (scope === 'all') return list;
  if (scope && typeof scope === 'object') {
    return home?.linked ? list.filter((row) => (row.home_context_id ?? null) === scope.contextId) : [];
  }
  return list.filter((row) => atCurrentHome(row, home));
}

/**
 * The latest refresh of each date, per home: the first row seen for a date and home wins, so the
 * rows must be ordered newest first within a date (readHistoryRows reads them so). The current
 * home's readings and those with no home recorded are one home here; each earlier home is its own,
 * so in 'all' a date of the move can have one record per home. Before 0016 (the default `home`)
 * that is simply one record per date. Rows come back in the order first seen. Pure.
 *
 * @param {Array<object>} rows
 * @param {HistoryHome} [home]
 */
export function latestPerDay(rows, home = UNLINKED_HOME) {
  const seen = new Map();
  for (const row of rows || []) {
    if (!row?.date) continue;
    const key = atCurrentHome(row, home) ? row.date : `${row.date} ${row.home_context_id}`;
    if (!seen.has(key)) seen.set(key, row);
  }
  return [...seen.values()];
}

/**
 * The household's readings between two local dates (inclusive), every home's, newest first. At most
 * HISTORY_ROW_LIMIT rows are read, so a cut (ours, or the database API's own row cap) drops the
 * oldest days and never today; a cut inside a day still leaves that day's newest refresh.
 * `truncated` is true when rows were left out. The scope is chosen afterwards (inScope), so the limit
 * and truncation are those of the household's readings in the range, as they always were.
 *
 * With a linked `home` the rows carry home_context_id. When the column turns out to be missing
 * (0016 not fully applied) the read is done again without it, and the answer's `home` is
 * UNLINKED_HOME: use that one, not the one passed in.
 *
 * @param {object} supabase the service-role client
 * @param {string} profileId the verified session's user id (the owner filter)
 * @param {string} from 'YYYY-MM-DD'
 * @param {string} to 'YYYY-MM-DD'
 * @param {{ columns?: string, home?: HistoryHome }} [options] columns: the daily_scores columns to
 *   read (include date and created_at)
 * @returns {Promise<{ rows: Array<object>, home: HistoryHome, truncated: boolean }>}
 * @throws {Error} on a database error
 */
export async function readHistoryRows(supabase, profileId, from, to, { columns = JOURNAL_COLUMNS, home = UNLINKED_HOME } = {}) {
  const read = (selected) => supabase
    .from('daily_scores')
    .select(selected, { count: 'exact' })
    .eq('profile_id', profileId)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(HISTORY_ROW_LIMIT);

  let used = home?.linked ? home : UNLINKED_HOME;
  let { data, error, count } = await read(used.linked ? `${columns}, ${HOME_CONTEXT_LINK}` : columns);
  if (error && used.linked && isMissingContextLink(error)) {
    used = UNLINKED_HOME;
    ({ data, error, count } = await read(columns));
  }
  if (error) throw new Error(error.message);
  const rows = data || [];
  return { rows, home: used, truncated: isTruncated({ count, returned: rows.length, limit: HISTORY_ROW_LIMIT }) };
}

/**
 * daily_scores rows → [{ date, air, uv, pollen, mold, tree, grass, weed }].
 * Rows must be ordered newest-first within a date; the first per date wins
 * (the latest refresh). They must already be one home's (inScope). Pure.
 */
export function rowsToHistory(rows) {
  return latestPerDay(rows)
    .map((row) => {
      let p = {};
      if (row.pollen_level) {
        try {
          p = JSON.parse(row.pollen_level) || {};
        } catch {
          p = {};
        }
      }
      const vals = [p.tree, p.grass, p.weed].filter((v) => typeof v === 'number');
      return {
        date: row.date,
        air: aqiSeverity(row.aqi),
        uv: uvSeverity(row.uv_index),
        pollen: pollenSeverity(vals.length ? Math.max(...vals) : null),
        mold: moldSeverity(row.mold_risk),
        tree: pollenSeverity(typeof p.tree === 'number' ? p.tree : null),
        grass: pollenSeverity(typeof p.grass === 'number' ? p.grass : null),
        weed: pollenSeverity(typeof p.weed === 'number' ? p.weed : null),
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * The household's current-home history between two local dates (inclusive), whether rows were left
 * out, and how many daily records of earlier homes were left out of it (one per date and home; 0
 * before 0016). The records come back oldest first, as every caller expects.
 *
 * `options.home`: the household's home when the caller already has it (the daily job reads every
 * household's in one bulk read); otherwise it is read here, owner-scoped.
 *
 * @returns {Promise<{ history: Array<object>, truncated: boolean, excludedEarlierHome: number }>}
 * @throws {Error} on a database error (reading the home or the readings)
 */
export async function fetchHistoryWindow(supabase, profileId, from, to, { home } = {}) {
  const known = home ?? (await historyHome(supabase, profileId));
  const read = await readHistoryRows(supabase, profileId, from, to, { columns: JOURNAL_COLUMNS, home: known });
  const earlier = read.rows.filter((row) => !atCurrentHome(row, read.home));
  return {
    history: rowsToHistory(inScope(read.rows, read.home, 'current')),
    truncated: read.truncated,
    excludedEarlierHome: latestPerDay(earlier, read.home).length,
  };
}

/** The records of fetchHistoryWindow, for callers that do not report truncation. */
export async function fetchHistory(supabase, profileId, from, to, options = {}) {
  return (await fetchHistoryWindow(supabase, profileId, from, to, options)).history;
}
