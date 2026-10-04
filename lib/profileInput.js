/**
 * The bodies of the two household settings writes.
 *
 * PUT /api/household
 *   The seven group keys (has_toddler ... has_respiratory) are each true or false;
 *   null or a key left out is false, because the PUT replaces the whole
 *   composition. Any other value (a string, a number, a list) is an error, where
 *   it used to become false and could wipe a household. `renter_mode` is true or
 *   false and `locale` is en or es; null or left out means "do not change it", and
 *   any other value is an error where it used to be ignored. Other keys are
 *   ignored.
 *
 * PATCH /api/profile
 *   `water_source` and `home_year`; other keys are ignored, and at least one of
 *   the two must be present, even with a null value (null clears the answer).
 *   `water_source` is text of at most 40 characters or null; the text is
 *   normalized to utility, well, spring or other by normalizeWaterSource, which
 *   turns an unrecognised answer into other and never into a public utility.
 *   `home_year` is null, an empty string, a whole year from 1700 to this year, or
 *   that year as a string of at most 10 characters (validateHomeYear is the
 *   rule); a boolean, a list or an object is an error.
 *
 * Results are `{ ok: true, value }` or `{ ok: false, fieldErrors }` (pass
 * fieldErrors to validationError); every problem is reported, in field order.
 * Pure module.
 */

import { BAND_KEYS } from './household.js';
import { normalizeWaterSource } from './waterSource.js';
import { validateHomeYear } from './geocode.js';
import { parseBoolean, parseEnum, parseText } from './validate.js';

const LOCALES = ['en', 'es'];
const WATER_SOURCE_MAX = 40;
const HOME_YEAR_TEXT_MAX = 10;

const absent = (value) => value === undefined || value === null;

/**
 * @param {object} body the parsed JSON object
 * @returns {{ ok: true, value: { bands: Record<string, boolean>, renter_mode?: boolean, locale?: 'en'|'es' } }
 *   | { ok: false, fieldErrors: { field: string, code: string, message: string }[] }}
 */
export function parseHouseholdBody(body) {
  const fieldErrors = [];
  const take = (parsed, field) => {
    if (parsed.ok) return parsed.value;
    fieldErrors.push({ field, code: parsed.code, message: parsed.message });
    return undefined;
  };

  const bands = {};
  for (const key of BAND_KEYS) bands[key] = take(parseBoolean(body[key], { fallback: false }), key);

  const value = { bands };
  if (!absent(body.renter_mode)) value.renter_mode = take(parseBoolean(body.renter_mode), 'renter_mode');
  if (!absent(body.locale)) value.locale = take(parseEnum(body.locale, LOCALES), 'locale');

  if (fieldErrors.length > 0) return { ok: false, fieldErrors };
  return { ok: true, value };
}

/**
 * @param {object} body the parsed JSON object
 * @param {Date} [now] only for tests; the latest accepted home_year is this year
 * @returns {{ ok: true, value: { water_source?: string|null, home_year?: number|null } }
 *   | { ok: false, fieldErrors: { field: string, code: string, message: string }[] }}
 */
export function parseProfilePatch(body, now = new Date()) {
  const fieldErrors = [];
  const update = {};

  if (Object.hasOwn(body, 'water_source')) {
    if (body.water_source === null) {
      update.water_source = null; // clears the answer
    } else {
      const text = parseText(body.water_source, { maxLength: WATER_SOURCE_MAX });
      if (text.ok) update.water_source = normalizeWaterSource(text.value);
      else fieldErrors.push({ field: 'water_source', code: text.code, message: text.message });
    }
  }

  if (Object.hasOwn(body, 'home_year')) {
    const raw = body.home_year;
    const shaped =
      raw === null ||
      typeof raw === 'number' ||
      (typeof raw === 'string' && Array.from(raw).length <= HOME_YEAR_TEXT_MAX);
    // A shape that cannot be a year gets the same sentence as a number that is not one.
    const year = validateHomeYear(shaped ? raw : Number.NaN, now);
    if (year.ok) update.home_year = year.value;
    else fieldErrors.push({ field: 'home_year', code: 'invalid_year', message: year.error });
  }

  if (fieldErrors.length > 0) return { ok: false, fieldErrors };
  if (Object.keys(update).length === 0) {
    return {
      ok: false,
      fieldErrors: [
        { field: 'body', code: 'nothing_to_change', message: 'Nothing to change: send water_source and/or home_year.' },
      ],
    };
  }
  return { ok: true, value: update };
}
