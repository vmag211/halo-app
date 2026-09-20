import { tone } from "./tone";

/**
 * A circular score gauge: a track ring with a progress arc whose length is the
 * score (0–100, higher = better/safer) and whose colour is the risk tier. The
 * frosted centre disk is one of the two sanctioned glass surfaces.
 *
 * A `null` score renders an em-dash on a flat grey track — never a full or
 * green ring — because "no score" is not "a good score".
 *
 * On HomeGuard this is used small (a badge), because the quarterly chart is the
 * hero, not the number.
 */
export default function ScoreGauge({
  score,
  severity,
  label,
  sublabel,
  size = 186,
}: {
  score: number | null;
  severity: string;
  label?: string;
  sublabel?: string;
  size?: number;
}) {
  const t = tone(severity);
  const compact = size < 110;
  const stroke = Math.max(6, Math.round(size * 0.055));
  const r = size / 2 - stroke;
  const c = 2 * Math.PI * r;
  const frac = score === null ? 0 : Math.max(0, Math.min(1, score / 100));
  const hasScore = score !== null;
  const ringColor = hasScore ? t.color : HALO_TRACK;

  return (
    <div style={{ position: "relative", width: size, height: size }} role="img" aria-label={label ? `${label}: ${hasScore ? score : "no score"}` : undefined}>
      <svg viewBox={`0 0 ${size} ${size}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} fill="none">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,.13)" strokeWidth={stroke} />
        {hasScore && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={ringColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${frac * c} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ filter: `drop-shadow(0 0 8px ${t.glow})` }}
          />
        )}
      </svg>
      {/* Frosted centre disk. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%,-50%)",
          width: size - stroke * 2 - Math.round(size * 0.06),
          height: size - stroke * 2 - Math.round(size * 0.06),
          borderRadius: "50%",
          background: "rgba(255,255,255,.15)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          border: "1px solid rgba(255,255,255,.3)",
          boxShadow: "0 14px 40px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.35)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 2,
          textAlign: "center",
          padding: 4,
        }}
      >
        <div className="font-display" style={{ fontSize: compact ? size * 0.4 : size * 0.32, fontWeight: 700, lineHeight: 1, textShadow: "0 0 22px rgba(255,255,255,.45)" }}>
          {hasScore ? score : "—"}
        </div>
        {label && !compact && (
          <div style={{ fontSize: 9.5, letterSpacing: "1.6px", fontWeight: 500, color: "rgba(255,255,255,.72)", marginTop: 4 }}>{label}</div>
        )}
        {sublabel && !compact && (
          <div style={{ fontSize: 10.5, fontWeight: 500, color: hasScore ? t.color : "rgba(255,255,255,.6)", marginTop: 2 }}>{sublabel}</div>
        )}
      </div>
    </div>
  );
}

const HALO_TRACK = "rgba(255,255,255,.35)";
