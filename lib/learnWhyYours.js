/**
 * Learn's "why yours reads this way" line (§17.1–17.2; punch list v3 item 14).
 *
 * Learn is never generic: it explains the specific number the household is
 * looking at. Each topic composes its line from the reading the overlay was
 * opened over — value, severity word, and topic-specific context. When that
 * context wasn't passed there is nothing true and specific to say, so the line
 * is null rather than filler like "This explains the uv reading for your area".
 *
 * Pure module.
 *
 * @param {string} topic
 * @param {(key:string)=>string|null} get  query-string accessor
 * @param {(o:{homeYear:number|null})=>{text:string}} [leadText]
 * @returns {string|null}
 */
import { normalizeSeverity, severityDescriptor } from './severity.js';

function number(get, key) {
  const raw = get(key);
  if (raw === null || raw === undefined || raw === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

/** The severity word if one was passed and is real, else null. */
function severityWord(get) {
  const raw = get('severity');
  if (!raw) return null;
  const w = normalizeSeverity(raw);
  return w === 'no_data' ? null : w;
}

const label = (w) => severityDescriptor(w).label.toLowerCase();
const fmt = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));

export function composeWhyYours(topic, get, leadText) {
  const value = number(get, 'value');
  const sev = severityWord(get);

  switch (topic) {
    case 'pfas': {
      const c = get('contaminant');
      const limit = number(get, 'limit');
      if (c && value !== null && limit !== null && limit > 0) {
        const ratio = (Math.round((value / limit) * 10) / 10).toFixed(1);
        return `Your utility's most recent federal testing found ${c} at ${fmt(value)} ppt — about ${ratio}× the federal limit of ${fmt(limit)} ppt.`;
      }
      return null;
    }
    case 'radon': {
      const county = get('county');
      const zone = get('zone');
      if (county && zone) {
        return `${county} is a Zone ${zone} radon area. A zone predicts the county average, not your home — homes in low zones still test high.`;
      }
      return null;
    }
    case 'lead': {
      const homeYear = number(get, 'home_year');
      return leadText ? leadText({ homeYear }).text : null;
    }
    case 'air': {
      const source = get('source');
      const provenance =
        source === 'open-meteo'
          ? ' It is a modeled estimate — the nearest monitoring station is more than 25 miles away.'
          : source === 'airnow'
            ? ' It was measured at a monitoring station near you.'
            : '';
      const pollutant = get('pollutant');
      const driver = pollutant ? ` ${pollutant} is setting it — the index reflects the single worst pollutant, not an average.` : '';
      if (value !== null) {
        return `Your air quality index is ${fmt(value)}${sev ? ` (${label(sev)})` : ''}.${provenance}${driver}`;
      }
      return provenance ? `Your air quality reading:${provenance}` : null;
    }
    case 'uv': {
      if (value === null) return null;
      if (value < 1) return `Your UV index is ${fmt(value)} — the sun is too low right now to burn.`;
      const peak = get('peak_start') && get('peak_end') ? ` It stays at 3 or above from ${get('peak_start')} to ${get('peak_end')} today.` : '';
      return `Your UV index is ${fmt(value)}${sev ? ` (${label(sev)})` : ''}. UV passes through clouds, so overcast days still count.${peak}`;
    }
    case 'pollen': {
      const category = get('category');
      if (value === null && !sev) return null;
      const which = category ? `${category} pollen` : 'Pollen';
      const level = sev ? label(sev) : null;
      const num = value !== null ? ` (index ${fmt(value)} of 5)` : '';
      return `${which} is ${level ?? 'reported'} for you today${num}.${category ? ` That's the category driving today's reading.` : ''}`;
    }
    case 'mold': {
      const risk = get('risk');
      const humidity = number(get, 'humidity');
      const precip = number(get, 'precip');
      const level = sev ? label(sev) : risk ? String(risk).toLowerCase() : null;
      if (!level) return null;
      const basis =
        humidity !== null
          ? ` It's based on ${fmt(humidity)}% humidity${precip !== null ? ` and a ${fmt(precip)}% chance of rain` : ''} in today's forecast`
          : " It's based on today's humidity and rain forecast";
      return `Your mold risk is estimated ${level}.${basis} — an estimate, not a measurement inside your home.`;
    }
    default:
      return null;
  }
}
