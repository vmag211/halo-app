import { evidenceRead } from '@/lib/publicEvidenceRoute';

/**
 * GET /api/fish/advisories?resource=fish-catalogue (operation `fish.read`, B12).
 *
 * The North Carolina fish advisory catalogue the fish screen matches against
 * (components/homeguard/FoodFish.tsx): waterbodies, audiences, species and one
 * rule per advisory and species, from the NC DHHS advisory data service and
 * statewide mercury page (lib/data/ncFishAdvisories.json). Cut-off or
 * contradictory source text is withheld, never shown in part. Session
 * required; see lib/publicEvidenceRoute.js for limits, caching and errors.
 */
const read = evidenceRead('fish.read');

export async function GET(request) {
  return read(request);
}
