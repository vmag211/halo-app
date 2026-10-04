/**
 * The query-string overrides /api/home-guard accepts: `county`, `pwsid`, `state`,
 * `water_source` and `home_year`. The household's stored answers are the
 * defaults; an override looks at another place or what-if, and is public
 * reference data only (it never reads another household's rows).
 *
 * Validated here so a malformed override is a 400 with field errors instead of
 * being quietly dropped or coerced (parseInt('1988abc') used to be 1988):
 *
 *   county        text, at most 100 characters, no control characters (the same rule
 *                 applies to every text override below: a NUL cannot be stored in
 *                 Postgres text and a line break could forge a line in a log)
 *   pwsid         at most 20 characters and the shape of a public water system id
 *                 (two capital letters, five to nine digits); '', 'null' and
 *                 'undefined' stay accepted because older clients sent them
 *   state         two letters, any case, returned in capitals (profiles.state is
 *                 constrained to the same shape)
 *   water_source  text, at most 40 characters, then the existing normaliser. That
 *                 function never rejects: text it does not recognise becomes
 *                 'other' on purpose (see lib/waterSource.js), so only the length
 *                 and text type are enforced here
 *   home_year     at most 10 characters, then validateHomeYear: a whole year from
 *                 1700 to this year, or blank
 *
 * `value` holds only the overrides that were supplied (even when empty), so the
 * route can tell "not given, use the profile" from "given empty". An empty
 * water_source or home_year is `null`.
 *
 * Pure module.
 */

import { parseText } from './validate.js';
import { normalizeWaterSource } from './waterSource.js';
import { validateHomeYear } from './geocode.js';

const COUNTY_MAX = 100;
const PWSID_MAX = 20;
const WATER_SOURCE_MAX = 40;
const HOME_YEAR_MAX = 10;

const PWSID = /^[A-Z]{2}[0-9]{5,9}$/;
const LEGACY_EMPTY_PWSIDS = new Set(['', 'null', 'undefined']);
const STATE = /^[A-Za-z]{2}$/;

/**
 * @param {URLSearchParams} searchParams
 * @param {{ now?: Date }} [options] `now` fixes the latest allowed home_year in tests
 * @returns {{ ok: true, value: { county?: string, pwsid?: string, state?: string, waterSource?: string|null, homeYear?: number|null } }
 *   | { ok: false, fieldErrors: { field: string, code: string, message: string }[] }}
 */
export function parseHomeGuardOverrides(searchParams, { now = new Date() } = {}) {
  const value = {};
  const fieldErrors = [];
  const reject = (field, code, message) => fieldErrors.push({ field, code, message });

  /**
   * The text of a supplied override, or null after recording why it is not text we accept.
   * Control characters are refused on every free text override: a NUL cannot be
   * stored in Postgres text and a line break would forge a log line.
   */
  const text = (name, maxLength) => {
    const parsed = parseText(searchParams.get(name), { maxLength, rejectControl: true });
    if (!parsed.ok) {
      reject(name, parsed.code, parsed.message);
      return null;
    }
    return parsed.value;
  };

  if (searchParams.has('county')) {
    const county = text('county', COUNTY_MAX);
    if (county !== null) value.county = county;
  }

  if (searchParams.has('pwsid')) {
    const pwsid = text('pwsid', PWSID_MAX);
    if (pwsid !== null) {
      if (LEGACY_EMPTY_PWSIDS.has(pwsid) || PWSID.test(pwsid)) value.pwsid = pwsid;
      else reject('pwsid', 'invalid_pwsid', 'Use a public water system id such as NC0160010.');
    }
  }

  if (searchParams.has('state')) {
    const state = searchParams.get('state').trim();
    if (STATE.test(state)) value.state = state.toUpperCase();
    else reject('state', 'invalid_state', 'Use a two-letter state code such as NC.');
  }

  if (searchParams.has('water_source')) {
    const waterSource = text('water_source', WATER_SOURCE_MAX);
    if (waterSource !== null) value.waterSource = normalizeWaterSource(waterSource);
  }

  if (searchParams.has('home_year')) {
    const homeYear = text('home_year', HOME_YEAR_MAX);
    if (homeYear !== null) {
      const checked = validateHomeYear(homeYear, now);
      if (checked.ok) value.homeYear = checked.value;
      else reject('home_year', 'invalid_home_year', checked.error);
    }
  }

  if (fieldErrors.length > 0) return { ok: false, fieldErrors };
  return { ok: true, value };
}
