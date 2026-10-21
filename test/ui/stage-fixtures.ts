import type { Page, Route } from '@playwright/test';

export const stageUserId = '00000000-0000-4000-8000-000000000001';
export const stageProfile = {
  onboarded: true, onboarding_complete: true, household_set: true,
  profile: { county: 'Cabarrus', state: 'NC', lat: 35.4, lng: -80.5, pwsid: null, water_source: 'utility', home_year: 1975 },
  household: { has_toddler: false, has_child: true, has_teen: false, has_adult: true, has_senior: false, has_pregnant: false, has_respiratory: false },
};
/** The placeholder Supabase project the stage server builds against (scripts/stage-test-server.mjs reads
 * the same variable and default). supabase-js keys its stored session by the URL's first host label. */
export const stageSupabaseUrl = new URL(process.env.HALO_STAGE_SUPABASE_URL || 'http://127.0.0.1:54321');
const stageSessionKey = `sb-${stageSupabaseUrl.hostname.split('.')[0]}-auth-token`;
export type StageRequest = { path: string; method: string; body: unknown };
type Handler = (route: Route, url: URL) => Promise<void>;
export type StageMockOptions = { assistant?: Handler; overrides?: Record<string, Handler> };

export async function jsonRoute(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Browser-only fake auth and API responses. Every other external/API request is
 * aborted, including any accidentally configured real Supabase project. */
export async function mockStage(page: Page, options: StageMockOptions = {}) {
  const requests: StageRequest[] = [];
  const blocked: string[] = [];
  const now = Math.floor(Date.now() / 1000);
  const user = { id: stageUserId, aud: 'authenticated', role: 'authenticated', is_anonymous: true, app_metadata: { provider: 'anonymous', providers: ['anonymous'] }, user_metadata: {}, created_at: new Date().toISOString() };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const session = {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: stageUserId, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 86400, is_anonymous: true })}.test-signature`,
    refresh_token: 'isolated-test-refresh-token', token_type: 'bearer', expires_in: 86400, expires_at: now + 86400, user,
  };
  await page.addInitScript(({ session, stageSessionKey }) => {
    localStorage.setItem(stageSessionKey, JSON.stringify(session));
    Object.assign(window, { turnstile: { render: (_container: unknown, config: { callback: (token: string) => void }) => { queueMicrotask(() => config.callback('isolated-test-captcha')); return 'test-widget'; }, remove: () => {} } });
  }, { session, stageSessionKey });
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    const isStageSupabase = url.origin === stageSupabaseUrl.origin;
    if (isStageSupabase && url.pathname.startsWith('/auth/v1/')) {
      if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } }); return; }
      if (['/auth/v1/signup', '/auth/v1/token', '/auth/v1/user'].includes(url.pathname)) {
        await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(url.pathname === '/auth/v1/user' ? user : session) }); return;
      }
    }
    // The placeholder Supabase origin is local, so it is blocked explicitly rather than by host.
    if (isStageSupabase || !['127.0.0.1', 'localhost'].includes(url.hostname)) { blocked.push(url.origin + url.pathname); await route.abort('blockedbyclient'); return; }
    if (!url.pathname.startsWith('/api/')) { await route.continue(); return; }
    let body: unknown = null;
    try { body = request.postDataJSON(); } catch { /* GET has no body. */ }
    requests.push({ path: url.pathname + url.search, method: request.method(), body });
    const override = options.overrides?.[url.pathname];
    if (override) { await override(route, url); return; }
    if (url.pathname === '/api/assistant' && options.assistant) { await options.assistant(route, url); return; }
    if (request.method() === 'GET') {
      if (url.pathname === '/api/profile') { await jsonRoute(route, stageProfile); return; }
      if (url.pathname === '/api/daily-score') { await jsonRoute(route, { air: null, uv: null, pollen: null, mold: null, score: null, retrieved_at: '2026-10-01T14:00:00Z' }); return; }
      if (url.pathname === '/api/home-guard') { await jsonRoute(route, { water: null, radon: null, lead: null, score: null, assembled_at: '2026-10-01T14:00:00Z' }); return; }
      if (url.pathname === '/api/history') { await jsonRoute(route, { from: '2026-09-25', to: '2026-10-01', count: 0, history: [] }); return; }
      if (url.pathname === '/api/learn') { const topic = url.searchParams.get('topic'); await jsonRoute(route, { topic, title: topic, locale: 'en', what_it_is: 'General educational information.', why_yours: null, household_note: null, protect: [], sources: [] }); return; }
      if (url.pathname === '/api/alerts') { await jsonRoute(route, { count: 0, unread: 0, alerts: [] }); return; }
      if (url.pathname === '/api/assistant') { await jsonRoute(route, { suggestions: ['Explain the available readings.'], disclaimer: 'General information, not medical advice.' }); return; }
    }
    blocked.push(`${request.method()} ${url.pathname}`); await route.abort('blockedbyclient');
  });
  return { requests, blocked };
}
