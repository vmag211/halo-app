/**
 * Ranked action plan for HomeGuard (§12.6–12.7).
 *
 * Ordered worst-problem-first, containing only items at Elevated or above. Each
 * item names the specific finding that produced it, an estimated cost, the
 * certification to look for where relevant, and separate owner/renter guidance —
 * because a renter cannot install a whole-house filter and telling them to is
 * advice they cannot use.
 *
 * Lead is never scored but still produces an action item (§12.3). Water and lead
 * items move up the list when a toddler or pregnancy is present (§8.4).
 *
 * Pure module.
 *
 * NOTE: certification numbers are transcribed from §12.6 for wiring; per §12.6
 * they must be re-verified against the certifying body before launch.
 */

import { severityLevel } from "./severity.js";

// Filter certification by contaminant (§12.6).
export function certificationFor(contaminant) {
  const c = String(contaminant || "").toUpperCase();
  if (c === "LEAD") return "NSF/ANSI 53";
  if (c === "PFOA" || c === "PFOS" || c.startsWith("PF") || c.includes("GENX") || c.includes("HFPO")) {
    return "NSF/ANSI 53 with a P473 claim, or NSF/ANSI 58 reverse osmosis";
  }
  return "NSF/ANSI 53"; // general chemical reduction
}

function ratioText(value, limit) {
  if (!Number.isFinite(value) || !Number.isFinite(limit) || limit <= 0) return null;
  // Round to one decimal via Math.round so half-way cases round up predictably.
  // .toFixed(1) alone rounds e.g. 8.2/4 (2.05) down to "2.0" because the binary
  // value sits just below 2.05; Math.round(value*10)/10 gives the expected 2.1.
  return (Math.round((value / limit) * 10) / 10).toFixed(1);
}

function zoneLabel(zone) {
  return { 1: "high", 2: "moderate", 3: "low" }[Number(zone)] ?? "";
}

/**
 * @param {object} input
 * @param {{contaminant:string,value_ppt:number,limit_ppt:number,severity:string}|null} [input.water]
 *        the worst scored water contaminant
 * @param {{zone:number,severity:string}|null} [input.radon]
 * @param {{level:string,basis:string}|null} [input.lead]
 * @param {object} input.bands  normalized household bands
 * @param {boolean} [input.renter]
 * @returns {Array<object>} ranked items (rank assigned), worst-first
 */
export function actionPlan({ water = null, radon = null, lead = null, bands = {}, renter = false } = {}) {
  const items = [];
  const youngHousehold = bands.has_toddler === true || bands.has_pregnant === true;
  // Base ordering within a severity tie: water first (most direct), then lead, then radon.
  const BASE = { water: 0, lead: 1, radon: 2 };

  // ── Water ──
  if (water && severityLevel(water.severity) >= 2) {
    const cert = certificationFor(water.contaminant);
    const ratio = ratioText(water.value_ppt, water.limit_ppt);
    items.push({
      key: "water",
      severity: water.severity,
      title: `Filter your drinking water for ${water.contaminant}`,
      reason: ratio
        ? `${water.contaminant} measured at ${water.value_ppt} ppt — about ${ratio}× the federal limit of ${water.limit_ppt} ppt.`
        : `${water.contaminant} was measured above its federal limit of ${water.limit_ppt} ppt.`,
      cost: renter ? "$30–90" : "$150–400",
      certification: cert,
      renter_can_self_serve: true,
      action: renter
        ? `Use a pitcher or faucet filter certified to ${cert}, and ask your landlord about building-level filtration.`
        : `Install an under-sink or whole-house filter certified to ${cert}.`,
    });
  }

  // ── Lead (never scored, but actionable) ──
  if (lead && severityLevel(lead.level) >= 2) {
    const reason =
      lead.basis === "utility_lead_service_line"
        ? "Your water utility's inventory lists a lead service line at this address."
        : "Your home's age means lead-soldered plumbing or a lead service line is possible.";
    items.push({
      key: "lead",
      severity: lead.level,
      title: "Test for lead, and filter your tap water meanwhile",
      reason,
      cost: "$20–50 for a lead test",
      certification: "NSF/ANSI 53",
      renter_can_self_serve: true,
      action: renter
        ? "Request testing from your landlord in writing, use a filter certified to NSF/ANSI 53, and run the tap before drinking when water has sat for hours."
        : "Test the water; if lead is present, plan to replace lead plumbing or the service line, and use a certified filter in the meantime.",
    });
  }

  // ── Radon ──
  if (radon && severityLevel(radon.severity) >= 2) {
    items.push({
      key: "radon",
      severity: radon.severity,
      title: "Test your home for radon",
      reason: `Your county is a ${zoneLabel(radon.zone)} radon zone (Zone ${radon.zone}). Zones predict county averages, not your home.`,
      cost: "$15–40 for a test kit",
      certification: null,
      renter_can_self_serve: true,
      action: renter
        ? "Request testing from your landlord in writing; landlord disclosure obligations vary by state."
        : "Test with a short-term kit; if it reads 4.0 pCi/L or above, have a certified contractor install a mitigation system.",
    });
  }

  // Sort worst-first. Water and lead get a small boost when the household has a
  // toddler or pregnancy (§8.4). Ties fall back to the base ordering.
  items.sort((a, b) => {
    const boost = (it) => (youngHousehold && (it.key === "water" || it.key === "lead") ? 0.5 : 0);
    const ka = severityLevel(a.severity) + boost(a);
    const kb = severityLevel(b.severity) + boost(b);
    if (kb !== ka) return kb - ka;
    return BASE[a.key] - BASE[b.key];
  });

  return items.map((it, i) => ({ rank: i + 1, ...it }));
}
