import { evidenceRead } from '@/lib/publicEvidenceRoute';

/**
 * GET /api/growers?resource=grower-resources (operation `growers.search`, B12).
 *
 * The official North Carolina testing and grower support resources
 * (components/homeguard/FoodGrower.tsx), an editorially maintained list whose
 * links and quoted text were checked when built (lib/data/ncGrowerResources.json).
 * Opening a link submits nothing and books nothing. Session required; see
 * lib/publicEvidenceRoute.js.
 */
const read = evidenceRead('growers.search');

export async function GET(request) {
  return read(request);
}
