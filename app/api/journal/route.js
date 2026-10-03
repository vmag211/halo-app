import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { BAND_KEYS } from '@/lib/household';
import { localDate } from '@/lib/localDate';
import { parseDateRange, parseUuid } from '@/lib/validate';
import { requestIdFor, validationError, internalError } from '@/lib/apiErrors';
import { JOURNAL_ROW_LIMIT, isTruncated } from '@/lib/boundedRead';

/**
 * Symptom journal (§14).
 *   GET    /api/journal?from&to      → entries for this household (newest first,
 *                                       default the last 90 days, at most 366 days
 *                                       and 2000 rows; `truncated` says when rows
 *                                       were cut, always the oldest)
 *   POST   /api/journal              → save/update an entry (one per date+band)
 *   DELETE /api/journal?id=<uuid>    → delete one entry  (swipe to delete, §47.4)
 *   DELETE /api/journal?all=true     → delete every entry (clear journal, §31.5)
 *
 * Dates are the household's local (America/New_York) calendar days, the same
 * dates readings are stored under, so the two join by date string.
 *
 * Owned entirely by the household. Re-logging the same date+band updates rather
 * than duplicating. Requires migration 0003.
 */

const SEVERITIES = new Set(['mild', 'moderate', 'bad']);
// Whose entry this is: one of the seven household groups, or the household.
const BANDS = new Set([...BAND_KEYS, 'household']);

export async function GET(request) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);
    const { searchParams } = new URL(request.url);
    // The same range rules as /api/history: real dates, from not after to, at
    // most 366 days; a missing from is 90 days ending at to (default today).
    const range = parseDateRange(
      { from: searchParams.get('from'), to: searchParams.get('to') },
      { today: localDate(), defaultDays: 90, maxDays: 366 },
    );
    if (!range.ok) return validationError(range.fieldErrors, requestId);
    const { from, to } = range.value;

    const { data, error, count } = await supabaseAdmin
      .from('symptom_logs')
      .select('*', { count: 'exact' })
      .eq('profile_id', userId)
      .gte('entry_date', from)
      .lte('entry_date', to)
      .order('entry_date', { ascending: false })
      .limit(JOURNAL_ROW_LIMIT);
    if (error) throw new Error(error.message);
    const entries = data || [];
    return NextResponse.json(
      {
        from,
        to,
        count: entries.length,
        entries,
        truncated: isTruncated({ count, returned: entries.length, limit: JOURNAL_ROW_LIMIT }),
      },
      { headers: { 'X-Request-Id': requestId } },
    );
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`journal GET failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}

export async function POST(request) {
  try {
    const { userId } = await requireUser(request);
    const body = await request.json().catch(() => ({}));

    const entry_date = typeof body.entry_date === 'string' ? body.entry_date : null;
    if (!entry_date || !/^\d{4}-\d{2}-\d{2}$/.test(entry_date)) {
      return NextResponse.json({ error: 'A valid entry_date (YYYY-MM-DD) is required.' }, { status: 400 });
    }
    const severity = body.severity == null ? null : String(body.severity).toLowerCase();
    if (severity !== null && !SEVERITIES.has(severity)) {
      return NextResponse.json({ error: 'severity must be mild, moderate, or bad.' }, { status: 400 });
    }

    const band = typeof body.band === 'string' && body.band ? body.band : 'household';
    if (!BANDS.has(band)) {
      return NextResponse.json(
        { error: `band must be one of: ${[...BANDS].join(', ')}.` },
        { status: 400 },
      );
    }

    const row = {
      profile_id: userId,
      entry_date,
      band,
      symptoms: Array.isArray(body.symptoms) ? body.symptoms.map(String).slice(0, 20) : [],
      severity,
      // Escaped on display by the client; capped here.
      note: typeof body.note === 'string' ? body.note.slice(0, 500) : null,
      retrospective: body.retrospective === true,
      possibly_illness: body.possibly_illness === true,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from('symptom_logs')
      .upsert(row, { onConflict: 'profile_id,entry_date,band' })
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    return NextResponse.json({ entry: data });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const rawId = searchParams.get('id');
    const all = searchParams.get('all') === 'true';

    let q = supabaseAdmin.from('symptom_logs').delete().eq('profile_id', userId);
    if (all) {
      // scoped to this household by the eq above; an id next to all=true is ignored
    } else if (rawId === null || rawId === '') {
      return validationError(
        [{ field: 'id', code: 'id_required', message: 'Pass id=<entry id> or all=true.' }],
        requestId,
      );
    } else {
      const id = parseUuid(rawId);
      if (!id.ok) return validationError([{ field: 'id', code: id.code, message: id.message }], requestId);
      q = q.eq('id', id.value);
    }
    const { data, error } = await q.select('id');
    if (error) throw new Error(error.message);
    return NextResponse.json({ deleted: (data || []).length }, { headers: { 'X-Request-Id': requestId } });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`journal DELETE failed (request ${requestId}):`, err);
    return internalError(requestId);
  }
}
