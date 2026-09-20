import { HALO } from "./tone";

type Cost = { low?: number; high?: number; is_estimate?: boolean };
export type WellTest = {
  rank?: number;
  id?: string;
  name: string;
  priority?: "critical" | "recommended" | "optional" | string;
  cadence?: string;
  why?: string;
  where?: string;
  estimated_cost?: Cost;
};

// Priority colour follows the risk vocabulary: critical = high, recommended =
// moderate, optional = neutral grey.
const PRIORITY = {
  critical: { color: HALO.high, bg: "rgba(224,71,63,.35)", border: "rgba(255,140,120,.5)", text: "#ffc9bd" },
  recommended: { color: HALO.moderate, bg: "rgba(245,166,35,.3)", border: "rgba(255,200,110,.5)", text: "#ffdda6" },
  optional: { color: "rgba(255,255,255,.4)", bg: "rgba(255,255,255,.14)", border: "rgba(255,255,255,.28)", text: "rgba(255,255,255,.75)" },
} as const;

function priorityStyle(p?: string) {
  if (p === "critical" || p === "recommended" || p === "optional") return PRIORITY[p];
  return PRIORITY.optional;
}

/**
 * Formats a cost range. The leading "~" is load-bearing: `is_estimate` is true
 * on these, so the UI must signal an estimate rather than a quoted price.
 */
function formatCost(cost?: Cost): string | null {
  if (!cost || (cost.low == null && cost.high == null)) return null;
  const prefix = cost.is_estimate ? "~" : "";
  if (cost.low != null && cost.high != null) return `${prefix}$${cost.low}–${cost.high}`;
  return `${prefix}$${cost.low ?? cost.high}`;
}

/** One ranked well/spring test in the plan. */
export default function TestPlanCard({ test, rank }: { test: WellTest; rank: number }) {
  const p = priorityStyle(test.priority);
  const cost = formatCost(test.estimated_cost);
  return (
    <div
      style={{
        background: HALO.panel,
        border: "1px solid rgba(255,255,255,.24)",
        borderLeft: `3px solid ${p.color}`,
        borderRadius: 18,
        padding: "13px 14px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span className="font-display" style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,.55)", minWidth: 14 }}>
            {rank}
          </span>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>{test.name}</span>
        </div>
        {test.priority && (
          <span style={{ fontSize: 8.5, letterSpacing: "1.1px", fontWeight: 600, padding: "3px 8px", borderRadius: 20, background: p.bg, border: `1px solid ${p.border}`, color: p.text, whiteSpace: "nowrap", textTransform: "uppercase" }}>
            {test.priority}
          </span>
        )}
      </div>
      {test.why && (
        <p style={{ fontSize: 11, fontWeight: 300, color: "rgba(255,255,255,.8)", lineHeight: 1.45, margin: "7px 0 0" }}>{test.why}</p>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, marginTop: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 300, color: "rgba(255,255,255,.6)", lineHeight: 1.4 }}>
          {test.where}
          {test.cadence ? ` · ${test.cadence}` : ""}
        </div>
        {cost && <div className="font-display" style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>{cost}</div>}
      </div>
    </div>
  );
}
