-- HALO — household composition + profile additions
-- Run this once in the Supabase SQL editor (DDL cannot go through PostgREST).
-- Safe to re-run.
--
-- Adds:
--   1. profiles.renter_mode and profiles.locale (§9.1, §16).
--   2. household_bands: the seven yes/no group facts from §8, one row per household,
--      owned and editable by the household.

-- ---------------------------------------------------------------------------
-- 1. Profile additions
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists renter_mode boolean not null default false,
  add column if not exists locale text not null default 'en';

-- Guard the locale to the two supported languages.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_locale_check'
  ) then
    alter table public.profiles
      add constraint profiles_locale_check check (locale in ('en', 'es'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. household_bands — one row per household, seven presence booleans
-- ---------------------------------------------------------------------------
-- Deliberately NO ages, birthdates, or names — only category presence (§8.3).
create table if not exists public.household_bands (
  profile_id      uuid primary key references public.profiles (id) on delete cascade,
  has_toddler     boolean not null default false,
  has_child       boolean not null default false,
  has_teen        boolean not null default false,
  has_adult       boolean not null default false,
  has_senior      boolean not null default false,
  has_pregnant    boolean not null default false,
  has_respiratory boolean not null default false,
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. Row Level Security — owner may read and write their own row only
-- ---------------------------------------------------------------------------
alter table public.household_bands enable row level security;

drop policy if exists "household_bands_select_own" on public.household_bands;
create policy "household_bands_select_own" on public.household_bands
  for select using (auth.uid() = profile_id);

drop policy if exists "household_bands_insert_own" on public.household_bands;
create policy "household_bands_insert_own" on public.household_bands
  for insert with check (auth.uid() = profile_id);

drop policy if exists "household_bands_update_own" on public.household_bands;
create policy "household_bands_update_own" on public.household_bands
  for update using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

drop policy if exists "household_bands_delete_own" on public.household_bands;
create policy "household_bands_delete_own" on public.household_bands
  for delete using (auth.uid() = profile_id);
