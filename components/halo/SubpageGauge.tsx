import { tone } from "./tone";

const SIZE = 250;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 88;
const C = 2 * Math.PI * R;
const SWEEP = 270; // degrees; a 90° gap at the bottom
const START = 135; // screen-degrees (clockwise from east); 135° = lower-left

function pointAt(r: number, angleDeg: number): [number, number] {
  const a = (angleDeg * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

/**
 * The subpage hero gauge: a 270° arc with real tick marks at real thresholds
 * and a frosted centre disk. `estimate` renders the ring dashed and fills the
 * whole sweep — the convention (borrowed from the Mold proxy) for a value that
 * is inferred, like a county radon zone, rather than measured at this home.
 */
export default function SubpageGauge({
  value,
  caption,
  severity,
  fraction = 1,
  ticks = [],
  estimate = false,
}: {
  value: string;
  caption: string;
  severity: string;
  fraction?: number;
  /** Tick marks at explicit positions along the arc (`at` ∈ [0,1]). */
  ticks?: { label: string; at: number }[];
  estimate?: boolean;
}) {
  const t = tone(severity);
  const frac = Math.max(0, Math.min(1, fraction));
  const trackLen = (SWEEP / 360) * C;
  const progressLen = estimate ? trackLen : frac * trackLen;

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "2px 0" }}>
      <div style={{ position: "relative", width: SIZE, height: SIZE }} role="img" aria-label={`${caption}: ${value}`}>
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} fill="none">
          {/* Track */}
          <circle cx={CX} cy={CY} r={R} stroke="rgba(255,255,255,.16)" strokeWidth={10} strokeDasharray={`${trackLen} ${C}`} transform={`rotate(${START} ${CX} ${CY})`} strokeLinecap="round" />
          {/* Progress / estimate arc */}
          <circle
            cx={CX}
            cy={CY}
            r={R}
            stroke={t.color}
            strokeWidth={estimate ? 8 : 10}
            strokeDasharray={estimate ? "7 6" : `${progressLen} ${C}`}
            transform={`rotate(${START} ${CX} ${CY})`}
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 8px ${t.glow})` }}
          />
          {/* Tick marks + labels at real thresholds. */}
          {ticks.map((tick) => {
            const angle = START + Math.max(0, Math.min(1, tick.at)) * SWEEP;
            const [x1, y1] = pointAt(R + 8, angle);
            const [x2, y2] = pointAt(R + 15, angle);
            const [lx, ly] = pointAt(R + 26, angle);
            return (
              <g key={tick.label}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,.6)" strokeWidth={1.5} />
                <text x={lx} y={ly + 3} textAnchor="middle" fill="rgba(255,255,255,.7)" fontFamily="Poppins,sans-serif" fontSize={8.5}>
                  {tick.label}
                </text>
              </g>
            );
          })}
        </svg>
        {/* Frosted centre disk. */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%,-50%)",
            width: 132,
            height: 132,
            borderRadius: "50%",
            background: "rgba(255,255,255,.14)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            border: `1px ${estimate ? "dashed" : "solid"} rgba(255,255,255,.35)`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: 8,
          }}
        >
          <div className="font-display" style={{ fontSize: value.length > 5 ? 30 : 46, fontWeight: 700, lineHeight: 1, textShadow: "0 0 22px rgba(255,255,255,.45)" }}>
            {value}
          </div>
          <div style={{ fontSize: 9, letterSpacing: "1.5px", fontWeight: 500, color: t.color, marginTop: 5 }}>{caption}</div>
        </div>
      </div>
    </div>
  );
}
