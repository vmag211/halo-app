import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';
const { communityOpportunities, filterCommunityOpportunities, opportunityState } = await loadFrontend('explore-opportunities');
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
