import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { fetchHistory } from '@/lib/journalHistory';
import { seasonSummary, seasonRange, lastEndedSeason, SEASONS } from '@/lib/journalRetro';
import { localDate } from '@/lib/localDate';

/**
 * GET /api/journal/summary[?season=spring|summer|fall|winter&year=YYYY]
 *   → { season, year, logged_days, statement, factor, from, to }
 *
 * The season recap (§14.7), e.g. "This spring you logged 22 days. On the 9
 * high-pollen days, you flagged symptoms 7 times." Defaults to the most recently
 * ended season. Winter belongs to the year it starts in.
 */
export async function GET(request) {
  try {
    const { userId } = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const fallback = lastEndedSeason(localDate());
    const season = (searchParams.get('season') || fallback.season).toLowerCase();
    const year = searchParams.get('year') ? Number(searchParams.get('year')) : fallback.year;

    if (!SEASONS.includes(season) || !Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: `season must be one of ${SEASONS.join(', ')}, with a four-digit year.` }, { status: 400 });
    }
    const { from, to } = seasonRange(season, year);

    const [history, { data: entries, error }] = await Promise.all([
      fetchHistory(supabaseAdmin, userId, from, to),
      supabaseAdmin
        .from('symptom_logs')
        .select('entry_date, symptoms, possibly_illness')
        .eq('profile_id', userId)
        .gte('entry_date', from)
        .lte('entry_date', to),
    ]);
    if (error) throw new Error(error.message);

    return NextResponse.json(seasonSummary({ season, year, entries: entries || [], history }));
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
