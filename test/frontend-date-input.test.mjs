import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';
const { parseCalendarDate, shiftCalendarDay, shiftCalendarMonth, calendarMonthDays, calendarDateAllowed, clampCalendarDate, calendarDateLabel, localCalendarToday } = await loadFrontend('date-input');

test('date-only parsing rejects impossible dates and preserves early years', () => {
  assert.equal(parseCalendarDate('2026-02-30'), null);
  assert.equal(parseCalendarDate('2026-02-29'), null);
  assert.equal(parseCalendarDate('2024-02-29').getUTCDate(), 29);
  assert.equal(parseCalendarDate('0001-01-01').getUTCFullYear(), 1);
});
test('month moves preserve the chosen day where possible and clamp shorter months', () => {
  assert.equal(shiftCalendarMonth('2026-01-31', 1), '2026-02-28');
  assert.equal(shiftCalendarMonth('2024-01-31', 1), '2024-02-29');
  assert.equal(shiftCalendarMonth('2026-12-18', 1), '2027-01-18');
  assert.equal(shiftCalendarMonth('2024-02-29', 12), '2025-02-28');
});
test('day moves do not shift dates across daylight saving transitions', () => {
  assert.equal(shiftCalendarDay('2026-03-08', 1), '2026-03-09');
  assert.equal(shiftCalendarDay('2026-11-01', -1), '2026-10-31');
});
test('calendar supplies six Monday-first rows with adjacent months', () => {
  const grid = calendarMonthDays('2026-10-01');
  assert.equal(grid.length, 42);
  assert.equal(grid[0], '2026-09-28');
  assert.equal(grid[41], '2026-11-08');
  assert.equal(calendarMonthDays('2026-02-30').length, 0);
});
test('minimum and maximum are inclusive and enforced on selection', () => {
  assert.equal(calendarDateAllowed('2026-10-12', '2026-10-12', '2026-10-15'), true);
  assert.equal(calendarDateAllowed('2026-10-11', '2026-10-12', '2026-10-15'), false);
  assert.equal(calendarDateAllowed('2026-10-16', '2026-10-12', '2026-10-15'), false);
  assert.equal(clampCalendarDate('2026-10-11', '2026-10-12', '2026-10-15'), '2026-10-12');
  assert.equal(clampCalendarDate('2026-10-16', '2026-10-12', '2026-10-15'), '2026-10-15');
});
test('spoken dates use the date itself, not the machine timezone', () => {
  assert.equal(calendarDateLabel('2026-10-12'), 'Monday, October 12, 2026');
  assert.equal(calendarDateLabel('2026-02-30'), '');
  assert.equal(localCalendarToday(new Date(2026, 9, 12, 0, 5)), '2026-10-12');
});
