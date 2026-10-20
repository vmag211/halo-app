import { participationRead } from '@/lib/participationRoute';
import { parseSearchQuery, searchOrganizations } from '@/lib/participation';

/**
 * GET /api/explore/organizations?area=<json>&interest=&search=&cursor=
 * (registry `organizations.search`, runtime.ts:45; B18 plan)
 *
 *   200 { items: [LocalParticipationResource & {checkedAt, revision}], complete: false, nextCursor }
 *
 * Only participation profiles a person wrote and verified within 180 days
 * (migration 0032, Ruling P2), each one route of one volunteer_orgs row
 * (P10). The area matches by its own id, its county or statewide, never by
 * distance (P5); no area is `items: []`. `complete` is always false (P7).
 * An unreadable directory is a 5xx, never `items: []` (B05 9.3). Session,
 * flag, limiter and errors: lib/participationRoute.js.
 */
const read = participationRead('organizations.search', (params) => parseSearchQuery(params, { withTiming: false }), searchOrganizations);

export async function GET(request) {
  return read(request);
}
