"use client";

import { useEffect, useMemo, useRef } from "react";
import { motion, useMotionValue, useTransform, animate, useReducedMotion } from "motion/react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { MorphSVGPlugin } from "gsap/MorphSVGPlugin";

// registerPlugin is safe at module scope — it touches no browser APIs.
gsap.registerPlugin(useGSAP, MorphSVGPlugin);

// Shield geometry (viewBox 0 0 200 236). Water surface travels between the
// shield's inner top and its bottom point.
const SHIELD = "M100 12 C124 22 152 30 176 34 L176 108 C176 168 142 208 100 220 C58 208 24 168 24 108 L24 34 C48 30 76 22 100 12 Z";
const TOP = 16;
const BOTTOM = 214;
const SPAN = BOTTOM - TOP;
const FLOOR = 244; // filled body extends below the shield point
const W2 = 400; // wave path is double-width so a -100 (one wavelength) translate loops seamlessly

/**
 * Water hue by tier: cyan/aqua shades that deepen as the score worsens, turning
 * green only at the top ("all clear"). Not red — severity is carried by the fill
 * LEVEL (a near-empty shield reads as low protection) and by the red water
 * scorecard + subpages, so the hero stays a calm, nice-looking body of water.
 */
function waterTone(severity: string): { color: string; back: string; glow: string } {
  switch (severity) {
    case "good":
      return { color: "#35E0A1", back: "#7BEFC9", glow: "rgba(53,224,161,.5)" };
    case "moderate":
      return { color: "#2FD8E8", back: "#8DEEF6", glow: "rgba(47,216,232,.5)" };
    case "elevated":
      return { color: "#22BEDC", back: "#7CE2F0", glow: "rgba(34,190,220,.5)" };
    case "action_needed":
      return { color: "#1FA3CC", back: "#6FD4EA", glow: "rgba(31,163,204,.55)" };
    default:
      return { color: "#5AA0B4", back: "#9DCAD6", glow: "rgba(90,160,180,.45)" };
  }
}

function wavePath(sy: number, amp: number) {
  return `M0 ${sy} q 25 ${-amp} 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 L${W2} ${FLOOR} L0 ${FLOOR} Z`;
}
function linePath(sy: number, amp: number) {
  return `M0 ${sy} q 25 ${-amp} 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0 t 50 0`;
}

export default function WaterShieldScore({
  score,
  severity,
  label = "HOME SAFETY",
}: {
  score: number | null;
  severity: string;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const t = waterTone(severity);
  const hasScore = score !== null;
  const frac = hasScore ? Math.max(0, Math.min(1, score / 100)) : 0;
  const surfaceY = BOTTOM - frac * SPAN;
  const depth = BOTTOM - surfaceY;
  const showBubbles = frac > 0.25;

  // Count-up for the score number.
  const count = useMotionValue(0);
  const display = useTransform(count, (v) => String(Math.round(v)));
  useEffect(() => {
    if (!hasScore) return;
    if (reduce) {
      count.set(score);
      return;
    }
    const controls = animate(count, score, { duration: 1.2, ease: "easeOut" });
    return () => controls.stop();
  }, [score, hasScore, reduce, count]);

  // Water motion (GSAP), gated on reduced-motion. Two wave layers flow at
  // coprime speeds (so the surface never visibly repeats), over a gentle bob and
  // a slow amplitude "breathe", with a soft refraction shimmer.
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(".water", { y: SPAN + 40, duration: 1.35, ease: "power2.out" });
        gsap.to(".water-bob", { y: 3, duration: 5.3, yoyo: true, repeat: -1, ease: "sine.inOut" });

        // Seamless horizontal flow (one wavelength = 100 units). Coprime periods
        // + a phase offset on the back layer keep it from ever repeating.
        gsap.set(".wave-back", { x: -47 });
        gsap.to(".wave-back", { x: -147, duration: 15, ease: "none", repeat: -1 });
        gsap.to(".wave-body", { x: -100, duration: 9.5, ease: "none", repeat: -1 });
        gsap.to(".wave-line", { x: -100, duration: 7, ease: "none", repeat: -1 });

        // Subtle organic amplitude breathing (MorphSVG).
        gsap.to(".wave-body", { morphSVG: wavePath(surfaceY, 11), duration: 6, yoyo: true, repeat: -1, ease: "sine.inOut" });

        // Gentle refraction shimmer — kept small so it reads as water, not noise.
        const turb = ref.current?.querySelector("#waterTurb");
        if (turb) {
          const proxy = { bf: 0.009 };
          gsap.to(proxy, {
            bf: 0.013,
            duration: 11,
            repeat: -1,
            yoyo: true,
            ease: "sine.inOut",
            onUpdate: () => turb.setAttribute("baseFrequency", `${proxy.bf} ${(proxy.bf * 1.5).toFixed(4)}`),
          });
        }

        if (showBubbles) {
          gsap.utils.toArray<SVGCircleElement>(".bubble").forEach((b, i) => {
            gsap.fromTo(
              b,
              { y: 0, opacity: 0 },
              { y: -depth * 0.62 - 14, opacity: 0.4, duration: 4 + i * 0.9, repeat: -1, ease: "sine.out", delay: i * 1.6, onRepeat: () => gsap.set(b, { opacity: 0 }) }
            );
          });
        }
      });
      return () => mm.revert();
    },
    { scope: ref, dependencies: [surfaceY, depth, showBubbles, hasScore] }
  );

  const bubbles = useMemo(() => [88, 108], []);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      style={{ position: "relative", width: 200, height: 236 }}
      role="img"
      aria-label={`${label}: ${hasScore ? score : "no score"}`}
    >
      <svg viewBox="0 0 200 236" width="200" height="236" style={{ display: "block", overflow: "visible" }}>
        <defs>
          <clipPath id="shieldClip">
            <path d={SHIELD} />
          </clipPath>
          <linearGradient id="waterGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={t.color} stopOpacity="0.86" />
            <stop offset="1" stopColor={t.color} stopOpacity="0.5" />
          </linearGradient>
          <linearGradient id="sheenGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.5" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <filter id="waterShimmer" x="-6%" y="-6%" width="112%" height="112%">
            <feTurbulence id="waterTurb" type="fractalNoise" baseFrequency="0.009 0.013" numOctaves={2} seed="4" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="4" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>

        <g clipPath="url(#shieldClip)">
          {/* Empty vessel backing so the shield reads as glass even when low. */}
          <rect x="0" y="0" width="200" height="236" fill="rgba(255,255,255,.06)" />
          <g className="water">
            <g className="water-bob">
              {/* Back wave layer — a lighter crest that peeks between the front waves. */}
              <path className="wave-back" d={wavePath(surfaceY - 4, 12)} fill={t.back} fillOpacity="0.38" />
              {/* Main water body. */}
              <path className="wave-body" d={wavePath(surfaceY, 8)} fill="url(#waterGrad)" filter="url(#waterShimmer)" />
              {/* Specular sheen — light hitting the surface. */}
              <rect x="0" y={surfaceY} width={W2} height="16" fill="url(#sheenGrad)" style={{ mixBlendMode: "screen" }} opacity="0.6" />
              {/* Crisp surface line. */}
              <path className="wave-line" d={linePath(surfaceY, 8)} fill="none" stroke={t.back} strokeWidth="2" strokeOpacity="0.7" style={{ filter: `drop-shadow(0 0 5px ${t.glow})` }} />
              {showBubbles &&
                bubbles.map((x, i) => (
                  <circle key={i} className="bubble" cx={x} cy={surfaceY + depth * 0.82} r={2.2 - i * 0.4} fill="#fff" fillOpacity="0.4" />
                ))}
            </g>
          </g>
        </g>

        {/* Shield outline. */}
        <path d={SHIELD} fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="2.5" style={{ filter: `drop-shadow(0 0 8px ${t.glow})` }} />
      </svg>

      {/* Number + caption overlay (kept legible over the water). */}
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", paddingTop: 8, pointerEvents: "none" }}>
        <div style={{ position: "absolute", top: "36%", width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(circle, rgba(3,20,30,.45) 0%, transparent 68%)" }} aria-hidden="true" />
        <div className="font-display" style={{ position: "relative", fontSize: 60, fontWeight: 700, lineHeight: 1, color: "#fff", textShadow: "0 2px 10px rgba(0,20,30,.6)" }}>
          {hasScore ? <motion.span>{display}</motion.span> : "—"}
        </div>
        <div style={{ position: "relative", marginTop: 6, fontSize: 9.5, letterSpacing: "1.8px", fontWeight: 600, color: "rgba(255,255,255,.82)", textShadow: "0 1px 4px rgba(0,20,30,.6)" }}>{label}</div>
      </div>
    </motion.div>
  );
}
