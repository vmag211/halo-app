/**
 * Stand-in for lib/ratelimit.js, which calls `Redis.fromEnv()` at import. Every
 * limiter allows every request; `checkLimit` therefore always allows. The export
 * names are kept in step with the real file by a drift test in
 * test/routeHarness.test.mjs.
 */

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

export async function checkLimit() {
  return true;
}
