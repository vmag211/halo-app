import Link from 'next/link';
import { useId } from 'react';
import { AnimatedNumber, Reveal } from './SceneExperience';

export type ScoreSegment = { key: string; label: string; share: number | null; color: string; href: string };
export function normalizeSegments(segments: readonly ScoreSegment[]) {
  const total = segments.reduce((sum, s) => sum + (s.share !== null && Number.isFinite(s.share) && s.share > 0 ? s.share : 0), 0);
  let offset = 0;
  return segments.map(segment => {
    const percent = total > 0 && segment.share !== null && Number.isFinite(segment.share) && segment.share > 0 ? segment.share / total * 100 : 0;
    const result = { ...segment, percent, offset };
    offset += percent;
    return result;
  });
}
export default function SegmentedScore({ score, severity, partial = false, segments, label = 'Overall score' }: { score: number | null; severity: string; partial?: boolean; segments: readonly ScoreSegment[]; label?: string }) {
  const id = useId();
  const arcs = normalizeSegments(segments);
  const validScore = score !== null && Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : null;
  return <Reveal><div className="halo-ph-ring" role="img" aria-label={`${label}: ${validScore ?? 'No data'}. ${severity.replace('_', ' ')}. Higher is better.${partial ? ' Partial score.' : ''} ${arcs.filter(s => s.percent > 0).map(s => `${s.label}: ${Number(s.percent.toFixed(2))}% of available risk.`).join(' ')}`}>
    <svg viewBox="0 0 200 200" aria-hidden="true"><circle className="halo-ph-ring-track" cx="100" cy="100" r="91" />
      <defs><mask id={id}><circle className="halo-ph-ring-reveal" cx="100" cy="100" r="91" pathLength="100" stroke="white" strokeWidth="9" fill="none" /></mask></defs><g mask={`url(#${id})`}>
      {validScore !== null && arcs.filter(s => s.percent > 0).map(segment => <circle key={segment.key} data-factor={segment.key} className="halo-ph-ring-segment" cx="100" cy="100" r="91" pathLength="100" stroke={segment.color} strokeDasharray={`${segment.percent} ${100 - segment.percent}`} strokeDashoffset={-segment.offset} />)}
      </g>{partial && <circle className="halo-ph-ring-partial" cx="100" cy="100" r="99" />}
    </svg>
    <div className="halo-ph-ring-center" aria-hidden="true"><span>{label}</span><strong data-empty={validScore === null}>{validScore === null ? 'No data' : <AnimatedNumber value={validScore} />}</strong><small>{validScore === null ? 'Waiting for readings' : 'out of 100'}</small></div>
  </div></Reveal>;
}
export function CompactContributionBar({ segments, unavailableNote }: { segments: readonly ScoreSegment[]; unavailableNote?: string }) {
  const shares = normalizeSegments(segments);
  const hasRisk = shares.some(s => s.percent > 0);
  return <div className="halo-ph-contributions"><div className="halo-ph-section-label"><span>What shapes your score</span><span>Risk contribution</span></div>
    {hasRisk ? <div className="halo-ph-contribution-track" aria-hidden="true">{shares.filter(s => s.percent > 0).map(s => <span key={s.key} style={{ width: `${s.percent}%`, background: s.color }} />)}</div> : <p className="halo-f-meta">{unavailableNote || (shares.some(s => s.share !== null) ? 'No risk to divide between the available factors.' : 'Contributions will appear when readings are available.')}</p>}
    <div className="halo-ph-legend">{shares.map(s => <Link key={s.key} href={s.href} prefetch={false} aria-label={`${s.label}, ${s.share === null ? 'No data' : `${Number(s.percent.toFixed(1))}% of risk`}. Open factor page.`}><i style={{ background: s.share === null ? 'transparent' : s.color }} /><span>{s.label}</span><b>{s.share === null ? 'No data' : `${Number(s.percent.toFixed(1))}%`}</b></Link>)}</div>
    {hasRisk && unavailableNote && <p className="halo-f-meta">{unavailableNote}</p>}
  </div>;
}
