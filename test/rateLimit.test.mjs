import { test } from 'node:test';
import assert from 'node:assert/strict';

// lib/rateLimit.js calls Redis.fromEnv() at module load, which throws without
// these. Provide dummies (only if absent) so the import succeeds; no network is
// touched — construction is lazy and the tests use a FAKE limiter, not the real
// Upstash ones, so checkLimit's fail-open/closed logic is exercised in isolation.
process.env.UPSTASH_REDIS_REST_URL ||= 'https://example.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN ||= 'test-token';

const { checkLimit } = await import('../lib/ratelimit.js');

const ok = { limit: async () => ({ success: true }) };
const blocked = { limit: async () => ({ success: false }) };
const broken = {
  limit: async () => {
    throw new Error('Upstash unreachable');
  },
};

test('passes through the limiter verdict when Redis answers', async () => {
  assert.equal(await checkLimit(ok, 'k'), true);
  assert.equal(await checkLimit(blocked, 'k'), false);
});

test('fails OPEN on a limiter outage when fallback:true (critical path)', async () => {
  assert.equal(await checkLimit(broken, 'k', { fallback: true }), true);
});

test('fails CLOSED on a limiter outage when fallback:false (optional paid call)', async () => {
  assert.equal(await checkLimit(broken, 'k', { fallback: false }), false);
});

test('default fallback is closed', async () => {
  assert.equal(await checkLimit(broken, 'k'), false);
});

test('a real Upstash error, which quotes the command, never puts the limiter key in the log', async () => {
  // A real Ratelimit on a real @upstash/redis client, its HTTP answered by a
  // stub (no network). Upstash builds the error as
  // `${body.error}, command was: ${JSON.stringify(command)}`, and the command
  // carries the key, which holds a user or profile id.
  const { Ratelimit } = await import('@upstash/ratelimit');
  const { Redis } = await import('@upstash/redis');
  const { withSandbox } = await import('./helpers/sandbox.mjs');
  const PROFILE = 'profile-marker-9c41';
  const sent = [];
  const fetch = async (_url, init) => {
    sent.push(init.body);
    return new Response('{"error":"ERR max daily request limit exceeded"}', { status: 400 });
  };
  const lines = [];
  const saved = console.error;
  console.error = (...args) => lines.push(args.join(' '));
  let verdicts;
  try {
    verdicts = await withSandbox({ fetch }, async () => {
      const limiter = new Ratelimit({
        redis: new Redis({ url: 'https://fake-upstash.example.test', token: 'test-token', retry: false, enableTelemetry: false }),
        limiter: Ratelimit.slidingWindow(30, '1 h'),
        analytics: false,
      });
      return [
        await checkLimit(limiter, `forecast:${PROFILE}`, { fallback: true, label: 'Forecast household budget' }),
        await checkLimit(limiter, `assistant:${PROFILE}`, { fallback: false, label: 'assistant limiter' }),
      ];
    });
  } finally {
    console.error = saved;
  }
  assert.deepEqual(verdicts, [true, false], 'each call site keeps its own fallback');
  assert.ok(sent.some((body) => body.includes(PROFILE)), 'the key really was in the command Upstash quotes');
  assert.deepEqual(lines, [
    'Forecast household budget unavailable (UpstashError: ERR max daily request limit exceeded); allowing the call.',
    'assistant limiter unavailable (UpstashError: ERR max daily request limit exceeded); skipping the call.',
  ]);
  for (const line of lines) assert.ok(!line.includes(PROFILE) && !line.includes('command was'), line);
});

test('a limiter that timed out (Upstash answers success with reason timeout) gets the fallback, not an allow', async () => {
  const slow = { limit: async () => ({ success: true, reason: 'timeout' }) };
  const saved = console.error;
  console.error = () => {};
  try {
    assert.equal(await checkLimit(slow, 'k', { fallback: false }), false);
    assert.equal(await checkLimit(slow, 'k', { fallback: true }), true);
  } finally {
    console.error = saved;
  }
});
