import { NextResponse } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';

/**
 * Symptom journal (§14).
 *   GET  /api/journal?from&to  → entries for this household
 *   POST /api/journal          → save/update an entry (one per date+band)
 *
 * Owned entirely by the household. Re-logging the same date+band updates rather
 * than duplicating. Requires migration 0003.
 */

const SEVERITIES = new Set(['mild', 'moderate', 'bad']);

export async function GET(request) {
  try {
    const { userId } = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const to = searchParams.get('to') || new Date().toISOString().slice(0, 10);
    let from = searchParams.get('from');
    if (!from) {
      const d = new Date(`${to}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 89);
      from = d.toISOString().slice(0, 10);
    }
    const { data, error } = await supabaseAdmin
      .from('symptom_logs')
      .select('*')
      .eq('profile_id', userId)
      .gte('entry_date', from)
      .lte('entry_date', to)
      .order('entry_date', { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json({ from, to, count: (data || []).length, entries: data || [] });
  } catch (err) {
    const authResponse = authErrorResponse(err);
    if (authResponse) return authResponse;
    return NextResponse.json({ error: err.message }, { status: 500 });
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

    const row = {
      profile_id: userId,
      entry_date,
      band: typeof body.band === 'string' && body.band ? body.band : 'household',
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
