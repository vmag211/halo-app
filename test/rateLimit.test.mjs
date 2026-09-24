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
