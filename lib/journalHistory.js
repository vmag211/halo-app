/**
 * The environmental side of Journal: one record per local date, as severity
 * words (§14; punch list v3 items 10, 13). Shared by findings, the first-visit
 * retrospective, and the season summary so they read history identically.
 */
import { aqiSeverity, uvSeverity, pollenSeverity, moldSeverity } from './severity.js';
import { HISTORY_ROW_LIMIT, isTruncated } from './boundedRead.js';

/**
 * daily_scores rows → [{ date, air, uv, pollen, mold, tree, grass, weed }].
 * Rows must be ordered newest-first within a date; the first per date wins
 * (the latest refresh). Pure.
 */
export function rowsToHistory(rows) {
  const byDate = new Map();
  for (const row of rows || []) if (row?.date && !byDate.has(row.date)) byDate.set(row.date, row);
  return [...byDate.values()]
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
 * A household's history between two local dates (inclusive), and whether rows
 * were left out. At most HISTORY_ROW_LIMIT rows are read, newest first, so a cut
 * (ours, or the database API's own row cap) drops the oldest days and never
 * today; a cut inside a day still leaves that day's newest refresh. The records
 * come back oldest first, as every caller expects.
 *
 * @returns {Promise<{ history: Array<object>, truncated: boolean }>}
 */
export async function fetchHistoryWindow(supabase, profileId, from, to) {
  const { data, error, count } = await supabase
    .from('daily_scores')
    .select('date, aqi, uv_index, pollen_level, mold_risk, created_at', { count: 'exact' })
    .eq('profile_id', profileId)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(HISTORY_ROW_LIMIT);
  if (error) throw new Error(error.message);
  const rows = data || [];
  return {
    history: rowsToHistory(rows),
    truncated: isTruncated({ count, returned: rows.length, limit: HISTORY_ROW_LIMIT }),
  };
}

/** The records of fetchHistoryWindow, for callers that do not report truncation. */
export async function fetchHistory(supabase, profileId, from, to) {
  return (await fetchHistoryWindow(supabase, profileId, from, to)).history;
}
