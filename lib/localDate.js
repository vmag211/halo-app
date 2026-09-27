/**
 * Household-local calendar dates (punch list v3 item 10).
 *
 * Readings and journal entries are joined by date string, so they must agree on
 * which day it is. HALO serves North Carolina households, so "today" is the
 * America/New_York calendar day — a UTC date rolls over at 8pm Eastern and put
 * evening readings on the wrong day.
 *
 * Pure module.
 */
export const HOUSEHOLD_TZ = 'America/New_York';

/** 'YYYY-MM-DD' for the given instant in the household's time zone. */
export function localDate(at = new Date(), tz = HOUSEHOLD_TZ) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** The local date `days` days before `from` (a 'YYYY-MM-DD' string). */
export function addDays(from, days) {
  const [y, m, d] = from.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}
