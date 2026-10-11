import { localResourceScope, type LocalResourceScope } from './explore-local-resources';
import { validDay } from './explore-workspace';
type ExploreArea = { place: string; state: string };

/** Checked public snapshots, not a live availability or distance service. */
export type CommunityOpportunity = {
  id: string; organizer: string; title: string; interest: string; artwork: 'tree' | 'cleanup' | 'garden';
  scopes: LocalResourceScope[]; area: string; venue: string; address?: string;
  kind: 'scheduled' | 'rolling'; startsAt?: string; endsAt?: string; timeLabel: string;
  checkedAt: string; status: 'listed' | 'cancelled' | 'full' | 'postponed'; url: string;
  summary: string; work: string[]; duration: string; cost: string; age: string; access: string;
  bring: string; join: string; safety: string;
};
const checkedAt = '2026-10-11';
export const communityOpportunities: CommunityOpportunity[] = [
  {
    id: 'long-creek-treeday', organizer: 'TreesCharlotte', title: 'Long Creek Greenway TreeDay', interest: 'Trees & habitat', artwork: 'tree', scopes: ['charlotte'], area: 'Charlotte area', venue: 'Long Creek Greenway, Miranda Road. Confirm the exact meeting address.',
    kind: 'scheduled', startsAt: '2026-10-23T14:00:00Z', endsAt: '2026-10-23T16:00:00Z', timeLabel: 'Fri, Oct 23 · 10am to noon, venue local time', checkedAt, status: 'listed',
    url: 'https://treescharlotte.org/event/long-creek-greenway-miranda-road-treeday/',
    summary: 'Help plant trees with TreesCharlotte at a scheduled community TreeDay.', work: ['Check in with the organizer', 'Learn planting technique from the team', 'Help plant in your assigned area'], duration: '2 hours', cost: 'Fee not stated. Tools are described in the general volunteer guide.', age: 'Adults and ages 17+ register. Ages 16 and under need a parent or guardian and check-in waiver.', access: 'Site access and adapted tasks are not supplied. Ask before joining.', bring: 'Work gloves, long pants and closed-toe shoes; recheck event instructions.', join: 'Open the official event page to check registration and meeting details.', safety: 'Follow the organizer’s site and tool instructions. No independent digging or tree placement.',
  },
  {
    id: 'tuckaseegee-treeday', organizer: 'TreesCharlotte', title: 'Tuckaseegee School TreeDay', interest: 'Trees & habitat', artwork: 'tree', scopes: ['charlotte'], area: 'Charlotte area', venue: 'Tuckaseegee Elementary School. Confirm the exact meeting address.',
    kind: 'scheduled', startsAt: '2026-10-24T13:00:00Z', endsAt: '2026-10-24T16:00:00Z', timeLabel: 'Sat, Oct 24 · 9am to noon, venue local time', checkedAt, status: 'listed',
    url: 'https://treescharlotte.org/event/tuckaseegee-elementary-school-treeday/',
    summary: 'Join a TreesCharlotte planting session at a school site.', work: ['Meet the volunteer team', 'Receive the assigned work and instruction', 'Plant and care for trees with supervision'], duration: '3 hours', cost: 'Fee not stated. Confirm event-specific supplies.', age: 'Adults and ages 17+ register. Ages 16 and under need a parent or guardian and check-in waiver.', access: 'Terrain and adapted tasks are not supplied. Ask the organizer.', bring: 'Gloves, long pants and closed-toe shoes; check the event guidance.', join: 'Use the official event page, not a mailing address, for registration and arrival details.', safety: 'Stay in the assigned area and follow the team’s planting instructions.',
  },
  {
    id: 'charlotte-anytime', organizer: 'Keep Charlotte Beautiful', title: 'Cleanup Litter Anytime', interest: 'Cleanup', artwork: 'cleanup', scopes: ['charlotte'], area: 'Charlotte city limits', venue: 'Choose a permitted cleanup site with the city program.',
    kind: 'rolling', timeLabel: 'Rolling program · Arrange your own date', checkedAt, status: 'listed', url: 'https://www.charlottenc.gov/Streets-and-Neighborhoods/Get-Involved/Keep-Charlotte-Beautiful',
    summary: 'Plan a local litter cleanup with city supply support, without taking on a street-adoption commitment.', work: ['Request supplies and arrange your site', 'Collect ordinary litter safely', 'Report the cleanup and return supplies'], duration: 'You arrange the session', cost: 'Supplies loaned free to Charlotte residents.', age: 'Confirm age, supervision and waiver requirements.', access: 'Depends on the chosen site. Confirm suitable tasks.', bring: 'Ask about grabbers, gloves, vests and bags before buying equipment.', join: 'Use the city’s pre-registration and supply-request link.', safety: 'Do not handle hazardous items or enter traffic. Confirm disposal and site permission.',
  },
  {
    id: 'park-pickers', organizer: 'Mecklenburg County Park and Recreation', title: 'Become a Park Picker', interest: 'Cleanup', artwork: 'cleanup', scopes: ['charlotte'], area: 'Mecklenburg County parks', venue: 'Choose an appropriate county park. No fixed meeting point.',
    kind: 'rolling', timeLabel: 'Self-led program · Choose your day', checkedAt, status: 'listed', url: 'https://parkandrec.mecknc.gov/Activities/volunteer-opportunities',
    summary: 'Help care for a county park by collecting ordinary litter and reporting your work through the official program.', work: ['Read the county instructions', 'Pick up ordinary litter at a suitable park', 'Report where, when and how many bags'], duration: 'You choose the session', cost: 'Not supplied by the source.', age: 'Not supplied. Confirm supervision requirements.', access: 'Park-specific. Ask about an appropriate site and task.', bring: 'Wear gloves and use the program’s safety guidance.', join: 'Open the county page and choose Park Pickers Sign Up.', safety: 'Never handle sharp or hazardous objects. This is not a court-ordered service placement.',
  },
];

export function opportunityState(item: CommunityOpportunity, now = Date.now()) {
  if (item.status !== 'listed') return item.status;
  if (item.kind === 'scheduled') {
    const instant = (value?: string) => value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) && validDay(value.slice(0, 10)) && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60 ? Date.parse(value) : NaN;
    const start = instant(item.startsAt); const end = instant(item.endsAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 'needs-check';
    if (start <= now) return 'past';
  }
  const checked = Date.parse(`${item.checkedAt}T00:00:00Z`);
  if (!validDay(item.checkedAt) || !Number.isFinite(checked) || checked - now > 86400000 || now - checked > 30 * 86400000) return 'needs-check';
  return item.kind === 'rolling' ? 'rolling' : 'upcoming';
}
export function filterCommunityOpportunities({ area, scope, interest = 'All interests', timing = 'all', search = '', now = Date.now() }: { area: ExploreArea; scope?: LocalResourceScope; interest?: string; timing?: string; search?: string; now?: number }) {
  const resolved = scope ?? localResourceScope(area);
  const terms = search.trim().toLocaleLowerCase('en').split(/\s+/).filter(Boolean);
  return communityOpportunities.filter(item => {
    const status = opportunityState(item, now);
    return (status === 'upcoming' || status === 'rolling') && resolved !== 'elsewhere'
      && (resolved === 'examples' || item.scopes.includes(resolved))
      && (interest === 'All interests' || item.interest === interest)
      && (timing === 'all' || timing === status)
      && terms.every(term => `${item.title} ${item.organizer} ${item.area} ${item.summary}`.toLocaleLowerCase('en').includes(term));
  }).sort((a, b) => a.kind === b.kind ? (a.startsAt ?? '').localeCompare(b.startsAt ?? '') : a.kind === 'scheduled' ? -1 : 1);
}
