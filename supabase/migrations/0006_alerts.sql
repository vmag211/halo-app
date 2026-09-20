-- HALO — generated alerts / notification history (§9.2, §19)
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Readable by its owner; written ONLY by the scheduled process (service role),
-- so a client cannot fabricate an alert. Marking an alert read also goes through
-- a service-role route (/api/alerts), so there is deliberately no user write policy.

create table if not exists public.alerts (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  type       text not null,   -- air_quality | weather_advisory | new_water_results | radon_season | season_summary
  severity   text,            -- canonical severity word, where applicable
  title      text not null,
  message    text not null,
  fired_at   timestamptz not null default now(),
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists alerts_profile_fired
  on public.alerts (profile_id, fired_at desc);

-- Prevents the scheduled job from firing the same recurring alert twice in a day
-- (e.g. one radon-season prompt per household per day). Nullable dedupe key.
alter table public.alerts
  add column if not exists dedupe_key text;
create unique index if not exists alerts_dedupe
  on public.alerts (profile_id, dedupe_key)
  where dedupe_key is not null;

alter table public.alerts enable row level security;

drop policy if exists "alerts_select_own" on public.alerts;
create policy "alerts_select_own" on public.alerts
  for select using (auth.uid() = profile_id);
-- No user insert/update/delete: the scheduled process and /api/alerts use the
-- service role, which bypasses RLS.
