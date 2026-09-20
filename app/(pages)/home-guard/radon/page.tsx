"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import PhoneFrame from "@/components/halo/PhoneFrame";
import SubpageGauge from "@/components/halo/SubpageGauge";
import DataChip from "@/components/halo/DataChip";
import StatusPill from "@/components/halo/StatusPill";
import ImpactGrid from "@/components/halo/ImpactGrid";
import EmptyState from "@/components/halo/EmptyState";
import { useHomeGuard } from "@/components/halo/useHomeGuard";
import { radonSeverity, withQuery, type Radon } from "@/components/halo/homeguard";

const GRADIENT = "linear-gradient(180deg,#241733 0%,#33224A 50%,#3E2C5E 100%)";
const ACCENT = "#b79ce8";

export default function RadonPage() {
  const { state, reload } = useHomeGuard();
  const back = state.kind === "ready" ? withQuery("/home-guard", state.params.raw) : "/home-guard";

  return (
    <PhoneFrame gradient={GRADIENT} color="#F3EEFB">
      <div style={{ display: "flex", minHeight: "100%", flexDirection: "column", padding: "52px 22px 40px", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href={back} aria-label="Back to HomeGuard" style={{ width: 34, height: 34, flex: "none", borderRadius: 11, background: "#211636", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
            <ChevronLeft size={18} />
          </Link>
          <div className="font-display" style={{ fontSize: 20, fontWeight: 600 }}>Radon</div>
        </div>

        {state.kind === "loading" && <Skeleton />}
        {state.kind === "no_address" && <EmptyState headline="No address on file yet" body="Finish onboarding so we know your county." action={{ label: "Set up my home →", href: "/" }} />}
        {state.kind === "error" && <EmptyState dashed headline="Couldn't load radon data" body={state.message} action={{ label: "Retry", onClick: () => void reload() }} />}
        {state.kind === "ready" && <Body radon={state.data.radon} />}
      </div>
    </PhoneFrame>
  );
}

function Body({ radon }: { radon: Radon }) {
  if (radon.error || radon.zone == null) {
    return <EmptyState headline="Radon zone unavailable" body={radon.error || "We don't have an EPA radon zone for this county. A home test kit is the only way to know your level."} />;
  }
  const severity = radonSeverity(radon.risk_level);
  return (
    <>
      {/* Estimate gauge — dashed ring, because this is a county zone map, not a
          measurement of this home (same honesty convention as the mould proxy). */}
      <SubpageGauge
        value={radon.risk_level ?? "—"}
        caption={`ZONE ${radon.zone} · ESTIMATE`}
        severity={severity}
        estimate
        ticks={[{ label: "Low", at: 0.15 }, { label: "Mod", at: 0.5 }, { label: "High", at: 0.85 }]}
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <DataChip label="COUNTY" value={(radon.county ?? "—").replace(/ County$/, "")} />
        <DataChip label="EPA ZONE" value={String(radon.zone)} />
        <DataChip label="ACTION LEVEL" value="4.0 pCi/L" />
      </div>

      <StatusPill text={radonVerdict(radon.risk_level)} severity={severity} />

      <div style={{ background: "rgba(255,255,255,.08)", border: "1px dashed rgba(255,255,255,.3)", borderRadius: 16, padding: "13px 15px", fontSize: 11, fontWeight: 300, lineHeight: 1.5, color: "rgba(243,238,251,.85)" }}>
        This is EPA&apos;s county zone map — an estimate, not a measurement of your home. Radon varies house to house, so a ~$15 test kit is the only way to know your actual level.
      </div>

      <ImpactGrid accent={ACCENT} items={radonImpact()} />
    </>
  );
}

function radonVerdict(level?: string): string {
  if (level === "High") return "Action needed — your county is a high-radon zone. Test your home and mitigate if it reads 4.0 pCi/L or above.";
  if (level === "Moderate") return "Moderate — a meaningful share of homes here test high. A cheap kit settles it.";
  if (level === "Low") return "Low predicted radon — but zones are county averages, and homes still test high in low zones. A test is the only certainty.";
  return "Radon risk unknown — test your home to find out.";
}

function radonImpact() {
  return [
    { label: "HEALTH", body: "Radon is the leading cause of lung cancer among people who don't smoke. Risk builds with long-term exposure, so fixing it early matters most." },
    { label: "ENVIRONMENT", body: "Radon seeps from uranium in soil and rock into the lowest level of a home. A private well can add to indoor levels." },
    { label: "DAILY LIFE", body: "A short-term kit sits in your lowest lived-in room for 2–7 days. If mitigation is needed, a vent fan runs roughly $800–1,500." },
    { label: "NEXT STEP", body: "Test regardless of zone — the map predicts county averages, not your house. Many NC county health departments hand out kits free." },
  ];
}

function Skeleton() {
  const block = (h: number) => <div style={{ height: h, borderRadius: 20, background: "rgba(255,255,255,.08)" }} aria-hidden="true" />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} aria-busy="true">
      {block(250)}
      {block(52)}
      {block(120)}
    </div>
  );
}
