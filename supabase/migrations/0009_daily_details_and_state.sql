-- HALO — daily reading details + profile state (punch list v3 items 5, 9)
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- daily_scores.details: the extra fields /api/daily-score now returns
-- (dominant pollutant, UV peak window, mold basis, UV source) so a cached
-- response carries them too. The route degrades without it (the fields read as
-- null on a cache hit) until this is applied.
--
-- profiles.state: two-letter state from the geocoder, so radon — whose zone map
-- here covers North Carolina only — is looked up only for NC addresses. Before,
-- a county name shared with another state (Union County, SC) silently got NC's
-- zone.

alter table public.daily_scores
  add column if not exists details jsonb;

alter table public.profiles
  add column if not exists state text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_state_check') then
    alter table public.profiles
      add constraint profiles_state_check check (state is null or state ~ '^[A-Z]{2}$');
  end if;
end $$;
