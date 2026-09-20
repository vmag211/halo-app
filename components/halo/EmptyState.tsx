import Link from "next/link";
import type { ReactNode } from "react";
import { HALO } from "./tone";

/**
 * The grey no-data / degraded panels. Deliberately `--halo-unknown` grey and
 * never green: "not yet reported", "no utility matched", and "lookup failed"
 * are all the absence of a result, which must never read as a clean bill of
 * health. `dashed` marks the states that are explicitly provisional.
 */
export default function EmptyState({
  headline,
  body,
  dashed = false,
  icon,
  action,
  footnote,
}: {
  headline: string;
  body: string;
  dashed?: boolean;
  icon?: ReactNode;
  action?: { label: string; href?: string; onClick?: () => void };
  footnote?: string;
}) {
  return (
    <div
      style={{
        background: "rgba(107,114,128,.16)",
        border: `1px ${dashed ? "dashed" : "solid"} ${dashed ? "rgba(255,255,255,.4)" : "rgba(255,255,255,.18)"}`,
        borderRadius: 22,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: "50%", background: HALO.unknown, flex: "none" }} />
        {icon}
        <div style={{ fontSize: 15, fontWeight: 600 }}>{headline}</div>
      </div>
      <p style={{ fontSize: 11.5, fontWeight: 300, lineHeight: 1.55, color: "rgba(255,255,255,.82)", margin: 0, textWrap: "pretty" } as React.CSSProperties}>
        {body}
      </p>
      {action &&
        (action.href ? (
          <Link
            href={action.href}
            style={{ marginTop: 4, alignSelf: "flex-start", borderRadius: 22, padding: "9px 16px", background: "rgba(255,255,255,.14)", border: "1px solid rgba(255,255,255,.3)", color: "#fff", fontSize: 12, fontWeight: 600, textDecoration: "none" }}
          >
            {action.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            style={{ marginTop: 4, alignSelf: "flex-start", borderRadius: 22, padding: "9px 16px", background: "rgba(255,255,255,.14)", border: "1px solid rgba(255,255,255,.3)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            {action.label}
          </button>
        ))}
      {footnote && <div style={{ fontSize: 10, fontWeight: 300, color: "rgba(255,255,255,.5)" }}>{footnote}</div>}
    </div>
  );
}
