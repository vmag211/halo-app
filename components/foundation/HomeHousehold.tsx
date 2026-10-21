'use client';

import Link from 'next/link';
import { ArrowUpRight, Backpack, Droplets, House, Leaf, ShieldCheck } from 'lucide-react';
import { homeMemberKeys, memberCatalog, type HomeMemberKey } from '@/lib/frontend/home-household';
import { factorColor, factorInlineName, factorReadings } from '@/lib/frontend/factor-preview';
import type { FoundationScenario } from '@/lib/frontend/foundation-preview';
import SeverityPill from '@/components/ui/SeverityPill';
import { Callout } from '@/components/ui/Foundation';
import { Reveal, useSceneExperience } from './SceneExperience';
import { usePreviewHousehold } from './PreviewHousehold';
import { MotionButton, type FactorHref } from './PersonalHero';
import EditorialScene, { type EditorialSceneKind } from './EditorialScene';
import './home-household.css';
import './household-editorial.css';
import { useStageRuntime } from './StageRuntime';

export type MemberHref = (member: HomeMemberKey) => string;

function MemberFigure({ member }: { member: HomeMemberKey }) {
  const shape = ['pregnant', 'senior', 'toddler'].includes(member) ? member : 'person';
  return <span className="halo-home-figure" data-member={member} aria-hidden="true"><span className="halo-home-silhouette" style={{ maskImage: `url(/household-icons/${shape}.svg)`, WebkitMaskImage: `url(/household-icons/${shape}.svg)` }} />{member === 'respiratory' && <span className="halo-home-breathing"><span /></span>}{member === 'teen' && <Backpack className="halo-home-backpack" size={22} strokeWidth={1.5} />}</span>;
}

export default function HomeHousehold({ memberHref }: { memberHref: MemberHref }) {
  const runtime = useStageRuntime();
  const { bands } = usePreviewHousehold();
  const members = homeMemberKeys.filter(key => bands[memberCatalog[key].band]);
  return <section className="halo-home-household" id="household" aria-label="Your Homeguard household" data-motion-surface="household">
    <div className="halo-home-house" data-count={members.length}>
      <div className="halo-home-guidance-heading"><div><span className="halo-ph-kicker">Made for your household</span><h2>Everyone at home.</h2><p className="halo-home-house-instruction">Choose a person for practical home guidance.</p></div><HousePortrait /></div>
      <div className="halo-home-house-body"><div className="halo-home-residents">{members.map(member => <Link key={member} href={memberHref(member)} prefetch={false} className="halo-home-person" data-member={member} aria-label={`Home guidance for ${memberCatalog[member].label.toLowerCase()}`}><MemberFigure member={member} /><span>{memberCatalog[member].shortLabel}</span><ArrowUpRight className="halo-home-person-arrow" size={16} aria-hidden="true" /></Link>)}</div>{members.length === 0 && <p className="halo-home-house-empty">{runtime ? <>No household categories selected. <Link href="/settings">Update your household in Settings.</Link></> : 'No household categories selected. Update your household in Settings.'}</p>}</div>
    </div>
    <p className="halo-home-house-caption">One figure per selected category, not a count of people. Categories can overlap.</p>
  </section>;
}

/** Proportional architectural artwork, not a diagram of the user's actual home. */
function HousePortrait() {
  return <svg className="halo-home-portrait-art" viewBox="0 0 300 200" aria-hidden="true" focusable="false">
    <ellipse className="house-ground" cx="156" cy="174" rx="123" ry="16" />
    <path className="house-garden" d="M23 160c-8-20 1-44 14-40 2-28 24-38 31-17 24-8 36 18 21 37l-4 25zM234 167c-13-24-7-46 6-42-5-29 18-49 32-29 12-5 23 9 13 30 15 10 8 32-6 38z" />
    <path className="house-tree" d="m54 107 2 65m-1-39-14-10m15 22 14-14m187-15 1 57m-1-25-12-11m13 4 13-13" />
    <path className="house-wall-side" d="m163 64 81 26v75l-81 13z" />
    <path className="house-wall" d="m68 89 59-46 52 31v104l-111-17z" />
    <path className="house-roof-side" d="m127 33 89 27 42 38-79-19z" />
    <path className="house-roof" d="m52 92 74-60 63 43-8 10-54-36-66 51z" />
    <path className="house-chimney" d="m216 61 0-28 15 5v38" />
    <path className="house-window" d="m85 100 24 3v30l-24-3zm53 6 23 3v30l-23-3zm57-5 30 8v26l-30-6z" />
    <path className="house-window-shine" d="m89 104 15 2-15 19zm54 6 13 2-13 17zm57-4 19 5-19 12z" />
    <path className="house-window-frame" d="m97 102 0 29m52-24 0 30m61-31 0 27" />
    <path className="house-door" d="m113 136 20 3v31l-20-3z" />
    <circle className="house-handle" cx="128" cy="154" r="1.7" />
    <path className="house-step" d="m108 167 29 4 10 7-42-5z" />
    <path className="house-planter" d="m72 144 27 4-2 12-23-3zm125-4 32 6-3 12-28-5z" />
    <path className="house-plants" d="M76 144c-7-14 6-16 10-4 5-17 16-9 10 6m107-6c-8-17 9-17 11-3 7-13 18-1 10 7" />
  </svg>;
}

const factorIcons = { pfas: Droplets, radon: House, lead: ShieldCheck, mold: Leaf };
const memberScenes: Record<HomeMemberKey, EditorialSceneKind> = {
  toddler: 'care-playroom', child: 'care-playroom', teen: 'care-study', adult: 'care-study',
  senior: 'care-rest', pregnant: 'care-garden', respiratory: 'care-rest',
};

export function HomeMemberGuidance({ member, scenario, memberHref, factorHref, parentHref }: { member: HomeMemberKey; scenario: FoundationScenario; memberHref: MemberHref; factorHref: FactorHref; parentHref: string }) {
  const runtime = useStageRuntime();
  const atmosphere = useSceneExperience();
  const readings = runtime?.readings ?? factorReadings;
  const { bands } = usePreviewHousehold();
  const content = memberCatalog[member];
  const missing = ['no-data', 'card-no-data', 'offline-empty', 'error'].includes(scenario);
  const offline = scenario === 'offline';
  const selected = bands[content.band];
  const otherMembers = homeMemberKeys.filter(key => key !== member && bands[memberCatalog[key].band]);
  return <article className="halo-home-member" data-member={member}>
    {runtime ? <section className="halo-home-member-hero"><span className="halo-ph-kicker">Homeguard · Household guidance</span><div className="halo-home-member-portrait"><MemberFigure member={member} /></div><h2>{content.label}</h2><p>{content.intro}</p><span className="halo-home-member-tag">{selected ? 'Selected household category' : 'General category guide'}</span></section> : <section className="halo-home-member-hero halo-household-editorial" data-motion-surface="household-intro">
      <div className="halo-household-editorial-art"><EditorialScene scene={memberScenes[member]} eager /><div className="halo-household-editorial-motion">{!atmosphere.deviceReduced && (atmosphere.motion || atmosphere.paused) && <MotionButton />}</div></div>
      <div className="halo-household-editorial-heading"><div className="halo-home-member-portrait"><MemberFigure member={member} /></div><div><span className="halo-ph-kicker">Homeguard · Household guidance</span><h2>{content.label}</h2></div></div>
      <p>{content.intro}</p><span className="halo-home-member-tag">{selected ? 'Selected household category' : 'General category guide'}</span>
    </section>}
    {!selected && <Callout tone="info"><p>{runtime ? 'This category is not selected in your household. You can still read its general guidance.' : 'This category is not selected in your household. You can still read its general guidance.'}</p></Callout>}
    {(missing || offline) && <Callout tone="notice"><p>{missing ? 'Readings are unavailable. The practical guidance remains general and does not describe conditions in this home.' : runtime ? 'Stored readings are shown with their original dates. These are not a new assessment.' : 'Stored readings are shown with their original dates. These are not a new assessment.'}</p></Callout>}
    <section className="halo-home-member-focus" data-motion-surface="household-focus"><span className="halo-ph-kicker">A useful place to start</span><h2>{content.focus}</h2><p>The home evidence stays the same for everyone. This page changes what to read and do next, not the score.</p></section>
    <div className="halo-home-member-actions">{content.actions.map((action, index) => {
      const factor = readings[action.factor]; const Icon = factorIcons[action.factor];
      const noReading = missing || (runtime ? factor.severity === 'no_data' : scenario === 'partial' && action.factor === 'pfas');
      return <Reveal key={action.title} delay={index * 75}><section className="halo-home-member-action" style={{ '--factor-accent': factorColor(action.factor) } as React.CSSProperties}>
        <div className="halo-home-member-factor"><Icon size={21} aria-hidden="true" /><span>{factor.title}</span><span className="halo-home-step">0{index + 1}</span></div>
        <h3>{action.title}</h3><p>{action.body}</p>
        <div className="halo-home-evidence"><div><span>{noReading ? 'No reading to interpret' : action.factor === 'mold' ? 'Outdoor context only' : runtime ? 'Your home evidence' : 'Your home evidence'}</span><strong>{noReading ? 'Reading unavailable' : `${factor.reading} ${factor.unit}`}</strong><small>{noReading ? 'General information remains available' : factor.asOf}</small></div><SeverityPill severity={noReading ? 'no_data' : factor.severity} /></div>
        <details><summary>What this can and cannot tell you</summary><p>{action.factor === 'lead' ? 'Building age is an estimate, not a tap-water test or a confirmed pipe material.' : action.factor === 'radon' ? 'The county zone describes regional potential. HALO has no indoor radon measurement for this home.' : action.factor === 'pfas' ? 'The utility sample has its own date. It does not measure PFAS at your tap today or anyone’s individual exposure.' : 'This is weather-based context, not a measurement of mold or humidity inside this home.'}</p><a href={action.sourceUrl} target="_blank" rel="noopener noreferrer">{action.sourceLabel}</a></details>
        <Link href={factorHref(action.factor)} prefetch={false}>Explore {factorInlineName(factor)}</Link>
      </section></Reveal>;
    })}</div>
    <section className="halo-home-member-limits" data-motion-surface="household-limits"><ShieldCheck size={23} aria-hidden="true" /><h2>About the person, not a personal score.</h2><p>HALO knows selected household categories, not names, medical histories, or individual exposure. These are educational suggestions, not a diagnosis or treatment plan. Speak with a qualified professional about individual health concerns.</p></section>
    {otherMembers.length > 0 && <nav className="halo-home-member-switch" aria-label="Other household guidance" data-motion-surface="household-switch"><h2>Others in your home</h2><div>{otherMembers.map(key => <Link key={key} href={memberHref(key)} prefetch={false}><MemberFigure member={key} /><span>{memberCatalog[key].shortLabel}</span></Link>)}</div></nav>}
    <Link className="halo-home-member-back" href={parentHref} prefetch={false}>Back to your Homeguard household</Link>
  </article>;
}
