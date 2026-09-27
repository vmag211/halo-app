/**
 * Utility-level lead service line inventory (punch list v3 item 11).
 *
 * Source: NC DEQ's published inventory results (July 2025) — per-utility counts
 * of lead, galvanized-requiring-replacement, non-lead and unknown service lines,
 * from the inventories utilities filed under the Lead and Copper Rule Revisions.
 *
 * DECISION (recorded, not pending): no public ADDRESS-level inventory exists for
 * NC-08 utilities, so HALO cannot know that a specific home has a lead service
 * line. The Severe lead level (basis "utility_lead_service_line") is therefore
 * knowingly unreachable. These counts are shown as context on the lead card and
 * never change the age-based level.
 *
 * Pure module.
 */
import data from './data/leadInventoryNC.json' with { type: 'json' };

export const LEAD_INVENTORY_SOURCE = {
  name: data.source,
  url: data.source_url,
  retrieved: data.retrieved,
};

/** Counts for one utility, or null when it isn't in the published results. */
export function utilityLeadInventory(pwsid) {
  if (typeof pwsid !== 'string') return null;
  const e = data.systems[pwsid];
  if (!e) return null;
  // Galvanized lines that are or were downstream of lead are treated like lead
  // under the federal rule, so they're summed into "needs replacement".
  const needsReplacement = (e.lead ?? 0) + (e.galvanized_requiring_replacement ?? 0);
  return {
    utility: e.name,
    reported: e.reported,
    lead: e.lead,
    galvanized_requiring_replacement: e.galvanized_requiring_replacement,
    non_lead: e.non_lead,
    unknown: e.unknown,
    needs_replacement: needsReplacement,
    address_level: false,
    source: LEAD_INVENTORY_SOURCE,
  };
}
