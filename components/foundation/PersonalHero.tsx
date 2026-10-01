'use client';

import type { CSSProperties } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Droplets, Flower2, House, Leaf, Pause, Play, ShieldCheck, Sprout, Sun, Users, Wind } from 'lucide-react';
import SeverityPill from '@/components/ui/SeverityPill';
import { Callout, ProvenancePill } from '@/components/ui/Foundation';
import { learnTopic } from '@/lib/learnContent';
import { displayText } from '@/lib/frontend/onboarding';
import { factorColor, factorReadings, homeFactorKeys, personalFactorKeys, previewRiskShares, type FactorKey, type FactorReading } from '@/lib/frontend/factor-preview';
import type { FoundationScenario } from '@/lib/frontend/foundation-preview';
import EnvironmentalScene from './EnvironmentalScene';
import SegmentedScore, { CompactContributionBar, type ScoreSegment } from './SegmentedScore';
import FactorScoreCard from './FactorScoreCard';
import FactorTrend from './FactorTrend';
import { AnimatedNumber, Reveal, useSceneExperience } from './SceneExperience';
import './personal-hero.css';
import './refinement.css';
import FactorReadingGuide from './FactorReadingGuide';
import HomeHousehold, { type MemberHref } from './HomeHousehold';
import { usePreviewHousehold } from './PreviewHousehold';
import { homeMemberKeys, memberCatalog } from '@/lib/frontend/home-household';
import FactorSteps from './FactorSteps';
import PreviewSectionLink from './PreviewSectionLink';
import RisingSun from './RisingSun';

const factorIcons = { air: Wind, uv: Sun, pollen: Flower2, mold: Sprout, pfas: Droplets, radon: House, lead: ShieldCheck };
export type FactorHref = (factor: FactorKey) => string;
type OverviewProps = { scenario: FoundationScenario; factorHref: FactorHref; familyHref?: string; memberHref?: MemberHref; home?: boolean };

export default function PersonalHero({ scenario, factorHref, familyHref, memberHref, home = false }: OverviewProps) {
  const { clock } = useSceneExperience();
  const missing = scenario === 'no-data';
  const partial = scenario === 'partial';
  const missingKey = home ? 'pfas' : 'pollen';
  const keys = home ? homeFactorKeys : personalFactorKeys;
  const zeroRisk = scenario === 'contribution-zero' || scenario === 'score-full';
  const score = missing ? null : scenario === 'score-zero' ? 0 : zeroRisk ? 100 : home ? 58 : 74;
  const severity = missing ? 'no_data' : score === 0 ? 'severe' : home ? 'elevated' : 'moderate';
  const segments: ScoreSegment[] = keys.filter(key => key !== 'lead').map((key, index) => ({
    key, label: factorReadings[key].shortTitle, color: factorColor(key), href: factorHref(key),
    share: missing || (partial && key === missingKey) ? null : zeroRisk ? 0 : scenario === 'contribution-single' ? (index === 0 ? 100 : 0) : scenario === 'contribution-sliver' ? [95, 5, 0, 0, 0][index] : home ? (key === 'pfas' ? 75 : 25) : previewRiskShares[key] ?? null,
  }));
  return <div className="halo-ph-overview" data-home={home}>
    <section className="halo-ph-landscape" aria-label={`${home ? 'Homeguard' : 'Today'} overview`}>
      <EnvironmentalScene variant={home ? 'home' : 'landscape'} /><div className="halo-ph-scene-content"><div className="halo-ph-scene-top"><span><Leaf size={14} aria-hidden="true" />{clock.label}</span><MotionButton /></div>
        <SegmentedScore score={score} severity={severity} partial={partial} segments={segments} label={home ? 'Your home score' : 'Your personal score'} />
        <span className="halo-ph-higher">Higher is better</span>
      </div>
    </section>
    <div className="halo-ph-introduction"><div className="halo-ph-headline">{(missing || score === 0 || zeroRisk || home) && <h2>{missing ? 'A few readings are missing' : score === 0 ? 'Take a closer look at your readings' : zeroRisk ? 'A little more room to breathe' : 'Know your home a little better.'}</h2>}<SeverityPill severity={severity} /></div><p>{home ? 'Water, ground, and the place you call home.' : 'Your air, sunlight, pollen, and moisture, brought into focus.'}</p><span className="halo-f-meta">Sample household · September 30, 2026</span></div>
    {partial && <Callout tone="notice"><p>Based on {home ? 1 : 3} of {home ? 2 : 4} scored factors. {home ? 'PFAS' : 'Pollen'} data is not available right now.</p></Callout>}
    {missing && <Callout tone="notice"><p>We could not get readings for this sample. Missing data does not mean low risk.</p></Callout>}
    <CompactContributionBar segments={segments} />
    {home && <HouseholdContext home />}
    {home && memberHref && <HomeHousehold memberHref={memberHref} />}
    <div className="halo-ph-section-label"><h2>{home ? 'Around your home' : 'Your environment, closer up'}</h2><span>Explore a factor</span></div>
    <div className="halo-ph-factor-grid">{keys.map((key, index) => {
      const factor = factorReadings[key]; const Icon = factorIcons[key]; const noData = missing || (partial && key === missingKey);
      return <Reveal key={key} delay={index * 90}><FactorScoreCard title={factor.title} score={noData ? null : factor.score} reading={noData ? 'Reading unavailable' : `${factor.reading} ${factor.unit}`} severity={noData ? 'no_data' : factor.severity} color={factorColor(key)} href={factorHref(key)} icon={<Icon size={22} aria-hidden="true" />} provenance={factor.provenance} /></Reveal>;
    })}</div>
    {!home && <HouseholdContext familyHref={familyHref} />}
    <p className="halo-ph-footnote">{home ? 'Lead is shown for awareness and is not included in the home score.' : 'Today brings together air quality, UV, pollen, and mold conditions. Check each reading’s update time.'} Estimates are identified in each factor.</p>
  </div>;
}

export function MotionButton() {
  const { motion, paused, togglePaused, deviceReduced } = useSceneExperience();
  if (!motion && !paused) return <span className="halo-ph-motion-note">{deviceReduced ? 'Device motion reduced' : 'Motion reduced'}</span>;
  return <button className="halo-ph-motion" onClick={togglePaused} aria-label={paused ? 'Play ambient animation' : 'Pause ambient animation'} aria-pressed={paused}>{paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}</button>;
}

function HouseholdContext({ home = false, familyHref }: { home?: boolean; familyHref?: string }) {
  const { bands } = usePreviewHousehold();
  const selected = homeMemberKeys.filter(key => bands[memberCatalog[key].band]).map(key => memberCatalog[key].shortLabel);
  if (!home && familyHref) return <Link href={familyHref} prefetch={false} className="halo-ph-family-link">
    <span className="halo-ph-family-symbol"><Users size={25} aria-hidden="true" /></span>
    <span><span className="halo-ph-kicker">Today · Your household</span><strong>A little guidance for everyone.</strong><span>Young children and adults · Explore your daily guidance</span></span>
  </Link>;
  return <aside className="halo-ph-household" data-prominent={home} aria-label="Sample household">
    <div className="halo-ph-household-icon"><Users size={23} aria-hidden="true" /></div>
    <div><h3>{home ? 'The people who make it home' : 'Looking out for your household'}</h3><p>{home ? `Sample household · ${selected.join(', ') || 'No categories selected'}` : 'Sample profile · Adults and a young child'}</p>{home && <span>Choose someone below for guidance on the home you share.</span>}</div>
  </aside>;
}

const actionTitles: Record<FactorKey, string> = { air: 'Make room for better air', uv: 'Before you step outside', pollen: 'Keep the outdoors outdoors', mold: 'A drier home, one step at a time', pfas: 'From a utility result to your tap', radon: 'The next step is a home test', lead: 'A closer look at your plumbing' };

// Frontend review copy checked against EPA's filter guide. Keep the shared API content unchanged.
const pfasPracticalSteps = [
  'Ask your utility for its latest PFAS results. Check which compounds were tested and when the samples were collected.',
  'If you choose a filter, verify its exact model and PFAS-reduction claim under NSF/ANSI 53 or NSF/ANSI 58. A certification logo alone is not enough.',
  'Replace cartridges and membranes on the manufacturer’s schedule. A filter needs maintenance to keep working as intended.',
  'Ask your local health or environmental department what steps it recommends for your water supply. A utility sample does not measure your individual exposure.',
];

export function FactorDetail({ factorKey, scenario, factorHref, parentHref, reading }: { factorKey: FactorKey; scenario: FoundationScenario; factorHref: FactorHref; parentHref: string; reading?: FactorReading }) {
  const { clock } = useSceneExperience();
  const base = reading ?? factorReadings[factorKey];
  const missing = scenario === 'no-data' || scenario === 'card-no-data' || (scenario === 'partial' && factorKey === 'pollen');
  const offline = scenario === 'offline';
  const factor: FactorReading = missing ? { ...base, score: null, severity: 'no_data', reading: 'No data', unit: '', why: null, householdNote: null, trend: [] } : base;
  const Icon = factorIcons[factorKey];
  const accent = factorColor(factorKey);
  const content = learnTopic(factorKey);
  const related = (factorKey === 'pfas' || factorKey === 'radon' || factorKey === 'lead' ? homeFactorKeys : personalFactorKeys).filter(key => key !== factorKey).slice(0, 2);
  const trend = !missing && (factor.trend.length > 0
    ? <FactorTrend points={factor.trend} title={factor.trendTitle} caption={factor.trendCaption} unit={factorKey === 'air' ? 'AQI' : factorKey === 'pfas' ? 'ppt PFOS' : factorKey === 'pollen' ? 'index' : 'UV'} color={accent} />
    : <Reveal><section className="halo-ph-honesty"><h2>{factor.trendTitle}</h2><p>{factor.trendCaption}</p></section></Reveal>);
  return <article className="halo-ph-detail" data-factor={factorKey} style={{ '--factor-accent': accent } as CSSProperties}>
    <section className="halo-ph-factor-hero"><EnvironmentalScene variant={factorKey} />
      <div className="halo-ph-scene-content"><div className="halo-ph-scene-top"><span><Icon size={18} aria-hidden="true" />{clock.label}</span><MotionButton /></div>
        <Reveal><div className="halo-ph-detail-score"><span className="halo-ph-kicker">{factorKey === 'lead' ? 'Not part of the score' : 'Factor score'}</span><strong data-empty={factor.score === null}>{factor.score === null ? (missing ? 'No data' : 'Not scored') : <AnimatedNumber value={factor.score} />}</strong>{factor.score !== null && <span>out of 100 · higher is better</span>}</div></Reveal>
        <div className="halo-ph-reading-capsule"><b>{factor.reading}</b><span>{factor.unit}</span></div><SeverityPill severity={factor.severity} />
      </div>
    </section>
    <nav className="halo-ph-page-nav" aria-label="On this factor page"><PreviewSectionLink target="reading-overview">Summary</PreviewSectionLink><PreviewSectionLink target="reading-detail">Details</PreviewSectionLink><PreviewSectionLink target="protection">Tips</PreviewSectionLink><PreviewSectionLink target="reading-sources">References</PreviewSectionLink></nav>
    <Reveal className="halo-ph-overlap"><section className="halo-ph-detail-intro" id="reading-overview" tabIndex={-1}><span className="halo-ph-kicker">The reading, in plain language</span><h2>{missing ? 'There is no reading to explain yet.' : factor.sentence}</h2><p>{factor.detail}</p><div className="halo-ph-source-line"><ProvenancePill provenance={factor.provenance} /><span>{factor.source}<br />{missing ? 'Reading unavailable' : factor.asOf}</span></div>
      {content && <details className="halo-ph-definition"><summary><h3>What it is</h3><span>Understand {factor.shortTitle}</span></summary><p>{displayText(content.what_it_is)}</p><a href="#reading-sources" className="halo-ph-inline-link">Explore the sources <ArrowUpRight size={15} aria-hidden="true" /></a></details>}
    </section></Reveal>
    {missing && <Callout tone="notice"><p>A missing reading is not a zero. General guidance remains available below.</p></Callout>}
    {factorKey === 'air' && trend}
    <Reveal><div className="halo-ph-reading-story" id="reading-detail" tabIndex={-1}>{!missing && <FactorFocus factor={factor} />}
      {!offline && factor.why && <aside className="halo-ph-why"><h3>Why yours reads this way</h3><p>{displayText(factor.why)}</p></aside>}
      <FactorReadingGuide factorKey={factorKey} />
    </div></Reveal>
    {!offline && !missing && factor.householdNote && <Reveal><aside className="halo-ph-household-note"><Users size={23} aria-hidden="true" /><div><h3>What it means for your household</h3><p>{displayText(factor.householdNote)}</p></div></aside></Reveal>}
    {['uv', 'pollen'].includes(factorKey) && trend}
    {content && <Reveal><section className="halo-ph-protection" id="protection" tabIndex={-1}><span className="halo-ph-kicker">{actionTitles[factorKey]}</span><h2>Small steps that help</h2>
      <FactorSteps factor={factorKey} tips={factorKey === 'pfas' ? pfasPracticalSteps : content.protect} />
      {factorKey === 'pfas' && <a className="halo-ph-inline-link" href="https://www.epa.gov/water-research/identifying-drinking-water-filters-certified-reduce-pfas" target="_blank" rel="noopener noreferrer">EPA guidance on PFAS filters <ArrowUpRight size={15} aria-hidden="true" /></a>}
    </section></Reveal>}
    {['mold', 'pfas', 'radon', 'lead'].includes(factorKey) && trend}
    {content && <section className="halo-ph-sources" id="reading-sources" tabIndex={-1}><h2>Where this comes from</h2><p className="halo-f-meta">The reading source is above. These references explain the factor and practical guidance.</p>{content.sources.map((source: { label: string; url: string; retrieved: string }) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer"><span>{displayText(source.label)}<small>Retrieved {source.retrieved}</small></span><ArrowUpRight size={18} aria-hidden="true" /></a>)}</section>}
    <section className="halo-ph-related"><h2>Keep exploring</h2>{related.map(key => { const RelatedIcon = factorIcons[key]; return <Link key={key} href={factorHref(key)} prefetch={false} style={{ '--factor-accent': factorColor(key) } as CSSProperties}><RelatedIcon size={19} aria-hidden="true" /><span>{factorReadings[key].title}</span><ArrowUpRight size={17} aria-hidden="true" /></Link>; })}<Link href={parentHref} prefetch={false}>Back to your overview</Link></section>
  </article>;
}

function localClock(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  if (hours === 0 && minutes === 0) return 'midnight';
  return `${hours % 12 || 12}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}${hours < 12 ? 'am' : 'pm'}`;
}
function FactorFocus({ factor }: { factor: FactorReading }) {
  const details = factor.details;
  if (factor.key === 'air' && details.air) {
    const air = details.air;
    return <section className="halo-ph-panel halo-ph-air-focus">
      <span className="halo-ph-kicker">Inside the index</span><h2>The particles behind the number</h2>
      <div className="halo-ph-pollutant"><span>{air.pollutant}</span><div><b>{air.pollutantName}</b><p>Dominant pollutant in this reading</p></div></div>
      <p>{air.explanation}</p>
      <div className="halo-ph-scale" aria-label={`AQI ${air.aqi} on a zero to 100 comparison scale`}><span style={{ width: `${Math.min(100, air.aqi)}%` }} /></div>
      <div className="halo-ph-axis"><span>0 AQI</span><span>100 AQI{air.aqi > 100 ? ' (chart continues)' : ''}</span></div>
      <p className="halo-f-meta">Lower AQI means less pollution. Your factor score runs the other way: higher is better.</p>
    </section>;
  }
  if (factor.key === 'uv' && details.uv) {
    const window = details.uv.peak_window;
    if (!window) return null;
    const minutes = (clock: string) => { const [h, m] = clock.split(':').map(Number); return h * 60 + m; };
    const start = minutes(window.start), end = minutes(window.end) || 1440;
    const timelineStart = Math.min(360, start), timelineEnd = Math.max(1080, end);
    const duration = timelineEnd - timelineStart;
    return <section className="halo-ph-panel halo-ph-uv-focus">
      <span className="halo-ph-kicker">Plan around the sun</span><h2>Your shade window</h2>
      <div className="halo-ph-window"><RisingSun /><strong>{localClock(window.start)} <span>to</span> {localClock(window.end)}</strong><span>UV 3 or higher</span></div>
      <div className="halo-ph-daylight" role="img" aria-label={`UV 3 or higher from ${localClock(window.start)} to ${localClock(window.end)}`}><span style={{ left: `${(start - timelineStart) / duration * 100}%`, width: `${(end - start) / duration * 100}%` }} /></div>
      <div className="halo-ph-axis"><span>{localClock(`${Math.floor(timelineStart / 60)}:${timelineStart % 60}`)}</span><span>Local forecast time</span><span>{localClock(`${Math.floor(timelineEnd / 60) % 24}:${timelineEnd % 60}`)}</span></div>
      <p>Highest forecast today: <b>{window.max.toFixed(1)} UV</b>. The window uses the forecast’s local clock times.</p>
      <a className="halo-ph-inline-link" href="#protection">Plan your protection <ArrowUpRight size={16} aria-hidden="true" /></a>
    </section>;
  }
  if (factor.key === 'pollen' && details.pollen) return <section className="halo-ph-panel">
    <span className="halo-ph-kicker">Three different stories</span><h2>What is in the air?</h2>
    <div className="halo-ph-pollen-list">{details.pollen.categories.map(row => <div key={row.name}>
      <div className="halo-ph-panel-heading"><b>{row.name}</b><span>{row.value === null ? 'No data' : `${row.value} / 5`}</span><SeverityPill severity={row.severity} /></div>
      <div className="halo-ph-pollen-dots" aria-label={`${row.name}: ${row.value === null ? 'No data' : `${row.value} of 5`}`}>{[1, 2, 3, 4, 5].map(n => <span key={n} data-active={row.value !== null && n <= row.value} />)}</div>
    </div>)}</div>
    <p className="halo-f-meta">Category index values, not grains per cubic meter. The leading category can change from day to day.</p>
  </section>;
  if (factor.key === 'mold' && details.mold) return <section className="halo-ph-panel">
    <span className="halo-ph-kicker">The weather behind the estimate</span><h2>Two signs of a damp day</h2>
    <div className="halo-ph-moisture-grid"><MoistureMeter value={details.mold.humidity_pct} label="Forecast humidity" /><MoistureMeter value={details.mold.precip_pct} label="Chance of rain" /></div>
    <p>These are outdoor conditions. Use an indoor humidity reading and look for leaks to understand moisture inside your home.</p>
    <a className="halo-ph-inline-link" href="#protection">Care for damp spaces <ArrowUpRight size={16} aria-hidden="true" /></a>
  </section>;
  if (factor.key === 'pfas' && details.water) return <section className="halo-ph-panel">
    <span className="halo-ph-kicker">Inside the utility sample</span><h2>Each compound, in context</h2>
    <p className="halo-f-meta">Illustrative results · {details.water.sampleDate}. Bars share a fixed 0 to 2× comparison scale.</p>
    <div className="halo-ph-water-results">{details.water.rows.map(row => {
      const ratio = row.limit_ppt !== null && row.limit_ppt > 0 ? row.value_ppt / row.limit_ppt : null;
      return <div key={row.name}>
        <div className="halo-ph-panel-heading"><b>{row.name}</b><span>{row.value_ppt.toFixed(1)} ppt{ratio !== null ? ` · ${ratio.toFixed(1)}×` : ''}</span></div>
        {ratio !== null ? <><div className="halo-ph-limit" role="img" aria-label={`${row.name}, ${row.value_ppt} parts per trillion, ${ratio.toFixed(1)} times the supplied limit${ratio > 2 ? ', continues beyond the chart' : ''}`}><span style={{ width: `${Math.min(100, ratio * 50)}%` }} data-exceeds={row.exceeds_limit} /><i />{ratio > 2 && <b aria-hidden="true">›</b>}</div>
          <div className="halo-ph-axis"><span>0</span><span>Limit {row.limit_ppt} ppt</span><span>2×</span></div></> : <p className="halo-f-meta">No comparison limit supplied. Shown, not scored.</p>}
      </div>;
    })}</div>
    {details.water.lithium_ug_l !== null && <div className="halo-ph-unscored"><span><b>Lithium</b><small>Shown, not scored</small></span><strong>{details.water.lithium_ug_l.toFixed(1)} µg/L</strong></div>}
    <p className="halo-f-meta">The marker uses the limit supplied with the result. No enforceable limit is assigned to lithium here.</p>
    <a className="halo-ph-inline-link" href="#protection">Understand filter options <ArrowUpRight size={16} aria-hidden="true" /></a>
  </section>;
  if (factor.key === 'radon' && details.radon) return <section className="halo-ph-panel">
    <span className="halo-ph-kicker">{details.radon.county} County potential</span><h2>A zone is a clue, not a home test.</h2>
    <div className="halo-ph-zones">{[1, 2, 3].map(zone => <div key={zone} data-selected={zone === details.radon!.zone}><span>Zone</span><strong>{zone}</strong><span>{['Higher', 'Middle', 'Lower'][zone - 1]} potential</span>{zone === details.radon!.zone && <b>Sample county</b>}</div>)}</div>
    <p>Testing is the only way to learn the level inside this home. HALO has no home radon measurement to plot.</p>
    <a className="halo-ph-inline-link" href="#protection">Read about home testing <ArrowUpRight size={16} aria-hidden="true" /></a>
  </section>;
  if (factor.key === 'lead' && details.lead) {
    const year = details.lead.home_year;
    const selected = year === null ? null : year < 1950 ? 0 : year < 1988 ? 1 : 2;
    return <section className="halo-ph-panel">
      <span className="halo-ph-kicker">Your home’s story</span><h2>Plumbing has a history.</h2>
      <div className="halo-ph-era">{['Before 1950', '1950 to 1987', '1988 onward'].map((label, i) => <span key={label} data-selected={i === selected}>{i === selected ? <><b>{label}</b><strong>{year}</strong><small>Sample home</small></> : label}</span>)}</div>
      <p>{year === null ? 'The year this home was built has not been supplied.' : 'Building age cannot identify replaced pipes or fixtures.'} A tap-water test gives more specific information.</p>
      <div className="halo-ph-info-note"><ShieldCheck size={21} aria-hidden="true" /><span>This factor is an estimate and is not scored.</span></div>
      <a className="halo-ph-inline-link" href="#protection">See practical steps <ArrowUpRight size={16} aria-hidden="true" /></a>
    </section>;
  }
  return null;
}
function MoistureMeter({ value, label }: { value: number | null; label: string }) {
  return <div className="halo-ph-moisture"><div className="halo-ph-moisture-gauge" style={{ '--moisture': `${value ?? 0}%` } as CSSProperties}><Droplets size={22} aria-hidden="true" /><strong>{value === null ? 'No data' : <AnimatedNumber value={value} />}{value !== null && <small>%</small>}</strong></div><span>{label}</span></div>;
}
