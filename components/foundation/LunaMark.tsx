import './luna-mark.css';

/** Preserve the resting faceted halo. Motion is decorative and finite. */
export default function LunaMark({ size = 32, loading = false }: { size?: number; loading?: boolean }) {
  return <svg className="halo-luna-mark" data-loading={loading || undefined} width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
    <g className="halo-luna-facets">
      <path className="halo-luna-facet halo-luna-facet--outer" d="M24 3 42.2 13.5v21L24 45 5.8 34.5v-21Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path className="halo-luna-facet halo-luna-facet--left" d="m15 6 25 9 2 20-26 7L6 24Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" opacity=".7" />
      <path className="halo-luna-facet halo-luna-facet--right" d="m30 5 12 22-12 16L7 31l4-20Z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" opacity=".75" />
      <path className="halo-luna-facet halo-luna-facet--inner" d="m24 10 12.1 7v14L24 38l-12.1-7V17Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path className="halo-luna-facet halo-luna-facet--mesh" d="m24 3 12.1 14 6.1 17.5L24 38 5.8 34.5 11.9 17ZM42.2 13.5 36.1 31 24 45 11.9 31 5.8 13.5 24 10Z" stroke="currentColor" strokeWidth=".8" strokeLinejoin="round" opacity=".55" />
    </g>
    {loading && <g className="halo-luna-waves" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round">
      <path className="halo-luna-wave halo-luna-wave--top" pathLength="1" d="M5 18C11 10 17 26 24 18S37 10 43 18" />
      <path className="halo-luna-wave halo-luna-wave--middle" pathLength="1" d="M5 24C12 15 17 33 24 24S36 15 43 24" />
      <path className="halo-luna-wave halo-luna-wave--bottom" pathLength="1" d="M5 30C11 22 18 38 24 30S37 22 43 30" />
    </g>}
  </svg>;
}
