import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Evaluate the real client module against an isolated Supabase double. Never
// import the configured client or load .env.local in these offline unit tests.
const source = (await readFile(new URL('../lib/auth.js', import.meta.url), 'utf8'))
  .replace("import { supabase } from './supabase';", '')
  .replace(/^export /gm, '');
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const session = (token, id = token) => ({ access_token: token, user: { id } });

function setup({ initial = session('old'), getSession, signIn, signOut, fetch: send, siteKey, document, browser = {}, timer = setTimeout } = {}) {
  let current = initial;
  const calls = { get: 0, signIn: 0, signOut: 0, requests: [] };
  const auth = {
    async getSession() {
      calls.get++;
      return getSession ? getSession(current, calls) : { data: { session: current }, error: null };
    },
    async signInAnonymously() {
      calls.signIn++;
      const result = signIn ? await signIn(calls) : { data: { session: session('new') }, error: null };
      if (result.data?.session) current = result.data.session;
      return result;
    },
    async signOut(options) {
      assert.equal(options.scope, 'local');
      calls.signOut++;
      if (signOut) await signOut(calls);
      current = null;
      return { error: null };
    },
  };
  const context = vm.createContext({
    supabase: { auth }, window: browser, document, process: { env: { NEXT_PUBLIC_TURNSTILE_SITE_KEY: siteKey } }, DOMException,
    setTimeout: timer, clearTimeout, console: { warn() {}, error() {} },
    fetch: async (url, init) => {
      calls.requests.push({ url, init });
      return send ? send(url, init, calls) : { status: 200 };
    },
  });
  vm.runInContext(`${source}\n globalThis.api = { ensureAnonSession, getAccessToken, authedFetch, resetSession };`, context);
  return { api: context.api, calls, setSession: (value) => { current = value; } };
}

test('successful session promises are not cached across token refreshes', async () => {
  const testCase = setup();
  assert.equal(await testCase.api.getAccessToken(), 'old');
  testCase.setSession(session('refreshed', 'old'));
  assert.equal(await testCase.api.getAccessToken(), 'refreshed');
  assert.equal(testCase.calls.signIn, 0);
  assert.equal(testCase.calls.get, 2);
});

test('concurrent session bootstrap creates exactly one anonymous user', async () => {
  const gate = deferred();
  const { api, calls } = setup({ initial: null, signIn: async () => {
    await gate.promise;
    return { data: { session: session('new') }, error: null };
  } });
  const pending = [api.ensureAnonSession(), api.ensureAnonSession(), api.getAccessToken()];
  gate.resolve();
  const result = await Promise.all(pending);
  assert.equal(result[0].access_token, 'new');
  assert.equal(result[2], 'new');
  assert.equal(calls.signIn, 1);
  assert.equal(calls.get, 1);
});

test('a failed session read never signs out or mints an unrelated household', async () => {
  const { api, calls } = setup({ getSession: async () => ({ data: { session: null }, error: new Error('network') }) });
  await assert.rejects(api.ensureAnonSession(), (error) => error.code === 'signin_failed');
  assert.equal(calls.signIn, 0);
  assert.equal(calls.signOut, 0);
});

test('failed anonymous sign-in can be retried', async () => {
  const { api, calls } = setup({ initial: null, signIn: async (counts) => counts.signIn === 1
    ? { data: {}, error: new Error('temporary') }
    : { data: { session: session('new') }, error: null } });
  await assert.rejects(api.ensureAnonSession(), (error) => error.code === 'signin_failed');
  assert.equal((await api.ensureAnonSession()).access_token, 'new');
  assert.equal(calls.signIn, 2);
});

test('sign-in without a session reports a recoverable sign-in failure', async () => {
  const { api } = setup({ initial: null, signIn: async () => ({ data: { session: null }, error: null }) });
  await assert.rejects(api.ensureAnonSession(), (error) => error.code === 'signin_failed');
});

test('failed CAPTCHA scripts are removed so a retry loads a new script', async () => {
  let script = null;
  let loads = 0;
  const browser = {};
  const document = {
    querySelector() { return script; },
    createElement(tag) {
      const handlers = new Map();
      return { style: {}, addEventListener: (name, callback) => handlers.set(name, callback),
        removeEventListener: (name) => handlers.delete(name),
        dispatch: (name) => handlers.get(name)?.(),
        remove() { if (tag === 'script') script = null; } };
    },
    head: { appendChild(element) {
      script = element;
      loads++;
      queueMicrotask(() => {
        if (loads === 1) element.dispatch('error');
        else {
          browser.turnstile = { render: (_container, options) => { options.callback('captcha-token'); return 'widget'; }, remove() {} };
          element.dispatch('load');
        }
      });
    } },
    body: { appendChild() {} },
  };
  const { api, calls } = setup({ initial: null, siteKey: 'test-site-key', document, browser });
  await assert.rejects(api.ensureAnonSession(), (error) => error.code === 'captcha_failed');
  assert.equal(script, null);
  assert.equal((await api.ensureAnonSession()).access_token, 'new');
  assert.equal(loads, 2);
  assert.equal(calls.signIn, 1);
});

test('a CAPTCHA script that never loads times out instead of poisoning later retries', async () => {
  let removed = false;
  const document = {
    querySelector: () => null,
    createElement: () => ({ addEventListener() {}, removeEventListener() {}, remove() { removed = true; } }),
    head: { appendChild() {} },
  };
  const { api, calls } = setup({ initial: null, siteKey: 'test-site-key', document, timer: (callback) => setTimeout(callback, 5) });
  await assert.rejects(api.ensureAnonSession(), (error) => error.code === 'captcha_failed');
  assert.equal(removed, true);
  assert.equal(calls.signIn, 0);
});

test('concurrent 401 responses share one reset and one replacement session', async () => {
  const { api, calls } = setup({ fetch: async (_url, init) => ({ status: init.headers.Authorization === 'Bearer old' ? 401 : 200 }) });
  const responses = await Promise.all([api.authedFetch('/one'), api.authedFetch('/two'), api.authedFetch('/three')]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200, 200]);
  assert.equal(calls.signOut, 1);
  assert.equal(calls.signIn, 1);
  assert.equal(calls.requests.length, 6);
});

test('late 401 from an older request does not reset the replacement session', async () => {
  const late = deferred();
  const lateStarted = deferred();
  const { api, calls } = setup({ fetch: async (url, init) => {
    if (url === '/late' && init.headers.Authorization === 'Bearer old') {
      lateStarted.resolve();
      await late.promise;
    }
    return { status: init.headers.Authorization === 'Bearer old' ? 401 : 200 };
  } });
  const pendingLate = api.authedFetch('/late');
  await lateStarted.promise;
  assert.equal((await api.authedFetch('/first')).status, 200);
  late.resolve();
  assert.equal((await pendingLate).status, 200);
  assert.equal(calls.signOut, 1);
  assert.equal(calls.signIn, 1);
});

test('an already-refreshed token is retried without changing household identity', async () => {
  const testCase = setup({ fetch: async (_url, init) => {
    if (init.headers.Authorization === 'Bearer old') {
      testCase.setSession(session('refreshed', 'old'));
      return { status: 401 };
    }
    return { status: 200 };
  } });
  assert.equal((await testCase.api.authedFetch('/data')).status, 200);
  assert.equal(testCase.calls.signOut, 0);
  assert.equal(testCase.calls.signIn, 0);
  assert.equal(testCase.calls.requests[1].init.headers.Authorization, 'Bearer refreshed');
});

test('a concurrent bootstrap waits for the whole recovery transaction', async () => {
  const clearing = deferred();
  const release = deferred();
  const { api, calls } = setup({
    signOut: async () => { clearing.resolve(); await release.promise; },
    fetch: async (_url, init) => ({ status: init.headers.Authorization === 'Bearer old' ? 401 : 200 }),
  });
  const request = api.authedFetch('/data');
  await clearing.promise;
  const bootstrap = api.ensureAnonSession();
  release.resolve();
  assert.equal((await bootstrap).access_token, 'new');
  assert.equal((await request).status, 200);
  assert.equal(calls.signIn, 1);
});

test('503 preserves the session and is not automatically retried', async () => {
  const { api, calls } = setup({ fetch: async () => ({ status: 503 }) });
  assert.equal((await api.authedFetch('/data')).status, 503);
  assert.equal(calls.signOut, 0);
  assert.equal(calls.signIn, 0);
  assert.equal(calls.requests.length, 1);
});

test('401 after the one permitted retry does not create an infinite reset loop', async () => {
  const { api, calls } = setup({ fetch: async () => ({ status: 401 }) });
  assert.equal((await api.authedFetch('/data')).status, 401);
  assert.equal(calls.signOut, 1);
  assert.equal(calls.signIn, 1);
  assert.equal(calls.requests.length, 2);
});

test('cancelled requests do not trigger session creation or identity recovery', async () => {
  const before = new AbortController();
  before.abort();
  const untouched = setup({ initial: null });
  await assert.rejects(untouched.api.authedFetch('/data', { signal: before.signal }), (error) => error.name === 'AbortError');
  assert.equal(untouched.calls.get, 0);
  assert.equal(untouched.calls.signIn, 0);

  const during = new AbortController();
  const rejected = setup({ fetch: async () => { during.abort(); return { status: 401 }; } });
  await assert.rejects(rejected.api.authedFetch('/data', { signal: during.signal }), (error) => error.name === 'AbortError');
  assert.equal(rejected.calls.signOut, 0);
  assert.equal(rejected.calls.signIn, 0);
});
