/**
 * The `quarter` parameter of the map routes (B05 ruling D2). Pure.
 *
 * The client sends `quarter=latest` whenever it means "no particular quarter"
 * (comparison and pagination calls; the first layer page omits it instead), so
 * `latest` is the absence of a quarter on every layer, exactly like an omitted
 * or empty parameter. It is checked before applicability, so
 * `layer=air&quarter=latest` is answered like `layer=air`.
 *
 * Anything else keeps the answer it had before `latest` was accepted: a quarter
 * on a layer other than water is `quarter_not_applicable`, and a water quarter
 * that is not `YYYYQn` is `invalid_quarter`. Only the exact lowercase `latest`
 * is accepted; `Latest` and `LATEST` are not.
 *
 * One parser, so /api/map and /api/map/comparison cannot drift apart.
 */

export const QUARTER_RE = /^\d{4}Q[1-4]$/;
export const LATEST_QUARTER = 'latest';

/**
 * @param {string|null|undefined} value the raw `quarter` query value
 * @param {string} layer the already validated layer
 * @returns {{ok: true, quarter: string|null} | {ok: false, code: string, message: string}}
 */
export function parseMapQuarter(value, layer) {
  if (value === null || value === undefined || value === '' || value === LATEST_QUARTER) return { ok: true, quarter: null };
  if (layer !== 'water') {
    return { ok: false, code: 'quarter_not_applicable', message: 'quarter applies to the water layer only.' };
  }
  if (typeof value !== 'string' || !QUARTER_RE.test(value)) {
    return { ok: false, code: 'invalid_quarter', message: 'quarter looks like 2024Q3.' };
  }
  return { ok: true, quarter: value };
}
