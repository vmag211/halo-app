/**
 * Shared HALO visual tokens and the risk-tier → colour mapping.
 *
 * Colour is never decorative here: every value below encodes a risk tier, and
 * `unknown` grey is reserved for "we could not evaluate this" — which the app
 * must never render as green/safe. The severity strings mirror the ones the
 * /api/home-guard `breakdown[].status` field emits, so a box can be styled
 * straight from the response without the client re-deriving thresholds.
 */

export const HALO = {
  accent: "#5fd3e6",
  accentSoft: "#aeefdf",
  good: "#4ade9b",
  moderate: "#f5a623",
  high: "#e0473f",
  severe: "#c9342d",
  unknown: "#6b7280",
  panel: "#0f2a3c",
  panelDeep: "#071c2e",
  frame: "linear-gradient(170deg,#0d4a5e 0%,#12657c 45%,#0b3a4c 100%)",
} as const;

export type Severity =
  | "good"
  | "moderate"
  | "elevated"
  | "action_needed"
  | "detected_not_scored"
  | "unknown";

export type Tone = {
  /** Primary colour for the tier. */
  color: string;
  /** Glow colour (rgba) for shadows/rings. */
  glow: string;
  /** A short, honest label a screen reader / colourblind user can read. */
  label: string;
};

const TONES: Record<Severity, Tone> = {
  good: { color: HALO.good, glow: "rgba(74,222,155,.55)", label: "Good" },
  moderate: { color: HALO.moderate, glow: "rgba(245,166,35,.5)", label: "Moderate" },
  elevated: { color: HALO.high, glow: "rgba(224,71,63,.55)", label: "Elevated" },
  action_needed: { color: HALO.severe, glow: "rgba(201,52,45,.6)", label: "Action needed" },
  // Measured, real, but deliberately not scored (e.g. lithium): neutral grey,
  // never green (would imply safe) and never red (would imply a violation).
  detected_not_scored: { color: HALO.unknown, glow: "rgba(107,114,128,.5)", label: "Detected, not scored" },
  unknown: { color: HALO.unknown, glow: "rgba(107,114,128,.5)", label: "Unknown" },
};

export function tone(severity: string | null | undefined): Tone {
  if (severity && severity in TONES) return TONES[severity as Severity];
  return TONES.unknown;
}
