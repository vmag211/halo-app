'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Clock, MapPin, Search } from 'lucide-react';
import { useHomeDraft } from '@/components/homeguard/HomeWorkspaceState';
import { filterCommunityOpportunities, opportunityState, communityOpportunities, type CommunityOpportunity } from '@/lib/frontend/explore-opportunities';
import { localParticipationResources, localResourceScope, type LocalResourceScope } from '@/lib/frontend/explore-local-resources';
import type { ExploreSection } from '@/lib/frontend/explore-preview';
import { blankEngagement } from '@/lib/frontend/explore-workspace';
import { VolunteeringFinder, OfficialDiscoveryRoutes } from './ExploreDiscovery';
import { areaLabel, blankArea } from './ExploreShared';
import { ExplorePhoto } from './ExploreVisuals';
import ProjectIllustration from './ProjectIllustration';
import './explore-opportunities.css';

type Go = (section?: ExploreSection, view?: string, id?: string) => void;
const readClock = () => Math.floor(Date.now() / 60000) * 60000;
const serverClock = () => null;
function subscribeClock(notify: () => void) {
  const tick = setInterval(notify, 1000);
  document.addEventListener('visibilitychange', notify);
  return () => { clearInterval(tick); document.removeEventListener('visibilitychange', notify); };
}
export function GetInvolvedPreview({ go }: { go: Go }) {
  const [area] = useHomeDraft('explore:area', blankArea);
  return <section className="ex-involvement-preview" aria-label="Get involved">
    <div className="ex-workbench-section-head"><h3>Get involved</h3><button className="ex-text-button" onClick={() => go('opportunities')}>Find opportunities<ArrowRight size={16} aria-hidden="true" /></button></div>
    <button className="ex-involvement-cover" onClick={() => go('opportunities')} aria-label="Get involved: find local volunteering and organizations"><ExplorePhoto scene="trail" /><span><small>Events &amp; ongoing programs</small><strong>Community volunteering</strong><span><MapPin size={15} aria-hidden="true" />{areaLabel(area) || 'Choose your area'}<ArrowRight size={18} aria-hidden="true" /></span></span></button>
  </section>;
}

export default function ExploreOpportunities({ go }: { go: Go }) {
  const [area] = useHomeDraft('explore:area', blankArea);
  const [selected, setSelected] = useHomeDraft('explore:local-selected', '');
  const [filters, setFilters] = useHomeDraft('explore:local-filters', { scope: 'auto', interest: 'All interests', search: '' });
  const [timing, setTiming] = useHomeDraft('explore:opportunity-timing', 'all');
  const [refreshing, setRefreshing] = useState(false); const [notice, setNotice] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const now = useSyncExternalStore<number | null>(subscribeClock, readClock, serverClock);
  const scope = filters.scope === 'auto' ? localResourceScope(area) : filters.scope as LocalResourceScope;
  const matches = now === null ? [] : filterCommunityOpportunities({ area, scope, timing, interest: filters.interest, search: filters.search, now });
  const staleCoverage = now !== null && communityOpportunities.some(item => (scope === 'examples' || item.scopes.includes(scope)) && opportunityState(item, now) === 'needs-check');
  const opportunity = communityOpportunities.find(item => item.id === selected);
  if (opportunity && now !== null) return <OpportunityDetail key={opportunity.id} item={opportunity} back={() => setSelected('')} go={go} now={now} />;
  if (localParticipationResources.some(item => item.id === selected)) return <VolunteeringFinder go={go} />;
  return <section className="ex-detail ex-opportunity-finder" aria-label="Local volunteering and organizations">
    <p className="ex-opportunity-result-note">Upcoming events and rolling programs, with official next steps.</p>
    <label className="ex-opportunity-search"><Search size={17} aria-hidden="true" /><span className="ex-sr">Find a program or organization</span><input type="search" maxLength={160} value={filters.search} placeholder="Trees, cleanups, gardening..." onChange={event => setFilters({ ...filters, search: event.target.value })} /></label>
    <div className="ex-opportunity-filters"><label>What interests you?<select value={filters.interest} onChange={event => setFilters({ ...filters, interest: event.target.value })}>{['All interests', 'Cleanup', 'Trees & habitat', 'Gardening', 'Community learning'].map(value => <option key={value}>{value}</option>)}</select></label><label>When?<select value={timing} onChange={event => setTiming(event.target.value)}><option value="all">Show both</option><option value="upcoming">Upcoming</option><option value="rolling">Rolling</option></select></label></div>
    <div className="ex-opportunity-location"><MapPin size={16} aria-hidden="true" /><span>{filters.scope === 'auto' ? areaLabel(area) || 'Charlotte review examples' : scope === 'charlotte' ? 'Charlotte & Mecklenburg' : scope === 'union' ? 'Union County' : scope === 'basin' ? 'Catawba-Wateree basin' : 'Other areas'}</span><button className="ex-text-button" disabled={refreshing} onClick={() => { setRefreshing(true); setNotice(''); timer.current = setTimeout(() => { timer.current = null; setRefreshing(false); setNotice('Listings refreshed. Confirm availability with the organizer.'); }, 850); }}>{refreshing ? 'Checking...' : 'Refresh listings'}</button></div>
    <details className="ex-opportunity-coverage"><summary>Location and source coverage</summary><label>Browse reviewed areas<select value={filters.scope} onChange={event => setFilters({ ...filters, scope: event.target.value })}><option value="auto">Use my chosen area</option><option value="charlotte">Charlotte &amp; Mecklenburg</option><option value="union">Union County, NC</option><option value="basin">Catawba-Wateree basin</option><option value="elsewhere">Find resources elsewhere</option></select></label><p>Official source snapshots, checked October 11, 2026. Your area filters the reviewed coverage; this is not live geocoding or distance ranking. Dates are venue local time. A published listing does not guarantee space or current registration.</p></details>
    {notice && <p className="ex-meta" role="status">{notice}</p>}
    <div className="ex-opportunity-list" aria-label="Upcoming and rolling opportunities" aria-busy={refreshing}>{matches.map(item => <button key={item.id} className="ex-opportunity-card" data-opportunity-id={item.id} data-opportunity-kind={item.kind} onClick={() => setSelected(item.id)}><ProjectIllustration kind={item.artwork} compact /><span><small className="ex-opportunity-kind">{item.kind === 'scheduled' ? 'Upcoming date' : 'Rolling program'} · {item.interest}</small><strong>{item.title}</strong><small>{item.organizer}</small><span className="ex-opportunity-date"><CalendarDays size={14} aria-hidden="true" />{item.timeLabel}</span></span><ArrowRight size={17} aria-hidden="true" /></button>)}</div>
    {now === null && <p role="status" className="ex-meta">Checking listings...</p>}
    {now !== null && !matches.length && <div className="ex-empty"><h4>{scope === 'elsewhere' ? 'No reviewed local coverage' : staleCoverage ? 'Listing updates needed' : 'No matching upcoming listings'}</h4><p>{staleCoverage ? 'These snapshots need a fresh source check. Use the organizer’s current listings; this is not an empty local search.' : 'Try a different interest or the organizer’s current listings. Missing results do not mean there is nothing nearby.'}</p><button className="ex-text-button" onClick={() => { setTiming('all'); setFilters({ ...filters, interest: 'All interests', search: '' }); }}>Clear interest and date filters</button></div>}
    <details className="ex-opportunity-programs"><summary>Organizations and other ways to help</summary><VolunteeringFinder go={go} compact /></details>
    {(scope === 'elsewhere' || !matches.length) && <OfficialDiscoveryRoutes go={go} />}
    <p className="ex-meta">Confirm the meeting address and availability on the official site before travelling.</p>
  </section>;
}

function OpportunityDetail({ item, back, go, now }: { item: CommunityOpportunity; back: () => void; go: Go; now: number }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [draft, setDraft] = useHomeDraft('explore:commitment:new', blankEngagement());
  const [replace, setReplace] = useState(false);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  const status = opportunityState(item, now); const available = status === 'upcoming' || status === 'rolling';
  function prepare() {
    setDraft({ ...blankEngagement(), title: item.title, organizer: item.organizer, cause: item.interest === 'Cleanup' ? 'Public spaces' : 'Habitats', url: item.url, place: item.venue, date: item.startsAt?.slice(0, 10) ?? '', preparation: `${item.timeLabel}. Source checked ${item.checkedAt}.\n${item.bring}\n${item.safety}\nConfirm the actual meeting point, access and registration on the official page.` });
    go('opportunities', 'new');
  }
  return <section className="ex-detail ex-opportunity-detail" aria-label="Opportunity details" data-opportunity-id={item.id}>
    <button className="ex-text-button" onClick={back}><ArrowLeft size={16} aria-hidden="true" />All opportunities</button>
    <ProjectIllustration kind={item.artwork} />
    <header><span className="ex-kicker">{item.interest} · {item.kind === 'scheduled' ? 'Scheduled session' : 'Rolling program'}</span><h3 ref={heading} tabIndex={-1}>{item.title}</h3><p>{item.organizer} · {item.area}</p></header>
    {!available && <p className="ex-notice" role="status">{status === 'past' ? 'This session has already started or passed.' : status === 'cancelled' ? 'This listing reports a cancelled session.' : status === 'full' ? 'This listing reports no available places.' : status === 'postponed' ? 'This session is postponed. A new date is not confirmed here.' : 'This listing needs a fresh availability check.'} Use the organizer’s site for current opportunities.</p>}
    <p className="ex-opportunity-summary">{item.summary}</p>
    <div className="ex-opportunity-at-a-glance"><p><CalendarDays size={17} aria-hidden="true" /><span>{item.timeLabel}</span></p><p><Clock size={17} aria-hidden="true" /><span>{item.duration}</span></p><p><MapPin size={17} aria-hidden="true" /><span>{item.venue}</span></p></div>
    <section className="ex-opportunity-work"><h4>What you’ll do</h4><ul>{item.work.map(work => <li key={work}>{work}</li>)}</ul></section>
    <dl className="ex-opportunity-essentials"><div><dt>Cost</dt><dd>{item.cost}</dd></div><div><dt>Who can join</dt><dd>{item.age}</dd></div></dl>
    <p className="ex-meta">Accessibility is not confirmed. Ask about a suitable task before joining.</p>
    <p className="ex-meta">{item.safety}</p>
    <a className="ex-button" href={item.url} target="_blank" rel="noreferrer">{available ? 'Check details & registration' : 'Open official organizer page'}<ArrowUpRight size={16} aria-hidden="true" /></a>
    <p className="ex-meta">Official website. Opening it does not register you.</p>
    <details className="ex-opportunity-consider"><summary>Preparation and access details</summary><dl className="ex-facts">{Object.entries({ 'Access and suitable tasks': item.access, 'Bring or prepare': item.bring }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details>
    <button className="ex-text-button" disabled={!available} onClick={() => draft.title || draft.preparation ? setReplace(true) : prepare()}>Plan my participation<ArrowRight size={16} aria-hidden="true" /></button>
    {replace && <div className="ex-notice" role="group" aria-label="Keep or replace participation draft"><p>You have an unfinished participation draft.</p><button className="ex-text-button" onClick={() => go('opportunities', 'new')}>Open my existing draft</button><button className="ex-text-button" onClick={prepare}>Replace unfinished draft with this opportunity</button><button className="ex-text-button" onClick={() => setReplace(false)}>Cancel</button></div>}
    <details className="ex-opportunity-coverage"><summary>Source and availability</summary><p>Official listing checked {item.checkedAt}. Snapshot only, not live capacity or registration. Exact meeting address and accessibility are not supplied here. Scheduled times use the Charlotte venue’s America/New_York timezone; recheck with the organizer. </p><a href={item.url} target="_blank" rel="noreferrer">Original source</a></details>
  </section>;
}
