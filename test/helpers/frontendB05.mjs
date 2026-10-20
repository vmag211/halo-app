/**
 * The frontend code the B05 routes are judged by. Everything that lives in a
 * TypeScript module is now IMPORTED from the real file (compiled in memory by
 * test/frontend-test-loader.mjs, the same way test/frontend-*.test.mjs load
 * it), so a change to the frontend validator changes what these suites see.
 * One module, shared by every B05 suite that needs it, so the per-route suites
 * and the contract suite (test/contractsB05.test.mjs) cannot drift apart:
 *
 * - `lib/frontend/stage-values.ts` (record, finite, nonnegative, safeText,
 *   textList, rows, severity, safeUrl, isoDate, timestamp);
 * - `lib/frontend/map-service.ts` (emptyMapSnapshot, parseMapLayer,
 *   parseMapComparisons, parseMapDistrict);
 * - `lib/frontend/map-preview.ts` (compounds) and `lib/frontend/copy/map-comparison.ts`
 *   (the whole `mapComparisonCopy`, as `c`);
 * - `lib/frontend/map-comparison-preview.ts` (comparisonRows, compareEvidence);
 * - `lib/frontend/production/explore-service.ts` (validPlaces,
 *   validDiscoveryArea).
 *
 * Still TRANSCRIBED, because the code lives in a `.tsx` component that cannot
 * be imported here: `components/map-preview/MapComparison.tsx:64` (the row
 * label, as `rowLabel`, built on the real copy `c`).
 *
 * A validator that accepted everything would pass every body it is given, so
 * each suite that uses these also shows that they reject what the client
 * rejects (precedent: test/contractsB03.test.mjs).
 */
import { loadFrontend } from '../frontend-test-loader.mjs';

const values = await loadFrontend('stage-values');
const service = await loadFrontend('map-service');
const preview = await loadFrontend('map-preview');
const copy = await loadFrontend('copy/map-comparison');
const comparison = await loadFrontend('map-comparison-preview');
const explore = await loadFrontend('production/explore-service');

const { record, finite, nonnegative, safeText, textList, rows, severity, safeUrl, isoDate, timestamp } = values;
const { emptyMapSnapshot, parseMapLayer, parseMapComparisons, parseMapDistrict } = service;
const { compounds } = preview;
const c = copy.mapComparisonCopy;
const { comparisonRows, compareEvidence } = comparison;
const { validPlaces, validDiscoveryArea } = explore;

// ------------------------------------------ transcribed: MapComparison.tsx:64

const rowLabel = (row) => row.compatible ? (row.warnings.length ? c.limited : c.matched) : c.unavailable;

export {
  record, finite, nonnegative, safeText, textList, rows, severity, safeUrl, isoDate, timestamp,
  emptyMapSnapshot, parseMapLayer, parseMapComparisons, parseMapDistrict,
  compounds, c, comparisonRows, compareEvidence, rowLabel,
  validPlaces, validDiscoveryArea,
};
