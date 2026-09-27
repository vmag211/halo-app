/**
 * Inputs the daily job feeds to evaluateAlerts (punch list v3 item 16). Pure.
 */

/**
 * NWS active alerts (api.weather.gov/alerts/active?point=…) → advisories HALO
 * reports: flood and heat. Boil-water notices come from utilities and health
 * departments, not NWS, and no national feed exists — that kind stays in
 * alertRules but has no source here (recorded in docs/backend-progress.md).
 */
export function parseNwsAdvisories(json) {
  const out = [];
  for (const f of json?.features || []) {
    const p = f?.properties || {};
    const event = String(p.event || '');
    let kind = null;
    if (/flood/i.test(event)) kind = 'flood';
    else if (/heat/i.test(event)) kind = 'heat';
    if (!kind) continue;
    if (p.status && p.status !== 'Actual') continue; // skip tests/exercises
    out.push({ id: String(p.id || f.id || `${kind}:${p.sent || ''}`), kind, event, ends: p.ends || p.expires || null });
  }
  return out;
}

/** A stable fingerprint of a utility's stored readings (order-independent). */
export function readingsFingerprint(contaminants) {
  const canon = (v) => {
    if (Array.isArray(v)) {
      const items = v.map(canon);
      return `[${items.sort().join(',')}]`;
    }
    if (v && typeof v === 'object') {
      return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
    }
    return JSON.stringify(v ?? null);
  };
  const s = canon(contaminants || {});
  // FNV-1a, 32-bit, plus length — plenty to detect a changed reload.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${s.length}:${h.toString(16)}`;
}

export const NOTIFICATION_TYPES = [
  'air_quality_change',
  'weather_advisory',
  'new_water_results',
  'radon_season',
  'season_summary',
];

/** A stored preferences row (or nothing) → all five booleans, default on. */
export function normalizePrefs(row) {
  const out = {};
  for (const t of NOTIFICATION_TYPES) out[t] = row && typeof row[t] === 'boolean' ? row[t] : true;
  return out;
}

/**
 * The season that ended this week, if today is within the first 7 days of a new
 * meteorological season; otherwise null. Winter belongs to the year it starts.
 */
export function justEndedSeason(today) {
  const [y, m, d] = today.split('-').map(Number);
  if (d > 7) return null;
  if (m === 3) return { season: 'winter', year: y - 1 };
  if (m === 6) return { season: 'spring', year: y };
  if (m === 9) return { season: 'summer', year: y };
  if (m === 12) return { season: 'fall', year: y };
  return null;
}
