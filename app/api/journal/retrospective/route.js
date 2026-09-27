import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { fetchHistory } from '@/lib/journalHistory';
import { retrospectiveComparison } from '@/lib/journalRetro';
import { localDate } from '@/lib/localDate';

/**
 * POST /api/journal/retrospective { dates: ["YYYY-MM-DD", ...] }
 *   → { ready, factor, statement, ... }
 *
 * Journal's first visit (§14.4): the household taps the rough days they
 * remember, and this compares those days' readings with the rest of those
 * months and with the days they didn't pick — e.g. "On the 3 days you flagged,
 * grass pollen averaged High. The month's average was Low. Days you didn't flag
 * averaged Low." Descriptive, never causal. Past days only.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request) {
  try {
    const { userId } = await requireUser(request);
    const body = await request.json().catch(() => ({}));
    const today = localDate();
    const raw = Array.isArray(body?.dates) ? body.dates : null;
    if (!raw) {
      return NextResponse.json({ error: 'Send { dates: ["YYYY-MM-DD", ...] }.' }, { status: 400 });
    }
    const dates = [...new Set(raw.filter((d) => typeof d === 'string' && DATE_RE.test(d) && d <= today))];
    if (dates.length > 62) {
      return NextResponse.json({ error: 'Pick at most 62 days.' }, { status: 400 });
    }
    if (!dates.length) {
      return NextResponse.json(retrospectiveComparison({ dates: [], history: [] }));
    }

    // The months containing the picked days: that's what "the month's average"
    // and "days you didn't flag" are measured against.
    const sorted = [...dates].sort();
    const from = `${sorted[0].slice(0, 7)}-01`;
    const [y, m] = sorted[sorted.length - 1].slice(0, 7).split('-').map(Number);
    const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const to = monthEnd < today ? monthEnd : today;

    const history = await fetchHistory(supabaseAdmin, userId, from, to);
    return NextResponse.json(retrospectiveComparison({ dates, history }));
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
