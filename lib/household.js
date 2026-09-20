/**
 * Household composition model (§8).
 *
 * Seven yes/no group facts — no ages, birthdates, or names. Composition NEVER
 * changes a measurement, a severity level, or a score (§8.2). It only selects
 * which explanatory sentence appears and which actions are recommended.
 *
 * Pure module.
 */

export const BAND_KEYS = [
  "has_toddler",
  "has_child",
  "has_teen",
  "has_adult",
  "has_senior",
  "has_pregnant",
  "has_respiratory",
];

/**
 * Coerce a stored row (or null) into a complete bands object. A skipped or
 * absent household is all-false → general-population wording everywhere.
 */
export function normalizeBands(row) {
  const out = {};
  for (const k of BAND_KEYS) out[k] = row ? row[k] === true : false;
  return out;
}

/** Did the household give any composition at all? */
export function hasAnyBand(bands) {
  return BAND_KEYS.some((k) => bands[k] === true);
}

// When several groups apply, name the most specific one, in this priority order
// (§8.5): respiratory, then toddler, then pregnancy, then senior, then child.
// Teen and adult carry no special interpretation, so they fall through to general.
const PRIORITY = ["has_respiratory", "has_toddler", "has_pregnant", "has_senior", "has_child"];

/** The highest-priority applicable group key, or null for general population. */
export function priorityGroup(bands) {
  for (const k of PRIORITY) if (bands[k] === true) return k;
  return null;
}

// Federal air-quality guidance treats these as sensitive groups; households
// containing one get air-quality alerts one level earlier (§19.3).
const SENSITIVE = ["has_respiratory", "has_toddler", "has_senior"];

/** Does the household contain a recognized sensitive group? */
export function hasSensitiveGroup(bands) {
  return SENSITIVE.some((k) => bands[k] === true);
}

// Human phrasings used when a sentence names a specific person. Naming a
// specific person consistently outperforms hedging (§8.5).
const GROUP_PHRASE = {
  has_respiratory: "anyone with asthma or a breathing condition",
  has_toddler: "your youngest",
  has_pregnant: "anyone pregnant",
  has_senior: "older adults in your home",
  has_child: "your kids",
};

/** A short noun phrase for a group key, e.g. for building a sentence. */
export function groupPhrase(key) {
  return GROUP_PHRASE[key] ?? null;
}
