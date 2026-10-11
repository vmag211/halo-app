import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../lib/auth.js', import.meta.url), 'utf8'))
  .replace("import { supabase } from './supabase';", '').replace(/^export /gm, '');
function setup(status = 401, { initial = { access_token: 'old', user: { id: 'original-household' } }, sessionError = null } = {}) {
  let session = initial;
  const calls = { signIn: 0, signOut: 0, requests: [] };
  const response = new Response(JSON.stringify({ error: 'Session rejected', draft: 'unchanged' }), { status });
  const context = vm.createContext({
    window: {}, process: { env: {} }, DOMException, Request, setTimeout, clearTimeout,
    console: { warn() {} },
    supabase: { auth: {
      async getSession() { return { data: { session }, error: sessionError }; },
      async signOut() { calls.signOut++; session = null; },
      async signInAnonymously() {
        calls.signIn++;
        session = { access_token: 'new', user: { id: 'replacement-household' } };
        return { data: { session }, error: null };
      },
    } },
    fetch: async (url, init) => { calls.requests.push({ url, init }); return response; },
  });
  vm.runInContext(`${source}\nglobalThis.api = { authedFetch, recoverSession, SESSION_REJECTED };`, context);
  return { api: context.api, calls, response };
}
for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post', 'OPTIONS']) {
  test(`${method} 401 returns the exact response without replacement or replay`, async () => {
    const { api, calls, response } = setup();
    const body = JSON.stringify({ note: 'Keep my draft' });
    const result = await api.authedFetch('/save', { method, body });
    assert.equal(result, response);
    assert.equal(result.bodyUsed, false);
    assert.equal((await result.json()).draft, 'unchanged');
    assert.equal(calls.requests.length, 1);
    assert.equal(calls.requests[0].init.body, body);
    assert.equal(calls.signOut, 0);
    assert.equal(calls.signIn, 0);
  });
}
for (const method of ['GET', 'HEAD', 'get']) {
  test(`${method} 401 permits just one read retry`, async () => {
    const { api, calls } = setup();
    assert.equal((await api.authedFetch('/read', { method })).status, 401);
    assert.equal(calls.requests.length, 2);
    assert.equal(calls.signOut, 1);
    assert.equal(calls.signIn, 1);
  });
}
for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
  test(`${method} 503 preserves identity without a retry`, async () => {
    const { api, calls, response } = setup(503);
    assert.equal(await api.authedFetch('/data', { method }), response);
    assert.equal(calls.requests.length, 1);
    assert.equal(calls.signOut, 0);
    assert.equal(calls.signIn, 0);
  });
}
test('explicit recovery replaces the session once and never replays the draft', async () => {
  const { api, calls } = setup();
  assert.equal(api.SESSION_REJECTED, 'session_rejected');
  await api.authedFetch('/save', { method: 'POST', body: '{"note":"draft"}' });
  assert.equal(calls.signIn, 0);
  const recovered = await Promise.all([api.recoverSession(), api.recoverSession()]);
  assert.ok(recovered.every((session) => session.user.id === 'replacement-household'));
  assert.equal(calls.signOut, 1);
  assert.equal(calls.signIn, 1);
  assert.equal(calls.requests.length, 1);
});

test('explicit recovery with no stored session creates only one new identity', async () => {
  const { api, calls } = setup(401, { initial: null });
  assert.equal((await api.recoverSession()).user.id, 'replacement-household');
  assert.equal(calls.signIn, 1);
  assert.equal(calls.requests.length, 0);
});
test('a failed session read during explicit recovery never signs out or creates an identity', async () => {
  const { api, calls } = setup(401, { sessionError: new Error('temporary auth failure') });
  await assert.rejects(api.recoverSession(), (error) => error.code === 'signin_failed');
  assert.equal(calls.signOut, 0);
  assert.equal(calls.signIn, 0);
  assert.equal(calls.requests.length, 0);
});

// authedFetch(url) takes a Request as well as a string. The method then lives on the Request, not in init.
test('a Request-object POST 401 neither resets the session, signs in anonymously nor retries', async () => {
  const { api, calls, response } = setup();
  const body = JSON.stringify({ note: 'Keep my draft' });
  const result = await api.authedFetch(new Request('https://halo.test/save', { method: 'POST', body }));
  assert.equal(result, response);
  assert.equal(result.bodyUsed, false);
  assert.equal(calls.requests.length, 1);
  assert.equal(calls.signOut, 0);
  assert.equal(calls.signIn, 0);
});
test('a Request-object GET 401 keeps the single read retry', async () => {
  const { api, calls } = setup();
  assert.equal((await api.authedFetch(new Request('https://halo.test/read'))).status, 401);
  assert.equal(calls.requests.length, 2);
  assert.equal(calls.signOut, 1);
  assert.equal(calls.signIn, 1);
});
