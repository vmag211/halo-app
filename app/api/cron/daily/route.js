import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/serverAuth';
import { ncRadonZones } from '@/lib/radonData';
import { aqiSeverity } from '@/lib/severity';
import { normalizeBands, hasSensitiveGroup } from '@/lib/household';
import { evaluateAlerts } from '@/lib/alertRules';
import { isCronAuthorized } from '@/lib/cronAuth';

/**
 * GET|POST /api/cron/daily — the single daily scheduled process (§23).
 *
 * Protected by a shared secret so it cannot be triggered by an outside request.
 * Vercel Cron calls it with GET and `Authorization: Bearer <CRON_SECRET>` (see
 * vercel.json); other schedulers may POST with `x-cron-secret` or `?secret=`.
 * lib/cronAuth.js accepts all three and fails closed when CRON_SECRET is unset.
 *
 * Built here: per-household alert evaluation (air worsening + radon season) from
 * the stored daily readings and county radon zones, inserting only new alerts
 * (deduped by dedupe_key). Requires migration 0006 (alerts) + 0002 (household_bands).
 *
 * NOT wired yet (need external sources / storage — flagged): weather-advisory
 * and new-water-result alerts, end-of-season summaries, and pre-assembling the
 * map/district datasets into a cached static file (the map/district routes
 * assemble on demand for now).
 */
export async function GET(request) {
  return runDaily(request);
}

export async function POST(request) {
  return runDaily(request);
}

async function runDaily(request) {
  if (!isCronAuthorized(request.headers, request.url)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();
    const dateStr = now.toISOString().slice(0, 10);

    // Households = profiles with a resolved location.
    const { data: profiles, error: pErr } = await supabaseAdmin
      .from('profiles')
      .select('id, county')
      .not('lat', 'is', null)
      .limit(5000);
    if (pErr) throw new Error(pErr.message);

    let created = 0;
    const toInsert = [];

    for (const p of profiles || []) {
      // Latest two daily readings for air worsening.
      const { data: scores } = await supabaseAdmin
        .from('daily_scores')
        .select('date, aqi, created_at')
        .eq('profile_id', p.id)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(4);
      const seen = new Set();
      const perDay = [];
      for (const r of scores || []) {
        if (seen.has(r.date)) continue;
        seen.add(r.date);
        perDay.push(r);
      }
      const airToday = perDay[0] ? aqiSeverity(perDay[0].aqi) : undefined;
      const airYesterday = perDay[1] ? aqiSeverity(perDay[1].aqi) : undefined;

      // Composition → sensitive-group threshold shift.
      let bands = normalizeBands(null);
      const { data: bandRow } = await supabaseAdmin
        .from('household_bands')
        .select('*')
        .eq('profile_id', p.id)
        .maybeSingle();
      if (bandRow) bands = normalizeBands(bandRow);

      const zone = ncRadonZones[p.county];

      const fired = evaluateAlerts({
        airToday,
        airYesterday,
        sensitive: hasSensitiveGroup(bands),
        radonZone: zone,
        month,
        year,
        hasRadonTest: false, // no home-test data source yet
        date: dateStr,
      });
      if (!fired.length) continue;

      // Skip alerts whose dedupe_key already exists for this household.
      const keys = fired.map((f) => f.dedupe_key);
      const { data: existing } = await supabaseAdmin
        .from('alerts')
        .select('dedupe_key')
        .eq('profile_id', p.id)
        .in('dedupe_key', keys);
      const have = new Set((existing || []).map((e) => e.dedupe_key));

      for (const f of fired) {
        if (have.has(f.dedupe_key)) continue;
        toInsert.push({ profile_id: p.id, type: f.type, severity: f.severity ?? null, title: f.title, message: f.message, dedupe_key: f.dedupe_key });
      }
    }

    if (toInsert.length) {
      const { error: iErr } = await supabaseAdmin.from('alerts').insert(toInsert);
      if (iErr) throw new Error(iErr.message);
      created = toInsert.length;
    }

    return NextResponse.json({ ok: true, households: (profiles || []).length, alerts_created: created, ran_at: now.toISOString() });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
