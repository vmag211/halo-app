/**
 * Shared HomeGuard response shapes and pure helpers, used by the main page and
 * the water/radon subpages so severity, contaminant selection and copy stay
 * consistent across all three. No JSX, no hooks — just data.
 */

export type Reading = { date?: string | null; value_ppt: number };
export type Scored = { contaminant: string; value_ppt: number; limit_ppt: number; risk: number; is_enforceable: boolean };
export type Excluded = {
  contaminant: string;
  value_ppt: number;
  date?: string | null;
  reason: string;
  health_reference_level_ppt?: number | null;
  needs_local_context?: boolean;
};
export type Water = {
  status: string;
  pws_name?: string;
  contaminants?: Record<string, Reading[]>;
  risk?: number | null;
  coverage?: string;
  scored_contaminants?: Scored[];
  detected_unregulated?: string[];
  excluded_from_score?: Excluded[];
  latest_sample_date?: string | null;
  data_age_days?: number | null;
  message?: string;
  regulatory_notice?: string;
  source_type?: string;
  test_plan?: { tests: import("./TestPlanCard").WellTest[] };
  retryable?: boolean;
};
export type Radon = { county?: string; zone?: number; risk_level?: string; error?: string };
export type Score = { display_score?: number | null; water_unscoreable?: boolean; reason?: string };
export type BreakdownBox = { key: string; status?: string };
export type HomeGuardResponse = { success: boolean; radon: Radon; water: Water; score: Score; breakdown?: BreakdownBox[] };

// Composite score (higher = safer) → risk tier, for the header badge.
export function compositeSeverity(score: number | null | undefined): string {
  if (score === null || score === undefined) return "unknown";
  if (score >= 80) return "good";
  if (score >= 50) return "moderate";
  if (score >= 20) return "elevated";
  return "action_needed";
}

export function radonSeverity(level?: string): string {
  return { High: "action_needed", Moderate: "moderate", Low: "good" }[level ?? ""] ?? "unknown";
}

// The contaminant to feature: the enforceable-limit compound with the highest
// risk (falls back to the worst scored, then nothing).
export function pickPrimary(water: Water) {
  const scored = water.scored_contaminants ?? [];
  const enforceable = scored.filter((s) => s.is_enforceable);
  const pool = enforceable.length ? enforceable : scored;
  if (!pool.length) return null;
  const top = pool.reduce((a, b) => (b.risk > a.risk ? b : a));
  const readings = (water.contaminants ?? {})[top.contaminant] ?? [];
  const peak = readings.length ? Math.max(...readings.map((r) => r.value_ppt)) : top.value_ppt;
  return { name: top.contaminant, limit: top.limit_ppt, readings, peakRatio: top.limit_ppt > 0 ? peak / top.limit_ppt : null };
}

export type FactorSummary = { severity: string; label: string; value: string };

// A one-line summary for the water scorecard on the main page.
export function waterSummary(data: HomeGuardResponse): FactorSummary {
  const w = data.water;
  switch (w.status) {
    case "private_well":
      return { severity: "unknown", label: "Private well", value: "Testing plan" };
    case "no_pwsid_available":
      return { severity: "unknown", label: "No utility matched", value: "Unknown" };
    case "no_data_yet":
      return { severity: "unknown", label: "No results yet", value: "Not reported" };
    case "lookup_failed":
      return { severity: "unknown", label: "Couldn't load", value: "Retry" };
    default: {
      const box = (data.breakdown ?? []).find((b) => b.key === "water");
      const sev = box?.status ?? "unknown";
      const hasDetections = (w.scored_contaminants ?? []).length > 0 || (w.detected_unregulated ?? []).length > 0;
      if (!hasDetections) return { severity: "good", label: "No contaminants detected", value: "Clean" };
      const primary = pickPrimary(w);
      return {
        severity: sev,
        label: primary ? `${primary.name} detected` : "Detected",
        value: primary?.peakRatio ? `up to ${primary.peakRatio.toFixed(1)}×` : "Detected",
      };
    }
  }
}

export function radonSummary(radon: Radon): FactorSummary {
  if (radon.error) return { severity: "unknown", label: "Radon", value: "No data" };
  return { severity: radonSeverity(radon.risk_level), label: `Zone ${radon.zone ?? "—"}`, value: radon.risk_level ?? "Unknown" };
}

export function pillCopy(severity: string, contaminant?: string, coverage?: string): string {
  const name = contaminant ?? "A detected compound";
  if (severity === "action_needed") return `Action needed — ${name} is above the federal legal limit.`;
  if (severity === "elevated") return `Elevated — ${name} is approaching the federal limit.`;
  if (coverage === "partial") return "Some compounds could not be scored; the score reflects only what could be evaluated.";
  if (severity === "moderate") return `Moderate — ${name} is detected below the federal limit.`;
  if (severity === "good") return "Within the federal limit for everything measured.";
  return "Detected in this system.";
}

export function wordFor(n: number): string {
  return ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"][n] ?? String(n);
}

/** Append the current query string to a subpage path so params propagate. */
export function withQuery(path: string, rawSearch: string): string {
  const s = rawSearch.startsWith("?") ? rawSearch : rawSearch ? `?${rawSearch}` : "";
  return `${path}${s}`;
}
