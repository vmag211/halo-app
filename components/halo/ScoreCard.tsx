import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { tone } from "./tone";

/**
 * A tappable factor summary on the HomeGuard main page. Shows a plain-language
 * verdict with a severity dot (colour is never the only signal — the value text
 * carries the meaning too) and navigates into that factor's subpage.
 */
export default function ScoreCard({
  href,
  label,
  value,
  detail,
  severity,
  icon,
}: {
  href: string;
  label: string;
  value: string;
  detail?: string;
  severity: string;
  icon: ReactNode;
}) {
  const t = tone(severity);
  return (
    <Link
      href={href}
      style={{ display: "block", textDecoration: "none", color: "inherit", background: "#0f2a3c", borderRadius: 20, border: "1px solid rgba(255,255,255,.1)", padding: 16 }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 10, background: "rgba(255,255,255,.08)", color: "#fff" }}>
          {icon}
        </span>
        <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", background: t.color, boxShadow: `0 0 10px ${t.glow}` }} />
      </div>
      <div style={{ fontSize: 10, letterSpacing: "1.3px", color: "rgba(255,255,255,.6)", marginTop: 12 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 2 }}>
        <span className="font-display" style={{ fontSize: 19, fontWeight: 600, color: t.color }}>
          <span className="sr-only">{t.label}: </span>
          {value}
        </span>
        <ChevronRight size={16} aria-hidden="true" style={{ color: "rgba(255,255,255,.4)", flex: "none" }} />
      </div>
      {detail && <div style={{ fontSize: 10.5, fontWeight: 300, color: "rgba(255,255,255,.65)", marginTop: 4, lineHeight: 1.4 }}>{detail}</div>}
    </Link>
  );
}
