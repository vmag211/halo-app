import { participationRead } from '@/lib/participationRoute';
import { notFound, parseDetailQuery, readOpportunity } from '@/lib/participation';

/**
 * GET /api/opportunities/detail?id=  (registry `opportunities.detail`, runtime.ts:44; B18 plan)
 *
 *   200 CommunityOpportunity & {revision}      404 not_found
 *
 * Any listing a person verified (migration 0032), whatever its status, date
 * or freshness, so a saved commitment can learn it was cancelled, is full or
 * has passed; the client labels it from `status`, `startsAt` and `checkedAt`
 * (explore-opportunities.ts:73-83). An id that is unknown or not verified is
 * the same 404 (Ruling P4). No screen calls this yet. Session, flag, limiter
 * and errors: lib/participationRoute.js.
 */
const read = participationRead('opportunities.detail', parseDetailQuery, (supabase, { id }) => readOpportunity(supabase, id), notFound);

export async function GET(request) {
  return read(request);
}
