/**
 * The body of POST /api/journal.
 *
 *   entry_date        required, a real date from 2000-01-01 to tomorrow (household
 *                     local, so a client a little ahead of New York still works)
 *   band              one of the household groups or 'household'; not given, null
 *                     or empty is 'household'; anything else, even a non-string, is
 *                     an error
 *   severity          null or not given, or mild, moderate or bad in any case
 *   symptoms          null or not given is none; otherwise a list of at most 20
 *                     phrases, each 1 to 80 characters with no control characters
 *                     (stored trimmed); too many, too long or not a string is an
 *                     error, never cut down or dropped
 *   note              null or not given is none; otherwise a string of at most 500
 *                     characters, stored exactly as written. Line breaks and tabs
 *                     are fine, other control characters (NUL included) are not.
 *                     Too long is an error, never truncated
 *   retrospective     true or false; null or not given is false
 *   possibly_illness  true or false; null or not given is false
 *
 * Anything else in the body is ignored (identity comes from the token, never the
 * body). The route saves the whole row, so a field left out is cleared, as before.
 * The limits are in lib/limits.js, which the database constraints repeat.
 *
 * Returns `{ ok: true, value }` or `{ ok: false, fieldErrors }` (pass fieldErrors
 * to validationError). Errors come in field order, and every problem is reported.
 * Pure module.
 */

import { parseIsoDate, parseEnum, parseText, parseBoolean } from './validate.js';
import { addDays } from './localDate.js';
import {
  JOURNAL_BANDS,
  JOURNAL_MIN_DATE,
  JOURNAL_NOTE_MAX,
  JOURNAL_SEVERITIES,
  JOURNAL_SYMPTOMS_MAX,
  JOURNAL_SYMPTOM_MAX_CHARS,
} from './limits.js';

const absent = (value) => value === undefined || value === null;

/**
 * @param {object} body the parsed JSON object
 * @param {{ today: string }} options `today` is localDate(), 'YYYY-MM-DD'
 */
export function parseJournalEntry(body, { today }) {
  const fieldErrors = [];
  const fail = (field, code, message) => fieldErrors.push({ field, code, message });
  /** The parsed value, or undefined after recording the failure. */
  const take = (parsed, field) => {
    if (parsed.ok) return parsed.value;
    fail(field, parsed.code, parsed.message);
    return undefined;
  };

  let entryDate;
  if (absent(body.entry_date)) {
    fail('entry_date', 'date_required', 'A valid entry_date (YYYY-MM-DD) is required.');
  } else {
    entryDate = take(parseIsoDate(body.entry_date, { min: JOURNAL_MIN_DATE, max: addDays(today, 1) }), 'entry_date');
  }

  const band = take(parseEnum(body.band, JOURNAL_BANDS, { fallback: 'household' }), 'band');

  const severity = absent(body.severity)
    ? null
    : take(parseEnum(body.severity, JOURNAL_SEVERITIES, { caseInsensitive: true }), 'severity');

  const symptoms = parseSymptoms(body.symptoms, fail);

  const note = absent(body.note)
    ? null
    : take(
        parseText(body.note, { maxLength: JOURNAL_NOTE_MAX, trim: false, rejectControl: true, allowNewlines: true }),
        'note',
      );

  const retrospective = take(parseBoolean(body.retrospective, { fallback: false }), 'retrospective');
  const possiblyIllness = take(parseBoolean(body.possibly_illness, { fallback: false }), 'possibly_illness');

  if (fieldErrors.length > 0) return { ok: false, fieldErrors };
  return {
    ok: true,
    value: {
      entry_date: entryDate,
      band,
      symptoms,
      severity,
      note,
      retrospective,
      possibly_illness: possiblyIllness,
    },
  };
}

/** The symptom list, or undefined after reporting what is wrong with it. */
function parseSymptoms(value, fail) {
  if (absent(value)) return [];
  if (!Array.isArray(value)) {
    fail('symptoms', 'invalid_symptoms', 'Send symptoms as a list of short phrases.');
    return undefined;
  }
  if (value.length > JOURNAL_SYMPTOMS_MAX) {
    fail('symptoms', 'too_many_symptoms', `Choose up to ${JOURNAL_SYMPTOMS_MAX} symptoms.`);
    return undefined;
  }
  const symptoms = [];
  let valid = true;
  value.forEach((item, index) => {
    // A blank phrase is refused: an entry with symptoms marks the day as one with symptoms.
    const parsed = parseText(item, { maxLength: JOURNAL_SYMPTOM_MAX_CHARS, required: true, rejectControl: true });
    if (parsed.ok) {
      symptoms.push(parsed.value);
    } else {
      valid = false;
      fail(`symptoms[${index}]`, parsed.code, parsed.message);
    }
  });
  return valid ? symptoms : undefined;
}
