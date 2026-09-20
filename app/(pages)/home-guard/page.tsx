"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, Droplet, Radiation, Shield, Info, X } from "lucide-react";
import PhoneFrame from "@/components/halo/PhoneFrame";
import AuroraContours from "@/components/halo/AuroraContours";
import WaterShieldScore from "@/components/halo/WaterShieldScore";
import HomeMap from "@/components/halo/HomeMap";
import ScoreCard from "@/components/halo/ScoreCard";
import EmptyState from "@/components/halo/EmptyState";
import BottomNav from "@/components/halo/BottomNav";
import { useHomeGuard } from "@/components/halo/useHomeGuard";
import { compositeSeverity, radonSummary, waterSummary, withQuery } from "@/components/halo/homeguard";

// Vibrant teal→cyan→aqua field (the aurora + ripples layer over this).
const GRADIENT = "linear-gradient(165deg,#0d8aa6 0%,#19b4d0 42%,#0e7089 100%)";

export default function HomeGuardPage() {
  const { state, reload } = useHomeGuard();
  const [infoOpen, setInfoOpen] = useState(false);

  return (
    <PhoneFrame gradient={GRADIENT} atmosphere={<AuroraContours />}>
      <div style={{ display: "flex", minHeight: "100%", flexDirection: "column", padding: "52px 20px 124px", gap: 16 }}>
        {/* Header — title + shield emblem (protection). The score has moved to
            the centre gauge below, so the header no longer carries a badge. */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/" aria-label="Back" style={{ width: 34, height: 34, flex: "none", borderRadius: 11, background: "rgba(255,255,255,.16)", border: "1px solid rgba(255,255,255,.28)", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,.85)" }}>
            <ChevronLeft size={18} />
          </Link>
          <span style={{ width: 34, height: 34, flex: "none", borderRadius: 11, background: "rgba(255,255,255,.14)", border: "1px solid rgba(255,255,255,.26)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Shield size={18} aria-hidden="true" />
          </span>
          <div>
            <div className="font-display" style={{ fontSize: 21, fontWeight: 600, letterSpacing: ".4px", textShadow: "0 0 18px rgba(255,255,255,.3)" }}>
              HomeGuard
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 300, color: "rgba(255,255,255,.78)" }}>Your home&apos;s baseline safety</div>
          </div>
        </div>

        {state.kind === "loading" && <LoadingBody />}
        {state.kind === "no_address" && (
          <EmptyState headline="No address on file yet" body="Finish onboarding so we know which utility and county to check. Once your address is saved, your home's baseline appears here." action={{ label: "Set up my home →", href: "/" }} />
        )}
        {state.kind === "error" && <EmptyState dashed headline="Couldn't load your home data" body={state.message} action={{ label: "Retry", onClick: () => void reload() }} />}
        {state.kind === "ready" && <ReadyBody state={state} onInfo={() => setInfoOpen(true)} />}
      </div>

      {infoOpen && <ScoreInfoSheet onClose={() => setInfoOpen(false)} />}
      <BottomNav active="home" />
    </PhoneFrame>
  );
}

function ReadyBody({ state, onInfo }: { state: Extract<ReturnType<typeof useHomeGuard>["state"], { kind: "ready" }>; onInfo: () => void }) {
  const { data, params } = state;
  const score = data.score?.display_score ?? null;
  const severity = compositeSeverity(score);
  const water = waterSummary(data);
  const radon = radonSummary(data.radon);
  const locationLabel = data.water.pws_name ?? data.radon.county ?? undefined;

  return (
    <>
      {/* Centre score — a shield that fills with water to the score. */}
      <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <WaterShieldScore score={score} severity={severity} />
        <button
          type="button"
          onClick={onInfo}
          aria-label="How the home safety score is calculated"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 2, minHeight: 40, padding: "9px 16px", borderRadius: 20, background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.16)", color: "rgba(255,255,255,.85)", fontSize: 11.5, cursor: "pointer" }}
        >
          <Info size={13} aria-hidden="true" /> How is this scored?
        </button>
      </div>

      <HomeMap lat={params.lat} lng={params.lng} label={locationLabel} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <ScoreCard href={withQuery("/home-guard/water", params.raw)} label="WATER" value={water.value} detail={water.label} severity={water.severity} icon={<Droplet size={16} />} />
        <ScoreCard href={withQuery("/home-guard/radon", params.raw)} label="RADON" value={radon.value} detail={radon.label} severity={radon.severity} icon={<Radiation size={16} />} />
      </div>

      <div style={{ textAlign: "center", fontSize: 10, fontWeight: 300, color: "rgba(255,255,255,.55)", marginTop: -4 }}>
        Baseline home risk · not today&apos;s conditions. Tap a card for detail.
      </div>
    </>
  );
}

/** Plain-language explainer for the score, opened by the (i) button. */
function ScoreInfoSheet({ onClose }: { onClose: () => void }) {
  const points = [
    "It combines two things that don't change day to day: what's in your tap water (from EPA testing) and your county's radon risk.",
    "We start at 100 and take points off for each risk we find. A contaminant above its legal limit takes the most.",
    "We only count what was actually tested. Anything we couldn't check is left out — never assumed safe.",
    "It's a baseline, not today's weather. A perfect 100 isn't possible, and even a serious problem never drops it to a flat zero.",
  ];
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="How the home safety score is calculated"
      onClick={onClose}
      style={{ position: "absolute", inset: 0, zIndex: 30, background: "rgba(4,20,30,.62)", backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)", display: "flex", alignItems: "flex-end" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", background: "#0f2a3c", borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTop: "1px solid rgba(255,255,255,.14)", padding: "18px 20px 28px", boxShadow: "0 -12px 40px rgba(0,0,0,.5)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Shield size={16} aria-hidden="true" style={{ color: "#5fd3e6" }} />
            <div className="font-display" style={{ fontSize: 17, fontWeight: 600 }}>How your score works</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ width: 30, height: 30, borderRadius: 10, background: "rgba(255,255,255,.1)", border: "none", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={16} />
          </button>
        </div>
        <p style={{ fontSize: 12.5, fontWeight: 300, lineHeight: 1.55, color: "rgba(255,255,255,.85)", margin: "12px 0 4px" }}>
          It&apos;s a <strong style={{ fontWeight: 600 }}>0&ndash;100 rating of your home&apos;s baseline safety</strong> — higher is safer.
        </p>
        <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
          {points.map((p, i) => (
            <li key={i} style={{ display: "flex", gap: 9, fontSize: 11.5, fontWeight: 300, lineHeight: 1.5, color: "rgba(255,255,255,.82)" }}>
              <span aria-hidden="true" style={{ flex: "none", marginTop: 6, width: 6, height: 6, borderRadius: "50%", background: "#5fd3e6" }} />
              {p}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function LoadingBody() {
  const block = (h: number) => <div style={{ height: h, borderRadius: 20, background: "rgba(255,255,255,.08)" }} aria-hidden="true" />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }} aria-busy="true" aria-label="Loading your home data">
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div style={{ width: 200, height: 200, borderRadius: "50%", background: "rgba(255,255,255,.08)" }} aria-hidden="true" />
      </div>
      {block(150)}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {block(120)}
        {block(120)}
      </div>
    </div>
  );
}
