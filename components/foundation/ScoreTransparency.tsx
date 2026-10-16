'use client';

import Link from 'next/link';
import { ArrowUpRight, Info } from 'lucide-react';
import { ProvenancePill } from '@/components/ui/Foundation';
import type { FactorKey, FactorReading } from '@/lib/frontend/factor-preview';
import type { StageOverview } from '@/lib/frontend/stage-data';
import './score-transparency.css';

/** Explains the existing server method. Never computes or repairs a score. */
export default function ScoreTransparency({ home, keys, readings, overview, factorHref, missingKeys = [] }: {
  home: boolean;
  keys: readonly FactorKey[];
  readings: Record<FactorKey, FactorReading>;
  overview: StageOverview | null;
  factorHref: (key: FactorKey) => string;
  missingKeys?: readonly FactorKey[];
}) {
  const available = keys.filter(key => readings[key].severity !== 'no_data' && !missingKeys.includes(key)).length;
  return <details className="halo-score-transparency">
    <summary><Info size={18} aria-hidden="true" /><span>How this score works</span><small>{available} of {keys.length} readings</small></summary>
    <div className="halo-score-explanation">
      <p>{home ? 'Homeguard summarizes published water results and county radon potential. Lead is shown separately. Your own test records remain separate evidence.' : 'Today brings together air quality, UV, pollen and a weather-based mold estimate. Higher scores mean lower combined environmental risk inputs.'}</p>
      <p>{home ? 'This is a guide to the available evidence, not a measurement of the safety of your home.' : 'It describes conditions in your area, not your personal exposure or chance of illness.'} Missing readings stay unknown. Completing a task does not change the score.</p>
      <details className="halo-score-method"><summary>Calculation details</summary>{home ? <>
        <p>The calculation combines the remaining fractions of the water and radon risk inputs, then scales the result to 100. Missing inputs are excluded and a partial score is identified.</p>
        <p>The current method has a minimum score of 6. It caps the score at 85 for partially assessable water detections, or 70 when detections have no supplied comparison. Untested private water does not receive a combined home score.</p>
      </> : <>
        <p>Air, UV and pollen are converted to risk inputs from 0 to 100. Air follows AQI bands, UV is scaled against index 11, and pollen uses the highest available tree, grass or weed index, scaled against 5.</p>
        <p>The outdoor mold estimate contributes 5, 17 or 30 for low, moderate or high conditions. Its smaller range reflects its weather-based evidence.</p>
        <p>HALO squares the available inputs, adds them, and takes the square root. It divides that total by 175.8, scales it to 100, and subtracts it from 100. The displayed score is rounded.</p>
      </>}
        <p>The colored shares compare available risk inputs. They are not formula weights or percentages of health risk.</p>
      </details>
      <div className="halo-score-source-list" aria-label="Reading sources and dates">{keys.map(key => {
        const factor = readings[key];
        const missing = factor.severity === 'no_data' || missingKeys.includes(key);
        return <Link href={factorHref(key)} prefetch={false} key={key} className="halo-score-source-row"><div><strong>{factor.title}</strong><span>{missing ? 'Reading unavailable' : `${factor.reading} ${factor.unit}`}</span><small>{factor.source} · {missing ? 'No current reading' : factor.asOf}</small></div><div><ProvenancePill provenance={missing ? null : factor.provenance} /><ArrowUpRight size={16} aria-hidden="true" /></div></Link>;
      })}</div>
      {overview?.missingInputs.length ? <p className="halo-f-meta">Missing score inputs: {overview.missingInputs.join(', ')}.</p> : null}
    </div>
  </details>;
}
