import type { CSSProperties, ReactNode } from "react";

/**
 * A frosted-glass surface. Per the design language, glass is rationed — reserve
 * it for the hero disk and the bottom nav. Most panels should be the solid
 * `SolidCard` instead, so glass stays meaningful because it's rare.
 */
export function GlassCard({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={className}
      style={{
        background: "rgba(255,255,255,.15)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid rgba(255,255,255,.28)",
        boxShadow: "0 8px 22px rgba(0,0,0,.22),inset 0 1px 0 rgba(255,255,255,.3)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * The default opaque panel — everything that isn't the hero disk or nav.
 * `deep` uses the darker of the two surface tones from the design docs.
 */
export function SolidCard({
  children,
  className = "",
  deep = false,
  style,
}: {
  children: ReactNode;
  className?: string;
  deep?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      className={className}
      style={{
        background: deep ? "#071c2e" : "#0f2a3c",
        borderRadius: 18,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
