/**
 * Row limits for the list endpoints that read a date range, and the rule for
 * saying "there is more than this".
 *
 * PostgREST (Supabase's API layer) silently caps every response at its
 * `db-max-rows` setting, so a long range could come back short with nothing to
 * say so. A route asks for `count: 'exact'` next to its `.limit()`, and the
 * count, not the page length, decides `truncated`. That also catches a server
 * cap that is lower than our own limit.
 *
 * Pure module.
 */

/** Daily readings per request: well above 366 days, since a day can hold several refreshes. */
export const HISTORY_ROW_LIMIT = 5000;

/** Journal entries per request: one per day and household group, so up to eight a day. */
export const JOURNAL_ROW_LIMIT = 2000;

/** Alerts per request: the inbox lists the newest 100 and says so when there are more. */
export const ALERTS_ROW_LIMIT = 100;

/**
 * True when rows matched the query that the response does not carry.
 *
 * @param {{ count: number|null|undefined, returned: number, limit: number }} args
 *   `count` is the exact match count from the same query (`select(..., { count: 'exact' })`),
 *   `returned` the number of rows that came back, `limit` the `.limit()` that was asked for.
 *   With no usable count a full page (`returned >= limit`) is assumed to hide rows.
 */
export function isTruncated({ count, returned, limit }) {
  if (Number.isInteger(count)) return count > returned;
  return returned >= limit;
}
