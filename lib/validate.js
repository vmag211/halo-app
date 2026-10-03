/**
 * Request validation primitives for HALO's route handlers.
 *
 * Routes used to coerce input loosely (`Number(x)`, `parseInt`, `x || default`),
 * which turned bad input into plausible wrong data: an empty `lat` became 0, a
 * 5000-day range ran an unbounded query, an oversize body was read in full.
 * These parsers say no instead, and say why.
 *
 * Every parser returns `{ ok: true, value }` or `{ ok: false, code, message }`
 * and never throws on bad input. Two parse several fields at once and so return
 * `{ ok: false, fieldErrors: [{ field, code, message }] }`: parseDateRange and
 * parseCoordinates. Hand a `fieldErrors` array straight to `validationError`
 * in apiErrors.js. Messages are plain sentences safe to show in the app.
 *
 * Pure module apart from readJsonBody, which reads the request it is given.
 */

import { ERROR_CODES } from './apiErrors.js';
import { addDays } from './localDate.js';

const ok = (value) => ({ ok: true, value });
const fail = (code, message) => ({ ok: false, code, message });

/** A value a caller left out: absent, or an empty query-string parameter. */
const isMissing = (value) => value === null || value === undefined || value === '';

// ------------------------------------------------------------------- dates

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function isRealDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1) return false;
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= lengths[month - 1];
}

/** Whole days since the epoch for a valid 'YYYY-MM-DD' (UTC, so no DST drift). */
function dayNumber(isoDate) {
  return Date.parse(`${isoDate}T00:00:00Z`) / DAY_MS;
}

/**
 * A calendar date written as 'YYYY-MM-DD'. Rejects non-dates such as 2026-02-31
 * and anything outside `min`..`max` (inclusive; `max: null` means no upper bound).
 *
 * Codes: `invalid_date`, `date_out_of_range`.
 */
export function parseIsoDate(value, { min = '2000-01-01', max = null } = {}) {
  const match = typeof value === 'string' ? ISO_DATE.exec(value) : null;
  if (!match || !isRealDate(Number(match[1]), Number(match[2]), Number(match[3]))) {
    return fail('invalid_date', 'Use a real date in YYYY-MM-DD form.');
  }
  if (min && value < min) return fail('date_out_of_range', `Choose a date on or after ${min}.`);
  if (max && value > max) return fail('date_out_of_range', `Choose a date on or before ${max}.`);
  return ok(value);
}

/**
 * A bounded inclusive date range for history-style queries.
 *
 * A missing `to` is `today`; a missing `from` is `defaultDays` ending at `to`
 * (never earlier than `min`). `to` may be at most `maxFutureDays` after `today`,
 * `from` must not be after `to`, and the inclusive span must fit in `maxDays`.
 * An empty string is a malformed date here, not a missing one.
 *
 * Codes: `invalid_date`, `date_out_of_range`, `range_inverted`, `range_too_large`.
 *
 * @param {{ from?: string|null, to?: string|null }} input
 * @param {{ today: string, defaultDays?: number, maxDays?: number, min?: string, maxFutureDays?: number }} options
 *   `today` is a 'YYYY-MM-DD' string; pass localDate() so the range follows the
 *   household's calendar day.
 */
export function parseDateRange(
  { from, to } = {},
  { today, defaultDays = 90, maxDays = 366, min = '2000-01-01', maxFutureDays = 1 } = {},
) {
  const fieldErrors = [];
  const latest = addDays(today, maxFutureDays);
  const given = (value) => value !== null && value !== undefined;

  // Parse both ends before deriving either, so errors come out as from, then to.
  const parsedFrom = given(from) ? parseIsoDate(from, { min }) : null;
  const parsedTo = given(to) ? parseIsoDate(to, { min, max: latest }) : null;
  if (parsedFrom && !parsedFrom.ok) {
    fieldErrors.push({ field: 'from', code: parsedFrom.code, message: parsedFrom.message });
  }
  if (parsedTo && !parsedTo.ok) {
    fieldErrors.push({ field: 'to', code: parsedTo.code, message: parsedTo.message });
  }

  const toDate = parsedTo ? parsedTo.value : today;
  let fromDate = parsedFrom ? parsedFrom.value : null;
  if (!parsedFrom && fieldErrors.length === 0) {
    const derived = addDays(toDate, -(defaultDays - 1));
    fromDate = min && derived < min ? min : derived;
  }

  // Range rules only make sense once both ends are real dates.
  if (fieldErrors.length === 0) {
    if (fromDate > toDate) {
      fieldErrors.push({
        field: 'from',
        code: 'range_inverted',
        message: 'The start date must be on or before the end date.',
      });
    } else if (dayNumber(toDate) - dayNumber(fromDate) + 1 > maxDays) {
      fieldErrors.push({
        field: 'from',
        code: 'range_too_large',
        message: `Choose a range of ${maxDays} days or fewer.`,
      });
    }
  }

  if (fieldErrors.length > 0) return { ok: false, fieldErrors };
  return ok({ from: fromDate, to: toDate });
}

// -------------------------------------------------------------- coordinates

// Plain decimal text only. Number() alone would also take '', '  ', '0x10' and
// '1e1', and Number('') is 0, a real place in the Atlantic.
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)$/;

function parseCoordinate(value, { field, label, limit }) {
  let number = null;
  if (typeof value === 'number') {
    number = value;
  } else if (typeof value === 'string' && DECIMAL.test(value.trim())) {
    number = Number(value.trim());
  }

  if (number === null || !Number.isFinite(number)) {
    return { fieldError: { field, code: 'invalid_coordinate', message: `${label} must be a number.` } };
  }
  if (number < -limit || number > limit) {
    return {
      fieldError: {
        field,
        code: 'coordinate_out_of_range',
        message: `${label} must be between -${limit} and ${limit}.`,
      },
    };
  }
  return { number };
}

/**
 * A latitude/longitude pair given as numbers or numeric strings. Each axis is
 * checked on its own so a caller sees every problem at once.
 *
 * Codes: `invalid_coordinate`, `coordinate_out_of_range`.
 */
export function parseCoordinates({ lat, lng } = {}) {
  const parsedLat = parseCoordinate(lat, { field: 'lat', label: 'Latitude', limit: 90 });
  const parsedLng = parseCoordinate(lng, { field: 'lng', label: 'Longitude', limit: 180 });

  const fieldErrors = [parsedLat.fieldError, parsedLng.fieldError].filter(Boolean);
  if (fieldErrors.length > 0) return { ok: false, fieldErrors };
  return ok({ lat: parsedLat.number, lng: parsedLng.number });
}

// ------------------------------------------------------- scalars and strings

/**
 * A whole number from `min` to `max` inclusive, given as a number or an integer
 * string. Out of range is an error, never a clamp. `fallback` stands in only
 * when the value is null, undefined or an empty string (pass `fallback: null`
 * for "optional"); with no fallback a missing value is an error.
 *
 * Codes: `invalid_integer`, `integer_out_of_range`.
 */
export function parseBoundedInt(value, { min, max, fallback } = {}) {
  if (isMissing(value)) {
    if (fallback !== undefined) return ok(fallback);
    return fail('invalid_integer', 'Enter a whole number.');
  }

  let number = null;
  if (typeof value === 'number') {
    number = value;
  } else if (typeof value === 'string' && /^[+-]?\d+$/.test(value.trim())) {
    number = Number(value.trim());
  }

  if (number === null || !Number.isSafeInteger(number)) {
    return fail('invalid_integer', 'Enter a whole number.');
  }
  if (number < min || number > max) {
    return fail('integer_out_of_range', `Enter a number from ${min} to ${max}.`);
  }
  return ok(number);
}

/**
 * One of `allowed` (an array of strings). With `caseInsensitive` the match is
 * case-blind and the allowed spelling is returned. `fallback` follows the same
 * rule as parseBoundedInt.
 *
 * Code: `invalid_option`.
 */
export function parseEnum(value, allowed, { fallback, caseInsensitive = false } = {}) {
  if (isMissing(value) && fallback !== undefined) return ok(fallback);

  if (typeof value === 'string') {
    const wanted = caseInsensitive ? value.toLowerCase() : value;
    const match = allowed.find((option) => (caseInsensitive ? option.toLowerCase() : option) === wanted);
    if (match !== undefined) return ok(match);
  }
  return fail('invalid_option', `Choose one of: ${allowed.join(', ')}.`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A standard 8-4-4-4-12 hex UUID, returned lowercase (the form Supabase hands
 * out, so it compares equal to a verified user id). No whitespace is trimmed.
 *
 * Code: `invalid_uuid`.
 */
export function parseUuid(value) {
  if (typeof value === 'string' && UUID.test(value)) return ok(value.toLowerCase());
  return fail('invalid_uuid', 'That id is not valid.');
}

/**
 * Free text. Anything that is not a string (including null and undefined) is an
 * error, so check presence before calling for an optional field. Length is
 * counted in characters (code points), so an emoji is one; over-long text is
 * rejected, never truncated. Empty text is an error only when `required`.
 *
 * Codes: `invalid_text`, `text_required`, `text_too_long`.
 */
export function parseText(value, { maxLength, required = false, trim = true } = {}) {
  if (typeof value !== 'string') return fail('invalid_text', 'Enter some text.');

  const text = trim ? value.trim() : value;
  if (text === '') {
    return required ? fail('text_required', 'This field cannot be empty.') : ok(text);
  }
  if (Array.from(text).length > maxLength) {
    return fail('text_too_long', `Use ${maxLength} characters or fewer.`);
  }
  return ok(text);
}

// -------------------------------------------------------------- JSON bodies

/**
 * Reads a request body as a JSON object with a hard size cap.
 *
 * An empty body is `{}`. A Content-Length over `maxBytes` is refused (413)
 * before anything is read; otherwise the text is read and its real byte length
 * checked, so a header that understates the body cannot get past the cap.
 * Invalid JSON, and any top level that is not an object, is a 400.
 *
 * @param {Request} request
 * @param {{ maxBytes?: number }} [options]
 * @returns {Promise<{ ok: true, value: object } | { ok: false, status: number, code: string, message: string }>}
 */
export async function readJsonBody(request, { maxBytes = 16384 } = {}) {
  const tooLarge = {
    ok: false,
    status: 413,
    code: ERROR_CODES.PAYLOAD_TOO_LARGE,
    message: 'That request is too large.',
  };
  const badRequest = (message) => ({ ok: false, status: 400, code: ERROR_CODES.BAD_REQUEST, message });

  const declared = request.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared) > maxBytes) {
    return tooLarge;
  }

  let text;
  try {
    text = await request.text();
  } catch {
    return badRequest('The request body could not be read.');
  }

  if (Buffer.byteLength(text, 'utf8') > maxBytes) return tooLarge;
  if (text === '') return ok({});

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return badRequest('The request body must be valid JSON.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return badRequest('The request body must be a JSON object.');
  }
  return ok(parsed);
}
