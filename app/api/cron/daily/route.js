import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/serverAuth';
import { ncRadonZones } from '@/lib/radonData';
import { normalizeBands, hasSensitiveGroup } from '@/lib/household';
import { evaluateAlerts } from '@/lib/alertRules';
import { isCronAuthorized } from '@/lib/cronAuth';
import { getWaterGeo } from '@/lib/waterGeo';
import { radonAppliesTo } from '@/lib/geocode';
import { localDate, addDays } from '@/lib/localDate';
import { recordToday } from '@/lib/backfill';
import { parseNwsAdvisories, readingsFingerprint, normalizePrefs, justEndedSeason } from '@/lib/alertInputs';
import { seasonSummary, seasonRange } from '@/lib/journalRetro';
import { fetchHistory } from '@/lib/journalHistory';
import { pushConfigured, sendAlertPushes } from '@/lib/push';
import { buildAndStoreAll } from '@/lib/mapBuild';
import { contextIdForPoint, readCurrentHomeContexts } from '@/lib/homeContextRpc';

// ArcGIS geography (~20s) runs in parallel with the household pass.
export const maxDuration = 60;

/**
 * GET|POST /api/cron/daily — the single daily scheduled process (§23).
 *
 * Protected by CRON_SECRET (lib/cronAuth.js). Vercel Cron calls it with GET and
 * `Authorization: Bearer <CRON_SECRET>` (vercel.json, 11:00 UTC).
 *
 * Each run:
 *  1. Refreshes the shared water-geography cache (map coordinates, population)
 *     and pre-builds every map layer and the NC-08 district view (map_layers),
 *     so /api/map and /api/district never wait on a government service.
 *  2. Detects UCMR reloads that changed a utility's readings (water_snapshots).
 *     The first run only records a baseline, so it never fires a flood of alerts.
 *  3. Records today's reading for every onboarded household (item 10), so
 *     Journal has history even on days the app isn't opened. Each reading is
 *     linked to the household's current home (migration 0016), read for every
 *     household at once before the pass (see currentHomesFor); none when the
 *     household has no home yet, or before 0016.
 *  4. Evaluates alerts per household, honouring notification preferences:
 *     air quality worsening (only when there IS a reading dated today — a
 *     household that stopped opening the app is not re-alerted about an old
 *     reading), NWS flood/heat advisories for the household's point, new water
 *     results, radon season (once per winter), and the season summary in the
 *     first week after a season ends.
 *  5. Pushes new alerts to subscribed devices and removes expired subscriptions.
 *
 * Every date is the household-local (America/New_York) calendar day.
 */
export async function GET(request) {
  return runDaily(request);
}

export async function POST(request) {
  return runDaily(request);
}

/** Run fn over items with at most n in flight. */
async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

function summarizeGeo(g) {
  return { requested: g.requested, found: g.found, failed_batches: g.failedBatches };
}

/** Utilities whose readings changed since the last run. */
async function detectWaterChanges(utilities) {
  const { data: snaps, error } = await supabaseAdmin.from('water_snapshots').select('pwsid, fingerprint');
  if (error) return { changed: new Set(), note: `water_snapshots unavailable (${error.message})` };
  const known = new Map((snaps || []).map((s) => [s.pwsid, s.fingerprint]));
  const baseline = known.size === 0;
  const changed = new Set();
  const upserts = [];
  for (const u of utilities) {
    const fp = readingsFingerprint(u.contaminants);
    if (known.get(u.pwsid) === fp) continue;
    if (!baseline) changed.add(u.pwsid); // new or reloaded results
    upserts.push({ pwsid: u.pwsid, fingerprint: fp, updated_at: new Date().toISOString() });
  }
  if (upserts.length) {
    const { error: uErr } = await supabaseAdmin.from('water_snapshots').upsert(upserts, { onConflict: 'pwsid' });
    if (uErr) console.error('water_snapshots update failed:', uErr.message);
  }
  return { changed, baseline, updated: upserts.length };
}

let warnedNoContextLink = false;

/** daily_scores has no home_context_id column (0016 not applied): readings go in without it. Once per process. */
function contextLinkDropped(error) {
  if (warnedNoContextLink) return;
  warnedNoContextLink = true;
  console.warn(
    `Daily job: daily_scores has no home_context_id column (${error?.code ?? 'unknown'}), so migration 0016 is probably not applied yet. ` +
      'Recording readings without their home.',
  );
}

/**
 * Each household's current home, in one bulk read for the whole run (lib/homeContextRpc.js
 * readCurrentHomeContexts: chunks of 100 households, never one read per household). An empty map
 * before 0016 or when the read fails: the readings are then recorded without a home, as before,
 * and the job goes on.
 */
async function currentHomesFor(profiles) {
  try {
    const read = await readCurrentHomeContexts(supabaseAdmin, profiles.map((p) => p.id));
    return read.unavailable ? new Map() : read.byProfile;
  } catch (err) {
    console.error('Daily job: could not read the current homes; recording readings without them.', err.message);
    return new Map();
  }
}

async function runDaily(request) {
  if (!isCronAuthorized(request.headers, request.url)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const today = localDate(now);
    const yesterday = addDays(today, -1);
    const [year, month] = today.split('-').map(Number);

    const [{ data: profiles, error: pErr }, { data: utilities, error: uErr }] = await Promise.all([
      supabaseAdmin.from('profiles').select('*').not('lat', 'is', null).limit(5000),
      supabaseAdmin.from('ucmr5_utilities').select('pwsid, contaminants').limit(2000),
    ]);
    if (pErr) throw new Error(pErr.message);
    if (uErr) throw new Error(uErr.message);

    // 1. Geography refresh + map pre-build run alongside everything else.
    const geoRefresh = getWaterGeo((utilities || []).map((u) => u.pwsid), { force: true });
    const geoSummary = geoRefresh.then(summarizeGeo, (err) => {
      console.error('Water geography refresh failed:', err.message);
      return { error: err.message };
    });
    const mapBuild = buildAndStoreAll(supabaseAdmin, geoRefresh.then((g) => g.geo)).catch((err) => ({ error: err.message }));

    // 2. Water result changes.
    const water = await detectWaterChanges(utilities || []);

    const ended = justEndedSeason(today);
    const advisoryCache = new Map(); // one NWS lookup per ~1 km point
    const advisoriesFor = async (lat, lng) => {
      const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
      if (!advisoryCache.has(key)) {
        advisoryCache.set(
          key,
          fetch(`https://api.weather.gov/alerts/active?point=${lat},${lng}`, { headers: { 'User-Agent': 'HALO/1.0' } })
            .then((r) => (r.ok ? r.json() : null))
            .then(parseNwsAdvisories)
            .catch(() => []),
        );
      }
      return advisoryCache.get(key);
    };

    const recording = { recorded: 0, already_had_one: 0, failed: 0 };
    const newAlerts = [];
    const currentHomes = await currentHomesFor(profiles || []);

    await mapLimit(profiles || [], 4, async (p) => {
      // 3. Today's reading, linked to this household's own current home when it is at the
      // profile's point (the point the reading is taken at); otherwise none (contextIdForPoint).
      const homeContextId = contextIdForPoint(currentHomes.get(p.id), p);
      recording[await recordToday(supabaseAdmin, p, { today, homeContextId, onContextLinkDropped: contextLinkDropped })] += 1;

      // 4. Alert inputs.
      const history = await fetchHistory(supabaseAdmin, p.id, yesterday, today).catch(() => []);
      const todayRow = history.find((h) => h.date === today);
      const yesterdayRow = history.find((h) => h.date === yesterday);

      const [{ data: bandRow }, { data: prefRow }] = await Promise.all([
        supabaseAdmin.from('household_bands').select('*').eq('profile_id', p.id).maybeSingle(),
        supabaseAdmin.from('notification_prefs').select('*').eq('profile_id', p.id).maybeSingle(),
      ]);
      const prefs = normalizePrefs(prefRow);

      let seasonEnded = null;
      let hasJournalEntries = false;
      if (ended && prefs.season_summary) {
        const { from, to } = seasonRange(ended.season, ended.year);
        const { data: entries } = await supabaseAdmin
          .from('symptom_logs')
          .select('entry_date, symptoms, possibly_illness')
          .eq('profile_id', p.id)
          .gte('entry_date', from)
          .lte('entry_date', to);
        hasJournalEntries = (entries || []).length > 0;
        if (hasJournalEntries) {
          const seasonHistory = await fetchHistory(supabaseAdmin, p.id, from, to).catch(() => []);
          const s = seasonSummary({ ...ended, entries, history: seasonHistory });
          seasonEnded = { ...ended, statement: s?.statement };
        }
      }

      const fired = evaluateAlerts({
        // Air only when there's a reading dated today; keyed on that date.
        airToday: todayRow ? todayRow.air : undefined,
        airYesterday: yesterdayRow ? yesterdayRow.air : undefined,
        sensitive: hasSensitiveGroup(normalizeBands(bandRow ?? null)),
        advisories: prefs.weather_advisory ? await advisoriesFor(p.lat, p.lng) : [],
        county: p.county || 'your county',
        waterResultsChanged: !!p.pwsid && water.changed.has(p.pwsid),
        radonZone: radonAppliesTo(p.state ?? null) ? ncRadonZones[p.county] : undefined,
        month,
        year,
        hasRadonTest: false, // no home radon-test data source yet
        seasonEnded,
        hasJournalEntries,
        date: today,
      }).filter((a) => prefs[a.type] !== false);
      if (!fired.length) return;

      const { data: existing } = await supabaseAdmin
        .from('alerts')
        .select('dedupe_key')
        .eq('profile_id', p.id)
        .in('dedupe_key', fired.map((f) => f.dedupe_key));
      const have = new Set((existing || []).map((e) => e.dedupe_key));
      for (const f of fired) {
        if (have.has(f.dedupe_key)) continue;
        newAlerts.push({
          profile_id: p.id,
          type: f.type,
          severity: f.severity ?? null,
          title: f.title,
          message: f.message,
          dedupe_key: f.dedupe_key,
        });
      }
    });

    let inserted = [];
    if (newAlerts.length) {
      const { data, error } = await supabaseAdmin
        .from('alerts')
        .insert(newAlerts)
        .select('id, profile_id, type, title, message');
      if (error) throw new Error(error.message);
      inserted = data || [];
    }

    // 5. Device pushes.
    let push = { configured: pushConfigured() };
    if (push.configured && inserted.length) {
      const byHousehold = new Map();
      for (const a of inserted) byHousehold.set(a.profile_id, [...(byHousehold.get(a.profile_id) || []), a]);
      const { data: subs } = await supabaseAdmin
        .from('push_subscriptions')
        .select('profile_id, endpoint, p256dh, auth')
        .in('profile_id', [...byHousehold.keys()]);
      let sent = 0;
      let failed = 0;
      const expired = [];
      for (const [pid, alerts] of byHousehold) {
        const r = await sendAlertPushes({ subscriptions: (subs || []).filter((s) => s.profile_id === pid), alerts });
        sent += r.sent;
        failed += r.failed;
        expired.push(...r.expired);
      }
      if (expired.length) await supabaseAdmin.from('push_subscriptions').delete().in('endpoint', expired);
      push = { configured: true, sent, failed, expired_removed: expired.length };
    }

    return NextResponse.json({
      ok: true,
      date: today,
      households: (profiles || []).length,
      readings: recording,
      water_results: { changed: water.changed.size, baseline_run: water.baseline ?? null, note: water.note ?? null },
      alerts_created: inserted.length,
      push,
      water_geo: await geoSummary,
      map_layers: await mapBuild,
      ran_at: now.toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
