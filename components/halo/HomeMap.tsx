import { MapPin } from "lucide-react";
import { HALO } from "./tone";

// A public (pk.) token exposed for client-side static-map requests. The repo's
// existing MAPBOX_TOKEN is server-only; add NEXT_PUBLIC_MAPBOX_TOKEN=<same pk.>
// to .env.local to light this up. Absent that, the map degrades to a labelled
// placeholder rather than breaking — never a blank or a wrong location.
const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

const HEIGHT = 150;

/**
 * The home's location as a static Mapbox map (dark style, teal marker), sitting
 * above the HomeGuard scorecards. Falls back to a placeholder when the token or
 * coordinates are missing.
 */
export default function HomeMap({ lat, lng, label }: { lat?: number; lng?: number; label?: string }) {
  const hasCoords = typeof lat === "number" && typeof lng === "number";

  if (!TOKEN || !hasCoords) {
    return (
      <div
        style={{ height: HEIGHT, borderRadius: 20, background: HALO.panel, border: "1px solid rgba(255,255,255,.12)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "rgba(255,255,255,.6)", textAlign: "center", padding: 16 }}
      >
        <MapPin size={22} aria-hidden="true" />
        <div style={{ fontSize: 11.5 }}>
          {!hasCoords ? "Add your address to see your area on the map." : "Map unavailable — set NEXT_PUBLIC_MAPBOX_TOKEN."}
        </div>
      </div>
    );
  }

  const marker = `pin-l+5fd3e6(${lng},${lat})`;
  const src = `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/${marker}/${lng},${lat},12,0/620x300@2x?access_token=${TOKEN}`;

  return (
    <div style={{ position: "relative", height: HEIGHT, borderRadius: 20, overflow: "hidden", border: "1px solid rgba(255,255,255,.14)" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a remote static-map PNG; next/image would need remotePatterns config (outside this lane). */}
      <img src={src} alt={label ? `Map of ${label}` : "Map of your home's location"} width={620} height={300} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      {/* Bottom scrim + label so the map blends into the frame. */}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg,transparent 55%,rgba(11,58,76,.75) 100%)", pointerEvents: "none" }} />
      {label && (
        <div style={{ position: "absolute", left: 12, bottom: 10, display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 500, textShadow: "0 1px 4px rgba(0,20,30,.7)" }}>
          <MapPin size={13} aria-hidden="true" />
          {label}
        </div>
      )}
    </div>
  );
}
