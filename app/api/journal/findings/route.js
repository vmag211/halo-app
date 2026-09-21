import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { aqiSeverity, uvSeverity, pollenSeverity, moldSeverity } from '@/lib/severity';
import { journalFindings } from '@/lib/journalAnalysis';

/**
 * GET /api/journal/findings
 *
 * Either a not-ready response (with counts + what's still needed) or findings
 * with co-occurrence rates + the permanent disclaimer (§14.6). Excludes
 * illness-flagged days and enforces the minimum-data thresholds. Requires
 * migrations 0003 (symptom_logs) and existing daily_scores history.
 */
export async function GET(request) {
  try {
    const { userId } = await requireUser(request);

    // 90-day window of environmental history + all symptom entries in it.
    const to = new Date().toISOString().slice(0, 10);
    const fromD = new Date(`${to}T00:00:00Z`);
    fromD.setUTCDate(fromD.getUTCDate() - 89);
    const from = fromD.toISOString().slice(0, 10);

    const [{ data: scores, error: sErr }, { data: entries, error: eErr }] = await Promise.all([
      supabaseAdmin
        .from('daily_scores')
        .select('date, aqi, uv_index, pollen_level, mold_risk, created_at')
        .eq('profile_id', userId)
        .gte('date', from)
        .lte('date', to)
        .order('date', { ascending: true })
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('symptom_logs')
        .select('entry_date, symptoms, possibly_illness')
        .eq('profile_id', userId)
        .gte('entry_date', from)
        .lte('entry_date', to),
    ]);
    if (sErr) throw new Error(sErr.message);
    if (eErr) throw new Error(eErr.message);

    // One environmental record per date (latest write), mapped to severity words.
    const byDate = new Map();
    for (const row of scores || []) if (!byDate.has(row.date)) byDate.set(row.date, row);
    const history = [...byDate.values()].map((row) => {
      let pollen = null;
      if (row.pollen_level) {
        try {
          const p = JSON.parse(row.pollen_level);
          const vals = [p.tree, p.grass, p.weed].filter((v) => typeof v === 'number');
          pollen = vals.length ? Math.max(...vals) : null;
        } catch { /* ignore */ }
      }
      return {
        date: row.date,
        air: aqiSeverity(row.aqi),
        uv: uvSeverity(row.uv_index),
        pollen: pollenSeverity(pollen),
        mold: moldSeverity(row.mold_risk),
      };
    });

    const result = journalFindings({ entries: entries || [], history });
    return NextResponse.json(result);
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
