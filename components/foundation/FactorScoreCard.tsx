import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import SeverityPill from '@/components/ui/SeverityPill';
import { AnimatedNumber } from './SceneExperience';

export default function FactorScoreCard({ title, score, reading, severity, color, href, icon, provenance, unscoredLabel }: { title: string; score: number | null; reading: string; severity: string; color: string; href: string; icon: ReactNode; provenance?: string | null; unscoredLabel?: string }) {
  // A reading with no card score by design (an estimate, or pollen out of season) names itself; only a real gap says No data.
  const unscored = unscoredLabel || (severity === 'no_data' ? 'No data' : 'Not scored');
  return <Link className="halo-ph-factor-card" data-testid="factor-scorecard" href={href} prefetch={false} style={{ '--factor-accent': color } as CSSProperties} aria-label={`${title}. ${score === null ? unscored : `Score ${score} of 100`}. ${reading}. Open details.`}>
    <div className="halo-ph-card-top"><span className="halo-ph-factor-icon">{icon}</span>{provenance === 'estimate' && <span className="halo-ph-card-estimate">Estimate</span>}</div>
    <h3>{title}</h3><div className="halo-ph-card-score" data-unscored={score === null}><strong>{score === null ? unscored : <AnimatedNumber value={score} delay={180} />}</strong>{score !== null && <span>/100</span>}</div>
    <span className="halo-ph-card-reading">{reading}</span>{(!unscoredLabel || severity !== 'no_data') && <SeverityPill severity={severity} />}
  </Link>;
}
