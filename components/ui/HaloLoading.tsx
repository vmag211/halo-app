import type { ReactNode } from 'react';
import './halo-loading.css';

/** Decorative orbital mark. Its caller owns the real pending state. */
export function LoadingSymbol({ small = false, children }: { small?: boolean; children?: ReactNode }) {
  return <span className="halo-loading-symbol" data-small={small || undefined} aria-hidden="true">
    <svg viewBox="0 0 64 64" fill="none" focusable="false">
      <circle className="halo-loading-track" cx="32" cy="32" r="27" />
      <g className="halo-loading-orbit"><path d="M32 5a27 27 0 0 1 27 27" /><circle cx="59" cy="32" r="2.4" /></g>
      <path className="halo-loading-tide" d="M12 32a20 20 0 0 0 20 20" />
    </svg>
    {children ?? <span className="halo-loading-brand" />}
  </span>;
}

/** No timer or invented percentage: render only while the caller is pending. */
export default function HaloLoading({ label = 'Loading', detail, layout = 'inline' }: {
  label?: string; detail?: string; layout?: 'inline' | 'panel' | 'screen';
}) {
  return <div className="halo-loading" data-layout={layout} role="status" aria-label={label} aria-live="polite" aria-atomic="true" aria-busy="true">
    <LoadingSymbol small={layout === 'inline'} />
    <span className="halo-loading-copy"><strong>{label}</strong>{detail && <small>{detail}</small>}</span>
    {layout !== 'inline' && <span className="halo-loading-horizon" aria-hidden="true"><span /></span>}
  </div>;
}

/** A 520ms arrival flourish, not a request indicator. Never hides ready content. */
export function PageArrival() {
  return <span className="halo-page-arrival" aria-hidden="true"><span /></span>;
}
