/**
 * A route written only to show what a handler can reach: the environment
 * variables it sees, and what happens when it (or an `after` callback) calls
 * fetch. Not part of the app.
 */
import { NextResponse, after } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';

const WATCHED = [
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'AIRNOW_API_KEY',
  'GOOGLE_POLLEN_API_KEY',
  'MAPBOX_TOKEN',
  'OPENUV_API_KEY',
  'ASSISTANT_MODEL_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'PROBE_OVERRIDE',
];

const attempt = async (url) => {
  try {
    const res = await fetch(url);
    return { ok: true, text: await res.text() };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

export async function GET(request) {
  try {
    const { userId } = await requireUser(request);
    const env = Object.fromEntries(WATCHED.map((name) => [name, process.env[name] ?? null]));
    const fetched = await attempt('https://provider.example.test/v1/readings?key=sk-live-secret');
    after(async () => {
      const later = await attempt('https://after.example.test/job?key=sk-live-secret');
      await supabaseAdmin.from('audit').insert({
        profile_id: userId,
        note: JSON.stringify({ env: process.env.AIRNOW_API_KEY ?? null, later }),
      });
    });
    return NextResponse.json({ env, fetched });
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'probe failed' }, { status: 500 });
  }
}
