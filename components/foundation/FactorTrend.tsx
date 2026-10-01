'use client';

import { useId, useState } from 'react';
import type { TrendPoint } from '@/lib/frontend/factor-preview';
import { Reveal } from './SceneExperience';

/** Dates arrive as calendar strings. Missing observations break the path. */
export default function FactorTrend({ points, title, caption, unit, color }: { points: TrendPoint[]; title: string; caption: string; unit: string; color: string }) {
  const id = useId();
  const [selected, setSelected] = useState(Math.max(0, points.length - 1));
  const available = points.filter(p => p.value !== null && Number.isFinite(p.value));
  if (available.length < 2) return <section className="halo-ph-panel"><h2>{title}</h2><p>Your trend will appear here after a few days of readings.</p></section>;
  const max = Math.max(1, ...available.map(p => p.value!)) * 1.15;
  const x = (i: number) => 34 + i / Math.max(1, points.length - 1) * 276;
  const y = (value: number) => 130 - value / max * 106;
  const path = points.map((point, i) => {
    if (point.value === null || !Number.isFinite(point.value)) return '';
    const previous = points[i - 1]?.value;
    const connected = previous !== null && previous !== undefined && Number.isFinite(previous);
    return `${connected ? 'L' : 'M'}${x(i)},${y(point.value)}`;
  }).join(' ');
  const active = points[Math.min(selected, points.length - 1)];
  return <Reveal><section className="halo-ph-panel halo-ph-trend"><div className="halo-ph-panel-heading"><h2>{title}</h2><span className="halo-ph-kicker">{points.length} dates</span></div>
    <p className="halo-f-meta">{caption}</p>
    <svg viewBox="0 0 330 160" role="img" aria-labelledby={`${id}-title`}>
      <title id={`${id}-title`}>{`${title}. ${caption}`}</title>
      {[0, 0.5, 1].map(n => <g key={n}><line className="halo-ph-chart-grid" x1="34" x2="310" y1={y(max * n)} y2={y(max * n)} /><text x="26" y={y(max * n) + 4} textAnchor="end">{Number((max * n).toFixed(1))}</text></g>)}
      <g className="halo-ph-chart-reveal"><path className="halo-ph-chart-line" d={path} fill="none" stroke={color} strokeWidth="2.5" />
      {points.map((point, i) => point.value !== null && Number.isFinite(point.value) && <circle key={point.date} cx={x(i)} cy={y(point.value)} r={i === selected ? 5 : 3} fill={color} stroke="var(--halo-card)" strokeWidth="2" />)}
      </g><text x="34" y="151">{points[0].label}</text><text x="310" y="151" textAnchor="end">{points[points.length - 1].label}</text>
    </svg>
    <label className="halo-ph-chart-selection"><span><b>{active.label}</b><span aria-live="polite">{active.value === null ? 'No reading' : `${active.value} ${unit}`}</span></span><input aria-label={`Explore ${title.toLowerCase()}`} type="range" min="0" max={points.length - 1} step="1" value={selected} aria-valuetext={`${active.label}, ${active.value ?? 'No reading'}${active.value === null ? '' : ` ${unit}`}`} onChange={event => setSelected(Number(event.target.value))} /></label>
    <details className="halo-ph-data-table"><summary>View readings as a table</summary><table><thead><tr><th scope="col">Date</th><th scope="col">Reading</th></tr></thead><tbody>{points.map(point => <tr key={point.date}><th scope="row"><time dateTime={point.date}>{point.date}</time></th><td>{point.value === null ? 'No data' : `${point.value} ${unit}`}</td></tr>)}</tbody></table></details>
  </section></Reveal>;
}
