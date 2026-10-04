/**
 * The body of POST /api/journal/retrospective: { dates: ["YYYY-MM-DD", ...] },
 * the rough days a household remembers.
 *
 *   dates   a list, at most 100 as sent (more is refused before any date is looked
 *           at). Each one must be a real date from 2000-01-01 to today. A date
 *           that is not, or that repeats an earlier one, is left out of the
 *           comparison and listed in `rejected` as { index, date, code } (index in
 *           the list as sent; date the text sent, cut to 32 characters, or null
 *           when it was not text; code invalid_date, date_out_of_range or
 *           duplicate_date) while the valid ones are still compared. At most 62
 *           distinct valid days, as before.
 *
 * The comparison reads the months those days fall in (the first of the earliest
 * month to the end of the latest, or today), and that window may span at most 366
 * days, so a request cannot ask for years of readings.
 *
 * Returns `{ ok: true, value: { dates, rejected, window } }`, where `window` is
 * `{ from, to }` or null when no date was valid, or `{ ok: false, fieldErrors }`
 * (pass fieldErrors to validationError). Pure module.
 */

import { parseIsoDate } from './validate.js';

export const RETRO_RAW_MAX = 100;
export const RETRO_DAYS_MAX = 62;
export const RETRO_WINDOW_MAX_DAYS = 366;
const ECHO_MAX_CHARS = 32;
const DAY_MS = 86_400_000;

const failure = (code, message) => ({ ok: false, fieldErrors: [{ field: 'dates', code, message }] });

/** The date as text to show back: the first 32 characters of a string, null for anything else. */
const echo = (value) => (typeof value === 'string' ? Array.from(value).slice(0, ECHO_MAX_CHARS).join('') : null);

/**
 * @param {object} body the parsed JSON object
 * @param {{ today: string }} options `today` is localDate(), 'YYYY-MM-DD'
 */
export function parseRetrospectiveDates(body, { today }) {
  const raw = body.dates;
  if (!Array.isArray(raw)) return failure('dates_required', 'Send { dates: ["YYYY-MM-DD", ...] }.');
  if (raw.length > RETRO_RAW_MAX) {
    return failure('too_many_dates', `Send at most ${RETRO_RAW_MAX} dates.`);
  }

  const dates = [];
  const rejected = [];
  const seen = new Set();
  raw.forEach((value, index) => {
    const parsed = parseIsoDate(value, { max: today });
    if (!parsed.ok) {
      rejected.push({ index, date: echo(value), code: parsed.code });
    } else if (seen.has(parsed.value)) {
      rejected.push({ index, date: parsed.value, code: 'duplicate_date' });
    } else {
      seen.add(parsed.value);
      dates.push(parsed.value);
    }
  });

  if (dates.length > RETRO_DAYS_MAX) {
    return failure('too_many_dates', `Pick at most ${RETRO_DAYS_MAX} days.`);
  }
  if (dates.length === 0) return { ok: true, value: { dates, rejected, window: null } };

  // The months holding the picked days: that is what "the month's average" and
  // "days you didn't flag" are measured against.
  const sorted = [...dates].sort();
  const from = `${sorted[0].slice(0, 7)}-01`;
  const [year, month] = sorted[sorted.length - 1].slice(0, 7).split('-').map(Number);
  const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const to = monthEnd < today ? monthEnd : today;

  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1;
  if (span > RETRO_WINDOW_MAX_DAYS) {
    return failure('range_too_large', 'Pick days from within one year.');
  }
  return { ok: true, value: { dates, rejected, window: { from, to } } };
}
