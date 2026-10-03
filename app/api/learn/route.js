import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { learnTopic } from '@/lib/learnContent';
import { normalizeBands, presentGroups } from '@/lib/household';
import { leadRisk } from '@/lib/leadRisk';
import { composeWhyYours } from '@/lib/learnWhyYours';
import { parseLearnQuery } from '@/lib/directoryInput';
import { ERROR_CODES, apiError, requestIdFor, validationError, internalError } from '@/lib/apiErrors';

/**
 * GET /api/learn?topic=pfas&locale=en  (+ context from the reading the overlay
 * was opened over: value, severity, and per topic — pfas: contaminant, limit;
 * radon: county, zone; lead: home_year; air: source, pollutant; uv: peak_start,
 * peak_end; pollen: category; mold: risk, humidity, precip)
 *
 * Learn is never generic: it explains a specific number the household is looking
 * at (§17). We return the base content plus a "why yours" line composed from the
 * context and a "what this means for your household" branch from composition.
 *
 * `topic`, `locale` and the text of the reading are validated (lib/directoryInput.js):
 * malformed is a 400 with field errors. Where a database read fails, the answer is
 * still complete (the code module has the content, and no household note is
 * shown) but carries `unavailable: true` and a `reason`, so "no translation or
 * note exists" and "the database could not be read" are not the same answer.
 */
export async function GET(request) {
  const requestId = requestIdFor(request);
  const headers = { 'X-Request-Id': requestId };
  try {
    const { userId } = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const query = parseLearnQuery(searchParams);
    if (!query.ok) return validationError(query.fieldErrors, requestId);
    const { topic, locale } = query.value;

    // Prefer human-reviewed DB content (esp. Spanish); fall back to the code
    // module. Before migration 0005 / seeding, the DB read simply returns null.
    let base = null;
    let contentFailed = false;
    {
      const { data, error } = await supabaseAdmin
        .from('learn_content')
        .select('*')
        .eq('topic', topic)
        .eq('locale', locale)
        .maybeSingle();
      if (error) {
        contentFailed = true;
        console.error(`Learn content read failed (request ${requestId}):`, error.message);
      }
      if (data) base = data;
    }
    if (!base) base = learnTopic(topic, 'en'); // 'es' only exists in the DB
    if (!base) {
      return apiError({ status: 404, code: ERROR_CODES.NOT_FOUND, message: 'Content not available', requestId });
    }

    // Household branch (§17.2 step 3): pick the most specific applicable group.
    let bandRow = null;
    let bandsFailed = false;
    {
      const { data, error } = await supabaseAdmin.from('household_bands').select('*').eq('profile_id', userId).maybeSingle();
      if (error) {
        bandsFailed = true;
        console.error(`Learn household read failed (request ${requestId}):`, error.message);
      }
      if (data) bandRow = data;
    }
    const bands = normalizeBands(bandRow);
    // First group (in priority order) that the topic has a note for (§8.5).
    const group = presentGroups(bands).find((g) => base.household && base.household[g]) ?? null;
    const householdNote = (group && base.household[group]) || null;

    const unavailableReason = contentFailed ? 'learn_content_unavailable' : bandsFailed ? 'household_unavailable' : null;
    return NextResponse.json(
      {
        topic,
        locale: base.locale ?? 'en',
        // learn_content rows have no title column; take it from the code module.
        title: base.title ?? learnTopic(topic, 'en')?.title ?? topic,
        what_it_is: base.what_it_is,
        // Null when the reading's context wasn't passed, never generic filler.
        why_yours: composeWhyYours(topic, (k) => searchParams.get(k), leadRisk),
        household_note: householdNote,
        protect: base.protect ?? [],
        sources: base.sources ?? [],
        ...(unavailableReason && { unavailable: true, reason: unavailableReason }),
      },
      { headers },
    );
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`Learn failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
