/**
 * Alert rule evaluation (§19).
 *
 * Pure decision function: given a household's current situation it returns the
 * alerts that should fire. The scheduled process persists them. Households with
 * a sensitive group get air-quality alerts one level earlier (§19.3).
 *
 * Each alert carries a `dedupe_key` so the daily job never fires the same
 * recurring alert twice (enforced by a unique index in migration 0006).
 *
 * Pure module.
 */

import { severityLevel, severityDescriptor } from "./severity.js";

const ADVISORY_TEXT = {
  flood: (county) => `Flood advisory for ${county}. Flooding can affect well water — retest after it recedes.`,
  boil_water: (county) => `Boil-water advisory for ${county}. Boil tap water before drinking or cooking until it's lifted.`,
  heat: (county) => `Heat advisory for ${county}. Limit strenuous outdoor activity, especially for older adults and young children.`,
};

function winterYear(month, year) {
  // Oct–Dec belong to that winter; Jan–Feb belong to the prior year's winter.
  if (month >= 10) return year;
  if (month <= 2) return year - 1;
  return null;
}

/**
 * @param {object} input
 * @param {string} [input.airToday] canonical severity word
 * @param {string} [input.airYesterday]
 * @param {boolean} [input.sensitive] household has a sensitive group
 * @param {Array<{kind:string}>} [input.advisories] advisories for this county
 * @param {string} [input.county]
 * @param {boolean} [input.waterResultsChanged]
 * @param {number} [input.radonZone]
 * @param {number} [input.month] 1–12
 * @param {number} [input.year]
 * @param {boolean} [input.hasRadonTest]
 * @param {{season:string}|null} [input.seasonEnded]
 * @param {boolean} [input.hasJournalEntries]
 * @param {string} [input.date] YYYY-MM-DD, for dedupe keys
 * @returns {Array<{type:string, severity?:string, title:string, message:string, dedupe_key:string}>}
 */
export function evaluateAlerts(input = {}) {
  const alerts = [];
  const {
    airToday, airYesterday, sensitive = false,
    advisories = [], county = "your county",
    waterResultsChanged = false,
    radonZone, month, year, hasRadonTest = false,
    seasonEnded = null, hasJournalEntries = false,
    date = "",
  } = input;

  // 1. Air quality worsening. Sensitive households alert one level earlier.
  const todayLvl = severityLevel(airToday);
  const yestLvl = severityLevel(airYesterday);
  const threshold = sensitive ? 2 : 3;
  if (todayLvl !== null && todayLvl >= threshold && (yestLvl === null || todayLvl > yestLvl)) {
    const label = severityDescriptor(airToday).label;
    alerts.push({
      type: "air_quality_change",
      severity: airToday,
      title: "Air quality dropped",
      message: `Air quality dropped to ${label} today.`,
      dedupe_key: `air_quality_change:${date}`,
    });
  }

  // 2. Weather advisories for this county.
  for (const a of advisories) {
    const text = ADVISORY_TEXT[a.kind];
    if (!text) continue;
    alerts.push({
      type: "weather_advisory",
      title: "Weather advisory",
      message: text(county),
      dedupe_key: `weather_advisory:${a.kind}:${date}`,
    });
  }

  // 3. New water testing results published for the utility.
  if (waterResultsChanged) {
    alerts.push({
      type: "new_water_results",
      title: "New water results",
      message: "New water testing results were published for your utility.",
      dedupe_key: `new_water_results:${date}`,
    });
  }

  // 4. Radon season, elevated zone, no test yet.
  const wy = winterYear(Number(month), Number(year));
  if ((radonZone === 1 || radonZone === 2) && wy !== null && !hasRadonTest) {
    alerts.push({
      type: "radon_season",
      title: "Time to test for radon",
      message: "Winter is the most accurate time to test for radon.",
      dedupe_key: `radon_season:${wy}`,
    });
  }

  // 5. End-of-season journal summary.
  if (seasonEnded && seasonEnded.season && hasJournalEntries) {
    alerts.push({
      type: "season_summary",
      title: `Your ${seasonEnded.season} summary is ready`,
      message: `Your ${seasonEnded.season} summary is ready.`,
      dedupe_key: `season_summary:${seasonEnded.season}:${year}`,
    });
  }

  return alerts;
}
