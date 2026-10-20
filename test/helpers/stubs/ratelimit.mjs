/**
 * Stand-in for lib/ratelimit.js, which calls `Redis.fromEnv()` at import. Every
 * limiter allows every request; `checkLimit` therefore allows too, unless the
 * harness was given a `rateLimit(key)` function that returns false for that key
 * (so a test can reach a route's 429 path). The export names are kept in step
 * with the real file by a drift test in test/routeHarness.test.mjs.
 *
 * A LIMITER OUTAGE IS ITS OWN SIGNAL: a `rateLimit(key)` that returns
 * `LIMITER_UNAVAILABLE` stands in for Upstash being unreachable, and this
 * follows the real `checkLimit` through it, logging in the same words and
 * returning the CALL SITE'S OWN `fallback`. Without it the stub discarded
 * `opts` entirely, so no route's fail-open or fail-closed choice could be
 * proved by a test. That matters most for the two public recovery routes,
 * which deliberately choose OPPOSITE fallbacks: `/request` fails closed
 * because it can cause mail to be sent, `/status` fails open because it writes
 * nothing and must stay answerable.
 *
 * A `rateLimit` that THROWS is deliberately NOT treated as an outage here, and
 * still propagates. Tests use a throwing decide as a convenient way to provoke
 * an unexpected failure deep inside a handler and prove its 500 envelope
 * (routesAssistantAccountWrite.test.mjs), so giving a throw the outage meaning
 * would quietly disarm those. The real `checkLimit` does catch a throw, so that
 * one case is stub behaviour rather than a faithful model; `LIMITER_UNAVAILABLE`
 * is the faithful path and is what an outage test should use.
 */
import { currentHarness, LIMITER_UNAVAILABLE } from './context.mjs';

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
export const recoveryRequestLimiter = allowAll();
export const recoveryAddressLimiter = allowAll();
export const lunaConversationLimiter = allowAll();
export const publicMapLimiter = allowAll();
export const privacyLimiter = allowAll();
export const forecastOpenMeteoDailyLimiter = allowAll();
export const forecastOpenMeteoMinuteLimiter = allowAll();
export const forecastAirNowLimiter = allowAll();
export const forecastNwsLimiter = allowAll();
export const forecastHouseholdLimiter = allowAll();
export const publicEvidenceLimiter = allowAll();
export const attachmentUploadLimiter = allowAll();

export async function checkLimit(_limiter, key, opts = {}) {
  const { fallback = false, label = 'rate limiter' } = opts;
  const decide = currentHarness().rateLimit;
  if (!decide) return true;
  const verdict = decide(key);
  if (verdict !== LIMITER_UNAVAILABLE) return verdict !== false;
  // The real checkLimit's SHAPE, not its exact words: production interpolates
  // the thrown error's message where this has a fixed phrase, because a
  // returned sentinel carries no message to interpolate. The parts a test
  // should assert on, the label and the allowing/skipping verdict, are the
  // real ones.
  console.error(
    `${label} unavailable (limiter unreachable); ${fallback ? 'allowing' : 'skipping'} the call.`,
  );
  return fallback;
}
