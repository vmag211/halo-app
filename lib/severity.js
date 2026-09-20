/**
 * HALO canonical severity scale (§6.1).
 *
 * Every environmental reading in the app, regardless of what it measures, maps
 * to ONE six-level scale. Thresholds differ per contaminant (each from its own
 * authority); the visual expression never does. The SERVER decides the level and
 * emits a word — the interface only maps that word to colour/icon/label, so two
 * screens can never disagree about the same household.
 *
 * Severity is never communicated by colour alone: every level carries a colour,
 * an icon token, and a written word together.
 *
 * Pure module: no I/O, fully unit-testable.
 */

// Canonical words. `no_data` is deliberately distinct from `good`.
export const SEVERITY = {
  good: { level: 0, label: "Good", color: "#16653a", icon: "check-circle" },
  moderate: { level: 1, label: "Moderate", color: "#a37200", icon: "info-circle" },
  elevated: { level: 2, label: "Elevated", color: "#c2620f", icon: "alert-triangle" },
  high: { level: 3, label: "High", color: "#a12d2d", icon: "alert-octagon" },
  severe: { level: 4, label: "Severe", color: "#6b1f6b", icon: "octagon" },
  no_data: { level: null, label: "No data", color: "#6b7280", icon: "help-circle" },
};

// Legacy words emitted by the existing scoring/route code, mapped onto the
// canonical scale so nothing falls through to no_data by accident.
const ALIASES = {
  // riskStatus() in the home-guard route
  action_needed: "severe",
  unknown: "no_data",
  // radon risk_level
  low: "good",
  // air getAirStatus
  unhealthy: "high",
  // uv getUvStatus
  very_high: "high",
  // pollen getPollenStatus
  none: "no_data",
  // generic
  detected_not_scored: "no_data",
};

/** Normalize any known severity word (canonical or legacy) to a canonical word. */
export function normalizeSeverity(word) {
  if (typeof word !== "string") return "no_data";
  const w = word.trim().toLowerCase();
  if (w in SEVERITY) return w;
  if (w in ALIASES) return ALIASES[w];
  return "no_data";
}

/** Numeric level (0–4) for a word, or null for no_data / unknown. */
export function severityLevel(word) {
  return SEVERITY[normalizeSeverity(word)].level;
}

/** Full descriptor {level,label,color,icon} for a word. */
export function severityDescriptor(word) {
  return SEVERITY[normalizeSeverity(word)];
}

/** The worse (higher level) of two words. no_data loses to any real level. */
export function worseSeverity(a, b) {
  const la = severityLevel(a);
  const lb = severityLevel(b);
  if (la === null) return normalizeSeverity(b);
  if (lb === null) return normalizeSeverity(a);
  return la >= lb ? normalizeSeverity(a) : normalizeSeverity(b);
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v);
}

// ── Threshold → word, per metric (each from its own authority) ──

/** EPA AQI bands (0–500). */
export function aqiSeverity(aqi) {
  if (!num(aqi)) return "no_data";
  if (aqi <= 50) return "good";
  if (aqi <= 100) return "moderate";
  if (aqi <= 150) return "elevated"; // Unhealthy for Sensitive Groups
  if (aqi <= 200) return "high"; // Unhealthy
  return "severe"; // Very Unhealthy / Hazardous
}

/** WHO UV Index bands. */
export function uvSeverity(uv) {
  if (!num(uv)) return "no_data";
  if (uv < 3) return "good"; // Low
  if (uv < 6) return "moderate"; // Moderate
  if (uv < 8) return "elevated"; // High
  if (uv < 11) return "high"; // Very High
  return "severe"; // Extreme
}

/** Google Pollen Universal Pollen Index (0–5). */
export function pollenSeverity(index) {
  if (!num(index)) return "no_data";
  if (index <= 0) return "good";
  if (index <= 2) return "moderate";
  if (index <= 3) return "elevated";
  if (index <= 4) return "high";
  return "severe";
}

/** Mold is a proxy from a low/moderate/high label (§11.4). */
export function moldSeverity(label) {
  if (typeof label !== "string") return "no_data";
  const l = label.trim().toLowerCase();
  if (l === "low") return "good";
  if (l === "moderate") return "moderate";
  if (l === "high") return "elevated"; // capped — it is an estimate, not a measurement
  return "no_data";
}

/** EPA radon zone (1 worst … 3 best). A prediction, never a measurement. */
export function radonZoneSeverity(zone) {
  const z = Number(zone);
  if (z === 1) return "high";
  if (z === 2) return "elevated";
  if (z === 3) return "good";
  return "no_data";
}

/**
 * Water severity from the 0–100 risk the scoring engine already produces, so the
 * map and HomeGuard colour utilities identically (one severity source, §13.10).
 */
export function waterRiskSeverity(risk) {
  if (!num(risk)) return "no_data";
  if (risk <= 20) return "good";
  if (risk <= 45) return "moderate";
  if (risk <= 70) return "elevated";
  if (risk < 90) return "high";
  return "severe";
}
