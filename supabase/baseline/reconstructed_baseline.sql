-- HALO reconstructed schema baseline
--
-- RECONSTRUCTED, NOT CAPTURED. This file was reconstructed from the numbered
-- migrations (supabase/migrations/0001 to 0014) and from the code that reads
-- and writes these tables. It was NOT captured from the deployed database and
-- is UNVERIFIED against it. docs/backend/baseline-audit.sql is the read-only
-- catalog query that can verify it, and docs/backend/baseline.md explains how
-- to run that query and diff its result against this file.
--
-- What it is for: the local PGlite test database (test/db/pgliteHarness.mjs)
-- loads this file first, so the migrations can then be applied in order exactly
-- as written. It stands in for what the HALO project already had before 0001:
-- the parts of a fresh Supabase project the migrations rely on, and the four
-- tables that were created by hand before the numbered migrations existed.
--
-- It is NOT a migration. Never run it against the HALO project: those objects
-- already exist there, and the auth stub below would collide with Supabase's.
--
-- Order, as a fresh Supabase project would have them:
--   1. API roles: anon, authenticated, service_role
--   2. schemas: auth, extensions, and usage on them
--   3. default privileges: every table, sequence and function created in
--      public is granted to all three roles, so row level security is the only
--      gate on table rows (as on Supabase)
--   4. auth stub: auth.users, auth.uid(), auth.role()
--   5. tables created before 0001: profiles, daily_scores, home_risks,
--      ucmr5_utilities

-- ---------------------------------------------------------------------------
-- 1. API roles
-- ---------------------------------------------------------------------------
-- On Supabase, PostgREST connects as `authenticator` and switches to one of
-- these per request. The test harness switches to them directly with
-- `set local role`, so `authenticator` is not reconstructed.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  -- The service role key: bypasses row level security by design.
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Schemas
-- ---------------------------------------------------------------------------
create schema if not exists auth;
create schema if not exists extensions;   -- 0007 installs pgvector here

grant usage on schema public     to anon, authenticated, service_role;
grant usage on schema auth       to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Default privileges (Supabase's): the API roles get every privilege on
--    what the migration owner creates in public. Table access is therefore
--    decided by row level security alone, and a function is callable by
--    anon and authenticated unless a migration revokes it (0008 does).
-- ---------------------------------------------------------------------------
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Auth stub
-- ---------------------------------------------------------------------------
-- Only the columns HALO relies on: the id every owned row hangs from, and the
-- two the stale-anonymous-user cleanup note in 0001 filters on. The API roles
-- get no privileges here (Supabase does not expose auth.users to them).
create table if not exists auth.users (
  id            uuid primary key default gen_random_uuid(),
  email         text,
  is_anonymous  boolean not null default false,
  created_at    timestamptz not null default now()
);

-- As on Supabase: the caller's id from the verified JWT, which PostgREST puts
-- in request.jwt.claim.sub (older) or request.jwt.claims (newer). NULL when the
-- request carries no user (the anon key alone).
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

-- ---------------------------------------------------------------------------
-- 5. Tables created before the numbered migrations
-- ---------------------------------------------------------------------------
-- 0001 says row level security "is already enabled on these tables but has no
-- policies", and that none of the foreign keys in the chain cascade (it quotes
-- the error naming profiles_id_fkey). Both are reproduced so 0001 runs against
-- the state it was written for: its loop really does drop and re-create these
-- three keys with ON DELETE CASCADE.
--
-- Columns are the ones the code and migrations read or write. Types are
-- inferred from the values written (see each comment) and are best guesses.
-- Columns that later migrations add (renter_mode, locale, state,
-- onboard_request_id, details) are deliberately absent: those migrations add them.

-- One row per visitor, created by the auth.users trigger from 0001.
-- address: exists on the deployed table per the product spec and is never
--   written (a privacy decision).
-- lat, lng: 0009 rounds them with round(lat::numeric, 3)::double precision.
-- zip: 0009 and /api/onboard clear it.
-- build_year: legacy; /api/profile falls back to it when home_year is null.
-- created_at: assumed (Supabase dashboard default); nothing reads it.
create table if not exists public.profiles (
  id            uuid not null,
  created_at    timestamptz not null default now(),
  address       text,
  lat           double precision,
  lng           double precision,
  zip           text,
  county        text,
  pwsid         text,
  build_year    integer,
  water_source  text,
  home_year     integer,
  constraint profiles_pkey primary key (id),
  constraint profiles_id_fkey foreign key (id) references auth.users (id)
);

-- One reading set per household per refresh (several per day are possible;
-- the history route collapses them). Written only with the service role.
-- id: assumed; no code reads it.
-- date: the household's local calendar day, written as 'YYYY-MM-DD'.
-- pollen_level: a JSON string (JSON.stringify), so text, not jsonb.
-- uv_index: providers return decimals, so not an integer.
create table if not exists public.daily_scores (
  id            uuid not null default gen_random_uuid(),
  profile_id    uuid not null,
  date          date,
  score         integer,
  aqi           integer,
  aqi_source    text,
  uv_index      double precision,
  pollen_level  text,
  mold_risk     text,
  created_at    timestamptz not null default now(),
  constraint daily_scores_pkey primary key (id),
  constraint daily_scores_profile_id_fkey foreign key (profile_id) references public.profiles (id)
);

-- Unused by the code. The product spec describes it as "the most recent home
-- assessment per household" (water risk and detail, radon zone, lead risk,
-- action plan); those columns are unknown, so only the keys 0001 relies on
-- are reconstructed.
create table if not exists public.home_risks (
  id            uuid not null default gen_random_uuid(),
  profile_id    uuid not null,
  created_at    timestamptz not null default now(),
  constraint home_risks_pkey primary key (id),
  constraint home_risks_profile_id_fkey foreign key (profile_id) references public.profiles (id)
);

alter table public.profiles      enable row level security;
alter table public.daily_scores  enable row level security;
alter table public.home_risks    enable row level security;

-- EPA UCMR 5 results, one row per water system, loaded by uploadData.js
-- (pwsid, pws_name, status, contaminants). created_at is read by /api/sources
-- as the load time. Public reference data: 0001 notes it is "already readable
-- with the anon key". Whether that is through row level security with a
-- public read policy (reconstructed here) or with row level security turned
-- off is NOT known; the audit's rls_enabled flag for this table settles it.
create table if not exists public.ucmr5_utilities (
  pwsid         text not null,
  pws_name      text,
  status        text,
  contaminants  jsonb,
  created_at    timestamptz not null default now(),
  constraint ucmr5_utilities_pkey primary key (pwsid)
);

alter table public.ucmr5_utilities enable row level security;

drop policy if exists "Enable read access for all users" on public.ucmr5_utilities;
create policy "Enable read access for all users" on public.ucmr5_utilities
  for select using (true);
