import Link from "next/link";
import { Home, Bell, Settings } from "lucide-react";
import type { ReactNode } from "react";

type Tab = "today" | "home" | "alerts" | "settings";

// Four tabs, per the design: Today · Home · Alerts · Settings. (No "Community"
// tab — the build guide is explicit that it should not exist.) Only Today and
// Home resolve to built routes today; Alerts/Settings are inert until their
// screens land, rather than linking to a 404.
const TABS: { key: Tab; label: string; href?: string; icon: ReactNode }[] = [
  { key: "today", label: "Today", href: "/", icon: <TodayDot /> },
  { key: "home", label: "Home", href: "/home-guard", icon: <Home size={18} strokeWidth={2} /> },
  { key: "alerts", label: "Alerts", icon: <Bell size={18} strokeWidth={2} /> },
  { key: "settings", label: "Settings", icon: <Settings size={18} strokeWidth={2} /> },
];

function TodayDot() {
  return (
    <span
      style={{ display: "block", width: 18, height: 18, borderRadius: "50%", border: "2px solid currentColor", boxShadow: "0 0 12px rgba(143,227,176,.8)" }}
    />
  );
}

/** Frosted-glass bottom navigation (one of the two sanctioned glass surfaces). */
export default function BottomNav({ active }: { active: Tab }) {
  return (
    <nav
      aria-label="Primary"
      style={{
        position: "absolute",
        left: 22,
        right: 22,
        bottom: 22,
        height: 66,
        borderRadius: 33,
        background: "rgba(255,255,255,.12)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        border: "1px solid rgba(255,255,255,.28)",
        boxShadow: "0 10px 30px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.3)",
        display: "flex",
        justifyContent: "space-around",
        alignItems: "center",
        padding: "0 8px",
      }}
    >
      {TABS.map((t) => {
        const isActive = t.key === active;
        const inner = (
          <span
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, minWidth: 56, color: isActive ? "#fff" : "rgba(255,255,255,.5)" }}
          >
            {t.icon}
            <span style={{ fontSize: 9.5, fontWeight: isActive ? 600 : 400 }}>{t.label}</span>
          </span>
        );
        return t.href ? (
          <Link key={t.key} href={t.href} aria-current={isActive ? "page" : undefined} style={{ textDecoration: "none" }}>
            {inner}
          </Link>
        ) : (
          <span key={t.key} aria-disabled="true">
            {inner}
          </span>
        );
      })}
    </nav>
  );
}
