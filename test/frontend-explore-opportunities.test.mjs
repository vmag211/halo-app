import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';
const { communityOpportunities, filterCommunityOpportunities, opportunityState, opportunityLocalDate, opportunityOutdoorHandoff, hasParticipationDraft } = await loadFrontend('explore-opportunities');
const { blankEngagement } = await loadFrontend('explore-workspace');
const { validOpportunity } = await loadFrontend('production/explore-service');
const { localResourceScope } = await loadFrontend('explore-local-resources');
const now = Date.parse('2026-10-11T20:00:00Z');
const charlotte = { place: 'Charlotte', state: 'NC' };

test('location directly filters checked future and rolling opportunities without invented distance', () => {
  const results = filterCommunityOpportunities({ area: charlotte, now });
  assert.equal(results.length, 4);
  assert.ok(results.every(item => item.scopes.includes('charlotte')));
  assert.equal(filterCommunityOpportunities({ area: { place: 'Monroe', state: 'NC' }, now }).length, 0);
  assert.equal(filterCommunityOpportunities({ area: { place: 'Charlotte', state: 'CA' }, now }).length, 0);
  assert.equal(localResourceScope({ place: '28208', state: 'NC' }), 'charlotte');
  assert.equal(localResourceScope({ place: '90210', state: 'NC' }), 'elsewhere');
  assert.equal(localResourceScope({ place: '28200', state: 'NC' }), 'elsewhere');
  assert.ok(results.every(item => !('distance' in item)));
});

test('scheduled sessions disappear at their start while rolling opportunities retain their separate basis', () => {
  const item = communityOpportunities[0];
  assert.equal(opportunityState(item, Date.parse(item.startsAt) - 1), 'upcoming');
  assert.equal(opportunityState(item, Date.parse(item.startsAt)), 'past');
  const later = filterCommunityOpportunities({ area: charlotte, now: Date.parse('2026-10-25T00:00:00Z') });
  assert.equal(later.length, 2); assert.ok(later.every(item => item.kind === 'rolling'));
});

test('cancellations, full events, malformed times and stale snapshots are not recommended as available', () => {
  const item = communityOpportunities[0];
  assert.equal(opportunityState({ ...item, status: 'cancelled' }, now), 'cancelled');
  assert.equal(opportunityState({ ...item, status: 'full' }, now), 'full');
  assert.equal(opportunityState({ ...item, status: 'postponed' }, now), 'postponed');
  assert.equal(opportunityState({ ...item, startsAt: 'not-a-time' }, now), 'needs-check');
  assert.equal(opportunityState({ ...item, startsAt: '2026-02-30T14:00:00Z' }, now), 'needs-check');
  assert.equal(opportunityState({ ...item, startsAt: '2026-10-23T25:00:00Z' }, now), 'needs-check');
  assert.equal(opportunityState({ ...item, checkedAt: '2026-02-30' }, now), 'needs-check');
  assert.equal(opportunityState({ ...item, endsAt: item.startsAt }, now), 'needs-check');
  assert.equal(opportunityState({ ...communityOpportunities[2], checkedAt: '2025-01-01' }, now), 'needs-check');
  assert.equal(filterCommunityOpportunities({ area: charlotte, now: Date.parse('2026-12-01') }).length, 0);
});

test('timing, interest and keyword filters intersect and public links do not contain private location', () => {
  assert.equal(filterCommunityOpportunities({ area: charlotte, now, timing: 'upcoming' }).length, 2);
  assert.equal(filterCommunityOpportunities({ area: charlotte, now, timing: 'rolling', interest: 'Cleanup' }).length, 2);
  assert.equal(filterCommunityOpportunities({ area: charlotte, now, timing: 'rolling', search: 'county picker' }).length, 1);
  for (const item of communityOpportunities) {
    assert.equal(new URL(item.url).protocol, 'https:');
    assert.equal(new URL(item.url).search, '');
    assert.ok(item.venue); assert.ok(item.age); assert.ok(item.access); assert.ok(item.safety);
    assert.ok(!/P\.O\./.test(item.venue));
  }
});

test('participation uses source venue calendar date across UTC rollover and daylight saving', () => {
  const item = { ...communityOpportunities[0], startsAt:'2026-10-16T01:00:00Z', endsAt:'2026-10-16T03:00:00Z', venueTimezone:'America/New_York', venueTimezoneBasis:'source' };
  assert.equal(opportunityLocalDate(item), '2026-10-15');
  assert.equal(opportunityLocalDate({ ...item, startsAt:'2026-11-01T05:30:00Z' }), '2026-11-01');
  assert.equal(opportunityLocalDate({ ...item, startsAt:'2026-11-01T06:30:00Z' }), '2026-11-01');
  assert.equal(opportunityLocalDate({ ...item, venueTimezone:'Pacific/Auckland', startsAt:'2026-10-15T12:30:00Z' }), '2026-10-16');
  assert.equal(validOpportunity(item), true);
});

test('legacy, inferred and unknown zones never guess a participation date', () => {
  const item = { ...communityOpportunities[0], startsAt:'2026-10-16T01:00:00Z', endsAt:'2026-10-16T03:00:00Z' };
  assert.equal(validOpportunity(item), true, 'old payloads remain compatible');
  assert.equal(opportunityLocalDate(item), '');
  assert.equal(opportunityLocalDate({ ...item, venueTimezone:'America/New_York', venueTimezoneBasis:'inferred' }), '');
  assert.equal(opportunityLocalDate({ ...item, venueTimezone:'America/New_York' }), '');
  assert.equal(opportunityLocalDate({ ...item, venueTimezone:'Mars/Mountain', venueTimezoneBasis:'source' }), '');
  assert.equal(opportunityLocalDate({ ...item, venueLocalDate:'2026-10-15' }), '2026-10-15');
  assert.equal(opportunityLocalDate({ ...communityOpportunities[2], venueLocalDate:'2026-10-15' }), '');
});

test('bad or contradictory venue context is rejected instead of changing the chosen date', () => {
  const item = { ...communityOpportunities[0], startsAt:'2026-10-16T01:00:00Z', endsAt:'2026-10-16T03:00:00Z', venueTimezone:'America/New_York', venueTimezoneBasis:'source' };
  assert.equal(validOpportunity({ ...item, venueLocalDate:'2026-10-15' }), true);
  assert.equal(validOpportunity({ ...item, venueLocalDate:'2026-10-16' }), false);
  assert.equal(validOpportunity({ ...item, venueLocalDate:'2026-02-30' }), false);
  assert.equal(validOpportunity({ ...item, venueTimezone:'Mars/Mountain' }), false);
  assert.equal(validOpportunity({ ...item, venueTimezoneBasis:'user-home' }), false);
  assert.equal(opportunityLocalDate({ ...item, venueLocalDate:'2026-10-16' }), '');
});

test('conditions handoff retains the organizer place and source without home or private state', () => {
  const item = { ...communityOpportunities[0], venueLocalDate:'2026-10-23', address:'Organizer meeting point', venueTimezone:'America/New_York', venueTimezoneBasis:'source' };
  const handoff = opportunityOutdoorHandoff(item);
  assert.equal(handoff.date, '2026-10-23'); assert.equal(handoff.place, 'Organizer meeting point');
  assert.equal(handoff.timezone,'America/New_York'); assert.equal(handoff.sourceUrl,item.url);
  assert.equal(opportunityOutdoorHandoff(communityOpportunities[0]).date,'');
  assert.equal('timezone' in opportunityOutdoorHandoff(communityOpportunities[0]),false);
  assert.deepEqual(Object.keys(handoff).sort(),['date','id','place','sourceCheckedAt','sourceUrl','startsAt','timezone','title']);
});

test('malformed or impossible scheduled instants cannot become validated opportunity data', () => {
  const item=communityOpportunities[0];
  for (const startsAt of ['2026-02-30T14:00:00Z','2026-10-23T24:00:00Z','2026-10-23T14:60:00Z']) assert.equal(validOpportunity({...item,startsAt}),false);
  for (const endsAt of ['2026-13-01T14:00:00Z','2026-11-31T14:00:00Z','2026-10-23T16:00:60Z']) assert.equal(validOpportunity({...item,endsAt}),false);
  assert.equal(validOpportunity({...item,checkedAt:'2026-02-30'}),false);
  assert.equal(validOpportunity({...item,id:''}),false);
});

test('a participation draft containing any editable field gets replacement protection', () => {
  assert.equal(hasParticipationDraft(blankEngagement()),false);
  for (const field of ['title','organizer','url','place','date','statusDate','participatedOn','hours','preparation','outcome','reference','followupDate']) assert.equal(hasParticipationDraft({...blankEngagement(),[field]:'User input'}),true,field);
  assert.equal(hasParticipationDraft({...blankEngagement(),cause:'Habitats'}),true);
  assert.equal(hasParticipationDraft({...blankEngagement(),status:'Contacted'}),true);
  assert.equal(hasParticipationDraft({...blankEngagement(),id:'temporary-id',revision:4}),false);
});
