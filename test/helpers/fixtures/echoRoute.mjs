/**
 * A route written only to exercise the harness (dynamic params, `after`,
 * request.nextUrl, the stubs). Not part of the app.
 */
import { NextResponse, after } from 'next/server';
import { requireUser, authErrorResponse, supabaseAdmin } from '@/lib/serverAuth';
import { checkLimit, pushLimiter } from '@/lib/ratelimit';

export async function POST(request, context) {
  try {
    const { userId } = await requireUser(request);
    const params = await context.params;
    const allowed = await checkLimit(pushLimiter, `echo:${userId}`);
    after(async () => {
      await supabaseAdmin.from('audit').insert({ profile_id: userId, note: `after ${params.id}` });
    });
    return NextResponse.json(
      {
        userId,
        id: params.id,
        paramsWasPromise: typeof context.params?.then === 'function',
        search: request.nextUrl.search,
        body: await request.json().catch(() => null),
        allowed,
      },
      { status: 201, headers: { 'X-Echo': 'yes' } },
    );
  } catch (err) {
    return authErrorResponse(err) ?? NextResponse.json({ error: 'echo failed' }, { status: 500 });
  }
}
