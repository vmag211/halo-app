/**
 * Map water-layer assembly (§13.5, §13.10; punch list v3 item 18).
 *
 * Turns the UCMR5 dataset into per-system features that carry EVERYTHING the map
 * needs — overall severity plus each regulated compound's own severity — so the
 * contaminant selector re-colours from data already in memory and detail sheets
 * open with no extra request. Severity comes from the SAME scoring logic as
 * HomeGuard (one severity source, §13.10). Untested compounds carry an explicit
 * no_data marker so "not tested" is never shown as "clean".
 *
 * Additive fields (item 18): per compound date_iso and proposed_for_rescission;
 * per system latest_sample_iso and the PFAS hazard index; statewide counts; and
 * quarter filtering for the time slider.
 *
 * The UCMR5 rows carry no coordinates or population, so this module leaves
 * `lat`/`lng`/`population` null; lib/waterGeo.js joins them by PWSID from
 * EPA's water-system boundary service (see /api/map).
 *
 * Pure module.
 */

import { getWaterRisk, MCL_PPT, MCL_PROPOSED_FOR_RESCISSION } from "./scoring.js";
import { waterRiskSeverity, waterDetailSeverity } from "./severity.js";
import { REGULATED } from "./district.js";
import { toIsoDate } from "./waterPresentation.js";

function limitFor(name) {
  return MCL_PPT[name] ?? (name === "HFPO-DA" ? MCL_PPT["HFPO-DA (GenX)"] : null) ?? null;
}

function rescinded(name) {
  return MCL_PROPOSED_FOR_RESCISSION.includes(name) || (name === "HFPO-DA" && MCL_PROPOSED_FOR_RESCISSION.includes("HFPO-DA (GenX)"));
}

/** Readings for a compound, accepting GenX under either stored name. */
function readingsFor(contaminants, name) {
  if (!contaminants || typeof contaminants !== "object") return [];
  if (Array.isArray(contaminants[name])) return contaminants[name];
  if (name === "HFPO-DA" && Array.isArray(contaminants["HFPO-DA (GenX)"])) return contaminants["HFPO-DA (GenX)"];
  return [];
}

/** The most recent reading's value (by date), or null. */
function latestValue(readings) {
  let best = null;
  for (const r of readings || []) {
    if (typeof r?.value_ppt !== "number" || !Number.isFinite(r.value_ppt)) continue;
    const iso = toIsoDate(r.date) || "";
    if (!best || iso > best.iso) best = { iso, value: r.value_ppt };
  }
  return best ? best.value : null;
}

// ── PFAS hazard index (EPA PFAS NPDWR, April 2024) ────────────────────────────
// HI = HFPO-DA/10 + PFBS/2000 + PFNA/10 + PFHxS/10 (health-based water
// concentrations in ppt; verified against EPA's hazard-index fact sheet). The
// MCL is HI ≥ 1 for a mixture of TWO OR MORE of these; with fewer present the HI
// does not apply. EPA's compliance test is a running annual average of quarterly
// HIs — this is the latest-sample HI, labelled as such, not a compliance
// determination. The HI is among the limits proposed for rescission.
export const HAZARD_INDEX_HBWC = { "HFPO-DA": 10, PFBS: 2000, PFNA: 10, PFHxS: 10 };

export function hazardIndex(contaminants) {
  const components = {};
  let present = 0;
  let sum = 0;
  for (const [name, hbwc] of Object.entries(HAZARD_INDEX_HBWC)) {
    const v = latestValue(readingsFor(contaminants, name));
    if (v === null || v <= 0) continue;
    present += 1;
    components[name] = Math.round((v / hbwc) * 1000) / 1000;
    sum += v / hbwc;
  }
  if (present < 2) return null;
  const value = Math.round(sum * 100) / 100;
  // Same ratio→risk curve the scoring engine uses for a compound vs its limit.
  const risk = Math.min(100, Math.max(0, 100 * (1 - Math.exp(-1.5 * value))));
  return {
    value,
    exceeds: value >= 1,
    severity: waterRiskSeverity(risk),
    components,
    basis: "latest_sample",
    proposed_for_rescission: true,
  };
}

// ── Quarters (time slider) ───────────────────────────────────────────────────
/** 'YYYY-MM-DD' → 'YYYYQn'. */
export function quarterOf(iso) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}/.test(iso)) return null;
  const m = Number(iso.slice(5, 7));
  return `${iso.slice(0, 4)}Q${Math.floor((m - 1) / 3) + 1}`;
}

/** Every quarter that has at least one reading, oldest first. */
export function quartersIn(utilities = []) {
  const set = new Set();
  for (const u of utilities) {
    for (const readings of Object.values(u.contaminants || {})) {
      for (const r of Array.isArray(readings) ? readings : []) {
        const q = quarterOf(toIsoDate(r?.date));
        if (q) set.add(q);
      }
    }
  }
  return [...set].sort();
}

/** A system's readings restricted to one quarter (compounds with none are dropped). */
export function contaminantsInQuarter(contaminants, quarter) {
  const out = {};
  for (const [name, readings] of Object.entries(contaminants || {})) {
    if (!Array.isArray(readings)) continue;
    const kept = readings.filter((r) => quarterOf(toIsoDate(r?.date)) === quarter);
    if (kept.length) out[name] = kept;
  }
  return out;
}

/**
 * One map feature per water system.
 * @param {Array<{pwsid:string, pws_name:string, status:string, contaminants:object}>} utilities
 * @returns {Array<object>}
 */
export function assembleWaterFeatures(utilities = []) {
  return utilities.map((u) => {
    const detail = getWaterRisk(u.contaminants);
    // Coverage-aware: a system whose only detections have no limit scores 0,
    // and 0 must not be painted "good" — it is no_data, and `coverage` stays
    // "unscoreable" so the interface can say "detected — no federal limit".
    const overall = waterDetailSeverity(detail);

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
          date_iso: toIsoDate(s.date),
          proposed_for_rescission: rescinded(name),
        };
      } else {
        contaminants[name] = { severity: "no_data", limit_ppt: limitFor(name), proposed_for_rescission: rescinded(name) };
      }
    }

    return {
      pwsid: u.pwsid,
      name: u.pws_name,
      status: u.status,
      overall_severity: overall,
      coverage: detail.coverage,
      latest_sample_date: detail.latest_sample_date,
      latest_sample_iso: toIsoDate(detail.latest_sample_date),
      detected_unregulated: detail.detected_unregulated,
      contaminants,
      hazard_index: hazardIndex(u.contaminants),
      // Joined afterwards by lib/waterGeo.js (see module note).
      lat: null,
      lng: null,
      population: null,
    };
  });
}

/**
 * Counts describing exactly the features returned (statewide) — the map's live
 * count line binds to these, not to the NC-08 district figures. "over" uses each
 * compound's scored (most recent) reading vs its limit.
 */
export function waterCounts(features = []) {
  const by = {};
  for (const name of REGULATED) by[name] = { tested: 0, over: 0 };
  let overLimit = 0;
  let hiOver = 0;
  for (const f of features) {
    let any = false;
    for (const name of REGULATED) {
      const c = f.contaminants?.[name];
      if (!c || typeof c.value_ppt !== "number") continue;
      by[name].tested += 1;
      if (typeof c.limit_ppt === "number" && c.value_ppt > c.limit_ppt) {
        by[name].over += 1;
        any = true;
      }
    }
    if (f.hazard_index?.exceeds) hiOver += 1;
    if (any) overLimit += 1;
  }
  return { total: features.length, over_limit: overLimit, hazard_index_over: hiOver, by_contaminant: by };
}
