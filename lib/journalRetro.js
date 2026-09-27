/**
 * Journal's first-visit insight and season recap (§14.4, §14.7; punch list v3
 * item 13). Pure and unit-tested.
 *
 * Both are descriptive comparisons, not findings: they report what the numbers
 * were on the days the household picked, and never claim a cause. The gated
 * co-occurrence analysis (lib/journalAnalysis.js) is still what decides whether
 * a pattern is worth reporting.
 */
import { severityLevel, severityDescriptor } from './severity.js';

// Factors compared, with how each is named in a sentence.
const FACTORS = [
  ['tree', 'tree pollen'],
  ['grass', 'grass pollen'],
  ['weed', 'weed pollen'],
  ['air', 'air quality'],
  ['uv', 'UV'],
  ['mold', 'mold risk'],
];

const LEVEL_WORDS = ['good', 'moderate', 'elevated', 'high', 'severe'];

/** Mean severity level over days that have one; null if none do. */
function meanLevel(days, key) {
  const levels = days.map((d) => severityLevel(d[key])).filter((l) => l !== null);
  if (!levels.length) return null;
  return levels.reduce((a, b) => a + b, 0) / levels.length;
}

/** A mean level (0–4) → its severity label ("High"). */
function levelLabel(mean) {
  return severityDescriptor(LEVEL_WORDS[Math.max(0, Math.min(4, Math.round(mean)))]).label;
}

/**
 * The first-visit comparison: for each factor, the flagged days' average vs the
 * rest of those months and vs the unflagged days; the factor with the biggest
 * gap is reported.
 *
 * @param {{dates:string[], history:Array<object>}} input  history from rowsToHistory
 * @returns {{ready:boolean, factor:string|null, statement:string, flagged_days_with_readings:number,
 *           flagged_avg?:string, month_avg?:string, unflagged_avg?:string}}
 */
export function retrospectiveComparison({ dates = [], history = [] } = {}) {
  const flaggedSet = new Set(dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));
  const flagged = history.filter((h) => flaggedSet.has(h.date));
  const unflagged = history.filter((h) => !flaggedSet.has(h.date));

  if (flagged.length < 2) {
    return {
      ready: false,
      factor: null,
      flagged_days_with_readings: flagged.length,
      statement:
        flagged.length === 0
          ? "HALO doesn't have readings for any of the days you picked yet, so there's nothing to compare."
          : "HALO has readings for only one of the days you picked. Pick at least two days it has readings for to compare.",
    };
  }
  if (!unflagged.length) {
    return {
      ready: false,
      factor: null,
      flagged_days_with_readings: flagged.length,
      statement: 'Every day HALO has readings for was one you picked, so there are no other days to compare against yet.',
    };
  }

  const months = new Set(flagged.map((h) => h.date.slice(0, 7)));
  const monthDays = history.filter((h) => months.has(h.date.slice(0, 7)));

  let best = null;
  for (const [key, name] of FACTORS) {
    const f = meanLevel(flagged, key);
    const u = meanLevel(unflagged, key);
    if (f === null || u === null) continue;
    const gap = f - u;
    if (!best || gap > best.gap) best = { key, name, gap, f, u, m: meanLevel(monthDays, key) };
  }

  if (!best || best.gap <= 0) {
    return {
      ready: true,
      factor: null,
      flagged_days_with_readings: flagged.length,
      statement: `On the ${flagged.length} days you flagged, none of the readings HALO tracks were higher than on the days you didn't flag.`,
    };
  }

  const n = flagged.length;
  const monthPhrase = months.size === 1 ? "The month's average was" : 'Those months averaged';
  const statement =
    `On the ${n} days you flagged, ${best.name} averaged ${levelLabel(best.f)}. ` +
    `${monthPhrase} ${levelLabel(best.m ?? best.u)}. ` +
    `Days you didn't flag averaged ${levelLabel(best.u)}.`;
  return {
    ready: true,
    factor: best.key,
    flagged_days_with_readings: n,
    flagged_avg: levelLabel(best.f),
    month_avg: levelLabel(best.m ?? best.u),
    unflagged_avg: levelLabel(best.u),
    statement,
  };
}

// ── Seasons ──────────────────────────────────────────────────────────────────
// Meteorological seasons. Winter belongs to the year it starts in (Dec 2025 –
// Feb 2026 is winter 2025).
export const SEASONS = ['spring', 'summer', 'fall', 'winter'];

export function seasonRange(season, year) {
  const pad = (m) => String(m).padStart(2, '0');
  const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  switch (season) {
    case 'spring':
      return { from: `${year}-03-01`, to: `${year}-05-31` };
    case 'summer':
      return { from: `${year}-06-01`, to: `${year}-08-31` };
    case 'fall':
      return { from: `${year}-09-01`, to: `${year}-11-30` };
    case 'winter':
      return { from: `${year}-12-01`, to: `${year + 1}-02-${pad(lastDay(year + 1, 2))}` };
    default:
      return null;
  }
}

/** The most recently ENDED season relative to a local date 'YYYY-MM-DD'. */
export function lastEndedSeason(today) {
  const [y, m] = today.split('-').map(Number);
  if (m >= 3 && m <= 5) return { season: 'winter', year: y - 1 };
  if (m >= 6 && m <= 8) return { season: 'spring', year: y };
  if (m >= 9 && m <= 11) return { season: 'summer', year: y };
  // December → fall of this year; Jan/Feb → fall of last year.
  return { season: 'fall', year: m === 12 ? y : y - 1 };
}

const RECAP_FACTORS = [
  ['pollen', 'high-pollen'],
  ['air', 'poor-air'],
  ['mold', 'high-mold'],
  ['uv', 'high-UV'],
];

/**
 * Season recap: "This spring you logged 22 days. On the 9 high-pollen days, you
 * flagged symptoms 7 times." "High" days are those at Elevated or worse; the
 * factor reported is the one whose high days had the most flagged symptoms.
 * Illness-flagged entries are excluded from the flagged count (§14.5).
 */
export function seasonSummary({ season, year, entries = [], history = [] }) {
  const range = seasonRange(season, year);
  if (!range) return null;
  const inRange = (d) => d >= range.from && d <= range.to;

  const loggedDates = new Set(entries.filter((e) => inRange(e.entry_date)).map((e) => e.entry_date));
  const flaggedDates = new Set(
    entries
      .filter((e) => inRange(e.entry_date) && !e.possibly_illness && Array.isArray(e.symptoms) && e.symptoms.length)
      .map((e) => e.entry_date),
  );
  const days = history.filter((h) => inRange(h.date));

  const base = `This ${season} you logged ${loggedDates.size} day${loggedDates.size === 1 ? '' : 's'}.`;
  let best = null;
  for (const [key, adjective] of RECAP_FACTORS) {
    const high = days.filter((d) => (severityLevel(d[key]) ?? -1) >= 2);
    if (!high.length) continue;
    const hits = high.filter((d) => flaggedDates.has(d.date)).length;
    if (!best || hits > best.hits || (hits === best.hits && high.length > best.high)) {
      best = { key, adjective, high: high.length, hits };
    }
  }

  const detail =
    best && loggedDates.size > 0
      ? ` On the ${best.high} ${best.adjective} day${best.high === 1 ? '' : 's'}, you flagged symptoms ${best.hits} time${best.hits === 1 ? '' : 's'}.`
      : '';

  return {
    season,
    year,
    from: range.from,
    to: range.to,
    logged_days: loggedDates.size,
    factor: best && loggedDates.size > 0 ? best.key : null,
    statement: base + detail,
  };
}
