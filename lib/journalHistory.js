/**
 * The environmental side of Journal: one record per local date, as severity
 * words (§14; punch list v3 items 10, 13). Shared by findings, the first-visit
 * retrospective, and the season summary so they read history identically.
 */
import { aqiSeverity, uvSeverity, pollenSeverity, moldSeverity } from './severity.js';

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

/** Fetch a household's history between two local dates (inclusive). */
export async function fetchHistory(supabase, profileId, from, to) {
  const { data, error } = await supabase
    .from('daily_scores')
    .select('date, aqi, uv_index, pollen_level, mold_risk, created_at')
    .eq('profile_id', profileId)
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return rowsToHistory(data);
}
