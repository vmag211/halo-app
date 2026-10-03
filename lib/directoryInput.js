/**
 * The query strings of the two directory routes that take free input.
 *
 * GET /api/volunteer?county=Cabarrus%20County&causes=water,pfas
 *   county   text, at most 100 characters, no control characters. Blank (or not
 *            given) means "use the household's stored county", as before.
 *   causes   comma separated cause tags (the directory documents water, pfas,
 *            radon, air, wells and advocacy, but a household can have findings
 *            for causes it has no organization for, so any well formed tag is
 *            accepted and simply matches nothing). At most 12 tags; a tag is 1
 *            to 32 letters, digits, hyphens or underscores and starts with a
 *            letter. Empty pieces are dropped; case is kept for the echo and the
 *            matching lower-cases it.
 *
 * GET /api/learn?topic=pfas&locale=en (plus the reading the overlay was opened over)
 *   topic    one of LEARN_TOPICS, any case; the legacy sentence is the message
 *   locale   en or es, any case; not given or empty is en
 *   the text of the reading (county, zone, contaminant, source, pollutant,
 *   peak_start, peak_end, category, risk, severity): at most 100 characters, no
 *   control characters, because it is written into the "why yours" sentence.
 *   The numbers of the reading (value, limit, home_year, humidity, precip) are
 *   not validated: lib/learnWhyYours.js uses one only when it is a finite
 *   number and otherwise leaves the sentence out, which is its documented rule.
 *
 * A malformed value is a field error, never silently ignored. Results are
 * `{ ok: true, value }` or `{ ok: false, fieldErrors }` (pass fieldErrors to
 * validationError). Pure module.
 */

import { parseText, parseEnum } from './validate.js';
import { LEARN_TOPICS } from './learnContent.js';

const COUNTY_MAX = 100;
const CONTEXT_TEXT_MAX = 100;
const CAUSES_MAX_TAGS = 12;
const CAUSES_RAW_MAX = 400;
const CAUSE_TAG = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

const LOCALES = ['en', 'es'];
// In the order their errors are reported.
const LEARN_CONTEXT_TEXT = ['county', 'zone', 'contaminant', 'source', 'pollutant', 'peak_start', 'peak_end', 'category', 'risk', 'severity'];

// C0 and C1 controls, DEL, and the Unicode line and paragraph separators.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

const CAUSES_MESSAGE = 'Use up to 12 cause tags (letters, numbers, hyphens or underscores), separated by commas.';

/** parseText plus "no control characters"; empty text is fine. */
function queryText(value, maxLength) {
  const parsed = parseText(value, { maxLength });
  if (!parsed.ok) return parsed;
  if (CONTROL.test(parsed.value)) {
    return { ok: false, code: 'invalid_characters', message: 'Remove line breaks and other control characters.' };
  }
  return parsed;
}

/** Records the failure of `parsed` as a field error and returns whether it passed. */
function accept(parsed, field, fieldErrors) {
  if (!parsed.ok) fieldErrors.push({ field, code: parsed.code, message: parsed.message });
  return parsed.ok;
}

/**
 * @param {URLSearchParams} searchParams
 * @returns {{ ok: true, value: { county: string|null, causes: string[] } }
 *   | { ok: false, fieldErrors: { field: string, code: string, message: string }[] }}
 */
export function parseVolunteerQuery(searchParams) {
  const fieldErrors = [];
  let county = null;
  let causes = [];

  const rawCounty = searchParams.get('county');
  if (rawCounty !== null) {
    const parsed = queryText(rawCounty, COUNTY_MAX);
    if (accept(parsed, 'county', fieldErrors)) county = parsed.value === '' ? null : parsed.value;
  }

  const rawCauses = searchParams.get('causes');
  if (rawCauses !== null) {
    const failure = (code) => fieldErrors.push({ field: 'causes', code, message: CAUSES_MESSAGE });
    if (Array.from(rawCauses).length > CAUSES_RAW_MAX) {
      failure('text_too_long');
    } else if (CONTROL.test(rawCauses.trim())) {
      failure('invalid_characters');
    } else {
      const tags = rawCauses.split(',').map((tag) => tag.trim()).filter(Boolean);
      if (tags.length > CAUSES_MAX_TAGS) failure('too_many_causes');
      else if (!tags.every((tag) => CAUSE_TAG.test(tag))) failure('invalid_cause');
      else causes = tags;
    }
  }

  if (fieldErrors.length > 0) return { ok: false, fieldErrors };
  return { ok: true, value: { county, causes } };
}

/**
 * @param {URLSearchParams} searchParams
 * @returns {{ ok: true, value: { topic: string, locale: 'en'|'es' } }
 *   | { ok: false, fieldErrors: { field: string, code: string, message: string }[] }}
 */
export function parseLearnQuery(searchParams) {
  const fieldErrors = [];

  const topic = parseEnum(searchParams.get('topic'), LEARN_TOPICS, { caseInsensitive: true });
  if (!topic.ok) topic.message = `Unknown topic. One of: ${LEARN_TOPICS.join(', ')}`;
  accept(topic, 'topic', fieldErrors);

  const locale = parseEnum(searchParams.get('locale'), LOCALES, { fallback: 'en', caseInsensitive: true });
  if (!locale.ok) locale.message = 'locale must be en or es.';
  accept(locale, 'locale', fieldErrors);

  for (const field of LEARN_CONTEXT_TEXT) {
    const raw = searchParams.get(field);
    if (raw !== null) accept(queryText(raw, CONTEXT_TEXT_MAX), field, fieldErrors);
  }

  if (fieldErrors.length > 0) return { ok: false, fieldErrors };
  return { ok: true, value: { topic: topic.value, locale: locale.value } };
}
