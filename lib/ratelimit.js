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