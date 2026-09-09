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
