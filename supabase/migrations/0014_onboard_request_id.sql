-- HALO — address-write request id (onboarding integration)
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- profiles.onboard_request_id: the client-generated id of the /api/onboard
-- request that last stored this household's location. /api/profile returns it,
-- so after an address request times out the app can tell whether THAT request
-- was saved (proceed) or not (ask to retry). Without it, a timed-out Change
-- address could never be recovered: the old coordinates and a late write look
-- the same. The routes degrade without it (no recovery by id) until applied.

alter table public.profiles
  add column if not exists onboard_request_id uuid;
