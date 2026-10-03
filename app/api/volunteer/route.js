import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { matchOrgs } from '@/lib/volunteerMatch';
import { parseVolunteerQuery } from '@/lib/directoryInput';
import { requestIdFor, validationError, internalError } from '@/lib/apiErrors';

/**
 * GET /api/volunteer?county=Cabarrus%20County&causes=water,pfas
 *
 * Organizations filtered by county and by the causes the household has a finding
 * for (§15.3). County defaults to the household's stored county; `causes` is
 * passed from the home assessment (what's elevated). Requires migration 0004 +
 * verified seed; degrades to an empty list if the table isn't present yet.
 *
 * `county` (at most 100 characters, no control characters) and `causes` (at most
 * 12 tags) are validated: malformed is a 400 with field errors (lib/directoryInput.js).
 *
 * "No organization matches" and "the directory could not be read" are different
 * answers. Both are a 200 with an empty list, but only the second carries
 * `unavailable: true` and `reason: 'directory_unavailable'` (plus the old note).
 * A failed read of the household's own profile is a 500: answering it with no
 * county would list every county's organizations as if they were this one's.
 */
export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);
    const { searchParams } = new URL(request.url);

    const query = parseVolunteerQuery(searchParams);
    if (!query.ok) return validationError(query.fieldErrors, requestId);
    const { causes } = query.value;

    let county = query.value.county;
    if (!county) {
      const { data: profile, error: profileError } = await supabaseAdmin.from('profiles').select('county').eq('id', userId).maybeSingle();
      if (profileError) throw new Error(`Could not read profile: ${profileError.message}`);
      county = profile?.county ?? null;
    }

    const { data: orgs, error } = await supabaseAdmin.from('volunteer_orgs').select('*');
    if (error) {
      // Table not present yet: no verified groups to show, and the answer says so.
      console.error(`Volunteer directory unavailable (request ${requestId}):`, error.message);
      return NextResponse.json(
        {
          county,
          causes,
          count: 0,
          orgs: [],
          note: 'Volunteer directory not available yet.',
          unavailable: true,
          reason: 'directory_unavailable',
        },
        { headers },
      );
    }

    const matched = matchOrgs(orgs || [], { county, causes });
    return NextResponse.json({ county, causes, count: matched.length, orgs: matched }, { headers });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`Volunteer failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
