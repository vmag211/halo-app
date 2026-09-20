/**
 * The HomeGuard backdrop: a slow "breathing" gradient mesh (design option 8d),
 * finished with grain and a vignette for depth. Purely decorative (aria-hidden),
 * sits behind all content. (Replaces the earlier aurora/ripple background.)
 */
export default function Backdrop() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true" style={{ overflow: "hidden" }}>
      {/* 8d — breathing gradient mesh. */}
      <div
        className="halo-anim"
        style={{
          position: "absolute",
          inset: "-12%",
          mixBlendMode: "screen",
          background:
            "radial-gradient(40% 40% at 28% 26%, rgba(74,236,190,.5), transparent 70%), radial-gradient(46% 46% at 78% 58%, rgba(90,150,255,.45), transparent 70%), radial-gradient(42% 42% at 46% 88%, rgba(52,224,236,.5), transparent 70%)",
          animation: "halo-breathe 14s ease-in-out infinite",
        }}
      />

      {/* Fine grain to kill flat banding. */}
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.05, mixBlendMode: "overlay" }}>
        <filter id="halo-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter="url(#halo-grain)" />
      </svg>

      {/* Vignette for depth. */}
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 78% at 50% 30%, transparent 46%, rgba(3,20,30,.42) 100%)" }} />
    </div>
  );
}
