/**
 * Lead risk for households on public water (§12.3).
 *
 * The only lead signal available for most households is the building's age — a
 * proxy for a plumbing ERA, not a measurement of these pipes. So lead is
 * **shown but never scored**: it carries a severity level for display and
 * ordering and can produce an action-plan item, but it never contributes to the
 * home score (settled decision, §12.3). Every age-based result says outright
 * that it is an estimate based on age, not a measurement.
 *
 * Pure module.
 */

const AGE_DISCLAIMER = "This is an estimate based on your home's age, not a measurement of your plumbing.";

/**
 * @param {object} input
 * @param {number|null} [input.homeYear] Year the home was built
 * @param {boolean} [input.leadServiceLine] The utility's own inventory reports a lead line here
 * @returns {{level:string, basis:string, is_estimate:boolean, shown_not_scored:true,
 *            contributes_to_score:false, text:string}}
 */
export function leadRisk({ homeYear = null, leadServiceLine = false } = {}) {
  const base = { shown_not_scored: true, contributes_to_score: false };

  // A confirmed lead service line is a fact, not an estimate.
  if (leadServiceLine === true) {
    return {
      ...base,
      level: "severe",
      basis: "utility_lead_service_line",
      is_estimate: false,
      text: "Your water utility's own inventory lists a lead service line at this address. This is confirmed by the utility, not an estimate.",
    };
  }

  const year = Number.isFinite(homeYear) ? Number(homeYear) : null;

  if (year === null) {
    return {
      ...base,
      level: "no_data",
      basis: "unknown_year",
      is_estimate: false,
      text: "We don't know when this home was built, so we can't estimate lead risk. Testing is the only way to know.",
    };
  }

  if (year < 1950) {
    return {
      ...base,
      level: "high",
      basis: "built_before_1950",
      is_estimate: true,
      text: `Homes built before 1950 frequently have both lead service lines and lead-soldered plumbing. ${AGE_DISCLAIMER}`,
    };
  }

  if (year <= 1987) {
    return {
      ...base,
      level: "elevated",
      basis: "built_1950_1987",
      is_estimate: true,
      text: `Built before the 1988 ban on lead solder, so soldered joints in the plumbing may contain lead. ${AGE_DISCLAIMER}`,
    };
  }

  // 1988 or later
  return {
    ...base,
    level: "good",
    basis: "built_1988_or_later",
    is_estimate: true,
    text: `Built after the 1988 ban on lead solder, so lead plumbing is unlikely — though not impossible. ${AGE_DISCLAIMER}`,
  };
}
