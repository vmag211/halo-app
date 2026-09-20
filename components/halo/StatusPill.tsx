import { tone } from "./tone";

/**
 * A solid, plain-language verdict bar. The severity drives the colour, but the
 * pill also carries a filled dot and the verdict text, so the meaning never
 * rests on colour alone (a colourblind or screen-reader user gets the same
 * information — see the accessibility rules in the build guide).
 */
export default function StatusPill({
  text,
  severity,
}: {
  text: string;
  severity: string;
}) {
  const t = tone(severity);
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        borderRadius: 26,
        padding: "13px 16px",
        background: `linear-gradient(150deg, ${t.color}38, ${t.color}14)`,
        border: `1px solid ${t.color}66`,
      }}
    >
      <span
        aria-hidden="true"
        style={{ width: 9, height: 9, flex: "none", borderRadius: "50%", background: t.color, boxShadow: `0 0 10px ${t.glow}` }}
      />
      <span style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.35 }}>
        {/* Screen-reader prefix so the tier is announced, not just shown. */}
        <span className="sr-only">{t.label}: </span>
        {text}
      </span>
    </div>
  );
}
