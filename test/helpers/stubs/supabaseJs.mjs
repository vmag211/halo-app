/**
 * Stand-in for `@supabase/supabase-js`. A route that builds its own client at
 * import (home-guard does, with the anon key) gets the harness's fake instead of
 * a real client. The fake bypasses row-level security like the service role
 * does, so the anon client is NOT modelled faithfully here.
 */
import { fakeClient } from './context.mjs';

export function createClient() {
  return fakeClient;
}
