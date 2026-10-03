/**
 * Stand-in for lib/ratelimit.js, which calls `Redis.fromEnv()` at import. Every
 * limiter allows every request; `checkLimit` therefore allows too, unless the
 * harness was given a `rateLimit(key)` function that returns false for that key
 * (so a test can reach a route's 429 path). The export names are kept in step
 * with the real file by a drift test in test/routeHarness.test.mjs.
 */
import { currentHarness } from './context.mjs';

function allowAll() {
  return {
    limit: async () => ({ success: true, limit: Number.MAX_SAFE_INTEGER, remaining: Number.MAX_SAFE_INTEGER, reset: 0 }),
    resetUsedTokens: async () => {},
  };
}

export const mapboxLimiter = allowAll();
export const openuvLimiter = allowAll();
export const onboardLimiter = allowAll();
export const assistantLimiter = allowAll();
export const assistantGlobalLimiter = allowAll();
export const dailyScoreLimiter = allowAll();
export const pushLimiter = allowAll();

export async function checkLimit(_limiter, key) {
  const decide = currentHarness().rateLimit;
  return decide ? decide(key) !== false : true;
}
