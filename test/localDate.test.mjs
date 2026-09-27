import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDate, addDays } from '../lib/localDate.js';

test('9pm Eastern is still the same Eastern day (UTC has already rolled over)', () => {
  // 2026-09-27 21:00 EDT = 2026-09-28 01:00 UTC
  assert.equal(localDate(new Date('2026-09-28T01:00:00Z')), '2026-09-27');
});

test('after midnight Eastern it is the next day', () => {
  assert.equal(localDate(new Date('2026-09-28T04:30:00Z')), '2026-09-28');
});

test('respects daylight saving (EST in winter)', () => {
  // 2026-01-15 23:30 EST = 2026-01-16 04:30 UTC
  assert.equal(localDate(new Date('2026-01-16T04:30:00Z')), '2026-01-15');
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-09-27', -89), '2026-06-30');
});
