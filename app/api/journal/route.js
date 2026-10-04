import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { localDate } from '@/lib/localDate';
import { parseDateRange, parseUuid, readJsonBody } from '@/lib/validate';
import { requestIdFor, apiError, validationError, internalError } from '@/lib/apiErrors';
import { JOURNAL_ROW_LIMIT, isTruncated } from '@/lib/boundedRead';
import { parseJournalEntry } from '@/lib/journalInput';

/**
 * Symptom journal (§14).
 *   GET    /api/journal?from&to      → entries for this household (newest first,
 *                                       default the last 90 days, at most 366 days
 *                                       and 2000 rows; `truncated` says when rows
 *                                       were cut, always the oldest)
 *   POST   /api/journal              → save/update an entry (one per date+band).
 *                                       The body is read with an 8192 byte limit and
 *                                       validated field by field (lib/journalInput.js):
 *                                       invalid JSON is a 400, an oversize body a 413,
 *                                       a bad field a 400 with field_errors, and
 *                                       nothing is saved in any of those cases.
 *   DELETE /api/journal?id=<uuid>    → delete one entry  (swipe to delete, §47.4)
 *   DELETE /api/journal?all=true     → delete every entry (clear journal, §31.5)
 *
 * Dates are the household's local (America/New_York) calendar days, the same
 * dates readings are stored under, so the two join by date string.
 *
 * Owned entirely by the household. Re-logging the same date+band updates rather
 * than duplicating. Requires migration 0003.
 */

// The write limits (note, symptoms, severities, bands, earliest date) are in lib/limits.js.
const POST_MAX_BYTES = 8192;

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
  const requestId = requestIdFor(request);
  try {
    const { userId } = await requireUser(request);
    const body = await readJsonBody(request, { maxBytes: POST_MAX_BYTES });
    if (!body.ok) {
      return apiError({ status: body.status, code: body.code, message: body.message, requestId });
    }
    const input = parseJournalEntry(body.value, { today: localDate() });
    if (!input.ok) return validationError(input.fieldErrors, requestId);

    // The owner key comes last, so nothing in the validated input can override it.
    const row = {
      ...input.value,
      updated_at: new Date().toISOString(),
      profile_id: userId,
    };

    const { data, error } = await supabaseAdmin
      .from('symptom_logs')
      .upsert(row, { onConflict: 'profile_id,entry_date,band' })
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    return NextResponse.json({ entry: data }, { headers: { 'X-Request-Id': requestId } });
  } catch (err) {
    const authResponse = authErrorResponse(err, requestId);
    if (authResponse) return authResponse;
    console.error(`journal POST failed (request ${requestId}):`, err);
    return internalError(requestId);
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
