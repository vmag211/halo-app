/**
 * HALO scoring system.
 *
 * Every function here is pure: no network, no database, no clock. That is
 * deliberate — these are the numbers a household sees, so they must be
 * reproducible and testable in isolation.
 *
 * Two conventions run through this file:
 *
 * 1. All individual risk functions return 0-100 where HIGHER IS WORSE.
 * 2. `null` means "no data", and is NEVER silently coerced to 0. Zero is a
 *    claim ("we measured, it was clean"); null is the absence of a claim.
 *    Composite functions exclude nulls rather than scoring them as zero.
 */

// EPA-finalized maximum contaminant levels, in parts per trillion.
// A contaminant absent from this table has no enforceable federal limit and is
// deliberately NOT scored — it is reported separately as "detected, unregulated".
// HFPO-DA is keyed under both its bare name (how it appears in the UCMR5 dump)
// and its common GenX label, so neither spelling falls through as unregulated.
export const MCL_PPT = {
  PFOA: 4.0,
  PFOS: 4.0,
  PFHxS: 10.0,
  PFNA: 10.0,
  'HFPO-DA': 10.0,
  'HFPO-DA (GenX)': 10.0,
};

// Three of the five finalized MCLs are the subject of a proposed EPA rescission
// (comment period closed 2026-07-20; not final as of this writing). They remain
// legally enforceable today, so they still score as enforceable limits — but the
// response flags them, because a score resting on a limit that may disappear is
// something a household deserves to know about. PFOA and PFOS are NOT affected.
export const MCL_PROPOSED_FOR_RESCISSION = [
  'PFHxS',
  'PFNA',
  'HFPO-DA',
  'HFPO-DA (GenX)',
];

// Health-based benchmarks for compounds with NO enforceable federal limit.
// These are published, citable values — never invented. Scoring against them is
// deliberately marked `enforceable: false` so guidance is never presented as law.
//
// Compounds still absent from this table (PFPeA, PFHpA, 6:2 FTS) have no
// benchmark we could verify at a primary source, and are left unscored rather
// than assigned a guessed value.
export const HEALTH_BENCHMARK_PPT = {
  // EPA Health-Based Water Concentration, used in the PFAS NPDWR Hazard Index.
  PFBS: {
    value: 2000,
    basis: 'epa_health_based_water_concentration',
    source: 'EPA PFAS NPDWR Hazard Index (2024)',
    enforceable: false,
  },
  // State health advisories. Out-of-state guidance, used because no federal or
  // North Carolina value exists for these two compounds.
  PFHxA: {
    value: 1900,
    basis: 'state_health_advisory',
    source: 'Illinois EPA Health Advisory (1,900 ng/L)',
    enforceable: false,
  },
  PFBA: {
    value: 3800,
    basis: 'state_health_advisory',
    source: 'Illinois EPA Health Advisory (3,800 ng/L)',
    enforceable: false,
  },
};

// Contaminants deliberately excluded from the composite on methodological
// grounds — NOT because data or a benchmark is missing.
//
// Lithium: EPA's only drinking-water value is the CCL 5 Health Reference Level
// (10 µg/L), which is explicitly non-regulatory — a screening level derived from
// a provisional reference dose, not a health-protective limit of the kind the
// PFAS MCLs represent. Lithium in North Carolina groundwater is also largely
// geologic rather than industrial, and USGS publishes a "drinking water only"
// benchmark of 60 µg/L, six times higher. Scoring it on a curve calibrated for
// 4 ppt PFAS limits put the median NC system at maximum severity, which
// misrepresents both the hazard and the benchmark. It is still measured, still
// reported, and still shown to the household — it just does not drive the score.
//
// This is distinct from "no benchmark exists": that case flows into
// `detected_unregulated` and lowers confidence via the ceiling. An exclusion is
// a deliberate choice, so it does not penalize coverage.
export const SCORE_EXCLUDED_CONTAMINANTS = {
  lithium: {
    reason:
      'Lithium is excluded from the score. EPA has set no enforceable limit or health advisory for it — only a non-regulatory screening level — and lithium in North Carolina groundwater is predominantly naturally occurring. It is reported here as measured, but it is not scored.',
    // The EPA CCL 5 Health Reference Level: 10 µg/L (10,000 ppt), explicitly
    // non-regulatory. Carried so the response can offer a comparison point
    // WITHOUT it being mistaken for an MCL — it is never used to score.
    health_reference_level_ppt: 10000,
    health_reference_basis: 'epa_ccl5_health_reference_level',
    health_reference_source:
      'EPA CCL 5 Health Reference Level (10 µg/L, non-regulatory)',
    // Whether a lithium reading matters depends on local geology and household
    // factors no dataset can resolve, so the honest presentation flags that a
    // number alone is not a verdict rather than implying one either way.
    needs_local_context: true,
  },
};

/**
 * Risk 0-100 for a reading as a multiple of its limit: 100 * (1 - 2^-ratio). A reading
 * exactly at its limit is 50, twice the limit 75, four times about 94; it rises steeply
 * below the limit and never reaches 100. (Until 2026-10-22 the curve was
 * 100 * (1 - e^(-1.5 * ratio)), which put a reading at the limit at 78 and let two
 * compounds near their limits drive a home to the score floor.) The map's hazard index
 * uses the same curve (lib/mapData.js).
 */
export function limitRatioRisk(ratio) {
  if (!isFiniteNumber(ratio)) return null;
  return Math.min(100, Math.max(0, 100 * (1 - Math.pow(2, -ratio))));
}

const MOLD_RISK_BY_LABEL = { low: 5, moderate: 17, high: 30 };
const RADON_RISK_BY_ZONE = { 1: 80, 2: 50, 3: 20 };

// Mold tops out at 30 by design. It is derived from humidity and precipitation
// forecasts, not measured in anyone's home, so it must never be able to
// meaningfully move the composite on its own.
export const MOLD_RISK_MAX = 30;

// sqrt(100^2 + 100^2 + 100^2 + 30^2) = 175.784...
export const DASHBOARD_MAX_POSSIBLE = 175.8;

// A home is never reported as risk-free. Even a maximally contaminated water
// supply leaves a floor, so the score degrades toward a floor instead of
// collapsing to a flat zero that erases any difference between bad and worse.
export const HOMEGUARD_SCORE_FLOOR = 6;

// Confidence ceilings. When we could not check everything that was detected, the
// score is not allowed to reach the top of the range — a home must never look
// "excellent" on the strength of a check we could not actually complete. These
// are presentation guards, not measurements, and they only ever move a score
// DOWN, which is the safe direction for a health app.
export const HOMEGUARD_CEILING_UNSCOREABLE = 70;
export const HOMEGUARD_CEILING_PARTIAL = 85;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Round to `places` decimals without dragging in float noise. */
function round(value, places = 2) {
  if (!isFiniteNumber(value)) return null;
  const factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
}

// ==========================================
// INDIVIDUAL RISK FUNCTIONS
// ==========================================

/**
 * Air quality risk from an AQI value, piecewise across the EPA AQI bands.
 * Returns null when there is no reading.
 */
export function getAirRisk(aqi) {
  if (!isFiniteNumber(aqi)) return null;

  let risk;
  if (aqi <= 50) risk = (aqi / 50) * 20;
  else if (aqi <= 100) risk = 20 + ((aqi - 50) / 50) * 20;
  else if (aqi <= 150) risk = 40 + ((aqi - 100) / 50) * 20;
  else if (aqi <= 200) risk = 60 + ((aqi - 150) / 50) * 20;
  else if (aqi <= 300) risk = 80 + ((aqi - 200) / 100) * 15;
  else risk = Math.min(100, 95 + ((aqi - 300) / 200) * 5);

  // Clamp guards against nonsense input (a negative AQI); it cannot change the
  // result for any value the EPA scale actually produces.
  return Math.min(100, Math.max(0, risk));
}

/** UV risk, scaled against index 11 (the top of the conventional scale). */
export function getUvRisk(uvIndex) {
  if (!isFiniteNumber(uvIndex)) return null;
  return Math.min(100, Math.max(0, (uvIndex / 11) * 100));
}

/**
 * Pollen risk: the worst of the three pollen families, each scaled against
 * index 5. Nulls are excluded rather than counted as zero; if every family is
 * missing the answer is null, because no data is not the same as no risk.
 */
export function getPollenRisk(tree, grass, weed) {
  const present = [tree, grass, weed].filter(isFiniteNumber);
  if (present.length === 0) return null;

  const risks = present.map((index) =>
    Math.min(100, Math.max(0, (index / 5) * 100))
  );
  return Math.max(...risks);
}

/**
 * Mold risk from the NWS-derived label. Capped at MOLD_RISK_MAX by design.
 * An unrecognized or missing label returns null, not 'low' — we do not invent
 * a benign reading for data we never got.
 */
export function getMoldRisk(label) {
  if (typeof label !== 'string') return null;
  const risk = MOLD_RISK_BY_LABEL[label.trim().toLowerCase()];
  return risk === undefined ? null : risk;
}

/** Radon risk from the EPA county zone (1 worst, 3 best). */
export function getRadonRisk(zone) {
  if (zone === null || zone === undefined || zone === '') return null;
  const risk = RADON_RISK_BY_ZONE[Number(zone)];
  return risk === undefined ? null : risk;
}

// The compounds with an enforceable federal limit, each under one name (GenX is
// stored under either spelling and counts once). The regulated panel below says
// which of these a system actually has a result for.
export const REGULATED_PANEL = ['PFOA', 'PFOS', 'PFHxS', 'PFNA', 'HFPO-DA'];

/**
 * What one stored reading is. Three kinds, and none borrows another's meaning:
 *
 *   numeric     a reported concentration (finite, non-negative value_ppt)
 *   non_detect  a documented non-detect: `non_detect: true`, the sample date and
 *               the reporting limit (`reporting_limit_ppt`, null when unknown).
 *               The lab analysed the sample and found nothing at or above that
 *               limit. That is a result, not a missing one.
 *   invalid     anything else (a string, NaN, a negative concentration, or a
 *               non-detect that also claims a value). Never a result.
 */
export function classifyWaterReading(reading) {
  if (!reading || typeof reading !== 'object' || Array.isArray(reading)) return 'invalid';
  const hasValue = reading.value_ppt !== undefined && reading.value_ppt !== null;
  if (reading.non_detect === true) return hasValue ? 'invalid' : 'non_detect';
  return isFiniteNumber(reading.value_ppt) && reading.value_ppt >= 0 ? 'numeric' : 'invalid';
}

function reportingLimit(reading) {
  const rl = reading?.reporting_limit_ppt;
  return isFiniteNumber(rl) && rl > 0 ? rl : null;
}

/**
 * Pick the most recent usable reading (numeric or documented non-detect) for
 * one contaminant.
 *
 * Dates arrive as M/D/YYYY (e.g. "7/1/2025"), so a string sort is wrong:
 * "1/7/2025" sorts before "10/23/2024" lexicographically but is the later date.
 * Where several readings share the most recent date, a numeric result beats a
 * non-detect and the highest value wins: deterministic, and health-protective
 * rather than flattering. Invalid readings are counted, never chosen.
 */
function mostRecentReading(readings) {
  if (!Array.isArray(readings)) return { reading: null, kind: null, invalid: readings === undefined ? 0 : 1 };

  let best = null;
  let bestKind = null;
  let bestTime = null;
  let invalid = 0;

  const outranks = (kind, reading) =>
    (kind === 'numeric' && bestKind === 'non_detect') ||
    (kind === 'numeric' && bestKind === 'numeric' && reading.value_ppt > best.value_ppt);

  for (const reading of readings) {
    const kind = classifyWaterReading(reading);
    if (kind === 'invalid') {
      invalid++;
      continue;
    }

    const parsed = Date.parse(reading.date);
    const time = Number.isNaN(parsed) ? null : parsed;

    if (best === null) {
      best = reading;
      bestKind = kind;
      bestTime = time;
      continue;
    }
    // A reading with a usable date always beats one without.
    if (time === null) {
      if (bestTime === null && outranks(kind, reading)) {
        best = reading;
        bestKind = kind;
      }
      continue;
    }
    if (bestTime === null || time > bestTime || (time === bestTime && outranks(kind, reading))) {
      best = reading;
      bestKind = kind;
      bestTime = time;
    }
  }

  return { reading: best, kind: bestKind, invalid };
}

/** The comparison value for a compound: an enforceable MCL, else a benchmark, else none. */
function comparisonFor(name) {
  const mcl = Object.hasOwn(MCL_PPT, name) ? MCL_PPT[name] : undefined;
  if (isFiniteNumber(mcl) && mcl > 0) {
    return {
      limit: mcl,
      basis: 'federal_mcl',
      source: 'EPA PFAS National Primary Drinking Water Regulation (2024)',
      enforceable: true,
    };
  }
  const guidance = Object.hasOwn(HEALTH_BENCHMARK_PPT, name) ? HEALTH_BENCHMARK_PPT[name] : undefined;
  if (guidance && isFiniteNumber(guidance.value) && guidance.value > 0) {
    return { limit: guidance.value, basis: guidance.basis, source: guidance.source, enforceable: false };
  }
  return null;
}

// Own keys only: a stored compound named "constructor" or "__proto__" must not
// match a built-in object property and pass for an exclusion.
function ownExclusion(name) {
  return Object.hasOwn(SCORE_EXCLUDED_CONTAMINANTS, name) ? SCORE_EXCLUDED_CONTAMINANTS[name] : null;
}

function panelName(name) {
  return name === 'HFPO-DA (GenX)' ? 'HFPO-DA' : name;
}

/**
 * Water risk from measured contaminant readings.
 *
 * Returns an object, not a bare number, because "0" is dangerously ambiguous
 * on its own: a utility whose only detections are unregulated compounds would
 * otherwise be indistinguishable from a utility with zero detections. Callers
 * must check `coverage` before presenting a risk of 0 as though it meant clean.
 *
 * Missing, empty and invalid results are never evidence. A system whose record
 * holds no numeric result and no documented non-detect has `risk: null` and
 * `coverage: 'no_data'`, exactly like a system with no record at all, so no
 * caller can turn it into Good (the UCMR5 import keeps detections only, so an
 * empty record is common and says nothing about the water).
 *
 *   risk                  0-100, or null when nothing could be evaluated
 *   coverage              complete | partial | no_detections | unscoreable |
 *                         excluded_only | no_data
 *   no_data_reason        why coverage is no_data (null otherwise)
 *   scored                numeric results compared with a limit or benchmark
 *   non_detects           documented non-detects, with sample date, reporting
 *                         limit and whether that limit is at or below the
 *                         comparison value (only then is "below the limit"
 *                         established)
 *   invalid_results       compounds whose stored readings were all unusable
 *   regulated_panel       which regulated compounds have a numeric result, a
 *                         documented non-detect, or no result in this record
 *   detected_unregulated  detected compounds with no limit: real, unscoreable
 *   has_data              whether any usable result was found
 */
export function getWaterRisk(contaminants) {
  // Anything that is not a plain object is treated as no data rather than as an
  // empty result. A JSON string would otherwise walk character-by-character,
  // find no contaminants, and report risk 0, failing silently CLEAN, which is
  // the one direction this app must never fail in.
  const supplied =
    contaminants !== null &&
    contaminants !== undefined &&
    typeof contaminants === 'object' &&
    !Array.isArray(contaminants);

  const scored = [];
  const nonDetects = [];
  const detectedUnregulated = [];
  const excluded = [];
  const invalidResults = [];
  let detectedCount = 0;
  let entries = 0;

  const panel = new Map(REGULATED_PANEL.map((name) => [name, 'no_result']));
  const rank = { no_result: 0, non_detect: 1, numeric: 2 };
  const markPanel = (name, kind) => {
    const key = panelName(name);
    if (panel.has(key) && rank[kind] > rank[panel.get(key)]) panel.set(key, kind);
  };

  // When this system was actually sampled. Collected across every usable
  // reading (non-detects are samples too), including excluded ones, because the
  // question is when the utility was tested, not which results we ended up
  // scoring. Reported as dates only: this module stays clock-free.
  const sampleTimes = [];

  for (const [name, readings] of supplied ? Object.entries(contaminants) : []) {
    if (Array.isArray(readings)) {
      entries += readings.length;
      for (const reading of readings) {
        if (classifyWaterReading(reading) === 'invalid') continue;
        const time = Date.parse(reading.date);
        if (!Number.isNaN(time)) sampleTimes.push({ time, raw: reading.date });
      }
    } else {
      entries += 1;
    }

    const { reading, kind, invalid } = mostRecentReading(readings);
    if (!reading) {
      // Stored but unusable is reported, not silently dropped; an empty list is
      // simply no result.
      if (invalid > 0) invalidResults.push(name);
      continue;
    }
    const date = reading.date === undefined ? null : reading.date;

    if (kind === 'non_detect') {
      const comparison = ownExclusion(name) ? null : comparisonFor(name);
      const rl = reportingLimit(reading);
      nonDetects.push({
        contaminant: name,
        date,
        reporting_limit_ppt: rl,
        limit_ppt: comparison ? comparison.limit : null,
        is_enforceable: comparison ? comparison.enforceable : false,
        // A non-detect shows the result is below the reporting limit, so it
        // establishes "below the comparison value" only when that limit is
        // known and no higher than the comparison value.
        below_limit: comparison && rl !== null ? rl <= comparison.limit : null,
      });
      markPanel(name, 'non_detect');
      continue;
    }

    markPanel(name, 'numeric');

    // Excluded by policy, not by absence of data. Reported, never scored, and
    // deliberately not counted toward coverage: we are not failing to evaluate
    // it, we are choosing not to, and the response says so explicitly.
    const exclusion = ownExclusion(name);
    if (exclusion) {
      excluded.push({
        contaminant: name,
        value_ppt: reading.value_ppt,
        date,
        reason: exclusion.reason,
        // A non-binding screening level and the "needs local context" flag,
        // carried through from the exclusion config when present. These make the
        // detection legible without ever feeding the score: a reference level
        // is not an MCL, and this contaminant was excluded precisely because no
        // enforceable limit exists for it.
        health_reference_level_ppt:
          exclusion.health_reference_level_ppt ?? null,
        health_reference_basis: exclusion.health_reference_basis ?? null,
        health_reference_source: exclusion.health_reference_source ?? null,
        needs_local_context: exclusion.needs_local_context === true,
      });
      continue;
    }

    detectedCount++;

    // Tier 1: an enforceable federal MCL. Tier 2: a published health-based
    // benchmark with no force of law. Anything else is left unscored.
    const comparison = comparisonFor(name);
    if (!comparison) {
      // Detected, and we have no published limit of any kind to compare it
      // against. Do not score it and do not guess: surface it instead.
      detectedUnregulated.push(name);
      continue;
    }

    const risk = limitRatioRisk(reading.value_ppt / comparison.limit);

    scored.push({
      contaminant: name,
      value_ppt: reading.value_ppt,
      limit_ppt: comparison.limit,
      // Preserved for callers written against the MCL-only shape; null when the
      // comparison value is guidance rather than an enforceable limit.
      mcl_ppt: comparison.enforceable ? comparison.limit : null,
      basis: comparison.basis,
      source: comparison.source,
      is_enforceable: comparison.enforceable,
      proposed_for_rescission: comparison.enforceable
        ? MCL_PROPOSED_FOR_RESCISSION.includes(name)
        : false,
      date,
      risk: round(risk),
      _exact: risk,
    });
  }
  sampleTimes.sort((a, b) => a.time - b.time);

  const combine = (list) =>
    Math.sqrt(list.reduce((sum, e) => sum + e._exact * e._exact, 0));

  // A documented non-detect at or below its comparison value contributes zero
  // risk, and it is evidence; a missing or invalid result contributes nothing
  // and is not.
  const evaluatedNonDetects = nonDetects.filter((n) => n.below_limit === true);
  const evaluated = scored.length + evaluatedNonDetects.length;
  const evaluatedEnforceable =
    scored.filter((e) => e.is_enforceable).length +
    evaluatedNonDetects.filter((n) => n.is_enforceable).length;

  const combined = combine(scored);
  const enforceableOnly = combine(scored.filter((e) => e.is_enforceable));

  // `_exact` is an internal full-precision carrier; it must not leak into the
  // API response, where only the rounded per-contaminant risk is meaningful.
  for (const entry of scored) delete entry._exact;

  // How much of what we found were we actually able to evaluate? This is
  // orthogonal to severity: a risk of 0 means something very different at
  // 'complete' than at 'unscoreable', and callers must be able to tell.
  let coverage;
  if (detectedCount === 0) {
    // "Documented as not detected", "only a compound we do not score was
    // found" and "nothing usable was stored" are three different claims.
    if (evaluated > 0) coverage = 'no_detections';
    else if (excluded.length > 0) coverage = 'excluded_only';
    else coverage = 'no_data';
  } else if (evaluated === 0) coverage = 'unscoreable';
  else if (detectedUnregulated.length > 0) coverage = 'partial';
  else coverage = 'complete';

  let noDataReason = null;
  if (coverage === 'no_data') {
    if (!supplied) noDataReason = 'not_supplied';
    else if (entries === 0) noDataReason = 'no_results';
    else if (invalidResults.length > 0 && nonDetects.length === 0) noDataReason = 'invalid_results';
    else noDataReason = 'no_comparable_results';
  }

  // Only evidence makes a number. 'unscoreable' keeps its long-standing 0 (it is
  // shown as no_data and caps HomeGuard); everything with nothing evaluated is
  // null, so callers leave water out rather than score it as clean.
  let risk = null;
  let riskEnforceableOnly = null;
  if (evaluated > 0 || coverage === 'unscoreable') {
    risk = round(Math.min(100, Math.max(0, combined)));
    riskEnforceableOnly =
      evaluatedEnforceable > 0 || coverage === 'unscoreable'
        ? round(Math.min(100, Math.max(0, enforceableOnly)))
        : null;
  }

  const panelOf = (kind) => REGULATED_PANEL.filter((name) => panel.get(name) === kind);

  return {
    risk,
    // Severity from enforceable limits alone, so the effect of including
    // non-binding guidance is always visible rather than baked in silently.
    risk_enforceable_only: riskEnforceableOnly,
    coverage,
    no_data_reason: noDataReason,
    // A score built on a three-year-old sample is not the same claim as one
    // built on last quarter's. Surfaced so the caller can say which it has.
    latest_sample_date:
      sampleTimes.length > 0 ? sampleTimes[sampleTimes.length - 1].raw : null,
    earliest_sample_date: sampleTimes.length > 0 ? sampleTimes[0].raw : null,
    reading_count: sampleTimes.length,
    scored_count: scored.length,
    detected_count: detectedCount,
    detected_unregulated: detectedUnregulated,
    // Measured and reported, but excluded from the score by policy. Kept
    // separate from `detected_unregulated` so "we chose not to score this" is
    // never confused with "nobody has set a limit for this".
    excluded_from_score: excluded,
    non_detects: nonDetects,
    invalid_results: invalidResults,
    // A result for every regulated compound is a complete panel. Anything less
    // is labelled, so a system with one low PFOA result is never presented as
    // though all five compounds were checked.
    regulated_panel: {
      numeric: panelOf('numeric'),
      non_detect: panelOf('non_detect'),
      no_result: panelOf('no_result'),
      complete: panelOf('no_result').length === 0,
    },
    has_data: coverage !== 'no_data',
    scored,
  };
}

// ==========================================
// COMPOSITE SCORES
// ==========================================

/**
 * Dashboard composite across air, UV, pollen and mold.
 *
 * Missing inputs are excluded from the sum rather than scored as zero, and the
 * result is flagged `is_partial` so a score built from two of four signals is
 * never presented as though it were built from all four.
 */
export function getDashboardScore({
  airRisk,
  uvRisk,
  pollenRisk,
  moldRisk,
} = {}) {
  const inputs = [
    ['air', airRisk],
    ['uv', uvRisk],
    ['pollen', pollenRisk],
    ['mold', moldRisk],
  ];

  const included = inputs.filter(([, value]) => isFiniteNumber(value));
  const missing = inputs
    .filter(([, value]) => !isFiniteNumber(value))
    .map(([name]) => name);

  // No inputs at all means no score. Returning 100 here would announce a
  // perfect day on the strength of having measured nothing.
  if (included.length === 0) {
    return {
      risk: null,
      score: null,
      display_score: null,
      is_partial: true,
      missing_inputs: missing,
      included_inputs: [],
      includes_proxy: false,
      reason: 'No environmental readings were available for this location.',
    };
  }

  const raw = Math.sqrt(
    included.reduce((sum, [, value]) => sum + value * value, 0)
  );
  const compositeRisk = Math.min(100, (raw / DASHBOARD_MAX_POSSIBLE) * 100);
  const score = 100 - compositeRisk;

  return {
    risk: round(compositeRisk),
    score: round(score),
    display_score: Math.round(score),
    is_partial: missing.length > 0,
    missing_inputs: missing,
    included_inputs: included.map(([name]) => name),
    // Mold is a humidity/precipitation heuristic, not a measurement in the home.
    includes_proxy: isFiniteNumber(moldRisk),
    reason: null,
  };
}

/**
 * HomeGuard composite across water and radon.
 *
 * The two are independent hazards, so they combine multiplicatively: each is a
 * surviving fraction of a clean home. A null input is excluded by treating it
 * as a factor of 1 and flagging the result partial.
 */
export function getHomeGuardScore({
  waterRisk,
  radonRisk,
  waterCoverage,
} = {}) {
  const inputs = [
    ['water', waterRisk],
    ['radon', radonRisk],
  ];

  const included = inputs.filter(([, value]) => isFiniteNumber(value));
  const missing = inputs
    .filter(([, value]) => !isFiniteNumber(value))
    .map(([name]) => name);

  if (included.length === 0) {
    return {
      risk: null,
      score: null,
      display_score: null,
      is_partial: true,
      missing_inputs: missing,
      included_inputs: [],
      floored: false,
      reason: 'Neither water nor radon data was available for this address.',
    };
  }

  const product = included.reduce((acc, [, value]) => {
    const clamped = Math.min(100, Math.max(0, value));
    return acc * (1 - clamped / 100);
  }, 1);

  const rawScore = 100 * product;

  // Confidence ceiling: we could not evaluate everything that was detected, so
  // the score is not permitted into the top of the range. Applied BEFORE the
  // floor so the floor always wins a conflict — the score never drops below it.
  let ceiling = 100;
  if (waterCoverage === 'unscoreable') ceiling = HOMEGUARD_CEILING_UNSCOREABLE;
  else if (waterCoverage === 'partial') ceiling = HOMEGUARD_CEILING_PARTIAL;

  const capped = Math.min(ceiling, rawScore);
  const score = Math.max(HOMEGUARD_SCORE_FLOOR, capped);

  return {
    risk: round(100 - score),
    score: round(score),
    display_score: Math.round(score),
    is_partial: missing.length > 0,
    missing_inputs: missing,
    included_inputs: included.map(([name]) => name),
    floored: score > capped,
    capped: capped < rawScore,
    ceiling: ceiling === 100 ? null : ceiling,
    water_coverage: waterCoverage === undefined ? null : waterCoverage,
    reason: null,
  };
}
