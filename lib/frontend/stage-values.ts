/** Small data-boundary helpers. Never turn an absent reading into zero. */
export const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
export const nonnegative = (value: unknown): number | null => { const number = finite(value); return number !== null && number >= 0 ? number : null; };
export const scoreNumber = (value: unknown): number | null => { const number = nonnegative(value); return number !== null && number <= 100 ? number : null; };
export function safeText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.replace(/\s*\u2014\s*/g, ', ').trim() : fallback;
}
export const textList = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').map(item => safeText(item)).filter(Boolean) : [];
export const rows = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter(item => item !== null && typeof item === 'object' && !Array.isArray(item)).map(record) : [];
export function severity(value: unknown): string {
  return ['good', 'moderate', 'elevated', 'high', 'severe', 'no_data'].includes(String(value)) ? String(value) : 'no_data';
}
export function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
export function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
export function dateLabel(value: unknown): string {
  const iso = isoDate(value);
  return iso ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`)) : 'Sample date unavailable';
}
export function timeLabel(value: unknown): string {
  const iso = timestamp(value);
  return iso ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York', timeZoneName: 'short' }).format(new Date(iso)) : 'Update time unavailable';
}
