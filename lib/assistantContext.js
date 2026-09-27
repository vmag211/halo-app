/**
 * The household context the assistant answers from (§18.2, §18.4; punch list
 * v3 item 15).
 *
 * Built server-side from the verified session only. It sits in its own block in
 * the prompt, separate from the retrieved agency sources, so an answer can
 * distinguish "your reading" (cited [H]) from "federal guidance" (cited [n]).
 *
 * Privacy: journal entries contribute symptom names and dates only — never the
 * free-text notes (the frontend spec's Settings privacy decision).
 */
import { aqiSeverity, uvSeverity, pollenSeverity, moldSeverity, severityDescriptor } from './severity.js';

const label = (w) => severityDescriptor(w).label;

/** Section order by the page the assistant was opened from. */
export function sectionOrder(page) {
  const p = String(page || '').toLowerCase();
  if (p === 'home' || p === 'homeguard' || p === 'map') return ['home', 'today', 'journal'];
  if (p === 'journal') return ['journal', 'today', 'home'];
  return ['today', 'home', 'journal'];
}

function todayLines(t) {
  if (!t) return [];
  const lines = [`Today's readings (${t.date}):`];
  if (t.aqi !== null && t.aqi !== undefined) {
    lines.push(`- Air quality index ${t.aqi} (${label(aqiSeverity(t.aqi))})${t.aqi_source === 'open-meteo' ? ', modeled — no monitor nearby' : t.aqi_source === 'airnow' ? ', measured at a nearby monitor' : ''}.`);
  }
  if (t.uv_index !== null && t.uv_index !== undefined) lines.push(`- UV index ${t.uv_index} (${label(uvSeverity(t.uv_index))}).`);
  const p = t.pollen || {};
  const cats = [['tree', p.tree], ['grass', p.grass], ['weed', p.weed]].filter(([, v]) => typeof v === 'number');
  if (cats.length) {
    const [name, v] = cats.reduce((a, b) => (b[1] > a[1] ? b : a));
    lines.push(`- Pollen ${label(pollenSeverity(v))}, mostly ${name} (index ${v} of 5).`);
  }
  if (t.mold_risk) lines.push(`- Mold risk estimated ${label(moldSeverity(t.mold_risk))} (an estimate from the forecast, not a measurement).`);
  return lines.length > 1 ? lines : [];
}

function homeLines(h) {
  if (!h) return [];
  const lines = ['Home assessment:'];
  if (h.score !== null && h.score !== undefined) lines.push(`- Home score ${h.score} of 100 (${h.severity ? label(h.severity) : 'no rating'}).`);
  if (h.water_source === 'well' || h.water_source === 'spring') {
    lines.push(`- Water comes from a private ${h.water_source}; no agency tests it, so there is no water reading.`);
  } else if (h.worst) {
    const w = h.worst;
    const word = w.is_enforceable === false ? 'health benchmark' : 'federal limit';
    lines.push(`- Water (${h.utility || 'your utility'}): ${w.contaminant} most recently measured at ${w.value_ppt} ppt against a ${word} of ${w.limit_ppt} ppt.`);
  } else if (h.utility) {
    lines.push(`- Water (${h.utility}): no regulated contaminant above its limit in the latest results.`);
  }
  if (h.radon_zone) lines.push(`- Radon: ${h.county} is EPA Zone ${h.radon_zone} (a county estimate, not a home measurement).`);
  if (h.lead_level && h.lead_level !== 'no_data') lines.push(`- Lead: ${label(h.lead_level)}, estimated from the home's build year (shown, not scored).`);
  if (Array.isArray(h.actions) && h.actions.length) lines.push(`- Top actions: ${h.actions.join('; ')}.`);
  return lines.length > 1 ? lines : [];
}

function journalLines(j) {
  if (!j) return [];
  const lines = ['Journal (symptom names and dates only):'];
  for (const e of (j.entries || []).slice(0, 14)) {
    if (Array.isArray(e.symptoms) && e.symptoms.length) lines.push(`- ${e.entry_date}: ${e.symptoms.slice(0, 5).join(', ')}.`);
  }
  for (const f of j.findings || []) lines.push(`- Pattern: ${f}`);
  return lines.length > 1 ? lines : [];
}

/**
 * @param {{page?:string, today?:object|null, home?:object|null, journal?:object|null}} parts
 * @returns {string|null} the context block, or null when there is nothing to say
 */
export function buildHouseholdContext({ page, today = null, home = null, journal = null } = {}) {
  const build = { today: () => todayLines(today), home: () => homeLines(home), journal: () => journalLines(journal) };
  const lines = sectionOrder(page).flatMap((k) => {
    const s = build[k]();
    return s.length ? [...s, ''] : [];
  });
  return lines.length ? lines.join('\n').trim() : null;
}
