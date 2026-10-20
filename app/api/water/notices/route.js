import { evidenceRead } from '@/lib/publicEvidenceRoute';

/**
 * GET /api/water/notices?resource=water-stewardship (operation `water.read`, B12).
 *
 * The water and conservation screen's sources (components/homeguard/FoodWater.tsx):
 * the 100 North Carolina counties, their weekly U.S. Drought Monitor area
 * distributions, and the NC Division of Water Resources conservation status of
 * each listed public water system (lib/data/ncWaterStewardship.json). A county
 * distribution is not a home reading, and a status is not the utility's rule
 * text. Session required; see lib/publicEvidenceRoute.js.
 */
const read = evidenceRead('water.read');

export async function GET(request) {
  return read(request);
}
