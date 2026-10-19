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

// 5. Per-user assistant bouncer (§37.2): 20 questions per user per hour.
//    The assistant is the one endpoint that calls a paid model per request, so it
//    is bounded per household to cap spend and blunt abuse. An hourly window
//    catches bursts while still leaving a curious user plenty over a day.
export const assistantLimiter = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(20, '1 h'),
  analytics: true,
});

// 6. App-wide assistant ceiling (default 450 questions per day across everyone;
//    ASSISTANT_GLOBAL_DAILY_LIMIT overrides). Sized to OpenRouter's free tier
//    (~1,000 requests/day, two per question) so the quota running out shows the
//    calm limit message instead of errors.
//    The per-user bouncer alone has no upper bound, because anonymous sign-in
//    makes fresh user ids cheap. This caps total model spend; it is checked
//    fail-CLOSED, so an Upstash outage pauses the assistant rather than leaving
//    spend unbounded.
export const assistantGlobalLimiter = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(Number(process.env.ASSISTANT_GLOBAL_DAILY_LIMIT || 450), '24 h'),
  analytics: true,
});

// 7. Per-household daily-score provider fetch: once per 5 minutes (item 9).
//    Cache hits are free; this only guards requests that would call AirNow,
//    Google Pollen and NWS — pull-to-refresh (?fresh=1) and cache misses — so
//    repeated pulls can't hammer those providers. Checked fail-open.
export const dailyScoreLimiter = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(1, '5 m'),
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

// 8. Per-household push-subscription changes: 20 per hour (item 21).
export const pushLimiter = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(20, '1 h'),
  analytics: true,
});

// 9. The two bounds on POST /api/recovery/request (B02 task 5, Ruling 18).
//    That route is unauthenticated and asks the provider to send a message to
//    an address a stranger typed, so two different things have to be bounded:
//
//      the ADDRESS asked about, so one inbox cannot be used as a weapon and so
//      a stream of requests cannot become a mail relay. 3 per hour.
//      Deliberately NOT a count of rows: a count read before the write is a
//      precondition that a concurrent burst all passes at once, and counting
//      challenge rows would also under-count, because the link intent deletes
//      them when a person cancels or an address is confirmed (Ruling 14).
//      A sliding window is one atomic decision per request in Redis, so a
//      burst spends tokens instead of racing, and no row anyone deletes can
//      refill it.
//
//      the CLIENT asking, to shed a flood before anything is read. 10 per
//      hour. There is no session to key this to and no durable record of a
//      client, so it rests on the forwarded client address, which is only as
//      trustworthy as the deployment in front of it (see the route).
//
//    Both keys are digests, never an address or an email. Both are checked
//    fail-CLOSED, which is the deliberate trade: during an Upstash outage
//    recovery pauses rather than becoming an open mail relay. That is the right
//    direction here and the opposite of the choice made for the critical-path
//    limiters above.
export const recoveryRequestLimiter = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(10, '1 h'),
  analytics: true,
});

export const recoveryAddressLimiter = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(3, '1 h'),
  analytics: true,
});

// 10. Per-conversation daily ceiling for Luna (B03 Ruling L15): 60 questions
//     per conversation per 24 hours.
//
//     Why a THIRD budget, when there is already one per household and one for
//     the whole app. The per-household window is hourly (20), so one household
//     can legitimately spend 480 questions in a day, which is more than the
//     app-wide ceiling holds. A Luna conversation also costs more per answer
//     than a single assistant question did, because it re-sends its bounded
//     history every turn, so the ceiling buys fewer conversations than it
//     bought questions. Without this, one enthusiastic thread in a demo can
//     take a visible share of the day's budget for everybody else.
//
//     The arithmetic: 60 is well under the app-wide default of 450, so at
//     least seven threads can each run to their own cap on the same day, and
//     no single thread can drain it. It is also far longer than any real
//     conversation, since the history bound keeps only 8 turns (four
//     exchanges), which is what a "what about X" follow-up actually needs. A
//     daily window rather than an hourly one on purpose: bursts are what the
//     per-household hourly bound is for, and this one is about the total
//     weight of one long-lived thread.
//
//     Checked fail-CLOSED, like the app-wide ceiling and for the same reason:
//     it is a bound on spend, and during an Upstash outage a paused Luna is
//     better than an unbounded one. 60 is a product number; see blocker 3 of
//     docs/backend/plans/b03-luna-conversational-mvp.md.
export const lunaConversationLimiter = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(60, '24 h'),
  analytics: true,
});

// 11. Per-household privacy reads (B07 Ruling P17): 30 per hour, counting
//     privacy inspect and privacy export, each of which reads the whole
//     household. Checked fail-OPEN, the opposite of the spend limiters above,
//     because an Upstash outage must never stop someone exporting or deleting
//     their own data. Clear is not limited here: it needs a fresh review
//     token, and only inspect mints one. 30 is a product number; see Open
//     question 9 of docs/backend/plans/b07-privacy.md.
export const privacyLimiter = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.slidingWindow(30, '1 h'),
  analytics: true,
});
