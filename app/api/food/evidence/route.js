import { evidenceRead } from '@/lib/publicEvidenceRoute';

/**
 * GET /api/food/evidence?resource=food-evidence|published-food-evidence[&foodId=&guideId=]
 * (operation `food.search`, B12).
 *
 * Two resources share this path and `resource` chooses (W:557):
 * `food-evidence` is the dated list on the evidence screen
 * (components/homeguard/FoodEvidence.tsx), studies only while food notices are
 * blocked; `published-food-evidence` is the reviewed FDA study bundle for one
 * catalogue food (components/homeguard/PublishedFoodEvidence.tsx), whose item
 * level is always Unknown (lib/data/foodEvidenceStudies.json). Session
 * required; see lib/publicEvidenceRoute.js.
 */
const read = evidenceRead('food.search');

export async function GET(request) {
  return read(request);
}
