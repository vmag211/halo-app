// HALO's one displayed clock style (lib/frontend/time-format.ts) and the Explore listing dates built on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';

const { clockText, instantClock, scheduleLabel } = await loadFrontend('time-format');
const { opportunityWhen } = await loadFrontend('explore-opportunities');
const { clockLabel } = await loadFrontend('week-timeline');

test('a stored wall clock is shown as 12-hour time with a plain space', () => {
  assert.equal(clockText('07:00'), '7:00 AM');
  assert.equal(clockText('00:05'), '12:05 AM');
  assert.equal(clockText('12:00'), '12:00 PM');
  assert.equal(clockText('17:30'), '5:30 PM');
  assert.equal(clockText('9:15'), '9:15 AM', 'an unpadded hour');
  assert.equal(clockText('18:0'), '6:00 PM', 'unpadded minutes, as the UV chart axis builds them');
  assert.equal(clockText('23:59:00'), '11:59 PM');
  for (const odd of ['', 'noon', '24:00', '07:60', '7']) assert.equal(clockText(odd), odd, `${odd} is returned as it is`);
});

test('an instant is shown in its zone, with no narrow or no-break space', () => {
  assert.equal(instantClock('2026-11-07T14:00:00Z', 'America/New_York'), '9:00 AM');
  assert.equal(instantClock('2026-07-07T14:00:00Z', 'America/New_York'), '10:00 AM', 'daylight time');
  assert.equal(clockLabel('2026-11-07T19:30:00Z', 'America/New_York'), '2:30 PM', 'the week timeline uses the same style');
  assert.doesNotMatch(instantClock('2026-11-07T14:00:00Z', 'UTC'), /[\u202f\u00a0]/);
});

test('a dated event reads "Sat, Nov 7, 2026 · 9:00 AM to 11:00 AM", with the end date when it runs past midnight', () => {
  assert.equal(scheduleLabel('2026-11-07T14:00:00Z', '2026-11-07T16:00:00Z', 'America/New_York'), 'Sat, Nov 7, 2026 · 9:00 AM to 11:00 AM');
  assert.equal(scheduleLabel('2026-12-31T23:00:00Z', '2027-01-01T06:00:00Z', 'America/New_York'), 'Thu, Dec 31, 2026 · 6:00 PM to Fri, Jan 1, 2027 · 1:00 AM');
  assert.equal(scheduleLabel('not a time', '2026-11-07T16:00:00Z', 'America/New_York'), null);
  assert.equal(scheduleLabel('2026-11-07T14:00:00Z', '2026-11-07T16:00:00Z', 'Not/AZone'), null);
});

const listing = {
  id: 'x', organizer: 'O', title: 'T', interest: 'Cleanup', artwork: 'cleanup', scopes: [], area: 'A', venue: 'V',
  checkedAt: '2026-10-21', status: 'listed', url: 'https://example.org',
};

test('a listing with a source-given zone shows its dates in the one style; otherwise its own words are kept', () => {
  const scheduled = { ...listing, kind: 'scheduled', startsAt: '2026-11-07T14:00:00Z', endsAt: '2026-11-07T16:00:00Z', timeLabel: 'November 7, 2026, 9:00 am to 11:00 am' };
  assert.equal(opportunityWhen({ ...scheduled, venueTimezone: 'America/New_York', venueTimezoneBasis: 'source' }), 'Sat, Nov 7, 2026 · 9:00 AM to 11:00 AM');
  assert.equal(opportunityWhen({ ...scheduled, venueTimezone: 'America/New_York', venueTimezoneBasis: 'inferred' }), scheduled.timeLabel, 'an inferred zone is not authority');
  assert.equal(opportunityWhen(scheduled), scheduled.timeLabel, 'no zone');
  assert.equal(opportunityWhen({ ...listing, kind: 'rolling', timeLabel: 'Any time' }), 'Any time');
});
