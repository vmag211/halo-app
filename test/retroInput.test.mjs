import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/routeLoader.mjs'; // registers the module hooks, so lib files load as ESM without the typeless-package warning

const { parseRetrospectiveDates, RETRO_WINDOW_MAX_DAYS } = await import('../lib/retroInput.js');

const DAY_MS = 86_400_000;
const parse = (dates, today) => parseRetrospectiveDates({ dates }, { today });
const spanOf = ({ from, to }) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1;

// The window runs from the first of the earliest month to the end of the latest, never past
// `today`. `today` is injected so the cap can be hit exactly: each case picks one early date
// and `today` itself, so the window is first-of-month .. today and its length is known.
const WINDOWS = [
  { label: '365 days in a normal year', picked: '2026-01-05', today: '2026-12-31', from: '2026-01-01', days: 365, ok: true },
  { label: '366 days spanning New Year (the cap)', picked: '2026-01-05', today: '2027-01-01', from: '2026-01-01', days: 366, ok: true },
  { label: '367 days is one over the cap', picked: '2026-01-05', today: '2027-01-02', from: '2026-01-01', days: 367, ok: false },
  { label: '366 days in a leap year', picked: '2024-01-10', today: '2024-12-31', from: '2024-01-01', days: 366, ok: true },
  { label: '367 days from a leap year January', picked: '2024-01-10', today: '2025-01-01', from: '2024-01-01', days: 367, ok: false },
];

test('the cap is 366 days', () => {
  assert.equal(RETRO_WINDOW_MAX_DAYS, 366);
});

for (const { label, picked, today, from, days, ok } of WINDOWS) {
  test(`window of ${label}`, () => {
    const result = parse([picked, today], today);
    if (ok) {
      assert.equal(result.ok, true);
      // The end is capped at today even though the month runs on past it.
      assert.deepEqual(result.value.window, { from, to: today });
      assert.equal(spanOf(result.value.window), days);
      assert.deepEqual(result.value.dates, [picked, today]);
    } else {
      assert.equal(result.ok, false);
      assert.deepEqual(result.fieldErrors.map((e) => [e.field, e.code]), [['dates', 'range_too_large']]);
      assert.equal(result.fieldErrors[0].message, 'Pick days from within one year.');
    }
  });
}

test('the end of a past month is its own last day, not today', () => {
  const result = parse(['2025-03-10', '2025-03-12'], '2026-12-31');
  assert.deepEqual(result.value.window, { from: '2025-03-01', to: '2025-03-31' });
  assert.equal(spanOf(result.value.window), 31);
});

test('dates in one month and no valid date: the window is that month, or null', () => {
  assert.deepEqual(parse(['2026-09-02'], '2026-09-15').value.window, { from: '2026-09-01', to: '2026-09-15' });
  const none = parse(['not a date'], '2026-09-15');
  assert.equal(none.ok, true);
  assert.equal(none.value.window, null);
  assert.deepEqual(none.value.rejected, [{ index: 0, date: 'not a date', code: 'invalid_date' }]);
});
