/**
 * Gathers the assistant's household context from the database (punch list v3
 * item 15). Server-side, keyed only on the verified session's household id.
 * Every part is best-effort: a failure leaves that section out rather than
 * failing the question.
 */
import { buildHouseholdContext } from './assistantContext.js';
import { getWaterRisk, getRadonRisk, getHomeGuardScore } from './scoring.js';
import { waterRiskSeverity, radonZoneSeverity, waterDetailSeverity, compositeSeverity } from './severity.js';
import { ncRadonZones } from './radonData.js';
import { radonAppliesTo } from './geocode.js';
import { leadRisk } from './leadRisk.js';
import { actionPlan } from './actionPlan.js';
import { normalizeBands } from './household.js';
import { journalFindings } from './journalAnalysis.js';
import { fetchHistory } from './journalHistory.js';
import { localDate, addDays } from './localDate.js';

async function todaySection(db, id, today) {
  const { data } = await db
    .from('daily_scores')
    .select('date, aqi, aqi_source, uv_index, pollen_level, mold_risk, created_at')
    .eq('profile_id', id)
    .eq('date', today)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  let pollen = {};
  try {
    pollen = JSON.parse(data.pollen_level || '{}') || {};
  } catch {
    pollen = {};
  }
  return { ...data, pollen };
}

async function homeSection(db, id) {
  const [{ data: profile }, { data: bandRow }] = await Promise.all([
    db.from('profiles').select('*').eq('id', id).maybeSingle(),
    db.from('household_bands').select('*').eq('profile_id', id).maybeSingle(),
  ]);
  if (!profile?.county) return null;

  const privateSource = profile.water_source === 'well' || profile.water_source === 'spring';
  let detail = null;
  let utility = null;
  if (!privateSource && profile.pwsid) {
    const { data: u } = await db.from('ucmr5_utilities').select('pws_name, contaminants').eq('pwsid', profile.pwsid).maybeSingle();
    if (u) {
      detail = getWaterRisk(u.contaminants);
      utility = u.pws_name;
    }
  }
  const zone = radonAppliesTo(profile.state ?? null) ? ncRadonZones[profile.county] : undefined;

  let worst = null;
  if (detail?.scored?.length) {
    const enforceable = detail.scored.filter((s) => s.is_enforceable);
    const top = (enforceable.length ? enforceable : detail.scored).reduce((a, b) => (b.risk > a.risk ? b : a));
    worst = { contaminant: top.contaminant, value_ppt: top.value_ppt, limit_ppt: top.limit_ppt, is_enforceable: top.is_enforceable !== false, severity: waterRiskSeverity(top.risk) };
  }

  let score = null;
  let severity = null;
  if (!privateSource) {
    const composite = getHomeGuardScore({ waterRisk: detail ? detail.risk : null, radonRisk: getRadonRisk(zone), waterCoverage: detail ? detail.coverage : null });
    score = composite.display_score;
    severity = compositeSeverity(composite, {
      water: waterDetailSeverity(detail),
      radon: zone ? radonZoneSeverity(zone) : 'no_data',
    });
  }

  const lead = privateSource ? null : leadRisk({ homeYear: profile.home_year ?? profile.build_year ?? null });
  const actions = privateSource
    ? []
    : actionPlan({
        water: worst,
        radon: zone ? { zone, severity: radonZoneSeverity(zone) } : null,
        lead: lead ? { level: lead.level, basis: lead.basis } : null,
        bands: normalizeBands(bandRow ?? null),
        renter: profile.renter_mode === true,
      })
        .slice(0, 3)
        .map((a) => a.title);

  return {
    score,
    severity,
    water_source: profile.water_source ?? null,
    utility,
    worst,
    county: profile.county,
    radon_zone: zone ?? null,
    lead_level: lead?.level ?? null,
    actions,
  };
}

async function journalSection(db, id, today) {
  const from = addDays(today, -89);
  const [{ data: entries }, history] = await Promise.all([
    // Symptom names and dates only — the notes column is never selected.
    db.from('symptom_logs').select('entry_date, symptoms, possibly_illness').eq('profile_id', id).gte('entry_date', from).lte('entry_date', today).order('entry_date', { ascending: false }),
    fetchHistory(db, id, from, today).catch(() => []),
  ]);
  if (!entries?.length) return null;
  const f = journalFindings({ entries, history });
  const findings = f?.ready ? (f.findings || []).map((x) => x.statement).filter(Boolean) : [];
  return { entries: entries.filter((e) => e.entry_date >= addDays(today, -13)), findings };
}

/** @returns {Promise<string|null>} the context block for this household */
export async function gatherHouseholdContext(db, profileId, page) {
  const today = localDate();
  const safe = (p) => p.catch((err) => {
    console.error('Assistant context section failed:', err.message);
    return null;
  });
  const [todayData, home, journal] = await Promise.all([
    safe(todaySection(db, profileId, today)),
    safe(homeSection(db, profileId)),
    safe(journalSection(db, profileId, today)),
  ]);
  return buildHouseholdContext({ page, today: todayData, home, journal });
}
