'use client';

import { useState, type CSSProperties } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { displayText } from '@/lib/frontend/onboarding';

/** A manual, looping deck. Rear cards keep space but are not read or focused. */
export default function FactorSteps({ tips, factor }: { tips: string[]; factor: string }) {
  const [active, setActive] = useState(0);
  if (!tips.length) return null;
  const previous = (active - 1 + tips.length) % tips.length;
  const next = (active + 1) % tips.length;
  return <div className="halo-ph-step-deck" role="region" aria-roledescription="carousel" aria-label="Practical tips">
    {tips.length > 1 && <button className="halo-ph-step-arrow" aria-label={`Previous step, step ${previous + 1}`} aria-controls={`steps-${factor}`} onClick={() => setActive(previous)}><ArrowUp size={23} aria-hidden="true" /></button>}
    <ol id={`steps-${factor}`} className="halo-ph-tips halo-ph-step-list">{tips.map((tip, index) => {
      const depth = (index - active + tips.length) % tips.length;
      return <li key={index} id={`tip-${factor}-${index + 1}`} data-active={depth === 0} data-depth={Math.min(depth, 3)} inert={depth !== 0} aria-hidden={depth !== 0} style={{ '--step-depth': Math.min(depth, 3), zIndex: tips.length - depth } as CSSProperties}>
        <div className="halo-ph-step-heading"><h3>Step {index + 1}</h3><span>{index + 1} of {tips.length}</span></div>
        <p>{displayText(tip).split(/(NSF\/ANSI \d+|P473)/g).map((part, partIndex) => /^(NSF\/ANSI \d+|P473)$/.test(part) ? <code key={partIndex}>{part}</code> : part)}</p>
      </li>;
    })}</ol>
    {tips.length > 1 && <button className="halo-ph-step-arrow" aria-label={`Next step, step ${next + 1}`} aria-controls={`steps-${factor}`} onClick={() => setActive(next)}><ArrowDown size={23} aria-hidden="true" /></button>}
    <p className="halo-sr-only" role="status" aria-atomic="true">Step {active + 1} of {tips.length}. {displayText(tips[active])}</p>
  </div>;
}
