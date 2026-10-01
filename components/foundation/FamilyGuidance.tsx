'use client';

import { useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { BookOpen, Check, Droplets, Flower2, Info, Leaf, ShieldCheck, Sun, Users, Wind } from 'lucide-react';
import SeverityPill from '@/components/ui/SeverityPill';
import { Callout } from '@/components/ui/Foundation';
import { factorColor, factorReadings, type FactorKey } from '@/lib/frontend/factor-preview';
import type { FoundationScenario } from '@/lib/frontend/foundation-preview';
import { learnTopic } from '@/lib/learnContent';
import { displayText } from '@/lib/frontend/onboarding';
import EnvironmentalScene from './EnvironmentalScene';
import { MotionButton, type FactorHref } from './PersonalHero';
import { Reveal, useSceneExperience } from './SceneExperience';
import RisingSun from './RisingSun';
import { useStageRuntime } from './StageRuntime';
import { homeMemberKeys, memberCatalog } from '@/lib/frontend/home-household';

type Area = 'all' | 'outside' | 'inside';
const guidance: { key: FactorKey; area: Area; title: string; action: string; why: string; source: string; url: string }[] = [
  { key: 'uv', area: 'outside', title: 'Make room for shade', action: 'For time outside, plan shade and protective clothing around the forecast UV window.', why: 'The sample forecast reaches UV 3 or higher from 11am to 3pm. Young children are included in this sample household.', source: 'EPA sun safety', url: 'https://www.epa.gov/sunsafety/uv-index-scale-0' },
  { key: 'air', area: 'outside', title: 'Check before a longer outing', action: 'Use the latest outdoor AQI when planning activity. Recheck if conditions change.', why: 'The sample AQI is 37. The reading describes outdoor air nearby, not the exposure of each person in your home.', source: 'AirNow AQI guidance', url: 'https://www.airnow.gov/aqi/aqi-basics/' },
  { key: 'pollen', area: 'outside', title: 'Bring home fewer outdoor particles', action: 'After extended time outdoors, changing clothes and showering can reduce pollen carried inside.', why: 'Grass is the leading category in this sample. That does not identify anyone’s allergy trigger.', source: 'CDC pollen guidance', url: 'https://www.cdc.gov/climate-health/php/effects/pollen-health.html' },
  { key: 'mold', area: 'inside', title: 'Check the places that stay damp', action: 'Look for leaks and condensation. Use an indoor humidity reading if one is available.', why: 'The sample forecast is humid, but HALO has not measured moisture or mold inside this home.', source: 'EPA moisture guidance', url: 'https://www.epa.gov/mold/brief-guide-mold-moisture-and-your-home' },
];
const icons = { air: Wind, uv: Sun, pollen: Flower2, mold: Leaf, pfas: Droplets, radon: ShieldCheck, lead: ShieldCheck };

/** Review fixture using the existing household categories. No personal health scoring or API writes. */
export default function FamilyGuidance({ scenario, factorHref, parentHref }: { scenario: FoundationScenario; factorHref: FactorHref; parentHref: string }) {
  const { clock } = useSceneExperience();
  const runtime = useStageRuntime();
  const readings = runtime?.readings ?? factorReadings;
  const categories = runtime ? homeMemberKeys.filter(key => runtime.household[memberCatalog[key].band]).map(key => memberCatalog[key].label) : ['Young children', 'Adults'];
  const uvWindow = readings.uv.details.uv?.peak_window;
  const clockLabel = (clock: string) => { const [h, m] = clock.split(':').map(Number); return h === 0 && m === 0 ? 'midnight' : `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`; };
  const minutes = (value: string) => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
  const windowStart = uvWindow ? minutes(uvWindow.start) : 0;
  const windowEnd = uvWindow ? minutes(uvWindow.end) || 1440 : 0;
  const axisStart = Math.min(360, windowStart), axisEnd = Math.max(1080, windowEnd);
  const [area, setArea] = useState<Area>('all');
  const [checked, setChecked] = useState<string[]>([]);
  const unavailable = ['no-data', 'offline-empty', 'error'].includes(scenario);
  const offline = scenario === 'offline';
  const selected = guidance.filter(item => area === 'all' || item.area === area);
  const steps = [
    { key: 'uv', text: 'Look at the UV window before time outdoors.' },
    { key: 'air', text: 'Check the latest air and pollen readings.' },
    { key: 'mold', text: 'Look for damp areas that need attention.' },
  ];
  return <article className="halo-family">
    <section className="halo-family-hero"><EnvironmentalScene variant="landscape" /><div className="halo-ph-scene-content"><div className="halo-ph-scene-top"><span><Users size={17} aria-hidden="true" />{clock.label}</span><MotionButton /></div><span className="halo-family-emblem"><Users size={35} strokeWidth={1.4} aria-hidden="true" /></span><span className="halo-ph-kicker">Today</span><h2>For the people<br />you look out for.</h2><p>Shared surroundings.<br />Guidance with your household in mind.</p></div></section>
    <section className="halo-family-profile"><span className="halo-ph-kicker">Who this guidance considers</span><div className="halo-family-bands">{categories.length ? categories.map(label => <span key={label}>{label}</span>) : <span>General household guidance</span>}</div><p>{runtime ? 'Selected household categories, not individual profiles.' : 'Sample household categories, not individual profiles.'}</p><details><summary>How household context is used</summary><p>HALO uses the categories chosen during setup to explain readings and prioritize guidance. These categories do not change environmental measurements, severities, or scores. No names, birthdays, or individual medical scores are used.</p></details></section>
    {(unavailable || offline) && <Callout tone="notice"><p>{unavailable ? 'Current readings are unavailable. The guidance below is general and does not describe conditions today.' : runtime ? 'You are viewing stored readings. Check their dates before planning. Household-specific interpretation is unavailable offline.' : 'You are viewing stored sample readings. Check their dates before planning. Household-specific interpretation is unavailable offline.'}</p></Callout>}
    {!unavailable && (!runtime || uvWindow) && <Reveal><section className="halo-family-window"><RisingSun /><span className="halo-ph-kicker">One useful detail for your day</span><h2>Plan a little shade.</h2><div className="halo-family-window-time"><Sun size={24} aria-hidden="true" />{runtime ? <strong>{uvWindow ? clockLabel(uvWindow.start) : '11am'} <span>to</span> {uvWindow ? clockLabel(uvWindow.end) : '3pm'}</strong> : <strong>11am <span>to</span> 3pm</strong>}</div>{runtime ? <p>{'The UV forecast'} reaches 3 or higher during this window.</p> : <p>The sample UV forecast reaches 3 or higher during this window.</p>}<div className="halo-family-day-strip" role="img" aria-label={runtime && uvWindow ? `UV 3 or higher from ${clockLabel(uvWindow.start)} to ${clockLabel(uvWindow.end)}, local forecast time` : 'UV 3 or higher from 11am to 3pm on a 6am to 6pm timeline'}><span style={runtime ? { left: `${(windowStart - axisStart) / (axisEnd - axisStart) * 100}%`, width: `${(windowEnd - windowStart) / (axisEnd - axisStart) * 100}%` } : undefined} /></div><div className="halo-ph-axis"><span>{runtime ? clockLabel(`${Math.floor(axisStart / 60)}:${axisStart % 60}`) : '6am'}</span><span>{runtime ? 'Local forecast time' : 'Noon'}</span><span>{runtime ? clockLabel(`${Math.floor(axisEnd / 60) % 24}:${axisEnd % 60}`) : '6pm'}</span></div><p className="halo-family-caveat">This is a UV window, not a combined forecast of the safest time to go outside.</p><Link href={factorHref('uv')} prefetch={false}>Explore the UV forecast</Link></section></Reveal>}
    <section className="halo-family-guidance"><div className="halo-family-section-heading"><span className="halo-ph-kicker">Readings into practical guidance</span><h2>{unavailable ? 'Small steps to keep in mind' : 'What to keep in mind'}</h2><p>Choose a setting. Open a factor for the full reading and its sources.</p></div><div className="halo-family-filters" aria-label="Filter household guidance">{([['all', 'All guidance'], ['outside', 'Outdoors'], ['inside', 'At home']] as const).map(([key, label]) => <button key={key} aria-pressed={area === key} onClick={() => setArea(key)}>{label}</button>)}</div><p className="halo-sr-only" role="status">{selected.length} guidance topics shown</p>
      <div className="halo-family-guidance-list">{selected.map((item, index) => {
        const factor = readings[item.key]; const Icon = icons[item.key];
        const missing = unavailable || (runtime ? factor.severity === 'no_data' : scenario === 'partial' && item.key === 'pollen');
        const topic = learnTopic(item.key);
        // This fixture mirrors one applicable household note, not a member-by-factor matrix.
        const householdNote = !missing && !offline ? (runtime ? runtime.learn[item.key]?.household_note : topic?.household?.has_toddler) ?? null : null;
        return <Reveal key={item.key} delay={index * 70}><section className="halo-family-guidance-item" style={{ '--factor-accent': factorColor(item.key) } as CSSProperties}><div className="halo-family-reading"><Icon size={21} aria-hidden="true" /><span>{factor.title}</span><SeverityPill severity={missing ? 'no_data' : factor.severity} /></div><h3>{item.title}</h3><p>{item.action}</p><div className="halo-family-reading-value"><b>{missing ? 'Reading unavailable' : `${factor.reading} ${factor.unit}`}</b><span>{missing ? 'General guidance only' : factor.asOf}</span></div><details><summary>Why this belongs here</summary><p>{missing ? 'A reading is missing, so HALO cannot explain the current conditions. These are general educational steps.' : offline ? 'Stored readings are shown for reference. A current household interpretation is not available offline.' : runtime ? displayText(runtime.learn[item.key]?.why_yours || factor.sentence) : item.why}</p>{householdNote && <p>{displayText(householdNote)}</p>}<a href={item.url} target="_blank" rel="noopener noreferrer">{item.source}</a></details><Link href={factorHref(item.key)} prefetch={false}>Explore {factor.shortTitle.toLowerCase()}</Link></section></Reveal>;
      })}</div>
    </section>
    <Reveal><section className="halo-family-checklist"><span className="halo-ph-kicker">A quick check, when it helps</span><h2>Your next few steps</h2><p>Use this as a small reminder, not a health score.</p>{steps.map(step => <label key={step.key}><input type="checkbox" checked={checked.includes(step.key)} onChange={event => setChecked(current => event.target.checked ? [...current, step.key] : current.filter(key => key !== step.key))} /><span className="halo-family-checkmark" aria-hidden="true">{checked.includes(step.key) && <Check size={16} />}</span><span>{step.text}</span></label>)}<p className="halo-family-caveat" role="status">{checked.length} of {steps.length} checked for this visit. This checklist resets when you leave or reload. It does not change your scores.</p></section></Reveal>
    <section className="halo-family-limits"><Info size={22} aria-hidden="true" /><h2>Helpful context, not a diagnosis.</h2><p>These are local environmental readings and general guidance. They do not measure each person’s exposure or predict illness. For an individual health concern, speak with a healthcare professional.</p><div><BookOpen size={18} aria-hidden="true" /><p>Journal can help you record how your household feels. Patterns in those records are associations, not proof of a cause.</p></div></section>
    <Link className="halo-family-back" href={parentHref} prefetch={false}>Back to Today</Link>
  </article>;
}
