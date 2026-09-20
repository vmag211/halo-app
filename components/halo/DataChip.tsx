/**
 * A small solid quick-glance chip: a letterspaced caption over a value. Used
 * for the row of facts under a hero (contaminant, utility, ratio-to-limit …).
 */
export default function DataChip({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  /** Optional colour for the value, e.g. a risk tier. Defaults to white. */
  accent?: string;
}) {
  return (
    <div style={{ background: "#071c2e", borderRadius: 14, padding: "10px 12px" }}>
      <div style={{ fontSize: 9, letterSpacing: "1px", color: "rgba(255,255,255,.6)" }}>
        {label}
      </div>
      <div
        className="font-display"
        style={{ fontSize: 15, fontWeight: 700, marginTop: 3, color: accent ?? "#fff", whiteSpace: "nowrap" }}
      >
        {value}
      </div>
    </div>
  );
}
