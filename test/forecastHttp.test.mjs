/**
 * lib/forecast/http.js, the forecast providers' only door (B10 plan F8, Task 3).
 * No network: every fetch here is a stub, and the one test that uses the global
 * fetch runs inside the route sandbox with its own stub.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getJson, DEFAULT_MAX_BYTES, MAX_TIMEOUT_MS } from '../lib/forecast/http.js';
import { withSandbox } from './helpers/sandbox.mjs';

const SECRET = 'SECRET-KEY-123';
const URL_WITH_KEY = `https://www.airnowapi.org/aq/forecast/latLong/?format=application/json&latitude=35.23&longitude=-80.84&API_KEY=${SECRET}`;

/** Every reason must be a fixed token: no URL, no key, no query string. */
function assertNothingEchoed(result) {
  const text = JSON.stringify(result);
  assert.ok(!text.includes(SECRET), `the key leaked: ${text}`);
  assert.ok(!text.includes('airnowapi'), `the host leaked: ${text}`);
  assert.ok(!text.includes('?') && !text.includes('latitude'), `the query leaked: ${text}`);
}

/** Records console.error and console.warn for the duration of `work`. */
async function quietLog(work) {
  const lines = [];
  const saved = { error: console.error, warn: console.warn };
  console.error = (...args) => lines.push(args.join(' '));
  console.warn = (...args) => lines.push(args.join(' '));
  try {
    return { value: await work(), lines };
  } finally {
    Object.assign(console, saved);
  }
}

test('a 2xx JSON body is ok with its status, and the request carries the signal, GET and the headers', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    return new Response('{"a":1}', { status: 203 });
  };
  const r = await getJson('https://api.weather.gov/alerts/active?point=35.23,-80.84', {
    fetchImpl,
    timeoutMs: 1000,
    headers: { 'User-Agent': 'HALO/1.0', accept: 'application/geo+json' },
  });
  assert.deepEqual(r, { ok: true, json: { a: 1 }, status: 203 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://api.weather.gov/alerts/active?point=35.23,-80.84');
  assert.equal(seen[0].init.method, 'GET');
  assert.ok(seen[0].init.signal instanceof AbortSignal, 'every call is given an abort signal');
  assert.equal(seen[0].init.signal.aborted, false);
  assert.deepEqual(seen[0].init.headers, { 'user-agent': 'HALO/1.0', accept: 'application/geo+json' }, 'the caller may override accept');
});

test('a capitalised Accept replaces the default instead of joining it, and a Headers object works too', async () => {
  const sent = [];
  const fetchImpl = async (_u, init) => (sent.push(init.headers), new Response('{}'));
  await getJson('https://api.weather.gov/alerts/active?point=35.23,-80.84', {
    fetchImpl,
    timeoutMs: 1000,
    headers: { 'User-Agent': '(HALO, contact)', Accept: 'application/geo+json' },
  });
  await getJson('https://x.example.test/', { fetchImpl, timeoutMs: 1000, headers: new Headers({ ACCEPT: 'text/plain' }) });
  assert.deepEqual(sent, [
    { accept: 'application/geo+json', 'user-agent': '(HALO, contact)' },
    { accept: 'text/plain' },
  ]);
});

test('headers fetch would refuse make no request', async () => {
  let called = 0;
  const fetchImpl = async () => ((called += 1), new Response('{}'));
  for (const headers of [{ 'bad name': 'x' }, { 'X-Ok': 'line\nbreak' }]) {
    assert.deepEqual(await getJson(URL_WITH_KEY, { fetchImpl, timeoutMs: 1000, headers }), { ok: false, reason: 'bad_headers' }, JSON.stringify(headers));
  }
  assert.equal(called, 0);
});

test('accept defaults to application/json', async () => {
  let headers;
  await getJson('https://x.example.test/', { fetchImpl: async (_u, init) => ((headers = init.headers), new Response('1')), timeoutMs: 1000 });
  assert.equal(headers.accept, 'application/json');
});

test('a body of JSON null is still ok: judging the shape is the adapter\'s job', async () => {
  assert.deepEqual(await getJson('https://x.example.test/', { fetchImpl: async () => new Response('null'), timeoutMs: 1000 }), { ok: true, json: null, status: 200 });
});

test('no timeout means no request: a provider call without a timeout cannot exist', async () => {
  for (const timeoutMs of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, '6000', null]) {
    let called = 0;
    const r = await getJson(URL_WITH_KEY, { fetchImpl: async () => ((called += 1), new Response('{}')), timeoutMs: /** @type {any} */ (timeoutMs) });
    assert.deepEqual(r, { ok: false, reason: 'no_timeout' }, String(timeoutMs));
    assert.equal(called, 0, `no fetch for timeoutMs ${String(timeoutMs)}`);
  }
  assert.deepEqual(await getJson(URL_WITH_KEY), { ok: false, reason: 'no_timeout' });
});

test('a timeout too large for Node\'s timers is refused, never thrown and never fired early', async () => {
  assert.equal(MAX_TIMEOUT_MS, 2 ** 31 - 1);
  let called = 0;
  const fetchImpl = async () => ((called += 1), new Response('{"a":1}'));
  // 2^31 would overflow to a 1 ms timer; 2^32 makes AbortSignal.timeout throw a RangeError.
  for (const timeoutMs of [2 ** 31, 2 ** 32, 2 ** 32 + 1, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE]) {
    assert.deepEqual(await getJson(URL_WITH_KEY, { fetchImpl, timeoutMs }), { ok: false, reason: 'no_timeout' }, String(timeoutMs));
  }
  assert.equal(called, 0);
  assert.deepEqual(await getJson(URL_WITH_KEY, { fetchImpl, timeoutMs: MAX_TIMEOUT_MS }), { ok: true, json: { a: 1 }, status: 200 }, 'the largest safe timeout is accepted');
});

test('a stub that never resolves, and ignores the signal, is abandoned at the timeout', async () => {
  const started = Date.now();
  const r = await getJson(URL_WITH_KEY, { fetchImpl: () => new Promise(() => {}), timeoutMs: 60 });
  const took = Date.now() - started;
  assert.deepEqual(r, { ok: false, reason: 'timeout' });
  assert.ok(took >= 50 && took < 2000, `aborted near the timeout, took ${took} ms`);
  assertNothingEchoed(r);
});

test('a fetch that honours the signal and rejects with an AbortError is a timeout', async () => {
  let signal;
  const fetchImpl = (_url, init) =>
    new Promise((_, reject) => {
      signal = init.signal;
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    });
  const r = await getJson(URL_WITH_KEY, { fetchImpl, timeoutMs: 40 });
  assert.deepEqual(r, { ok: false, reason: 'timeout' });
  assert.equal(signal.aborted, true, 'the signal handed to fetch is the one that fired');
});

test('the timeout bounds the body as well as the headers', async () => {
  const fetchImpl = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"partial":'));
          // and then nothing, ever
        },
      }),
      { status: 200 },
    );
  const r = await getJson(URL_WITH_KEY, { fetchImpl, timeoutMs: 60 });
  assert.deepEqual(r, { ok: false, reason: 'timeout' });
});

test('a non-2xx status gives http_<status>, and the body is not parsed', async () => {
  for (const status of [500, 503, 401, 404, 429, 302]) {
    const r = await getJson(URL_WITH_KEY, { fetchImpl: async () => new Response('{"ok":true}', { status }), timeoutMs: 1000 });
    assert.deepEqual(r, { ok: false, reason: `http_${status}` });
    assertNothingEchoed(r);
  }
});

test('a body that is not JSON is invalid', async () => {
  for (const body of ['<html>Service Unavailable</html>', '', '{"cut":', 'undefined']) {
    const r = await getJson(URL_WITH_KEY, { fetchImpl: async () => new Response(body), timeoutMs: 1000 });
    assert.deepEqual(r, { ok: false, reason: 'invalid' }, JSON.stringify(body));
  }
});

test('a body over maxBytes is too_large, whether declared or streamed; exactly maxBytes is fine', async () => {
  const declared = await getJson(URL_WITH_KEY, {
    fetchImpl: async () => new Response('{}', { headers: { 'content-length': String(DEFAULT_MAX_BYTES + 1) } }),
    timeoutMs: 1000,
  });
  assert.deepEqual(declared, { ok: false, reason: 'too_large' }, 'a declared length over the default 2 MB cap is refused unread');

  const big = JSON.stringify({ pad: 'x'.repeat(200) });
  let pulled = 0;
  const streamed = await getJson(URL_WITH_KEY, {
    fetchImpl: async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            pulled += 1;
            if (pulled > 1000) controller.close();
            else controller.enqueue(new TextEncoder().encode(big));
          },
        }),
      ),
    timeoutMs: 1000,
    maxBytes: 1000,
  });
  assert.deepEqual(streamed, { ok: false, reason: 'too_large' });
  assert.ok(pulled < 10, `reading stopped once past the cap (pulled ${pulled} chunks)`);

  const exact = '{"a":"' + 'y'.repeat(92) + '"}';
  assert.equal(Buffer.byteLength(exact), 100);
  assert.deepEqual(await getJson(URL_WITH_KEY, { fetchImpl: async () => new Response(exact), timeoutMs: 1000, maxBytes: 100 }), {
    ok: true,
    json: { a: 'y'.repeat(92) },
    status: 200,
  });
  assert.deepEqual(await getJson(URL_WITH_KEY, { fetchImpl: async () => new Response(exact), timeoutMs: 1000, maxBytes: 99 }), { ok: false, reason: 'too_large' });
});

test('multi-byte text is counted in bytes, not characters', async () => {
  const body = JSON.stringify({ t: '°'.repeat(40) }); // 40 characters, 80 bytes inside
  assert.ok(body.length < 60 && Buffer.byteLength(body) > 60);
  assert.deepEqual(await getJson(URL_WITH_KEY, { fetchImpl: async () => new Response(body), timeoutMs: 1000, maxBytes: 60 }), { ok: false, reason: 'too_large' });
  assert.deepEqual((await getJson(URL_WITH_KEY, { fetchImpl: async () => new Response(body), timeoutMs: 1000 })).json, { t: '°'.repeat(40) });
});

test('a rejected fetch is network, and its error text (which quotes the URL) is dropped', async () => {
  const fetchImpl = async (url) => {
    throw new TypeError(`fetch failed for ${url}`);
  };
  const r = await getJson(URL_WITH_KEY, { fetchImpl, timeoutMs: 1000 });
  assert.deepEqual(r, { ok: false, reason: 'network' });
  assertNothingEchoed(r);
});

test('a fetch that returns something that is not a response is network', async () => {
  assert.deepEqual(await getJson(URL_WITH_KEY, { fetchImpl: async () => /** @type {any} */ (undefined), timeoutMs: 1000 }), { ok: false, reason: 'network' });
});

test('no outcome echoes the URL, the key or the query string, and nothing is logged', async () => {
  const cases = [
    () => new Promise(() => {}),
    async () => new Response('x', { status: 500 }),
    async () => new Response('not json'),
    async () => new Response('{}', { headers: { 'content-length': '999999999' } }),
    async (url) => {
      throw new Error(`boom ${url}`);
    },
  ];
  const { value: results, lines } = await quietLog(() => Promise.all(cases.map((fetchImpl) => getJson(URL_WITH_KEY, { fetchImpl, timeoutMs: 50 }))));
  assert.deepEqual(
    results.map((r) => r.reason),
    ['timeout', 'http_500', 'invalid', 'too_large', 'network'],
  );
  for (const r of results) assertNothingEchoed(r);
  assert.deepEqual(lines, [], 'the helper itself logs nothing');
});

test('getJson never throws, even when fetchImpl throws synchronously', async () => {
  const r = await getJson(URL_WITH_KEY, {
    fetchImpl: () => {
      throw new Error('sync');
    },
    timeoutMs: 1000,
  });
  assert.deepEqual(r, { ok: false, reason: 'network' });
});

test('without fetchImpl it uses the global fetch, which in a route test is the sandbox\'s stub', async () => {
  const hosts = [];
  const r = await withSandbox(
    {
      fetch: async (url) => {
        hosts.push(new URL(url).host);
        return new Response('{"features":[]}');
      },
    },
    () => getJson('https://api.weather.gov/alerts/active?point=35.23,-80.84', { timeoutMs: 1000 }),
  );
  assert.deepEqual(r, { ok: true, json: { features: [] }, status: 200 });
  assert.deepEqual(hosts, ['api.weather.gov']);
});
