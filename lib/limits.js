/**
 * The journal's input limits, in one place.
 *
 * The journal routes validate against these, and the database constraints that
 * back them up (Task 7) repeat the same numbers in SQL, with a test that fails
 * when the two drift apart. Change one, change the other.
 *
 * Pure module.
 */
import { BAND_KEYS } from './household.js';

/** Characters in a journal note (code points, so an emoji is one). */
export const JOURNAL_NOTE_MAX = 500;

/** Symptoms in one entry. */
export const JOURNAL_SYMPTOMS_MAX = 20;

/** Characters in one symptom. */
export const JOURNAL_SYMPTOM_MAX_CHARS = 80;

/** How a household rates an entry (the symptom_logs.severity check). */
export const JOURNAL_SEVERITIES = Object.freeze(['mild', 'moderate', 'bad']);

/** Whose entry it is: one of the seven household groups, or the household. */
export const JOURNAL_BANDS = Object.freeze([...BAND_KEYS, 'household']);

/** The earliest entry date accepted, the same floor as the history range reads. */
export const JOURNAL_MIN_DATE = '2000-01-01';
