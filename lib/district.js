/**
 * District aggregate (§20) and per-contaminant exceedance counts (§13.4).
 *
 * Built entirely from the public UCMR5 utility dataset — no household data.
 * Produces the "38 of 412 systems exceed the limit for PFOS" style counts the
 * map and district panel rely on.
 *
 * DATA GAP (flagged, not silently ignored): the UCMR5 rows carry no population
 * served and no coordinates, so "affected population" and per-county breakdowns
 * cannot be computed here. They need a separate geographic/SDWIS source. The
 * counts below are complete; population is returned as null.
 *
 * Pure module.
 */

import { MCL_PPT } from "./scoring.js";

// The regulated compounds the map/district reason about (§13.4).
export const REGULATED = ["PFOA", "PFOS", "PFHxS", "PFNA", "HFPO-DA"];

function mostRecentValue(readings) {
  if (!Array.isArray(readings) || readings.length === 0) return null;
  let best = null;
  let bestTime = null;
  for (const r of readings) {
    if (!r || typeof r.value_ppt !== "number" || !Number.isFinite(r.value_ppt)) continue;
    const t = Date.parse(r.date);
    const time = Number.isNaN(t) ? null : t;
    if (best === null) {
      best = r.value_ppt;
      bestTime = time;
      continue;
    }
    if (time === null) continue;
    if (bestTime === null || time > bestTime) {
      best = r.value_ppt;
      bestTime = time;
    } else if (time === bestTime && r.value_ppt > best) {
      best = r.value_ppt;
    }
  }
  return best;
}

/** Which key in a system's contaminants map holds this regulated compound. */
function readingFor(contaminants, name) {
  if (!contaminants || typeof contaminants !== "object") return null;
  if (Array.isArray(contaminants[name])) return contaminants[name];
  // GenX is stored under either its bare name or the labelled form.
  if (name === "HFPO-DA" && Array.isArray(contaminants["HFPO-DA (GenX)"])) return contaminants["HFPO-DA (GenX)"];
  return null;
}

function limitFor(name) {
  return MCL_PPT[name] ?? (name === "HFPO-DA" ? MCL_PPT["HFPO-DA (GenX)"] : null) ?? null;
}

/**
 * @param {Array<{pwsid:string, contaminants:object}>} utilities
 * @returns {{total_systems:number, by_contaminant:object, systems_over_limit:number,
 *            affected_population:null, note:string}}
 */
export function computeDistrict(utilities = []) {
  const total = utilities.length;
  const by = {};
  for (const name of REGULATED) by[name] = { tested: 0, over: 0, limit: limitFor(name) };

  let systemsOver = 0;
  for (const u of utilities) {
    let thisOver = false;
    for (const name of REGULATED) {
      const readings = readingFor(u.contaminants, name);
      if (!readings) continue;
      const val = mostRecentValue(readings);
      if (val === null) continue;
      by[name].tested += 1;
      const limit = limitFor(name);
      if (Number.isFinite(limit) && val > limit) {
        by[name].over += 1;
        thisOver = true;
      }
    }
    if (thisOver) systemsOver += 1;
  }

  return {
    total_systems: total,
    by_contaminant: by,
    systems_over_limit: systemsOver,
    affected_population: null, // not in the UCMR5 dataset — needs a separate source
    note: "Population served and per-county breakdowns are not present in the UCMR5 dataset and require a separate source.",
  };
}

/** "38 of 412 systems exceed the limit for PFOS" (§13.4), for one contaminant. */
export function exceedanceLine(district, contaminant) {
  const c = district.by_contaminant?.[contaminant];
  if (!c) return null;
  return `${c.over} of ${district.total_systems} systems exceed the limit for ${contaminant}.`;
}
