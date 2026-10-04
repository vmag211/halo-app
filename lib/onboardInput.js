/**
 * The body of POST /api/onboard: `{ address, request_id?, water_source?, home_year? }`
 * (plus `profile_id`, which the route checks against the session and never uses).
 *
 *   address       required text, trimmed, 3 to 200 characters, no control characters.
 *                 It is geocoded, so it can be a street address, a ZIP code or a GPS
 *                 "lng,lat" string. A list, an object or a number is refused, not
 *                 turned into text (an array used to be stringified into the lookup).
 *                 Missing, null or blank keeps the old sentence "Address is required".
 *   request_id    the client's id for this submission. Left out (or null) is fine, as
 *                 older clients never send one. Anything else must be a UUID: a value
 *                 that is not used to be silently dropped, which hid a client that
 *                 believed it was tracking a submission it was not.
 *   water_source  as before: normalizeWaterSource decides (it never refuses an answer,
 *                 an unrecognised one is stored as 'other').
 *   home_year     as before: validateHomeYear decides, with the same sentence.
 *
 * Every problem is reported at once, in field order (address, request_id, home_year).
 * Returns `{ ok: true, value: { address, requestId, waterSource, homeYear } }` or
 * `{ ok: false, fieldErrors }` (pass fieldErrors to validationError). Pure module.
 */

import { parseText } from './validate.js';
import { normalizeWaterSource } from './waterSource.js';
import { parseRequestId, validateHomeYear } from './geocode.js';

export const ADDRESS_MIN = 3;
export const ADDRESS_MAX = 200;

const isAbsent = (value) => value === undefined || value === null;

/** The address text, or a field error saying why not. */
function parseAddress(raw) {
  const required = { field: 'address', code: 'address_required', message: 'Address is required' };
  if (isAbsent(raw)) return { error: required };

  const text = parseText(raw, { maxLength: ADDRESS_MAX, rejectControl: true });
  if (!text.ok) return { error: { field: 'address', code: text.code, message: text.message } };
  if (text.value === '') return { error: required };
  if (Array.from(text.value).length < ADDRESS_MIN) {
    return { error: { field: 'address', code: 'address_too_short', message: `Enter at least ${ADDRESS_MIN} characters.` } };
  }
  return { value: text.value };
}

/**
 * @param {object} body the parsed JSON object
 * @param {{ now?: Date }} [options] `now` is only for tests: the latest accepted home_year is its year
 */
export function parseOnboardBody(body, { now = new Date() } = {}) {
  const fieldErrors = [];

  const address = parseAddress(body.address);
  if (address.error) fieldErrors.push(address.error);

  let requestId = null;
  if (!isAbsent(body.request_id)) {
    requestId = parseRequestId(body.request_id);
    if (requestId === null) {
      fieldErrors.push({ field: 'request_id', code: 'invalid_request_id', message: 'Send request_id as a UUID, or leave it out.' });
    }
  }

  const waterSource = normalizeWaterSource(body.water_source);

  const year = validateHomeYear(body.home_year, now);
  if (!year.ok) fieldErrors.push({ field: 'home_year', code: 'invalid_year', message: year.error });

  if (fieldErrors.length > 0) return { ok: false, fieldErrors };
  return { ok: true, value: { address: address.value, requestId, waterSource, homeYear: year.value } };
}
