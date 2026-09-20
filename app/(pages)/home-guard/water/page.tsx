"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import PhoneFrame from "@/components/halo/PhoneFrame";
import SubpageGauge from "@/components/halo/SubpageGauge";
import DataChip from "@/components/halo/DataChip";
import StatusPill from "@/components/halo/StatusPill";
import QuarterlyChart from "@/components/halo/QuarterlyChart";
import ImpactGrid from "@/components/halo/ImpactGrid";
import EmptyState from "@/components/halo/EmptyState";
import TestPlanCard, { type WellTest } from "@/components/halo/TestPlanCard";
import { HALO, tone } from "@/components/halo/tone";
import { useHomeGuard } from "@/components/halo/useHomeGuard";
import { pickPrimary, pillCopy, withQuery, type HomeGuardResponse, type Water } from "@/components/halo/homeguard";

const GRADIENT = "linear-gradient(180deg,#0B2B45 0%,#0F4560 50%,#136072 100%)";

export default function WaterPage() {
  const { state, reload } = useHomeGuard();
  const back = state.kind === "ready" ? withQuery("/home-guard", state.params.raw) : "/home-guard";

  return (
    <PhoneFrame gradient={GRADIENT} atmosphere={<Drips />}>
      <div style={{ display: "flex", minHeight: "100%", flexDirection: "column", padding: "52px 22px 40px", gap: 14 }}>
        <SubHeader title="Water Quality" back={back} />
        {state.kind === "loading" && <Skeleton />}
        {state.kind === "no_address" && (
          <EmptyState headline="No address on file yet" body="Finish onboarding so we know which utility to check." action={{ label: "Set up my home →", href: "/" }} />
        )}
        {state.kind === "error" && <EmptyState dashed headline="Couldn't load water data" body={state.message} action={{ label: "Retry", onClick: () => void reload() }} />}
        {state.kind === "ready" && <Body data={state.data} raw={state.params.raw} onRetry={() => void reload()} />}
      </div>
    </PhoneFrame>
  );
}

function Body({ data, raw, onRetry }: { data: HomeGuardResponse; raw: string; onRetry: () => void }) {
  const w = data.water;
  switch (w.status) {
    case "private_well":
      return <WellPlan water={w} />;
    case "no_pwsid_available":
      return (
        <EmptyState
          headline="We couldn't match a water utility to this address"
          body="Homes outside a mapped utility service area are often on a private well. If that's you, we can build a testing plan instead of a measurement."
          action={{ label: "I'm on a well →", href: withQuery("/home-guard/water", raw ? `${raw}&water_source=well` : "?water_source=well") }}
        />
      );
    case "no_data_yet":
      return <EmptyState dashed headline="No test results yet for this utility" body="EPA's nationwide testing program is about two-thirds complete. Your utility hasn't reported results yet — this is not the same as a clean result." />;
    case "lookup_failed":
      return <EmptyState dashed headline="Couldn't load water data right now" body="This is a temporary problem on our side, not a finding about your water." action={{ label: "Retry", onClick: onRetry }} />;
    default:
      break;
  }

  const hasScored = (w.scored_contaminants ?? []).length > 0;
  const hasDetections = hasScored || (w.detected_unregulated ?? []).length > 0;
  if (!hasDetections && (w.excluded_from_score ?? []).length === 0) return <Clean water={w} />;

  return <Detections data={data} />;
}

function Detections({ data }: { data: HomeGuardResponse }) {
  const w = data.water;
  const primary = pickPrimary(w);
  const box = (data.breakdown ?? []).find((b) => b.key === "water");
  const severity = box?.status ?? "unknown";
  const ratio = primary?.peakRatio ?? null;

  return (
    <>
      {ratio !== null ? (
        <SubpageGauge
          value={`${ratio.toFixed(1)}×`}
          caption="PEAK vs LIMIT"
          severity={severity}
          fraction={Math.min(ratio, 2.5) / 2.5}
          ticks={[{ label: "1×", at: 1 / 2.5 }, { label: "2×", at: 2 / 2.5 }]}
        />
      ) : (
        <EmptyState headline="Detected — not scoreable" body={w.message || "The compounds found here have no enforceable federal limit or published benchmark, so they can't be scored against one. Detected is not the same as safe."} />
      )}

      <div style={{ display: "grid", gridTemplateColumns: primary ? "auto 1fr auto" : "1fr", gap: 10 }}>
        {primary && <DataChip label="COMPOUND" value={primary.name} />}
        {w.pws_name && <DataChip label="UTILITY" value={w.pws_name} />}
        {ratio !== null && <DataChip label="VS LIMIT" value={`up to ${ratio.toFixed(1)}×`} accent={tone(severity).color} />}
      </div>

      <StatusPill text={pillCopy(severity, primary?.name, w.coverage)} severity={severity} />

      {primary && primary.readings.length > 0 && <QuarterlyChart readings={primary.readings} limit={primary.limit} contaminant={primary.name} />}

      {w.regulatory_notice && (
        <div style={{ fontSize: 10.5, fontWeight: 300, color: "rgba(255,255,255,.72)", lineHeight: 1.45 }}>{w.regulatory_notice}</div>
      )}

      <UnregulatedExcluded water={w} />

      <ImpactGrid items={waterImpact(w, primary?.name)} />
      <Freshness water={w} />
    </>
  );
}

function Clean({ water }: { water: Water }) {
  return (
    <>
      <div style={{ background: HALO.panel, borderRadius: 22, padding: "26px 18px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
        <div style={{ width: 56, height: 56, borderRadius: "50% 50% 50% 6px", transform: "rotate(-45deg)", background: HALO.good, boxShadow: "0 0 26px rgba(74,222,155,.5)" }} aria-hidden="true" />
        <div style={{ fontSize: 17, fontWeight: 600 }}>No regulated contaminants detected</div>
        <div style={{ fontSize: 11.5, fontWeight: 300, color: "rgba(255,255,255,.8)" }}>
          {water.latest_sample_date ? `Last tested ${water.latest_sample_date}` : "Last tested date unavailable"}
          {water.pws_name ? ` · ${water.pws_name}` : ""}
        </div>
        <div style={{ fontSize: 10.5, fontWeight: 300, color: "rgba(255,255,255,.6)" }}>Tested for 29 PFAS compounds and lithium under EPA UCMR5.</div>
      </div>
      <UnregulatedExcluded water={water} />
      <ImpactGrid items={waterImpact(water)} />
      <Freshness water={water} />
    </>
  );
}

function WellPlan({ water }: { water: Water }) {
  const tests = water.test_plan?.tests ?? [];
  const source = water.source_type === "spring" ? "spring" : "well";
  const cost = (f: (t: WellTest) => boolean) => {
    const p = tests.filter(f);
    return { low: p.reduce((s, t) => s + (t.estimated_cost?.low ?? 0), 0), high: p.reduce((s, t) => s + (t.estimated_cost?.high ?? 0), 0) };
  };
  const start = cost((t) => t.priority === "critical");
  const full = cost(() => true);
  return (
    <>
      <div style={{ border: "1px dashed rgba(255,255,255,.4)", borderRadius: 22, padding: 16, background: "rgba(107,114,128,.14)" }}>
        <div className="font-display" style={{ fontSize: 16, fontWeight: 600 }}>No score available</div>
        <p style={{ fontSize: 11.5, fontWeight: 300, lineHeight: 1.5, color: "rgba(255,255,255,.82)", margin: "6px 0 0" }}>
          {water.message || `Private ${source}s aren't covered by the Safe Drinking Water Act. No agency tests this water — you're the only person who can find out what's in it.`}
        </p>
      </div>
      <div style={{ fontSize: 9.5, letterSpacing: "1.6px", fontWeight: 600, color: "rgba(255,255,255,.6)" }}>YOUR TESTING PLAN</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {tests.map((t, i) => (
          <TestPlanCard key={t.id ?? i} test={t} rank={t.rank ?? i + 1} />
        ))}
      </div>
      {(full.low > 0 || full.high > 0) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(255,255,255,.17)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", border: "1px solid rgba(255,255,255,.3)", borderRadius: 22, padding: "14px 16px" }}>
          <div>
            <div style={{ fontSize: 9.5, letterSpacing: "1.4px", color: "rgba(255,255,255,.6)" }}>START HERE</div>
            <div className="font-display" style={{ fontSize: 22, fontWeight: 600 }}>~${start.low}–{start.high}</div>
          </div>
          <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,.2)" }} />
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9.5, letterSpacing: "1.4px", color: "rgba(255,255,255,.6)" }}>FULL PANEL</div>
            <div className="font-display" style={{ fontSize: 22, fontWeight: 600, color: "rgba(255,255,255,.85)" }}>~${full.low}–{full.high}</div>
          </div>
        </div>
      )}
      <div style={{ fontSize: 9.5, fontWeight: 300, color: "rgba(255,255,255,.5)", textAlign: "center" }}>Costs are estimates, not verified quotes.</div>
    </>
  );
}

function UnregulatedExcluded({ water }: { water: Water }) {
  const unreg = water.detected_unregulated ?? [];
  const excl = water.excluded_from_score ?? [];
  if (unreg.length === 0 && excl.length === 0) return null;
  return (
    <div style={{ background: "rgba(107,114,128,.16)", border: "1px solid rgba(255,255,255,.16)", borderRadius: 18, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,.85)" }}>Also detected — no federal limit</div>
      {excl.map((e) => (
        <div key={e.contaminant} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, textTransform: "capitalize" }}>{e.contaminant}</span>
            <span className="font-display" style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>{(e.value_ppt / 1000).toLocaleString()} µg/L</span>
          </div>
          <div style={{ fontSize: 10, fontWeight: 300, color: "rgba(255,255,255,.7)", lineHeight: 1.45 }}>{e.reason}</div>
          {typeof e.health_reference_level_ppt === "number" && (
            <div style={{ fontSize: 9.5, color: "rgba(255,255,255,.55)" }}>Non-binding reference level: {(e.health_reference_level_ppt / 1000).toLocaleString()} µg/L (not an EPA limit)</div>
          )}
        </div>
      ))}
      {unreg.length > 0 && (
        <div style={{ fontSize: 10.5, fontWeight: 300, color: "rgba(255,255,255,.7)", lineHeight: 1.45 }}>
          {unreg.join(", ")} detected with no enforceable limit or published benchmark — real, but not scoreable. Detected is not the same as safe.
        </div>
      )}
    </div>
  );
}

function Freshness({ water }: { water: Water }) {
  if (!water.latest_sample_date) return null;
  return <div style={{ textAlign: "center", fontSize: 9.5, fontWeight: 300, color: "rgba(255,255,255,.5)" }}>Last checked {water.latest_sample_date} · EPA UCMR5</div>;
}

function waterImpact(water: Water, primary?: string) {
  const name = primary ?? "PFAS";
  const clean = (water.scored_contaminants ?? []).length === 0 && (water.detected_unregulated ?? []).length === 0;
  return [
    { label: "HEALTH", body: clean ? "Nothing regulated was detected this cycle. A carbon or reverse-osmosis filter still adds margin." : `${name} builds up in the body over years. A certified NSF/ANSI 53 filter at the tap removes most of it.` },
    { label: "ENVIRONMENT", body: "PFAS don't break down in the environment, so tap levels track the source water rather than fluctuating day to day." },
    { label: "DAILY LIFE", body: "Boiling doesn't remove PFAS. Use filtered water for drinking, cooking, and especially infant formula." },
    { label: "NEXT CHECK", body: water.latest_sample_date ? `Last sampled ${water.latest_sample_date}. UCMR5 sampling runs quarterly through 2025.` : "UCMR5 sampling runs quarterly through 2025." },
  ];
}

// ── chrome ──
function SubHeader({ title, back }: { title: string; back: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <Link href={back} aria-label="Back to HomeGuard" style={{ width: 34, height: 34, flex: "none", borderRadius: 11, background: "#071c2e", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
        <ChevronLeft size={18} />
      </Link>
      <div className="font-display" style={{ fontSize: 20, fontWeight: 600 }}>{title}</div>
    </div>
  );
}

function Skeleton() {
  const block = (h: number) => <div style={{ height: h, borderRadius: 20, background: "rgba(255,255,255,.08)" }} aria-hidden="true" />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} aria-busy="true">
      {block(250)}
      {block(52)}
      {block(180)}
    </div>
  );
}

function Drips() {
  const drips = [
    { left: "12%", top: "22%", w: 6, h: 9 },
    { left: "82%", top: "16%", w: 5, h: 8 },
    { left: "68%", top: "40%", w: 7, h: 11 },
    { left: "24%", top: "58%", w: 5, h: 8 },
    { left: "88%", top: "62%", w: 6, h: 9 },
  ];
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {drips.map((d, i) => (
        <div key={i} style={{ position: "absolute", left: d.left, top: d.top, width: d.w, height: d.h, borderRadius: "50% 50% 50% 50% / 60% 60% 40% 40%", background: "radial-gradient(circle at 35% 30%,rgba(255,255,255,.6),rgba(255,255,255,.1) 60%)" }} />
      ))}
    </div>
  );
}
