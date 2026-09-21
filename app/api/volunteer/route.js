import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { matchOrgs } from '@/lib/volunteerMatch';

/**
 * GET /api/volunteer?county=Cabarrus%20County&causes=water,pfas
 *
 * Organizations filtered by county and by the causes the household has a finding
 * for (§15.3). County defaults to the household's stored county; `causes` is
 * passed from the home assessment (what's elevated). Requires migration 0004 +
 * verified seed; degrades to an empty list if the table isn't present yet.
 */
export async function GET(request) {
  try {
    const { userId } = await requireUser(request);
    const { searchParams } = new URL(request.url);

    let county = searchParams.get('county');
    if (!county) {
      const { data: profile } = await supabaseAdmin.from('profiles').select('county').eq('id', userId).maybeSingle();
      county = profile?.county ?? null;
    }
    const causes = (searchParams.get('causes') || '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);

    const { data: orgs, error } = await supabaseAdmin.from('volunteer_orgs').select('*');
    if (error) {
      // Table not present yet — no verified groups to show.
      return NextResponse.json({ county, causes, count: 0, orgs: [], note: 'Volunteer directory not available yet.' });
    }

    const matched = matchOrgs(orgs || [], { county, causes });
    return NextResponse.json({ county, causes, count: matched.length, orgs: matched });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
