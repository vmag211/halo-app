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
import { limitRatioRisk } from "./scoring.js";
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
  const risk = limitRatioRisk(value);
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

    // Per-contaminant severity for the selector. Each regulated compound carries
    // exactly one `result` kind, and none borrows another's meaning:
    //   numeric     a reported concentration with its own severity
    //   non_detect  a documented non-detect: sample date and reporting limit; good
    //               only when that limit is at or below the comparison limit
    //   invalid     stored readings that could not be used: no_data
    //   no_result   nothing in this record (the import keeps detections only, so
    //               this does not mean "not detected"): no_data
    const byName = (list) => {
      const out = {};
      for (const s of list || []) out[s.contaminant] = s;
      return (name) => out[name] || (name === "HFPO-DA" ? out["HFPO-DA (GenX)"] : null) || null;
    };
    const scoredFor = byName(detail.scored);
    const nonDetectFor = byName(detail.non_detects);
    const invalid = new Set(detail.invalid_results || []);

    const contaminants = {};
    for (const name of REGULATED) {
      const s = scoredFor(name);
      const nd = s ? null : nonDetectFor(name);
      if (nd) {
        contaminants[name] = {
          result: "non_detect",
          reporting_limit_ppt: nd.reporting_limit_ppt,
          limit_ppt: limitFor(name),
          below_limit: nd.below_limit,
          severity: nd.below_limit === true ? "good" : "no_data",
          date: nd.date,
          date_iso: toIsoDate(nd.date),
          proposed_for_rescission: rescinded(name),
        };
      } else if (s) {
        contaminants[name] = {
          result: "numeric",
          value_ppt: s.value_ppt,
          limit_ppt: s.limit_ppt,
          ratio: s.limit_ppt ? Math.round((s.value_ppt / s.limit_ppt) * 10) / 10 : null,
          severity: waterRiskSeverity(s.risk),
          date: s.date,
          date_iso: toIsoDate(s.date),
          proposed_for_rescission: rescinded(name),
        };
      } else {
        const stored = invalid.has(name) || (name === "HFPO-DA" && invalid.has("HFPO-DA (GenX)"));
        contaminants[name] = { result: stored ? "invalid" : "no_result", severity: "no_data", limit_ppt: limitFor(name), proposed_for_rescission: rescinded(name) };
      }
    }

    return {
      pwsid: u.pwsid,
      name: u.pws_name,
      status: u.status,
      overall_severity: overall,
      coverage: detail.coverage,
      no_data_reason: detail.no_data_reason,
      regulated_panel: detail.regulated_panel,
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
