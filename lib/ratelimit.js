import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// 1. Connect to your Upstash Redis database using your environment variables
const redis = Redis.fromEnv();

// 2. Create the Mapbox bouncer (500 requests per 24 hours)
export const mapboxLimiter = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(500, '24 h'),
  analytics: true, // Optional: lets you see charts in your Upstash dashboard
});

// 3. Create the OpenUV bouncer (45 requests per 24 hours)
export const openuvLimiter = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(45, '24 h'),
  analytics: true,
});

// 4. Per-user onboarding bouncer (10 per user per 24 hours).
//    The Mapbox limiter above is a single *global* window, so without this one
//    abusive client can exhaust the day's budget for every real household.
//    Anonymous sign-in is unauthenticated user creation, so a fresh uid is cheap
//    to obtain -- this is the second layer behind CAPTCHA, not the only one.
export const onboardLimiter = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(10, '24 h'),
  analytics: true,
});

/**
 * Runs a limiter without letting a limiter outage take the endpoint down.
 *
 * Rate limiters here are budget guards, not the product. Upstash has vanished on
 * this project before, and an unwrapped `.limit()` call turns that into a 500
 * for the user.
 *
 * `fallback` is the deliberate choice per call site:
 *   - `true` (fail open) for anything on the critical path, where blocking the
 *     user is worse than briefly overspending an API budget.
 *   - `false` (fail closed) for optional paid calls, where skipping costs only a
 *     fallback reading.
 *
 * @param {Ratelimit} limiter
 * @param {string} key
 * @param {{ fallback?: boolean, label?: string }} [opts]
 * @returns {Promise<boolean>} whether the call is allowed to proceed
 */
export async function checkLimit(limiter, key, opts = {}) {
  const { fallback = false, label = 'rate limiter' } = opts;

  try {
    const { success } = await limiter.limit(key);
    return success;
  } catch (err) {
    console.error(
      `${label} unavailable (${err.message}); ${fallback ? 'allowing' : 'skipping'} the call.`,
    );
    return fallback;
  }
}
