'use client';

import { useState, useRef, useEffect } from "react";
import { MapPin, Navigation, ChevronDown } from "lucide-react";

const WATER_SOURCES = ["City utility", "Well", "Spring", "Other"];

/* ─────────────────────────────────────────────
   Aurora blob gradient + plexus rendered on two
   stacked canvases so the network is composited
   independently from the color field.
───────────────────────────────────────────── */

function useAuroraCanvas(ref: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let animId = 0;
    let t = 0;

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
    };
    resize();
    window.addEventListener("resize", resize);

    // Five liquid-drifting color blobs that mix fluidly
    const blobs = [
      { baseX: 0.20, baseY: 0.20, r: 0.70, color: [32, 178, 170],  phaseX: 0,    phaseY: 0,    speed: 0.00035 },
      { baseX: 0.75, baseY: 0.25, r: 0.75, color: [56, 189, 248],  phaseX: 1.2,  phaseY: 2.1,  speed: 0.00032 },
      { baseX: 0.45, baseY: 0.55, r: 0.65, color: [110, 231, 183], phaseX: 2.4,  phaseY: 0.7,  speed: 0.00028 },
      { baseX: 0.80, baseY: 0.80, r: 0.60, color: [56, 189, 248],  phaseX: 3.7,  phaseY: 1.5,  speed: 0.00038 },
      { baseX: 0.25, baseY: 0.75, r: 0.55, color: [52, 211, 153],  phaseX: 0.9,  phaseY: 3.2,  speed: 0.00030 },
    ];

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;

      // Deep teal-blue base
      ctx.fillStyle = "#0d4a5e";
      ctx.fillRect(0, 0, w, h);

      // Liquid fluid blending (Screen mode allows soft translucent color mixing)
      ctx.globalCompositeOperation = "screen";

      blobs.forEach((b) => {
        // Slow water-like movement matching plexus pace
        const driftX = Math.sin(t * b.speed + b.phaseX) * 0.25 + Math.cos(t * b.speed * 0.5 + b.phaseY) * 0.10;
        const driftY = Math.cos(t * b.speed + b.phaseY) * 0.25 + Math.sin(t * b.speed * 0.5 + b.phaseX) * 0.10;
        
        const cx = (b.baseX + driftX) * w;
        const cy = (b.baseY + driftY) * h;
        const radius = b.r * Math.max(w, h);

        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        const [r, g, bl] = b.color;
        grad.addColorStop(0,   `rgba(${r},${g},${bl},0.65)`);
        grad.addColorStop(0.4, `rgba(${r},${g},${bl},0.35)`);
        grad.addColorStop(0.8, `rgba(${r},${g},${bl},0.10)`);
        grad.addColorStop(1,   `rgba(${r},${g},${bl},0)`);

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      });

      ctx.globalCompositeOperation = "source-over";

      t += 16;
      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, [ref]);
}

function usePlexusCanvas(ref: React.RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let animId = 0;

    const NODE_COUNT = 25;
    const MAX_DIST_FRAC = 0.34;
    const SPEED_PX = 0.35;

    interface FracNode { fx: number; fy: number; vx: number; vy: number; }
    const fnodes: FracNode[] = Array.from({ length: NODE_COUNT }, () => ({
      fx: Math.random(),
      fy: Math.random(),
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2,
    }));

    fnodes.forEach((n) => {
      const mag = Math.sqrt(n.vx * n.vx + n.vy * n.vy) || 1;
      n.vx /= mag;
      n.vy /= mag;
    });

    const resize = () => {
      canvas.width  = canvas.offsetWidth  * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      const w   = canvas.width;
      const h   = canvas.height;
      const dpr = window.devicePixelRatio || 1;
      const diag = Math.sqrt(w * w + h * h);
      const maxDist = MAX_DIST_FRAC * diag;
      const speed   = SPEED_PX * dpr;

      ctx.clearRect(0, 0, w, h);

      fnodes.forEach((n) => {
        n.fx += (n.vx * speed) / w;
        n.fy += (n.vy * speed) / h;
        if (n.fx <= 0) { n.fx = 0;  n.vx =  Math.abs(n.vx); }
        if (n.fx >= 1) { n.fx = 1;  n.vx = -Math.abs(n.vx); }
        if (n.fy <= 0) { n.fy = 0;  n.vy =  Math.abs(n.vy); }
        if (n.fy >= 1) { n.fy = 1;  n.vy = -Math.abs(n.vy); }
      });

      const px = fnodes.map((n) => ({ x: n.fx * w, y: n.fy * h }));

      ctx.lineWidth = 0.9 * dpr;
      for (let i = 0; i < px.length; i++) {
        for (let j = i + 1; j < px.length; j++) {
          const dx = px[i].x - px[j].x;
          const dy = px[i].y - px[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < maxDist) {
            const alpha = (1 - dist / maxDist) * 0.58;
            ctx.beginPath();
            ctx.moveTo(px[i].x, px[i].y);
            ctx.lineTo(px[j].x, px[j].y);
            ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
            ctx.stroke();
          }
        }
      }

      px.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.2 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.84)";
        ctx.fill();
      });

      animId = requestAnimationFrame(draw);
    };

    animId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, [ref]);
}

/* ─────────────────────────────────────────────
   Main component
───────────────────────────────────────────── */

export default function OnboardingScreen() {
  const [address, setAddress]         = useState("");
  const [buildYear, setBuildYear]     = useState("");
  const [waterSource, setWaterSource] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [gpsPulse, setGpsPulse]       = useState(false);

  const auroraRef  = useRef<HTMLCanvasElement>(null);
  const plexusRef  = useRef<HTMLCanvasElement>(null);

  useAuroraCanvas(auroraRef);
  usePlexusCanvas(plexusRef);

  const handleGPS = () => {
    setGpsPulse(true);
    setTimeout(() => setGpsPulse(false), 600);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        () => setAddress("Current location detected"),
        () => setAddress("123 Maple Street, Austin TX 78701")
      );
    } else {
      setAddress("123 Maple Street, Austin TX 78701");
    }
  };

  const currentYear = new Date().getFullYear();
  const yearValid =
    buildYear === "" ||
    (Number(buildYear) >= 1800 && Number(buildYear) <= currentYear);

  return (
    <div
      className="size-full min-h-screen flex items-center justify-center bg-slate-900"
      style={{ fontFamily: "'DM Sans', sans-serif" }}
    >
      {/* Phone Shell */}
      <div
        className="relative w-[390px] h-[844px] overflow-hidden"
        style={{ borderRadius: 44, boxShadow: "0 32px 80px rgba(0,0,0,0.5)" }}
      >
        {/* Layer 0 — Liquid Aurora Gradient */}
        <canvas
          ref={auroraRef}
          className="absolute inset-0 w-full h-full"
          style={{ zIndex: 0 }}
        />

        {/* Layer 1 — Plexus Network */}
        <canvas
          ref={plexusRef}
          className="absolute inset-0 w-full h-full"
          style={{ zIndex: 1 }}
        />

        {/* Layer 2 — Vignette */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            zIndex: 2,
            background: "linear-gradient(180deg, rgba(0,0,0,0.04) 0%, rgba(0,0,0,0.18) 100%)",
          }}
        />

        {/* Layer 3 — Scrollable Content */}
        <div
          className="absolute inset-0 overflow-y-auto"
          style={{ scrollbarWidth: "none", zIndex: 3 }}
        >
          <div className="flex flex-col min-h-full px-7 pt-14 pb-12">

            {/* Logo Block */}
            <div className="flex flex-col items-center mb-9">
              {/* Ambient Background Glow */}
              <div
                className="absolute pointer-events-none"
                style={{
                  width: 224,
                  height: 158,
                  top: 26,
                  borderRadius: "50%",
                  background: "radial-gradient(ellipse, rgba(255,255,255,0.48) 0%, rgba(255,255,255,0) 70%)",
                  filter: "blur(26px)",
                }}
              />

              {/* Logo Icon with Whitish Glow */}
              <div className="relative mb-3 flex items-center justify-center" style={{ width: 115, height: 115 }}>
                <img
                  src="/finallogo.png"
                  alt="HALO circular badge"
                  className="w-full h-full object-contain"
                  style={{
                    filter: "drop-shadow(0 0 16px rgba(255, 255, 255, 0.75)) drop-shadow(0 4px 18px rgba(0,0,0,0.22))"
                  }}
                />
              </div>

              {/* HALO Text with Whitish Glow */}
              <h1
                style={{
                  fontFamily: "'Quicksand', sans-serif",
                  fontWeight: 700,
                  fontSize: 38,
                  letterSpacing: "0.22em",
                  color: "white",
                  filter: "drop-shadow(0 0 14px rgba(255, 255, 255, 0.7))",
                  textShadow: "0 2px 16px rgba(0,0,0,0.20)",
                  lineHeight: 1,
                  marginBottom: 7,
                }}
              >
                HALO
              </h1>

              {/* Subtext with Whitish Glow */}
              <p
                style={{
                  fontFamily: "'Quicksand', sans-serif",
                  fontWeight: 500,
                  color: "rgba(255,255,255,0.92)",
                  fontSize: 13.5,
                  letterSpacing: "0.02em",
                  textAlign: "center",
                  filter: "drop-shadow(0 0 8px rgba(255, 255, 255, 0.5))",
                  textShadow: "0 1px 8px rgba(0,0,0,0.15)",
                }}
              >
                Know what surrounds your family.
              </p>
            </div>

            {/* Glassform Card with Glowing Ambient Outline */}
            <div
              className="flex flex-col gap-5 flex-1"
              style={{
                background: "rgba(255,255,255,0.26)",
                backdropFilter: "blur(18px)",
                WebkitBackdropFilter: "blur(18px)",
                borderRadius: 28,
                border: "1px solid rgba(255,255,255,0.5)",
                boxShadow: "0 0 24px rgba(255, 255, 255, 0.25), 0 6px 32px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.35)",
                padding: "26px 22px 22px",
              }}
            >
              <p
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  color: "rgba(255,255,255,0.92)",
                  fontSize: 15,
                  fontWeight: 500,
                  marginBottom: 2,
                }}
              >
                Tell us about your home
              </p>

              {/* Address */}
              <div className="flex flex-col gap-1.5">
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    letterSpacing: "0.07em",
                    color: "rgba(255,255,255,0.62)",
                    textTransform: "uppercase",
                  }}
                >
                  Home address
                </label>
                <div
                  className="flex items-center gap-2.5"
                  style={{
                    background: "rgba(255,255,255,0.14)",
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.25)",
                    padding: "0 12px",
                    height: 52,
                  }}
                >
                  <MapPin size={17} color="rgba(255,255,255,0.60)" strokeWidth={2} />
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="123 Maple Street, City, State"
                    className="flex-1 bg-transparent outline-none min-w-0"
                    style={{
                      color: "white",
                      fontSize: 14,
                      fontFamily: "'DM Sans', sans-serif",
                      caretColor: "white",
                    }}
                  />
                  <button
                    onClick={handleGPS}
                    className="flex-shrink-0 flex items-center justify-center"
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 10,
                      background: gpsPulse ? "rgba(255,255,255,0.32)" : "rgba(255,255,255,0.16)",
                      border: "1px solid rgba(255,255,255,0.28)",
                      transition: "background 0.2s",
                      cursor: "pointer",
                    }}
                    aria-label="Use my location"
                  >
                    <Navigation size={14} color="white" strokeWidth={2} />
                  </button>
                </div>
              </div>

              {/* Build Year */}
              <div className="flex flex-col gap-1.5">
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    letterSpacing: "0.07em",
                    color: "rgba(255,255,255,0.62)",
                    textTransform: "uppercase",
                  }}
                >
                  Home build year
                </label>
                <div
                  style={{
                    background: "rgba(255,255,255,0.14)",
                    borderRadius: 16,
                    border: `1px solid ${!yearValid ? "rgba(255,160,120,0.65)" : "rgba(255,255,255,0.25)"}`,
                    padding: "0 16px",
                    height: 52,
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <input
                    type="number"
                    value={buildYear}
                    onChange={(e) => setBuildYear(e.target.value)}
                    placeholder="e.g. 1998"
                    min={1800}
                    max={currentYear}
                    className="w-full bg-transparent outline-none"
                    style={{
                      color: "white",
                      fontSize: 14,
                      fontFamily: "'DM Sans', sans-serif",
                      caretColor: "white",
                    }}
                  />
                </div>
                {!yearValid && (
                  <p style={{ fontSize: 11, color: "rgba(255,200,180,0.9)", marginTop: 2 }}>
                    Enter a year between 1800 and {currentYear}
                  </p>
                )}
              </div>

              {/* Water Source */}
              <div className="flex flex-col gap-1.5">
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    letterSpacing: "0.07em",
                    color: "rgba(255,255,255,0.62)",
                    textTransform: "uppercase",
                  }}
                >
                  Water source
                </label>
                <div className="relative">
                  <button
                    onClick={() => setDropdownOpen((o) => !o)}
                    className="w-full flex items-center justify-between"
                    style={{
                      background: "rgba(255,255,255,0.14)",
                      borderRadius: 16,
                      border: "1px solid rgba(255,255,255,0.25)",
                      padding: "0 16px",
                      height: 52,
                      cursor: "pointer",
                    }}
                  >
                    <span
                      style={{
                        color: waterSource ? "white" : "rgba(255,255,255,0.42)",
                        fontSize: 14,
                        fontFamily: "'DM Sans', sans-serif",
                      }}
                    >
                      {waterSource || "Select your water source"}
                    </span>
                    <ChevronDown
                      size={17}
                      color="rgba(255,255,255,0.60)"
                      strokeWidth={2}
                      style={{
                        transform: dropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
                        transition: "transform 0.22s ease",
                      }}
                    />
                  </button>

                  {dropdownOpen && (
                    <div
                      className="absolute left-0 right-0 z-20 overflow-hidden"
                      style={{
                        top: "calc(100% + 6px)",
                        borderRadius: 16,
                        background: "rgba(220,240,248,0.28)",
                        backdropFilter: "blur(24px)",
                        WebkitBackdropFilter: "blur(24px)",
                        border: "1px solid rgba(255,255,255,0.32)",
                        boxShadow: "0 8px 28px rgba(0,0,0,0.14)",
                      }}
                    >
                      {WATER_SOURCES.map((src, i) => (
                        <button
                          key={src}
                          onClick={() => { setWaterSource(src); setDropdownOpen(false); }}
                          className="w-full text-left"
                          style={{
                            padding: "13px 16px",
                            fontSize: 14,
                            color: waterSource === src ? "white" : "rgba(255,255,255,0.80)",
                            fontFamily: "'DM Sans', sans-serif",
                            fontWeight: waterSource === src ? 500 : 400,
                            background: waterSource === src ? "rgba(255,255,255,0.14)" : "transparent",
                            borderBottom: i < WATER_SOURCES.length - 1 ? "1px solid rgba(255,255,255,0.12)" : "none",
                            cursor: "pointer",
                          }}
                        >
                          {src}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-1" style={{ minHeight: 6 }} />

              {/* Submit CTA */}
              <button
                onClick={() => setDropdownOpen(false)}
                className="w-full flex items-center justify-center transition-all active:scale-[0.97]"
                style={{
                  height: 56,
                  borderRadius: 18,
                  background: "linear-gradient(110deg, #2563eb 0%, #0ea5e9 52%, #14b8a6 100%)",
                  boxShadow: "0 4px 24px rgba(14,165,233,0.32)",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "'Proxima Soft', sans-serif",
                  fontWeight: 500,
                  fontSize: 16,
                  color: "white",
                  letterSpacing: "0.01em",
                }}
              >
                Set up my HALO
              </button>

              <p
                style={{
                  textAlign: "center",
                  fontSize: 11.5,
                  color: "rgba(255,255,255,0.48)",
                  marginTop: 4,
                }}
              >
                By continuing you agree to our{" "}
                <span
                  style={{
                    color: "rgba(255,255,255,0.72)",
                    textDecoration: "underline",
                    cursor: "pointer",
                  }}
                >
                  Terms of Service
                </span>
              </p>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}