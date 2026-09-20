import { HALO } from "./tone";

type Reading = { date?: string | null; value_ppt: number };

/**
 * The HomeGuard hero: quarterly contaminant readings as hand-rolled SVG bars,
 * with a dashed line at the enforceable limit. Bars at or above the limit are
 * rendered in the "high" tier; bars below in "good". This is the evidence the
 * page is built around — a parent seeing four bars breach a red line should
 * understand the situation without reading the score.
 *
 * Reads the full reading history (pass `water.contaminants[NAME]`), NOT the
 * single most-recent value the API keeps in `scored_contaminants`.
 *
 * A visually-hidden summary makes the same facts available to screen readers,
 * per the build guide's requirement that charts carry a text alternative.
 */
export default function QuarterlyChart({
  readings,
  limit,
  contaminant,
  unit = "ppt",
}: {
  readings: Reading[];
  limit: number;
  contaminant: string;
  unit?: string;
}) {
  // Sort oldest → newest. M/D/YYYY parses fine via Date; unparseable dates sink
  // to the front deterministically rather than throwing.
  const sorted = [...readings]
    .filter((r) => typeof r.value_ppt === "number" && Number.isFinite(r.value_ppt))
    .sort((a, b) => timeOf(a.date) - timeOf(b.date));

  if (sorted.length === 0) return null;

  const W = 320;
  const H = 188;
  // Left gutter holds the limit value so it never sits behind a bar.
  const padL = 30;
  const padR = 8;
  const padTop = 22;
  const padBottom = 30;
  const plotW = W - padL - padR;
  const plotH = H - padTop - padBottom;
  const yMax = Math.max(limit, ...sorted.map((r) => r.value_ppt)) * 1.28;
  const y = (v: number) => padTop + plotH * (1 - v / yMax);

  const n = sorted.length;
  const slot = plotW / n;
  const barW = Math.min(46, slot * 0.5);
  const limitY = y(limit);
  const exceedCount = sorted.filter((r) => r.value_ppt > limit).length;

  const summary = `${contaminant}: ${sorted.length} quarterly ${sorted.length === 1 ? "reading" : "readings"} of ${sorted
    .map((r) => `${r.value_ppt} ${unit}`)
    .join(", ")}${sorted[0]?.date ? ` from ${sorted[0].date} to ${sorted[n - 1].date}` : ""}. EPA legal limit is ${limit} ${unit}. ${exceedCount} of ${sorted.length} exceed the limit.`;

  return (
    <div style={{ background: HALO.panel, borderRadius: 22, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{contaminant} · quarterly readings</div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,.6)" }}>{unit}</div>
      </div>

      {/* Legend — labels the dashed line without overlapping the bars. */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6, fontSize: 10, color: HALO.high, fontWeight: 600 }}>
        <span aria-hidden="true" style={{ width: 20, height: 0, borderTop: `1.5px dashed ${HALO.high}` }} />
        EPA legal limit {limit} {unit}
      </div>

      <p className="sr-only">{summary}</p>

      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} style={{ width: "100%", height: "auto", marginTop: 8, display: "block" }}>
        {/* Dashed legal-limit line, with the value tucked in the left gutter. */}
        <line x1={padL} y1={limitY} x2={W - padR} y2={limitY} stroke={HALO.high} strokeWidth={1.2} strokeDasharray="4 4" />
        <text x={2} y={limitY + 3.5} fill={HALO.high} fontFamily="Poppins,sans-serif" fontSize={9} fontWeight={700}>
          {limit}
        </text>

        {sorted.map((r, i) => {
          const cx = padL + slot * i + slot / 2;
          const over = r.value_ppt > limit;
          const top = y(r.value_ppt);
          const barH = padTop + plotH - top;
          const fill = over ? HALO.high : HALO.good;
          return (
            <g key={`${r.date}-${i}`}>
              <rect x={cx - barW / 2} y={top} width={barW} height={Math.max(2, barH)} rx={5} fill={fill} style={over ? { filter: "drop-shadow(0 0 10px rgba(224,71,63,.5))" } : undefined} />
              <text x={cx} y={top - 6} textAnchor="middle" className="font-display" fill="#fff" fontSize={11} fontWeight={700}>
                {r.value_ppt}
              </text>
              <text x={cx} y={H - 12} textAnchor="middle" fill="rgba(255,255,255,.65)" fontFamily="Poppins,sans-serif" fontSize={9}>
                {quarterLabel(r.date)}
              </text>
            </g>
          );
        })}
      </svg>

      {exceedCount > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4, fontSize: 10.5, color: "#ffb0a0" }}>
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: HALO.high }} />
          {exceedCount === sorted.length
            ? `All ${sorted.length} quarters exceed the legal limit`
            : `${exceedCount} of ${sorted.length} quarters exceed the legal limit`}
        </div>
      )}
    </div>
  );
}

function timeOf(date?: string | null): number {
  if (!date) return -Infinity;
  const t = Date.parse(date);
  return Number.isNaN(t) ? -Infinity : t;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function quarterLabel(date?: string | null): string {
  if (!date) return "—";
  const t = Date.parse(date);
  if (Number.isNaN(t)) return "—";
  const d = new Date(t);
  return `${MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
}
