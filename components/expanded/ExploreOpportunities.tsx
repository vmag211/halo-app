'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Clock, MapPin, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import HaloLoading from '@/components/ui/HaloLoading';
import { useHomeDraft } from '@/components/homeguard/HomeWorkspaceState';
import { filterCommunityOpportunities, opportunityState, opportunityLocalDate, opportunityOutdoorHandoff, hasParticipationDraft, communityOpportunities, type CommunityOpportunity, type OpportunityOutdoorHandoff } from '@/lib/frontend/explore-opportunities';
import { localParticipationResources, localResourceScope, type LocalResourceScope } from '@/lib/frontend/explore-local-resources';
import type { ExploreSection } from '@/lib/frontend/explore-preview';
import { blankEngagement } from '@/lib/frontend/explore-workspace';
import { VolunteeringFinder, OfficialDiscoveryRoutes } from './ExploreDiscovery';
import { areaLabel, blankArea } from './ExploreShared';
import { ExplorePhoto } from './ExploreVisuals';
import ProjectIllustration from './ProjectIllustration';
import './explore-opportunities.css';
import {useProductionResource,useProductionRuntime} from '@/components/production/ProductionContext';
import { listingsOff } from '@/lib/frontend/explore-availability';
import {validOpportunityResults} from '@/lib/frontend/production/explore-service';

type Go = (section?: ExploreSection, view?: string, id?: string) => void;
type Href = (tab: string, destination?: string) => string;
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
    <button className="ex-destination" onClick={() => go('opportunities')} aria-label="Get involved: find local volunteering and organizations"><ExplorePhoto scene="cleanup" /><span className="ex-destination-copy"><span className="ex-destination-category">With your community</span><h3>Get involved</h3><span className="ex-destination-description">Cleanups, planting and local programs.</span><span className="ex-destination-location"><MapPin size={14} aria-hidden="true" />{areaLabel(area) || 'Choose your area'}</span><span className="ex-destination-action">Find opportunities<ArrowRight size={17} aria-hidden="true" /></span></span></button>
  </section>;
}

export default function ExploreOpportunities({ go, href }: { go: Go; href: Href }) {
  const runtime=useProductionRuntime();
  const [area] = useHomeDraft('explore:area', blankArea);
  const [selected, setSelected] = useHomeDraft('explore:local-selected', '');
  const [filters, setFilters] = useHomeDraft('explore:local-filters', { scope: 'auto', interest: 'All interests', search: '' });
  const [timing, setTiming] = useHomeDraft('explore:opportunity-timing', 'all');
  const [refreshing, setRefreshing] = useState(false); const [notice, setNotice] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const now = useSyncExternalStore<number | null>(subscribeClock, readClock, serverClock);
  // Server-rendered controls must not accept native edits before React can retain them.
  const controlsReady = now !== null;
  const queryKey=JSON.stringify([area,filters.interest,filters.search,timing]);
  const [page,setPage]=useState<{key:string;cursor:string|null}>({key:'',cursor:null});const cursor=page.key===queryKey?page.cursor:null;
  const setCursor=(cursor:string|null)=>setPage({key:queryKey,cursor});
  const live=useProductionResource<unknown>('opportunities.search',{area,interest:filters.interest,search:filters.search,timing,cursor},Boolean(runtime));
  const result=validOpportunityResults(live.data)?live.data:null;
  const scope = filters.scope === 'auto' ? localResourceScope(area) : filters.scope as LocalResourceScope;
  const listings=runtime?result?.items??[]:communityOpportunities;
  const matches = now === null ? [] : runtime?listings.filter(item=>['upcoming','rolling'].includes(opportunityState(item,now))):filterCommunityOpportunities({ area, scope, timing, interest: filters.interest, search: filters.search, now });
  const staleCoverage = now !== null && listings.some(item => (runtime||scope === 'examples' || item.scopes.includes(scope)) && opportunityState(item, now) === 'needs-check');
  const opportunity = listings.find(item => item.id === selected);
  if (opportunity && now !== null) return <OpportunityDetail key={opportunity.id} item={opportunity} back={() => setSelected('')} go={go} href={href} now={now} />;
  if (!runtime&&localParticipationResources.some(item => item.id === selected)) return <VolunteeringFinder go={go} />;
  return <section className="ex-detail ex-opportunity-finder" aria-label="Local volunteering and organizations">
    <p className="ex-opportunity-result-note">Upcoming events and rolling programs, with official next steps.</p>
    <label className="ex-opportunity-search"><Search size={17} aria-hidden="true" /><span className="ex-sr">Find a program or organization</span><input type="search" maxLength={160} disabled={!controlsReady} value={filters.search} placeholder="Trees, cleanups, gardening..." onChange={event => setFilters({ ...filters, search: event.target.value })} /></label>
    <div className="ex-opportunity-filters"><label>What interests you?<select disabled={!controlsReady} value={filters.interest} onChange={event => setFilters({ ...filters, interest: event.target.value })}>{['All interests', 'Cleanup', 'Trees & habitat', 'Gardening', 'Community learning'].map(value => <option key={value}>{value}</option>)}</select></label><label>When?<select disabled={!controlsReady} value={timing} onChange={event => setTiming(event.target.value)}><option value="all">Show both</option><option value="upcoming">Upcoming</option><option value="rolling">Rolling</option></select></label></div>
    <div className="ex-opportunity-location"><MapPin size={16} aria-hidden="true" /><span>{runtime?result?.areaLabel||areaLabel(area)||'Choose your area':filters.scope === 'auto' ? areaLabel(area) || 'Charlotte review examples' : scope === 'charlotte' ? 'Charlotte & Mecklenburg' : scope === 'union' ? 'Union County' : scope === 'basin' ? 'Catawba-Wateree basin' : 'Other areas'}</span><button className="ex-text-button" disabled={refreshing||live.loading||live.off} onClick={() => {if(runtime){setCursor(null);live.retry();return;}setRefreshing(true); setNotice(''); timer.current = setTimeout(() => { timer.current = null; setRefreshing(false); setNotice('Listings refreshed. Confirm availability with the organizer.'); }, 850); }}>{refreshing||live.loading ? 'Checking...' : 'Refresh listings'}</button></div>
    <details className="ex-opportunity-coverage"><summary>Location and source coverage</summary>{runtime?<p>{result?`Sources checked ${result.checkedAt}. ${result.complete?'This result set is complete.':'More listings may be available.'}`:live.off?'Local listings are not checked yet.':'Source coverage is being checked.'} A published listing does not guarantee space or current registration.</p>:<><label>Browse reviewed areas<select disabled={!controlsReady} value={filters.scope} onChange={event => setFilters({ ...filters, scope: event.target.value })}><option value="auto">Use my chosen area</option><option value="charlotte">Charlotte &amp; Mecklenburg</option><option value="union">Union County, NC</option><option value="basin">Catawba-Wateree basin</option><option value="elsewhere">Find resources elsewhere</option></select></label><p>Official source snapshots, checked October 11, 2026. Your area filters the reviewed coverage; this is not live geocoding or distance ranking. Dates are venue local time. A published listing does not guarantee space or current registration.</p></>}</details>
    {runtime&&Boolean(live.loading||live.error||live.data&&!result)&&(live.loading?<HaloLoading label="Finding local opportunities" />:<p role="status">{live.off?listingsOff:live.error||'The listing response was incomplete. Try refreshing.'}</p>)}
    {notice && <p className="ex-meta" role="status">{notice}</p>}
    <div className="ex-opportunity-list" aria-label="Upcoming and rolling opportunities" aria-busy={refreshing}>{matches.map(item => <button key={item.id} className="ex-opportunity-card" data-opportunity-id={item.id} data-opportunity-kind={item.kind} onClick={() => setSelected(item.id)}><ProjectIllustration kind={item.artwork} compact /><span><small className="ex-opportunity-kind">{item.kind === 'scheduled' ? 'Upcoming date' : 'Rolling program'} · {item.interest}</small><strong>{item.title}</strong><small>{item.organizer}</small><span className="ex-opportunity-date"><CalendarDays size={14} aria-hidden="true" />{item.timeLabel}</span></span><ArrowRight size={17} aria-hidden="true" /></button>)}</div>
    {now === null && <p role="status" className="ex-meta">Checking listings...</p>}
    {now !== null && !matches.length && !live.loading && !live.error && <div className="ex-empty"><h4>{runtime&&result?.availability==='unavailable'?'Local listings unavailable':runtime&&result?.availability==='no_coverage'||!runtime&&scope === 'elsewhere' ? 'No reviewed local coverage' : staleCoverage ? 'Listing updates needed' : 'No matching upcoming listings'}</h4><p>{staleCoverage ? 'These snapshots need a fresh source check. Use the organizer’s current listings; this is not an empty local search.' : 'Try a different interest or the organizer’s current listings. Missing results do not mean there is nothing nearby.'}</p><button className="ex-text-button" onClick={() => {setCursor(null); setTiming('all'); setFilters({ ...filters, interest: 'All interests', search: '' }); }}>Clear interest and date filters</button></div>}
    {runtime&&result?.nextCursor&&<button className="ex-text-button" disabled={live.loading} onClick={()=>{setSelected('');setCursor(result.nextCursor);}}>Next listings</button>}{runtime&&cursor&&<button className="ex-text-button" onClick={()=>setCursor(null)}>Back to first listings</button>}
    <details className="ex-opportunity-programs"><summary>Organizations and other ways to help</summary><VolunteeringFinder go={go} compact /></details>
    {(scope === 'elsewhere' || !matches.length) && <OfficialDiscoveryRoutes go={go} />}
    <p className="ex-meta">Confirm the meeting address and availability on the official site before travelling.</p>
  </section>;
}

function OpportunityDetail({ item, back, go, href, now }: { item: CommunityOpportunity; back: () => void; go: Go; href: Href; now: number }) {
  const router = useRouter();
  const heading = useRef<HTMLHeadingElement>(null);
  const [draft, setDraft] = useHomeDraft('explore:commitment:new', blankEngagement());
  const [, setOutdoorHandoff] = useHomeDraft<OpportunityOutdoorHandoff | null>('week:outdoor-handoff', null);
  const [replace, setReplace] = useState(false);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  const status = opportunityState(item, now); const available = status === 'upcoming' || status === 'rolling';
  function prepare() {
    const date = opportunityLocalDate(item);
    setDraft({ ...blankEngagement(), title: item.title, organizer: item.organizer, cause: item.interest === 'Cleanup' ? 'Public spaces' : 'Habitats', url: item.url, place: item.address || item.venue, date, preparation: `${item.timeLabel}. Source checked ${item.checkedAt}.${date ? '' : '\nConfirm the venue-local calendar date before scheduling.'}\n${item.bring}\n${item.safety}\nConfirm the actual meeting point, access and registration on the official page.` });
    go('opportunities', 'new');
  }
  return <section className="ex-detail ex-opportunity-detail" aria-label="Opportunity details" data-opportunity-id={item.id}>
    <button className="ex-text-button" onClick={back}><ArrowLeft size={16} aria-hidden="true" />All opportunities</button>
    <div className="ex-opportunity-photo"><ExplorePhoto scene={item.artwork === 'tree' ? 'tree' : item.artwork === 'garden' ? 'garden' : 'cleanup'} /><small>Activity photo, not the venue</small></div>
    <header><span className="ex-kicker">{item.interest} · {item.kind === 'scheduled' ? 'Scheduled session' : 'Rolling program'}</span><h3 ref={heading} tabIndex={-1}>{item.title}</h3><p>{item.organizer} · {item.area}</p></header>
    {!available && <p className="ex-notice" role="status">{status === 'past' ? 'This session has already started or passed.' : status === 'cancelled' ? 'This listing reports a cancelled session.' : status === 'full' ? 'This listing reports no available places.' : status === 'postponed' ? 'This session is postponed. A new date is not confirmed here.' : 'This listing needs a fresh availability check.'} Use the organizer’s site for current opportunities.</p>}
    <p className="ex-opportunity-summary">{item.summary}</p>
    <div className="ex-opportunity-at-a-glance"><p><CalendarDays size={17} aria-hidden="true" /><span>{item.timeLabel}</span></p><p><Clock size={17} aria-hidden="true" /><span>{item.duration}</span></p><p><MapPin size={17} aria-hidden="true" /><span>{item.venue}</span></p></div>
    <div className="ex-opportunity-decision"><section className="ex-opportunity-work"><h4>What you’ll do</h4><ol>{item.work.map(work => <li key={work}>{work}</li>)}</ol></section><dl className="ex-opportunity-essentials"><div><dt>Cost</dt><dd>{item.cost}</dd></div><div><dt>Who can join</dt><dd>{item.age}</dd></div><div><dt>Access</dt><dd>{item.access}</dd></div></dl></div>
    <p className="ex-opportunity-safety">{item.safety}</p>
    <a className="ex-button" href={item.url} target="_blank" rel="noreferrer">{available ? 'Check details & registration' : 'Open official organizer page'}<ArrowUpRight size={16} aria-hidden="true" /></a>
    <p className="ex-meta">Official website. Opening it does not register you.</p>
    <details className="ex-opportunity-consider"><summary>Preparation and access details</summary><dl className="ex-facts">{Object.entries({ 'Access and suitable tasks': item.access, 'Bring or prepare': item.bring }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details>
    <div className="ex-opportunity-actions"><button className="ex-secondary-button" disabled={!available} onClick={() => hasParticipationDraft(draft) ? setReplace(true) : prepare()}>Plan my participation<ArrowRight size={16} aria-hidden="true" /></button><button className="ex-secondary-button" onClick={() => { setOutdoorHandoff(opportunityOutdoorHandoff(item)); router.push(href('plan', 'outdoors')); }}>Check outdoor conditions<ArrowRight size={16} aria-hidden="true" /></button></div>
    {replace && <div className="ex-notice" role="group" aria-label="Keep or replace participation draft"><p>You have an unfinished participation draft.</p><button className="ex-text-button" onClick={() => go('opportunities', 'new')}>Open my existing draft</button><button className="ex-text-button" onClick={prepare}>Replace unfinished draft with this opportunity</button><button className="ex-text-button" onClick={() => setReplace(false)}>Cancel</button></div>}
    <details className="ex-opportunity-coverage"><summary>Source and availability</summary><p>Official listing checked {item.checkedAt}. Capacity and registration are confirmed by the organizer. {item.venueTimezoneBasis === 'source' ? `Venue timezone: ${item.venueTimezone}.` : 'Confirm the venue-local date and timezone before scheduling.'}</p>{item.address&&<p>Meeting address: {item.address}</p>}<a href={item.url} target="_blank" rel="noreferrer">Original source</a></details>
  </section>;
}
