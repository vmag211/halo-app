/**
 * Journal pattern analysis (§14.6).
 *
 * Reports co-occurrence between environmental conditions and how a household's
 * people felt — as plain rates, never a model fitted to a handful of points. The
 * restraint IS the sophistication: refusing to report until the data supports a
 * claim is the defensible engineering decision (§14.6).
 *
 * Rules:
 *  - Days flagged as possible illness are excluded from every comparison.
 *  - No finding until ≥5 flagged days AND ≥14 total days of environmental history.
 *  - A factor with fewer than 3 days on either side of its elevated threshold is
 *    skipped as too thin.
 *  - A comparison whose two rates differ by less than 25 points is not reported.
 *  - Every finding carries a permanent, non-dismissible disclaimer.
 *
 * Pure module.
 */

import { severityLevel } from "./severity.js";

export const FINDING_DISCLAIMER =
  "This is a pattern in your own logs, not a medical finding. Many things affect how you feel on a given day.";

const DEFAULTS = { minFlagged: 5, minTotal: 14, minPerSide: 3, minGapPct: 25 };
const FACTORS = { air: "air quality", pollen: "pollen", uv: "UV", mold: "mold" };

function pct(n, d) {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

/**
 * @param {object} input
 * @param {Array<{entry_date:string, symptoms?:string[], possibly_illness?:boolean}>} input.entries
 * @param {Array<{date:string, air?:string, pollen?:string, uv?:string, mold?:string}>} input.history
 *        one record per date, each factor a canonical severity word
 * @param {object} [input.config]
 * @returns {{ready:false, flaggedDays:number, totalDays:number, needed:object}
 *          |{ready:true, findings:Array, disclaimer:string, flaggedDays:number, totalDays:number}}
 */
export function journalFindings({ entries = [], history = [], config = {} } = {}) {
  const cfg = { ...DEFAULTS, ...config };

  // A "flagged day" = a day the household logged actual symptoms and did NOT
  // mark as probably illness. Build a set of those dates.
  const symptomDays = new Set();
  for (const e of entries) {
    if (e.possibly_illness === true) continue;
    if (Array.isArray(e.symptoms) && e.symptoms.length > 0) symptomDays.add(e.entry_date);
  }
  // Illness-flagged dates are excluded from every comparison entirely.
  const illnessDays = new Set(entries.filter((e) => e.possibly_illness === true).map((e) => e.entry_date));

  const usableHistory = history.filter((h) => h && h.date && !illnessDays.has(h.date));
  const totalDays = usableHistory.length;
  const flaggedDays = usableHistory.filter((h) => symptomDays.has(h.date)).length;

  if (flaggedDays < cfg.minFlagged || totalDays < cfg.minTotal) {
    return {
      ready: false,
      flaggedDays,
      totalDays,
      needed: { flagged: cfg.minFlagged, total: cfg.minTotal },
    };
  }

  const findings = [];
  for (const [key, label] of Object.entries(FACTORS)) {
    const elevated = [];
    const other = [];
    for (const h of usableHistory) {
      const lvl = severityLevel(h[key]);
      if (lvl === null) continue; // no reading that day → not comparable for this factor
      (lvl >= 2 ? elevated : other).push(h.date);
    }
    if (elevated.length < cfg.minPerSide || other.length < cfg.minPerSide) continue;

    const elevRate = pct(elevated.filter((d) => symptomDays.has(d)).length, elevated.length);
    const otherRate = pct(other.filter((d) => symptomDays.has(d)).length, other.length);
    if (Math.abs(elevRate - otherRate) < cfg.minGapPct) continue;

    findings.push({
      factor: key,
      statement: `On days with elevated ${label}, you logged symptoms ${elevRate}% of the time, versus ${otherRate}% on other days.`,
      elevated_rate: elevRate,
      other_rate: otherRate,
      counts: { elevated_days: elevated.length, other_days: other.length },
    });
  }

  // Strongest gap first.
  findings.sort((a, b) => Math.abs(b.elevated_rate - b.other_rate) - Math.abs(a.elevated_rate - a.other_rate));

  return { ready: true, findings, disclaimer: FINDING_DISCLAIMER, flaggedDays, totalDays };
}
