/**
 * District aggregate (§20) and per-contaminant exceedance counts (§13.4).
 *
 * Built entirely from the public UCMR5 utility dataset — no household data.
 * Produces the "38 of 412 systems exceed the limit for PFOS" style counts the
 * map and district panel rely on.
 *
 * Population: UCMR5 carries none, so it is passed in separately (lib/waterGeo.js
 * joins EPA's population-served counts by PWSID). With it, "affected population"
 * is the population served by systems whose most recent sample exceeds a limit.
 * Systems whose population is unknown are counted, never guessed, and reported
 * so a partial total is labelled as a minimum. Without it, population stays
 * null. There is no per-county breakdown (the boundary data has no county field).
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
 * @param {Map<string,{population:number|null}>|null} [geo] population by PWSID
 * @returns {object}
 */
export function computeDistrict(utilities = [], geo = null) {
  const total = utilities.length;
  const withPop = geo instanceof Map;
  const popOf = (pwsid) => {
    const p = withPop ? geo.get(pwsid)?.population : null;
    return typeof p === "number" && Number.isFinite(p) ? p : null;
  };
  const by = {};
  for (const name of REGULATED) {
    by[name] = { tested: 0, over: 0, limit: limitFor(name) };
    if (withPop) Object.assign(by[name], { population_over: 0, over_population_unknown: 0 });
  }

  let systemsOver = 0;
  let affected = 0;
  let affectedUnknown = 0;
  for (const u of utilities) {
    let thisOver = false;
    const pop = popOf(u.pwsid);
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
        if (withPop) {
          if (pop === null) by[name].over_population_unknown += 1;
          else by[name].population_over += pop;
        }
      }
    }
    if (thisOver) {
      systemsOver += 1;
      if (pop === null) affectedUnknown += 1;
      else affected += pop;
    }
  }

  if (!withPop) {
    return {
      total_systems: total,
      by_contaminant: by,
      systems_over_limit: systemsOver,
      affected_population: null,
      note: "Population served is not in the UCMR5 dataset and could not be joined from the boundary service, so it is not shown.",
    };
  }
  return {
    total_systems: total,
    by_contaminant: by,
    systems_over_limit: systemsOver,
    affected_population: affected,
    affected_population_complete: affectedUnknown === 0,
    over_limit_population_unknown: affectedUnknown,
    note:
      "Affected population = people served by systems whose most recent sample exceeds a federal limit." +
      (affectedUnknown
        ? ` Population is unknown for ${affectedUnknown} of those systems, so this total is a minimum.`
        : "") +
      " No per-county breakdown: the boundary data has no county field.",
  };
}

/** "38 of 412 systems exceed the limit for PFOS" (§13.4), for one contaminant. */
export function exceedanceLine(district, contaminant) {
  const c = district.by_contaminant?.[contaminant];
  if (!c) return null;
  return `${c.over} of ${district.total_systems} systems exceed the limit for ${contaminant}.`;
}
