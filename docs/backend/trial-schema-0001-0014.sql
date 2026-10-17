-- HALO throwaway-project trial schema.
--
-- Run this in a NEW, EMPTY Supabase project only. Never against the HALO project.
--
-- Contents, in order:
--   1. The four tables created by hand before migration 0001 (profiles,
--      daily_scores, home_risks, ucmr5_utilities), taken from section 5 of
--      supabase/baseline/reconstructed_baseline.sql.
--   2. Migrations 0001 through 0014, unmodified, in order.
--
-- Deliberately EXCLUDED from the baseline file: its API roles, schemas,
-- default privileges and auth stub (sections 1-4). A real Supabase project
-- already provides all of those, and the stub's "create or replace function
-- auth.uid()" would overwrite Supabase's own.
--
-- The vector extension is created by 0007 itself; nothing extra is needed.
--
-- Verified 2026-10-17: applied cleanly to a throwaway Supabase project running
-- PostgreSQL 17.6, after which 0015 and 0016 were applied, checked, backed out
-- and re-applied successfully.
--
-- Remaining known difference from the deployed database: production also has a
-- SECURITY DEFINER function rls_auto_enable() returning event_trigger, which is
-- in no migration and no baseline. Not reproduced here; provenance unknown, and
-- the catalog audit does not read pg_event_trigger so it is not known whether
-- an event trigger is actually bound to it.

-- ================================================================
-- Pre-0001 tables (baseline section 5)
-- ================================================================
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

-- Name confirmed against the deployed database by the 2026-10-17 catalog audit
-- (docs/backend/baseline-audit.deployed.json). It was previously guessed as
-- "Enable read access for all users", which no deployed policy ever had.
drop policy if exists "Allow public read access on ucmr5_utilities" on public.ucmr5_utilities;
create policy "Allow public read access on ucmr5_utilities" on public.ucmr5_utilities
  for select using (true);

-- ================================================================
-- 0001_anon_auth
-- ================================================================
-- HALO — anonymous auth foundation
-- Run this once in the Supabase SQL editor (DDL cannot go through PostgREST).
--
-- Three things happen here:
--   1. Every new auth.users row automatically gets a matching profiles row, so the
--      daily_scores.profile_id -> profiles.id -> auth.users.id chain is always satisfiable.
--   2. RLS policies scope every row to the user that owns it. RLS is already enabled on
--      these tables but has no policies, which is why anon reads currently return [].
--   3. Existing users are backfilled.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Auto-create a profile for every new user (anonymous or otherwise)
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
exception
  -- Never let a profile problem block a sign-up. /api/onboard upserts the row
  -- anyway, so a failure here degrades to "profile created slightly later"
  -- rather than "user cannot sign in at all".
  when others then
    raise warning 'handle_new_user failed for %: %', new.id, sqlerrm;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 2. Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles      enable row level security;
alter table public.daily_scores  enable row level security;
alter table public.home_risks    enable row level security;

-- profiles: a user may only ever see and edit their own row.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- No delete policy: anonymous users cannot delete their own row. Account
-- deletion, when it exists, will go through a service-role route.

-- daily_scores: read-only to the owner. Writes come from /api/daily-score using
-- the service-role key, which bypasses RLS by design -- there is deliberately no
-- user-facing insert or update policy, so a client cannot forge a cached score.
drop policy if exists "daily_scores_select_own" on public.daily_scores;
create policy "daily_scores_select_own" on public.daily_scores
  for select using (auth.uid() = profile_id);

drop policy if exists "home_risks_select_own" on public.home_risks;
create policy "home_risks_select_own" on public.home_risks
  for select using (auth.uid() = profile_id);

-- ucmr5_utilities is public EPA reference data, not user data. It is already
-- readable with the anon key and /api/home-guard depends on that. Left alone.

-- ---------------------------------------------------------------------------
-- 3. Backfill anyone who predates the trigger (e.g. the hand-seeded test user)
-- ---------------------------------------------------------------------------

insert into public.profiles (id)
select u.id from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Make user deletion actually possible
-- ---------------------------------------------------------------------------
--
-- None of the foreign keys in the chain cascade, so deleting any user fails:
--
--   delete on table "users" violates foreign key constraint "profiles_id_fkey"
--   Key (id)=(...) is still referenced from table "profiles".
--
-- and deleting the profile then fails against daily_scores. That breaks the
-- Supabase dashboard's delete button, blocks the scheduled cleanup of stale
-- anonymous users that anonymous auth requires, and would block account
-- deletion later. Anonymous sign-in creates a real user per device, so rows
-- accumulate quickly and there has to be a way to remove them.
--
-- Constraint names are looked up rather than assumed.

do $$
declare
  r record;
begin
  for r in
    select con.conname, cl.relname as table_name
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
    join pg_namespace ns on ns.oid = cl.relnamespace
    where con.contype = 'f'
      and ns.nspname = 'public'
      and con.confdeltype <> 'c'   -- 'c' = already ON DELETE CASCADE
      -- Scoped to exactly the three owning keys. A broader match would drop
      -- unrelated foreign keys on these tables that nothing below re-creates.
      and (
        (cl.relname = 'profiles'
           and pg_get_constraintdef(con.oid) like 'FOREIGN KEY (id)%')
        or (cl.relname in ('daily_scores', 'home_risks')
           and pg_get_constraintdef(con.oid) like 'FOREIGN KEY (profile_id)%')
      )
  loop
    raise notice 'recreating % on % with ON DELETE CASCADE', r.conname, r.table_name;

    execute format(
      'alter table public.%I drop constraint %I',
      r.table_name, r.conname
    );
  end loop;
end $$;

-- The block above drops whatever the original constraints were called. These
-- guards cover the re-run case, where they already cascade and so were skipped.
alter table public.profiles     drop constraint if exists profiles_id_fkey;
alter table public.daily_scores drop constraint if exists daily_scores_profile_id_fkey;
alter table public.home_risks   drop constraint if exists home_risks_profile_id_fkey;

alter table public.profiles
  add constraint profiles_id_fkey
  foreign key (id) references auth.users (id) on delete cascade;

alter table public.daily_scores
  add constraint daily_scores_profile_id_fkey
  foreign key (profile_id) references public.profiles (id) on delete cascade;

alter table public.home_risks
  add constraint home_risks_profile_id_fkey
  foreign key (profile_id) references public.profiles (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 5. Cleanup helper for stale anonymous users (run manually or on a schedule)
-- ---------------------------------------------------------------------------
--
-- Anonymous auth means a new auth.users row per device, including every bounce.
-- With the cascade above in place this now removes their profiles and scores
-- too. Not scheduled here -- run it when you want, or wire it to pg_cron.
--
--   delete from auth.users
--   where is_anonymous is true
--     and created_at < now() - interval '30 days';

-- ================================================================
-- 0002_household_and_profile
-- ================================================================
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

-- ================================================================
-- 0003_symptom_logs
-- ================================================================
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

-- ================================================================
-- 0004_volunteer_orgs
-- ================================================================
-- HALO — volunteer organizations (§9.2, §15.3)
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Public reference data (not household data), readable by everyone. Written only
-- by whoever maintains the directory. `last_verified` forces periodic human
-- re-checking — a directory of dead links would undermine the hand-verified claim.
--
-- The seed below is a STARTER set of real NC environmental organizations. Per
-- §41/§66 every entry must be human-verified (operating + link resolves) before
-- launch; `last_verified` is left NULL until that happens, and the interface
-- should render NULL as "not yet verified" rather than a date.

create table if not exists public.volunteer_orgs (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  description   text not null,
  counties      text[] not null default '{}',   -- county names, or the literal 'statewide'
  causes        text[] not null default '{}',   -- cause tags: water, pfas, radon, air, wells, advocacy
  url           text not null,
  last_verified date,                            -- NULL until a human checks it
  created_at    timestamptz not null default now()
);

alter table public.volunteer_orgs enable row level security;

drop policy if exists "volunteer_orgs_public_read" on public.volunteer_orgs;
create policy "volunteer_orgs_public_read" on public.volunteer_orgs
  for select using (true);
-- No insert/update/delete policies: only the service role writes.

-- ── Starter seed (real orgs; VERIFY before launch) ──
insert into public.volunteer_orgs (name, description, counties, causes, url, last_verified) values
  ('Yadkin Riverkeeper',
   'Protects the Yadkin–Pee Dee River basin, which drains much of NC-08, through monitoring, advocacy, and volunteer water sampling.',
   array['statewide'], array['water','pfas','advocacy'], 'https://www.yadkinriverkeeper.org', null),
  ('Catawba Riverkeeper Foundation',
   'Monitors and defends the Catawba–Wateree basin, including the Charlotte metro and Cabarrus area.',
   array['statewide'], array['water','pfas','advocacy'], 'https://www.catawbariverkeeper.org', null),
  ('Cape Fear River Watch',
   'Works on PFAS and pollution in the Cape Fear River basin, including the downstream communities affected by GenX.',
   array['statewide'], array['water','pfas','advocacy'], 'https://capefearriverwatch.org', null),
  ('Clean Water for North Carolina',
   'Statewide environmental justice group focused on drinking water, private wells, and community organizing.',
   array['statewide'], array['water','wells','advocacy'], 'https://www.cwfnc.org', null),
  ('NC Conservation Network',
   'A statewide network coordinating advocacy on clean water, clean air, and environmental policy across North Carolina.',
   array['statewide'], array['water','air','advocacy'], 'https://www.ncconservationnetwork.org', null)
on conflict do nothing;

-- ================================================================
-- 0005_learn_content
-- ================================================================
-- HALO — educational content (§9.2, §17)
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- One record per topic per language. Public reference data, readable by everyone.
--
-- The canonical content lives in code (lib/learnContent.js) so it can be reviewed
-- and unit-tested; /api/learn serves from there and composes the "why yours" line
-- from the household's own value at request time. This table is the spec'd
-- persistence layer for future DB-backed editing/translation; seed it from the
-- code module (a seed route/script) once this migration is applied. Spanish
-- (locale 'es') is stored as separate rows, human-reviewed, never machine-translated
-- at display time (§17.10).

create table if not exists public.learn_content (
  topic       text not null,     -- pfas | radon | lead | air | pollen | uv | mold
  locale      text not null default 'en' check (locale in ('en', 'es')),
  what_it_is  text not null,
  protect     jsonb not null default '[]',   -- ordered checklist of protective actions
  household   jsonb not null default '{}',   -- per-group framing branches
  sources     jsonb not null default '[]',   -- [{label, url, retrieved}]
  updated_at  timestamptz not null default now(),
  primary key (topic, locale)
);

alter table public.learn_content enable row level security;

drop policy if exists "learn_content_public_read" on public.learn_content;
create policy "learn_content_public_read" on public.learn_content
  for select using (true);
-- No user writes: only the service role seeds/edits.

-- ================================================================
-- 0006_alerts
-- ================================================================
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

-- ================================================================
-- 0007_assistant_corpus
-- ================================================================
-- HALO — assistant knowledge base (§9.2, §18)
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Curated source documents from federal health/environmental agencies, a national
-- lung-health org, and state agencies, broken into passages. Each passage stores
-- its source label + URL + retrieval date and an embedding used to find relevant
-- passages. Public reference data.
--
-- Ingesting passages and computing embeddings needs an embedding-model key
-- (§38 "Assistant model key"); that is a separate script and is NOT built/tested
-- here. The embedding dimension below assumes a 1536-d model (e.g. OpenAI
-- text-embedding-3-small); change it to match whichever model is used.

create extension if not exists vector with schema extensions;

create table if not exists public.assistant_corpus (
  id           uuid primary key default gen_random_uuid(),
  source_label text not null,
  source_url   text not null,
  retrieved    date not null,
  passage      text not null,
  embedding    extensions.vector(1536),
  created_at   timestamptz not null default now()
);

-- Approximate-nearest-neighbour index for retrieval (cosine distance).
-- HNSW, not IVFFlat: IVFFlat built on an empty table has meaningless list
-- centres, and with the default probes=1 a small corpus (the starter ingest is
-- ~14 passages) would return no rows for most questions — silently turning
-- every answer into "no source". HNSW works at any size and needs no rebuild.
--
-- Re-run guard: 0013 later widens the column to 2,048 dimensions and drops this
-- index, because HNSW allows at most 2,000. The index is therefore only created
-- while the column's declared dimension is 2,000 or fewer, which is always true
-- on a first run (1,536). Running this file again after 0013 then skips it
-- instead of failing.
do $$
begin
  if (select a.atttypmod
        from pg_attribute a
       where a.attrelid = 'public.assistant_corpus'::regclass
         and a.attname = 'embedding'
         and not a.attisdropped) between 1 and 2000 then
    create index if not exists assistant_corpus_embedding
      on public.assistant_corpus
      using hnsw (embedding extensions.vector_cosine_ops);
  end if;
end $$;

alter table public.assistant_corpus enable row level security;

drop policy if exists "assistant_corpus_public_read" on public.assistant_corpus;
create policy "assistant_corpus_public_read" on public.assistant_corpus
  for select using (true);
-- No user writes: only the ingestion script (service role) populates it.

-- ================================================================
-- 0008_assistant_match_fn
-- ================================================================
-- HALO — assistant retrieval function (§18)
-- Run once in the Supabase SQL editor, AFTER 0007. Safe to re-run.
--
-- Cosine-similarity retrieval over the curated corpus. Called by /api/assistant
-- via supabaseAdmin.rpc('match_assistant_corpus', {...}) once an embedding-model
-- key exists and passages have been ingested (scripts/ingest-corpus.mjs).
--
-- pgvector's `<=>` is cosine DISTANCE (0 = identical), so cosine similarity is
-- `1 - (a <=> b)`. Passages below `min_similarity` are dropped so an off-topic
-- corpus yields no rows and the route declines with NO_SOURCE rather than
-- citing something irrelevant. Reads reference data only — never household rows.
--
-- search_path is pinned so `<=>` resolves from the extensions schema regardless
-- of the caller's path, and execution is limited to the service role (the only
-- caller) with the result count clamped, so it isn't an open public endpoint.

create or replace function public.match_assistant_corpus(
  query_embedding extensions.vector(1536),
  match_count     int default 6,
  min_similarity  double precision default 0.4
)
returns table (
  id           uuid,
  source_label text,
  source_url   text,
  retrieved    date,
  passage      text,
  similarity   double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select
    c.id,
    c.source_label,
    c.source_url,
    c.retrieved,
    c.passage,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.assistant_corpus c
  where c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) >= min_similarity
  order by c.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 20);
$$;

revoke execute on function public.match_assistant_corpus(extensions.vector, int, double precision)
  from public, anon, authenticated;
grant execute on function public.match_assistant_corpus(extensions.vector, int, double precision)
  to service_role;

-- ================================================================
-- 0009_daily_details_and_state
-- ================================================================
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

-- Privacy clean-up (item 7d). The privacy statement promises approximate
-- coordinates and doesn't list ZIP code. Onboarding now rounds to 3 decimals
-- (~100 m) and stores no ZIP; bring rows written by earlier versions into line.
-- Idempotent: re-rounding a rounded value is a no-op.
update public.profiles
   set lat = round(lat::numeric, 3)::double precision,
       lng = round(lng::numeric, 3)::double precision
 where lat is not null
   and (lat <> round(lat::numeric, 3)::double precision
        or lng <> round(lng::numeric, 3)::double precision);

update public.profiles set zip = null where zip is not null;

-- ================================================================
-- 0010_alerts_notifications
-- ================================================================
-- HALO — alerts: dismiss, notification preferences, device push, water change
-- tracking (punch list v3 item 16). Run once in the Supabase SQL editor, AFTER
-- 0006. Safe to re-run.

-- ── Dismiss (§19.4 swipe, with undo) ────────────────────────────────────────
alter table public.alerts
  add column if not exists dismissed boolean not null default false;

-- ── Notification preferences, one row per household ─────────────────────────
-- Every type defaults on. The daily job skips types turned off.
create table if not exists public.notification_prefs (
  profile_id          uuid primary key references public.profiles (id) on delete cascade,
  air_quality_change  boolean not null default true,
  weather_advisory    boolean not null default true,
  new_water_results   boolean not null default true,
  radon_season        boolean not null default true,
  season_summary      boolean not null default true,
  updated_at          timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;
drop policy if exists "notification_prefs_select_own" on public.notification_prefs;
create policy "notification_prefs_select_own" on public.notification_prefs
  for select using (auth.uid() = profile_id);
drop policy if exists "notification_prefs_upsert_own" on public.notification_prefs;
create policy "notification_prefs_upsert_own" on public.notification_prefs
  for insert with check (auth.uid() = profile_id);
drop policy if exists "notification_prefs_update_own" on public.notification_prefs;
create policy "notification_prefs_update_own" on public.notification_prefs
  for update using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

-- ── Browser push subscriptions (§19.5) ───────────────────────────────────────
-- One row per browser/device. Written only by the server (service role) from the
-- verified session; endpoints that the push service reports expired are deleted.
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_profile on public.push_subscriptions (profile_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own" on public.push_subscriptions
  for select using (auth.uid() = profile_id);
-- No client writes: /api/push/subscribe writes with the service role.

-- ── Water result change tracking ─────────────────────────────────────────────
-- A fingerprint of each utility's stored readings. When a UCMR reload changes
-- it, the daily job alerts that utility's households (new_water_results) and
-- updates the fingerprint. Public reference data, server-written only.
create table if not exists public.water_snapshots (
  pwsid        text primary key,
  fingerprint  text not null,
  updated_at   timestamptz not null default now()
);
alter table public.water_snapshots enable row level security;
-- No policies: service role only.

-- ================================================================
-- 0011_map_layers
-- ================================================================
-- HALO — pre-built map layers and district aggregate (punch list v3 items 18, 19)
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- The daily job assembles every map layer (water, radon, facilities, air) and
-- the NC-08 district aggregate once a day and stores the result here; /api/map
-- and /api/district serve it. A slow or unavailable government service can then
-- never slow or break the map (§13.10, §62.1). Public reference data only — no
-- household data. Server-written (service role) and server-read.

create table if not exists public.map_layers (
  layer         text primary key,          -- 'water' | 'radon' | 'facilities' | 'air' | 'district'
  payload       jsonb not null,
  assembled_at  timestamptz not null default now()
);

alter table public.map_layers enable row level security;
-- No policies: service role only.

-- ================================================================
-- 0012_volunteer_orgs_nc08
-- ================================================================
-- HALO — volunteer organizations for NC-08 (punch list v3 item 17)
-- Run once in the Supabase SQL editor, AFTER 0004. Safe to re-run.
--
-- Tags the starter organizations to the NC-08 counties they actually serve, and
-- adds organizations researched for NC-08's counties and causes — including
-- radon, which none covered before (a radon-only household got an empty list).
--
-- link_checked: the date each website was confirmed to load.
-- last_verified stays NULL: a PERSON must still confirm each organization is
-- operating and serves these counties before launch (§41, §66 item 8). The
-- interface shows NULL as "not yet verified". "Twenty verified beats forty
-- unverified" (§68) — this list is deliberately short and sourced.
--
-- Left out on purpose: Sierra Club Central Piedmont Group (its sierraclub.org
-- page redirects endlessly and its own site hasn't been updated since 2016).

alter table public.volunteer_orgs
  add column if not exists link_checked date;

insert into public.volunteer_orgs (name, description, counties, causes, url, link_checked) values
  -- Existing five, now tagged to the NC-08 counties in their river basins.
  ('Yadkin Riverkeeper',
   'Protects the Yadkin–Pee Dee River basin, which drains most of NC-08, through water monitoring, advocacy, and volunteer sampling.',
   array['Anson County','Cabarrus County','Montgomery County','Richmond County','Stanly County','Union County'],
   array['water','pfas','advocacy'], 'https://www.yadkinriverkeeper.org', '2026-09-27'),
  ('Catawba Riverkeeper Foundation',
   'Monitors and defends the Catawba–Wateree River basin, including the Charlotte area and western Union County.',
   array['Mecklenburg County','Union County'],
   array['water','pfas','advocacy'], 'https://www.catawbariverkeeper.org', '2026-09-27'),
  ('Cape Fear River Watch',
   'Works on PFAS and other pollution in the Cape Fear River basin, including the downstream communities affected by GenX.',
   array['statewide'], array['water','pfas','advocacy'], 'https://capefearriverwatch.org', '2026-09-27'),
  ('Clean Water for North Carolina',
   'Statewide environmental justice group focused on drinking water, private wells, and community organizing.',
   array['statewide'], array['water','wells','advocacy'], 'https://www.cwfnc.org', '2026-09-27'),
  ('NC Conservation Network',
   'A statewide network coordinating advocacy on clean water, clean air, and environmental policy across North Carolina.',
   array['statewide'], array['water','air','advocacy'], 'https://www.ncconservationnetwork.org', '2026-09-27'),

  -- New.
  ('Three Rivers Land Trust',
   'Conserves land and water in a fifteen-county region of the central Piedmont and Sandhills, with volunteer workdays on protected land.',
   array['Anson County','Cabarrus County','Montgomery County','Richmond County','Scotland County','Stanly County'],
   array['water'], 'https://trlt.org', '2026-09-27'),
  ('Winyah Rivers Alliance (Lumber Riverkeeper)',
   'Protects the Lumber River watershed through its Lumber Riverkeeper, with water monitoring and advocacy on pollution along the river.',
   array['Robeson County','Scotland County'],
   array['water','advocacy'], 'https://winyahrivers.org', '2026-09-27'),
  ('Catawba Lands Conservancy',
   'A land trust permanently conserving land and streams in the southern Piedmont, with volunteer trail and cleanup days.',
   array['Mecklenburg County','Union County'],
   array['water'], 'https://catawbalands.org', '2026-09-27'),
  ('CleanAIRE NC',
   'Advocates for clean air and climate solutions from offices in Charlotte and RTP; its AirKeepers volunteers run community air-quality sensors.',
   array['Mecklenburg County','statewide'],
   array['air','advocacy'], 'https://cleanairenc.org', '2026-09-27'),
  ('American Lung Association in North Carolina',
   'Works on lung health, air quality, and radon awareness in North Carolina, with volunteer and advocacy opportunities.',
   array['statewide'],
   array['air','radon','advocacy'], 'https://www.lung.org/about-us/local-associations/north-carolina.html', '2026-09-27'),
  ('North Carolina Radon Program (NCDHHS)',
   'The state radon program: free home radon test kits each January, radon data by county, and help finding mitigation.',
   array['statewide'],
   array['radon'], 'https://radon.ncdhhs.gov', '2026-09-27'),
  ('North Carolina Environmental Justice Network',
   'A grassroots, people-of-color-led coalition supporting communities facing environmental injustice, including meetings held in Robeson County.',
   array['Robeson County','statewide'],
   array['water','air','advocacy'], 'https://ncejn.org', '2026-09-27'),
  ('Toxic Free NC',
   'Statewide education and advocacy on pesticide and toxic exposures, focused on families and communities most at risk.',
   array['statewide'],
   array['advocacy'], 'https://toxicfreenc.org', '2026-09-27')
on conflict (name) do update set
  description  = excluded.description,
  counties     = excluded.counties,
  causes       = excluded.causes,
  url          = excluded.url,
  link_checked = excluded.link_checked;
  -- last_verified is deliberately untouched: only a person sets it.

-- ================================================================
-- 0013_assistant_embed_2048
-- ================================================================
-- HALO — assistant embeddings at 2,048 dimensions (OpenRouter free model)
-- Run once in the Supabase SQL editor, AFTER 0007/0008. Safe to re-run.
--
-- The assistant now embeds with nvidia/nemotron-3-embed-1b (via OpenRouter's
-- free tier), which only produces 2,048-dimension vectors. pgvector's HNSW index
-- supports at most 2,000 dimensions, so the approximate index is dropped:
-- the curated corpus is ~14 passages, and an exact scan of it is instant (and
-- slightly more accurate than an approximate index). If the corpus ever grows to
-- tens of thousands of passages, add an HNSW index on embedding::halfvec(2048).
--
-- Embeddings from different models are not comparable, so any rows embedded
-- with the old 1,536-dimension model are removed; re-run
-- `node scripts/ingest-corpus.mjs` afterwards.

drop index if exists public.assistant_corpus_embedding;

delete from public.assistant_corpus
 where embedding is not null and extensions.vector_dims(embedding) <> 2048;

alter table public.assistant_corpus
  alter column embedding type extensions.vector(2048);

drop function if exists public.match_assistant_corpus(extensions.vector, int, double precision);

create or replace function public.match_assistant_corpus(
  query_embedding extensions.vector(2048),
  match_count     int default 6,
  min_similarity  double precision default 0.4
)
returns table (
  id           uuid,
  source_label text,
  source_url   text,
  retrieved    date,
  passage      text,
  similarity   double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select
    c.id,
    c.source_label,
    c.source_url,
    c.retrieved,
    c.passage,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.assistant_corpus c
  where c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) >= min_similarity
  order by c.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 20);
$$;

revoke execute on function public.match_assistant_corpus(extensions.vector, int, double precision)
  from public, anon, authenticated;
grant execute on function public.match_assistant_corpus(extensions.vector, int, double precision)
  to service_role;

-- ================================================================
-- 0014_onboard_request_id
-- ================================================================
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

