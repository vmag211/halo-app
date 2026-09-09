/**
 * Normalizes the water-source answer collected during onboarding.
 *
 * The picker offers "City utility" / "Well" / "Spring" / "Other" as display
 * strings; HomeGuard branches on the lowercase tokens 'well' and 'spring'. That
 * gap is not cosmetic: a private-well household whose answer fails to match
 * falls through to the public-utility PFAS lookup and is shown a measurement for
 * a system they are not connected to, instead of the testing plan they need.
 * Nothing about a private well is ever measured by an agency, so that would be
 * exactly the "no data rendered as safe" failure the honesty convention exists
 * to prevent.
 *
 * Normalizing on the server keeps the contract independent of how any client
 * happens to capitalize its labels.
 */

const CANONICAL = ['utility', 'well', 'spring', 'other'];

/**
 * @param {string|null|undefined} raw
 * @returns {'utility'|'well'|'spring'|'other'|null} null when nothing was answered
 */
export function normalizeWaterSource(raw) {
  if (raw === null || raw === undefined) return null;

  const value = String(raw).trim().toLowerCase();
  if (value === '') return null;

  if (CANONICAL.includes(value)) return value;

  // Private sources first: misrouting these is the failure that matters.
  if (value.includes('well')) return 'well';
  if (value.includes('spring')) return 'spring';
  if (value.includes('city') || value.includes('utility') || value.includes('municipal')) {
    return 'utility';
  }
  if (value.includes('other') || value.includes('not sure') || value.includes('unknown')) {
    return 'other';
  }

  // An answer we do not recognize is not evidence of a public utility. Treat it
  // as 'other' so downstream code keeps its uncertainty rather than defaulting
  // into a measurement path.
  console.warn(`normalizeWaterSource: unrecognized value ${JSON.stringify(raw)}, treating as 'other'`);
  return 'other';
}
