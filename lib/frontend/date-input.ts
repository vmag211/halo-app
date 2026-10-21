/** Date-only calendar arithmetic. UTC is used for geometry, never to shift a user's date. */
export function parseCalendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

/** "Oct 20, 2026" for an ISO calendar date; anything that is not one is returned unchanged. */
export function readableCalendarDate(value: string, locale = 'en-US'): string {
  const date = parseCalendarDate(value);
  return date ? new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date) : value;
}

export function calendarDateISO(date: Date): string {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function localCalendarToday(now = new Date()): string {
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function shiftCalendarDay(value: string, amount: number): string {
  const date = parseCalendarDate(value);
  if (!date || !Number.isInteger(amount)) return value;
  date.setUTCDate(date.getUTCDate() + amount);
  return date.getUTCFullYear() > 0 && date.getUTCFullYear() <= 9999 ? calendarDateISO(date) : value;
}

export function shiftCalendarMonth(value: string, amount: number): string {
  const date = parseCalendarDate(value);
  if (!date || !Number.isInteger(amount)) return value;
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + amount);
  if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return value;
  const last = new Date(date);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(day, last.getUTCDate()));
  return calendarDateISO(date);
}

export function calendarDateAllowed(value: string, min?: string, max?: string): boolean {
  return !!parseCalendarDate(value) && (!min || !parseCalendarDate(min) || value >= min) && (!max || !parseCalendarDate(max) || value <= max);
}

export function clampCalendarDate(value: string, min?: string, max?: string): string {
  if (min && parseCalendarDate(min) && value < min) return min;
  if (max && parseCalendarDate(max) && value > max) return max;
  return value;
}

/** Six Monday-first rows keep the picker steady when a user browses months. */
export function calendarMonthDays(value: string): string[] {
  const date = parseCalendarDate(value);
  if (!date) return [];
  date.setUTCDate(1);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(date);
    day.setUTCDate(day.getUTCDate() + index);
    return calendarDateISO(day);
  });
}

export function calendarDateLabel(value: string, locale = 'en-US'): string {
  const date = parseCalendarDate(value);
  return date ? new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date) : '';
}
