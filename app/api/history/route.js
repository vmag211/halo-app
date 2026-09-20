import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { aqiSeverity, uvSeverity, pollenSeverity, moldSeverity } from '@/lib/severity';

/**
 * GET /api/history?days=90 (or ?from=YYYY-MM-DD&to=YYYY-MM-DD)
 *
 * Daily readings across a date range, exactly one record per date — the latest
 * write wins when a day was refreshed more than once. Serves the seven-day trend
 * lines and the Journal's pattern analysis. Read-only, owner-scoped.
 */
export async function GET(request) {
  try {
    const { userId } = await requireUser(request);
    const { searchParams } = new URL(request.url);

    const to = searchParams.get('to') || new Date().toISOString().slice(0, 10);
    let from = searchParams.get('from');
    if (!from) {
      const days = Math.min(365, Math.max(1, parseInt(searchParams.get('days'), 10) || 90));
      const d = new Date(`${to}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - (days - 1));
      from = d.toISOString().slice(0, 10);
    }

    const { data, error } = await supabaseAdmin
      .from('daily_scores')
      .select('date, score, aqi, uv_index, pollen_level, mold_risk, created_at')
      .eq('profile_id', userId)
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    // Collapse to one record per date (rows are already newest-first within a date).
    const byDate = new Map();
    for (const row of data || []) {
      if (!byDate.has(row.date)) byDate.set(row.date, row);
    }

    const history = [...byDate.values()].map((row) => {
      let pollen = { tree: null, grass: null, weed: null };
      if (row.pollen_level) {
        try { pollen = { ...pollen, ...JSON.parse(row.pollen_level) }; } catch { /* leave nulls */ }
      }
      const pollenVals = [pollen.tree, pollen.grass, pollen.weed].filter((v) => typeof v === 'number');
      const pollenWorst = pollenVals.length ? Math.max(...pollenVals) : null;
      return {
        date: row.date,
        score: row.score ?? null,
        // Canonical severity words per factor, for trend bands and Journal analysis.
        air: aqiSeverity(row.aqi),
        uv: uvSeverity(row.uv_index),
        pollen: pollenSeverity(pollenWorst),
        mold: moldSeverity(row.mold_risk),
        values: { aqi: row.aqi ?? null, uv_index: row.uv_index ?? null, pollen, mold_risk: row.mold_risk ?? null },
      };
    });

    return NextResponse.json({ from, to, count: history.length, history });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
