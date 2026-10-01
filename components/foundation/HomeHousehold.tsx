'use client';

import Link from 'next/link';
import { Backpack, Droplets, House, Leaf, ShieldCheck } from 'lucide-react';
import { homeMemberKeys, memberCatalog, type HomeMemberKey } from '@/lib/frontend/home-household';
import { factorColor, factorReadings } from '@/lib/frontend/factor-preview';
import type { FoundationScenario } from '@/lib/frontend/foundation-preview';
import SeverityPill from '@/components/ui/SeverityPill';
import { Callout } from '@/components/ui/Foundation';
import { Reveal } from './SceneExperience';
import { usePreviewHousehold } from './PreviewHousehold';
import type { FactorHref } from './PersonalHero';
import './home-household.css';

export type MemberHref = (member: HomeMemberKey) => string;

function MemberFigure({ member }: { member: HomeMemberKey }) {
  const shape = ['pregnant', 'senior', 'toddler'].includes(member) ? member : 'person';
  return <span className="halo-home-figure" data-member={member} aria-hidden="true"><span className="halo-home-silhouette" style={{ maskImage: `url(/household-icons/${shape}.svg)`, WebkitMaskImage: `url(/household-icons/${shape}.svg)` }} />{member === 'respiratory' && <span className="halo-home-breathing"><span /></span>}{member === 'teen' && <Backpack className="halo-home-backpack" size={22} strokeWidth={1.5} />}</span>;
}

export default function HomeHousehold({ memberHref }: { memberHref: MemberHref }) {
  const { bands } = usePreviewHousehold();
  const members = homeMemberKeys.filter(key => bands[memberCatalog[key].band]);
  return <section className="halo-home-household" id="household" aria-label="Your Homeguard household">
    <div className="halo-home-house" data-count={members.length}>
      <svg className="halo-home-roof" viewBox="0 0 400 112" preserveAspectRatio="none" aria-hidden="true"><path d="M12 104 200 10 388 104Z" /><path d="M304 62V26h35v54" /><path d="M3 105 200 6 397 105" /></svg>
      <div className="halo-home-attic" aria-hidden="true"><House size={21} strokeWidth={1.4} /></div>
      <div className="halo-home-house-body"><p className="halo-home-house-instruction">Tap a person for their home guidance</p><div className="halo-home-residents">{members.map(member => <Link key={member} href={memberHref(member)} prefetch={false} className="halo-home-person" data-member={member} aria-label={`Home guidance for ${memberCatalog[member].label.toLowerCase()}`}><MemberFigure member={member} /><span>{memberCatalog[member].shortLabel}</span></Link>)}</div>{members.length === 0 && <p className="halo-home-house-empty">No household categories selected. Add a sample category in HALO design review to explore its guidance.</p>}<span className="halo-home-floor" aria-hidden="true" /></div>
    </div>
    <p className="halo-home-house-caption">One figure per selected category, not a count of people. Categories can overlap.</p>
  </section>;
}

const factorIcons = { pfas: Droplets, radon: House, lead: ShieldCheck, mold: Leaf };

export function HomeMemberGuidance({ member, scenario, memberHref, factorHref, parentHref }: { member: HomeMemberKey; scenario: FoundationScenario; memberHref: MemberHref; factorHref: FactorHref; parentHref: string }) {
  const { bands } = usePreviewHousehold();
  const content = memberCatalog[member];
  const missing = ['no-data', 'card-no-data', 'offline-empty', 'error'].includes(scenario);
  const offline = scenario === 'offline';
  const selected = bands[content.band];
  const otherMembers = homeMemberKeys.filter(key => key !== member && bands[memberCatalog[key].band]);
  return <article className="halo-home-member" data-member={member}>
    <section className="halo-home-member-hero"><span className="halo-ph-kicker">Homeguard · Household guidance</span><div className="halo-home-member-portrait"><MemberFigure member={member} /></div><h2>{content.label}</h2><p>{content.intro}</p><span className="halo-home-member-tag">{selected ? 'Selected sample category' : 'General category guide'}</span></section>
    {!selected && <Callout tone="info"><p>This category is not selected in your sample household. You can still read its general guidance.</p></Callout>}
    {(missing || offline) && <Callout tone="notice"><p>{missing ? 'Readings are unavailable. The practical guidance remains general and does not describe conditions in this home.' : 'Stored sample readings are shown with their original dates. These are not a new assessment.'}</p></Callout>}
    <section className="halo-home-member-focus"><span className="halo-ph-kicker">A useful place to start</span><h2>{content.focus}</h2><p>The home evidence stays the same for everyone. This page changes what to read and do next, not the score.</p></section>
    <div className="halo-home-member-actions">{content.actions.map((action, index) => {
      const factor = factorReadings[action.factor]; const Icon = factorIcons[action.factor];
      const noReading = missing || (scenario === 'partial' && action.factor === 'pfas');
      return <Reveal key={action.title} delay={index * 75}><section className="halo-home-member-action" style={{ '--factor-accent': factorColor(action.factor) } as React.CSSProperties}>
        <div className="halo-home-member-factor"><Icon size={21} aria-hidden="true" /><span>{factor.title}</span><span className="halo-home-step">0{index + 1}</span></div>
        <h3>{action.title}</h3><p>{action.body}</p>
        <div className="halo-home-evidence"><div><span>{noReading ? 'No reading to interpret' : action.factor === 'mold' ? 'Outdoor context only' : 'Your sample home evidence'}</span><strong>{noReading ? 'Reading unavailable' : `${factor.reading} ${factor.unit}`}</strong><small>{noReading ? 'General information remains available' : factor.asOf}</small></div><SeverityPill severity={noReading ? 'no_data' : factor.severity} /></div>
        <details><summary>What this can and cannot tell you</summary><p>{action.factor === 'lead' ? 'Building age is an estimate, not a tap-water test or a confirmed pipe material.' : action.factor === 'radon' ? 'The county zone describes regional potential. HALO has no indoor radon measurement for this home.' : action.factor === 'pfas' ? 'The utility sample has its own date. It does not measure PFAS at your tap today or anyone’s individual exposure.' : 'This is weather-based context, not a measurement of mold or humidity inside this home.'}</p><a href={action.sourceUrl} target="_blank" rel="noopener noreferrer">{action.sourceLabel}</a></details>
        <Link href={factorHref(action.factor)} prefetch={false}>Explore {factor.shortTitle.toLowerCase()}</Link>
      </section></Reveal>;
    })}</div>
    <section className="halo-home-member-limits"><ShieldCheck size={23} aria-hidden="true" /><h2>About the person, not a personal score.</h2><p>HALO knows selected household categories, not names, medical histories, or individual exposure. These are educational suggestions, not a diagnosis or treatment plan. Speak with a qualified professional about individual health concerns.</p></section>
    {otherMembers.length > 0 && <nav className="halo-home-member-switch" aria-label="Other household guidance"><h2>Others in your home</h2><div>{otherMembers.map(key => <Link key={key} href={memberHref(key)} prefetch={false}><MemberFigure member={key} /><span>{memberCatalog[key].shortLabel}</span></Link>)}</div></nav>}
    <Link className="halo-home-member-back" href={parentHref} prefetch={false}>Back to your Homeguard household</Link>
  </article>;
}
