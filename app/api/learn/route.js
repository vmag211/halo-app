import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { learnTopic, LEARN_TOPICS } from '@/lib/learnContent';
import { normalizeBands, presentGroups } from '@/lib/household';
import { leadRisk } from '@/lib/leadRisk';
import { composeWhyYours } from '@/lib/learnWhyYours';

/**
 * GET /api/learn?topic=pfas&locale=en  (+ context from the reading the overlay
 * was opened over: value, severity, and per topic — pfas: contaminant, limit;
 * radon: county, zone; lead: home_year; air: source, pollutant; uv: peak_start,
 * peak_end; pollen: category; mold: risk, humidity, precip)
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
    // First group (in priority order) that the topic has a note for (§8.5).
    const group = presentGroups(bands).find((g) => base.household && base.household[g]) ?? null;
    const householdNote = (group && base.household[group]) || null;

    return NextResponse.json({
      topic,
      locale: base.locale ?? 'en',
      // learn_content rows have no title column; take it from the code module.
      title: base.title ?? learnTopic(topic, 'en')?.title ?? topic,
      what_it_is: base.what_it_is,
      // Null when the reading's context wasn't passed — never generic filler.
      why_yours: composeWhyYours(topic, (k) => searchParams.get(k), leadRisk),
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
