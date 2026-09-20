/**
 * Map water-layer assembly (§13.5, §13.10).
 *
 * Turns the UCMR5 dataset into per-system features that carry EVERYTHING the map
 * needs — overall severity plus each regulated compound's own severity — so the
 * contaminant selector re-colours from data already in memory and detail sheets
 * open with no extra request. Severity comes from the SAME scoring logic as
 * HomeGuard (one severity source, §13.10). Untested compounds carry an explicit
 * no_data marker so "not tested" is never shown as "clean".
 *
 * DATA GAP (flagged): the UCMR5 rows carry no coordinates or population, so the
 * geometry (circle position + size) must come from a separate geographic source
 * (e.g. the ArcGIS boundary service or SDWIS). This module produces the data
 * payload; `lat`/`lng`/`population` are null placeholders to be joined in later.
 *
 * Pure module.
 */

import { getWaterRisk, MCL_PPT } from "./scoring.js";
import { waterRiskSeverity } from "./severity.js";
import { REGULATED } from "./district.js";

function limitFor(name) {
  return MCL_PPT[name] ?? (name === "HFPO-DA" ? MCL_PPT["HFPO-DA (GenX)"] : null) ?? null;
}

/**
 * One map feature per water system.
 * @param {Array<{pwsid:string, pws_name:string, status:string, contaminants:object}>} utilities
 * @returns {Array<object>}
 */
export function assembleWaterFeatures(utilities = []) {
  return utilities.map((u) => {
    const detail = getWaterRisk(u.contaminants);
    const overall = waterRiskSeverity(detail.risk);

    // Per-contaminant severity for the selector. A regulated compound the system
    // was tested for gets its own severity; one it wasn't tested for is no_data.
    const scoredByName = {};
    for (const s of detail.scored || []) scoredByName[s.contaminant] = s;

    const contaminants = {};
    for (const name of REGULATED) {
      const s = scoredByName[name] || (name === "HFPO-DA" ? scoredByName["HFPO-DA (GenX)"] : null);
      if (s) {
        contaminants[name] = {
          value_ppt: s.value_ppt,
          limit_ppt: s.limit_ppt,
          ratio: s.limit_ppt ? Math.round((s.value_ppt / s.limit_ppt) * 10) / 10 : null,
          severity: waterRiskSeverity(s.risk),
          date: s.date,
        };
      } else {
        contaminants[name] = { severity: "no_data", limit_ppt: limitFor(name) };
      }
    }

    return {
      pwsid: u.pwsid,
      name: u.pws_name,
      status: u.status,
      overall_severity: overall,
      coverage: detail.coverage,
      latest_sample_date: detail.latest_sample_date,
      detected_unregulated: detail.detected_unregulated,
      contaminants,
      // Geometry to be joined from a geographic source (see module note).
      lat: null,
      lng: null,
      population: null,
    };
  });
}
