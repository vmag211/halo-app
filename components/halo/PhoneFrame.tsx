import type { ReactNode } from "react";

// The default HomeGuard gradient. Subpages pass their own per-subject gradient.
const DEFAULT_GRADIENT = "linear-gradient(170deg,#0d4a5e 0%,#12657c 45%,#0b3a4c 100%)";

/**
 * The 390×844 phone shell every HALO screen sits inside.
 *
 * Deliberately clean, matching the Personal Hero *subpage* language: a single
 * gradient field, plus an optional per-screen atmospheric effect passed via
 * `atmosphere`. No constellation/plexus overlay — content carries the screen.
 */
export default function PhoneFrame({
  children,
  gradient = DEFAULT_GRADIENT,
  atmosphere,
  color = "#fff",
}: {
  children: ReactNode;
  gradient?: string;
  atmosphere?: ReactNode;
  color?: string;
}) {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-slate-900">
      <div
        className="relative h-[844px] w-[390px] overflow-hidden"
        style={{ borderRadius: 42, background: gradient, boxShadow: "0 18px 50px rgba(0,0,0,.5)", color }}
      >
        {/* Optional per-screen atmospheric effect (water drips, etc.). */}
        {atmosphere}
        {/* Scrollable content column. */}
        <div className="no-scrollbar absolute inset-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
