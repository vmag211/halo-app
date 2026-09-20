-- HALO — symptom journal entries (§9.2, §14)
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Owned entirely by the household. One entry per household per group per day;
-- re-logging the same day+group updates rather than duplicating (unique below).

create table if not exists public.symptom_logs (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid not null references public.profiles (id) on delete cascade,
  entry_date       date not null,
  band             text not null default 'household',   -- a household_bands key, or 'household'
  symptoms         text[] not null default '{}',
  severity         text check (severity in ('mild', 'moderate', 'bad')),
  note             text,
  retrospective    boolean not null default false,      -- recalled later vs logged that day
  possibly_illness boolean not null default false,      -- user flagged as probably cold/flu (§14.5)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (profile_id, entry_date, band)
);

create index if not exists symptom_logs_profile_date
  on public.symptom_logs (profile_id, entry_date);

alter table public.symptom_logs enable row level security;

drop policy if exists "symptom_logs_select_own" on public.symptom_logs;
create policy "symptom_logs_select_own" on public.symptom_logs
  for select using (auth.uid() = profile_id);

drop policy if exists "symptom_logs_insert_own" on public.symptom_logs;
create policy "symptom_logs_insert_own" on public.symptom_logs
  for insert with check (auth.uid() = profile_id);

drop policy if exists "symptom_logs_update_own" on public.symptom_logs;
create policy "symptom_logs_update_own" on public.symptom_logs
  for update using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

drop policy if exists "symptom_logs_delete_own" on public.symptom_logs;
create policy "symptom_logs_delete_own" on public.symptom_logs
  for delete using (auth.uid() = profile_id);
