import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { learnTopic, LEARN_TOPICS } from '@/lib/learnContent';
import { normalizeBands, priorityGroup } from '@/lib/household';
import { leadRisk } from '@/lib/leadRisk';

/**
 * GET /api/learn?topic=pfas&locale=en  (+ optional context that came from the
 * reading the overlay was opened over: contaminant, value, limit, county, zone,
 * home_year, source)
 *
 * Learn is never generic: it explains a specific number the household is looking
 * at (§17). We return the base content plus a "why yours" line composed from the
 * context and a "what this means for your household" branch from composition.
 */
export async function GET(request) {
  try {
    const { userId } = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const topic = (searchParams.get('topic') || '').toLowerCase();
    const locale = searchParams.get('locale') === 'es' ? 'es' : 'en';

    if (!LEARN_TOPICS.includes(topic)) {
      return NextResponse.json({ error: `Unknown topic. One of: ${LEARN_TOPICS.join(', ')}` }, { status: 400 });
    }

    // Prefer human-reviewed DB content (esp. Spanish); fall back to the code
    // module. Before migration 0005 / seeding, the DB read simply returns null.
    let base = null;
    {
      const { data } = await supabaseAdmin
        .from('learn_content')
        .select('*')
        .eq('topic', topic)
        .eq('locale', locale)
        .maybeSingle();
      if (data) base = data;
    }
    if (!base) base = learnTopic(topic, 'en'); // 'es' only exists in the DB
    if (!base) return NextResponse.json({ error: 'Content not available' }, { status: 404 });

    // Household branch (§17.2 step 3): pick the most specific applicable group.
    let bandRow = null;
    {
      const { data } = await supabaseAdmin.from('household_bands').select('*').eq('profile_id', userId).maybeSingle();
      if (data) bandRow = data;
    }
    const bands = normalizeBands(bandRow);
    const group = priorityGroup(bands);
    const householdNote = (base.household && group && base.household[group]) || null;

    return NextResponse.json({
      topic,
      locale: base.locale ?? 'en',
      title: base.title ?? topic,
      what_it_is: base.what_it_is,
      why_yours: composeWhyYours(topic, searchParams),
      household_note: householdNote,
      protect: base.protect ?? [],
      sources: base.sources ?? [],
    });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// The contextual second section — references the household's own value. Falls
// back to a generic line when the reading context wasn't passed.
function composeWhyYours(topic, sp) {
  const num = (k) => {
    const v = parseFloat(sp.get(k));
    return Number.isFinite(v) ? v : null;
  };
  switch (topic) {
    case 'pfas': {
      const c = sp.get('contaminant');
      const value = num('value');
      const limit = num('limit');
      if (c && value !== null && limit !== null) {
        const ratio = (Math.round((value / limit) * 10) / 10).toFixed(1);
        return `Your utility's most recent federal testing found ${c} at ${value} ppt — about ${ratio}× the federal limit of ${limit} ppt.`;
      }
      return 'This explains the PFAS reading your utility reported for your water.';
    }
    case 'radon': {
      const county = sp.get('county');
      const zone = sp.get('zone');
      if (county && zone) {
        return `${county} is a Zone ${zone} radon area. A zone predicts the county average, not your home — homes in low zones still test high.`;
      }
      return 'This explains what your county radon zone does and does not tell you.';
    }
    case 'lead': {
      const homeYear = num('home_year');
      const assessment = leadRisk({ homeYear: homeYear });
      return assessment.text;
    }
    case 'air': {
      const source = sp.get('source');
      if (source === 'open-meteo') return 'Your reading is a modeled estimate — the nearest monitoring station is more than 25 miles away.';
      if (source === 'airnow') return 'Your reading was measured at a physical monitoring station near you.';
      return 'This explains the air quality reading for your area.';
    }
    default:
      return `This explains the ${topic} reading for your area.`;
  }
}
