import { participationRead } from '@/lib/participationRoute';
import { parseSearchQuery, searchOpportunities } from '@/lib/participation';

/**
 * GET /api/opportunities?area=<json>&interest=&search=&timing=&cursor=
 * (registry `opportunities.search`, runtime.ts:43; B18 plan)
 *
 *   200 { items: [CommunityOpportunity & {revision}], areaLabel, checkedAt,
 *         availability: 'ready' | 'empty' | 'partial' | 'no_coverage', nextCursor, complete: false }
 *
 * Only listings a person wrote and verified (migration 0032) are served:
 * verified within 29 days, status listed, and a scheduled one only before it
 * starts; rolling programs are marked rolling and carry no dates (Rulings P2,
 * P3). The area matches by its own id, its county or statewide, never by
 * distance (P5). No area or no verified listing for it is `no_coverage`;
 * filters that remove every listing are `empty` (P6). `complete` is always
 * false (P7). A failed read is a 5xx, never `items: []`. Session, flag,
 * limiter and errors: lib/participationRoute.js.
 */
const read = participationRead('opportunities.search', (params) => parseSearchQuery(params, { withTiming: true }), searchOpportunities);

export async function GET(request) {
  return read(request);
}
