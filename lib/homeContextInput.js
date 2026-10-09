/**
 * The body of PATCH /api/home-contexts/[id]: { expected_revision, water_source?, home_year? }.
 *
 *   expected_revision  required: the revision of this home the client last read. A JSON
 *                      number that is a whole number from 1 to 2147483647 (the database's
 *                      int); text such as "4" is an error, not a number.
 *   water_source       as PATCH /api/profile (lib/profileInput.js parseProfilePatch): text of
 *   home_year          at most 40 characters normalized by normalizeWaterSource, and a whole
 *                      year from 1700 to this year (or that year as text); null clears the
 *                      answer, and at least one of the two must be present.
 *
 * Any other key is an error (`unknown_field`, one per key), the owner id included: the
 * identity is the session's, and the location, the utility and the revision itself never
 * change here. So the database function (update_home_context_attributes, which refuses
 * those keys too) only ever gets what it accepts.
 *
 * Every problem is reported at once: expected_revision first, then the two answers (or
 * `nothing_to_change`), then unknown keys in name order. Returns
 * `{ ok: true, value: { expected_revision, attributes } }`, where `attributes` holds only the
 * answers that were sent, or `{ ok: false, fieldErrors }` (pass fieldErrors to
 * validationError). Pure module.
 */

import { parseProfilePatch } from './profileInput.js';

/** The keys the body may carry. */
export const HOME_CONTEXT_PATCH_KEYS = Object.freeze(['expected_revision', 'water_source', 'home_year']);

/** The largest revision the database can hold (int). */
const REVISION_MAX = 2147483647;

/**
 * @param {object} body the parsed JSON object
 * @param {Date} [now] only for tests; the latest accepted home_year is this year
 * @returns {{ ok: true, value: { expected_revision: number, attributes: { water_source?: string|null, home_year?: number|null } } }
 *   | { ok: false, fieldErrors: { field: string, code: string, message: string }[] }}
 */
export function parseHomeContextPatch(body, now = new Date()) {
  const fieldErrors = [];

  const revision = body.expected_revision;
  if (revision === undefined || revision === null) {
    fieldErrors.push({
      field: 'expected_revision',
      code: 'revision_required',
      message: 'Send expected_revision, the revision of this home you last loaded.',
    });
  } else if (!Number.isInteger(revision) || revision < 1 || revision > REVISION_MAX) {
    fieldErrors.push({
      field: 'expected_revision',
      code: 'invalid_revision',
      message: 'expected_revision must be a whole number of 1 or more.',
    });
  }

  const answers = parseProfilePatch(body, now);
  if (!answers.ok) fieldErrors.push(...answers.fieldErrors);

  const unknown = Object.keys(body).filter((key) => !HOME_CONTEXT_PATCH_KEYS.includes(key)).sort();
  for (const key of unknown) {
    fieldErrors.push({ field: key, code: 'unknown_field', message: 'Only expected_revision, water_source and home_year can be sent.' });
  }

  if (fieldErrors.length > 0) return { ok: false, fieldErrors };
  return { ok: true, value: { expected_revision: revision, attributes: answers.value } };
}
