/**
 * The 2×2 "impact" grid that closes each subpage (Health / Environment / Daily
 * Life / Live Factor in the design). Solid cards, accent-coloured labels.
 */
export default function ImpactGrid({
  items,
  accent = "#5fd3e6",
}: {
  items: { label: string; body: string }[];
  accent?: string;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      {items.map((it) => (
        <div key={it.label} style={{ background: "#071c2e", borderRadius: 16, padding: "12px 14px" }}>
          <div style={{ fontSize: 9, letterSpacing: "1.3px", color: accent, fontWeight: 600 }}>{it.label}</div>
          <div style={{ fontSize: 11, fontWeight: 300, lineHeight: 1.5, color: "rgba(255,255,255,.85)", marginTop: 6 }}>{it.body}</div>
        </div>
      ))}
    </div>
  );
}
