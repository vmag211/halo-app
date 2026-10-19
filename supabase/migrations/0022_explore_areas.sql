-- HALO: a household's saved discovery area (B05 plan, Task 3, Rulings D5 and D6).
--
-- Run once in the Supabase SQL editor, AFTER 0021. Safe to re-run.
--
-- Locks: creates one new table. It does not read or write any existing table,
-- so nothing else is blocked while it runs. The foreign key to profiles takes
-- a brief SHARE ROW EXCLUSIVE on profiles as it is created.
--
-- WHAT THIS TABLE IS FOR. The Explore screen lets a household choose the area
-- it wants to discover things in ("Explore your area"). That choice feeds the
-- opportunity search, the outreach context and Luna, so it has to be held by
-- the server and read back on every device. It is a county-level place the
-- household picked from the location search, not the home address: the five
-- place columns are exactly the client's `DiscoveryPlace` (id, place, state,
-- label, timezone), as GET /api/locations/search returns it, canonicalized by
-- the server against the county gazetteer before it is stored (Ruling D8).
--
-- ONE ROW PER HOUSEHOLD, NOT PER HOME (Ruling D5). The row is keyed by
-- profile_id alone. A household's discovery area does not move when its home
-- context changes, and the X-Halo-Home-Context header is ignored by every
-- route that reads or writes it.
--
-- NEVER SAVED IS REVISION 1 WITH NO ROW (Ruling D6). The client requires a
-- positive revision on every read and sends it back as If-Match on a save; a
-- revision of 0 would make every save refuse. So a household with no row reads
-- as `{place: null, revision: 1}`, and the first row ever stored carries
-- revision 2. That is why `revision` has no default and a check refuses
-- anything below 2: a stored 1 would be indistinguishable from "never saved",
-- and a stale client holding 1 could then overwrite it.
--
-- THE COMPARE AND SET IS TWO STATEMENTS, AND BOTH ARE ATOMIC ON THEIR OWN
-- (lib/exploreArea.js):
--
--   first save   a plain insert with revision 2. The primary key is the
--                precondition: if another save got there first, the insert
--                raises a unique violation (23505), and that IS the conflict.
--                No read-then-write window exists, so two first saves cannot
--                both succeed.
--   later saves  update ... where profile_id = $1 and revision = $2, setting
--                revision = $2 + 1. A stale revision matches no row, so the
--                update touches nothing, and that is the conflict.
--
-- A cleared area is a row whose five place columns are all null, and clearing
-- still advances the revision. The five columns are null together or set
-- together, because a partial place is something the client's validator would
-- discard whole.
--
-- EVERY STORED VALUE IS ONE THE CLIENT CAN READ BACK. The bounds are the
-- client's own `validPlaces` (lib/frontend/production/explore-service.ts:9 on
-- the frontend branch): each field a string of at most 300 characters, with no
-- control character other than tab, line feed and carriage return. A value
-- outside them makes `validDiscoveryArea` reject the whole response, so the
-- database refuses to hold what could only be thrown away.
--
-- Degrades cleanly: GET and PATCH /api/explore/area answer a non-retryable 503
-- feature_unavailable until this is applied, the same convention 0016 to 0021
-- use. Nothing else reads this table.
--
-- Retention: a row is kept until the owner is deleted (ON DELETE CASCADE).
-- Clearing the area keeps the row with a null place and a higher revision. No
-- purge job is defined here on purpose, and no period is invented: retention
-- for a discovery-area row is UNDECIDED and listed as such in
-- docs/backend/privacy-and-retention.md.
--
-- Privacy: the service role is the only reader. Row level security is on with
-- no policy at all and the default privileges are revoked, so not even the
-- owner can read their own area with their own session; it comes back through
-- GET /api/explore/area, which reads it with the service role after verifying
-- the token.

create table if not exists public.explore_areas (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  place_id   text,
  place      text,
  state      text,
  label      text,
  timezone   text,
  revision   integer not null,
  updated_at timestamptz not null default now()
);

-- Each check is added separately and idempotently, so re-running is safe and a
-- partially applied earlier run is completed rather than erroring.
do $$
begin
  -- 1 is the implicit never-saved state, which has no row (Ruling D6), so the
  -- first stored revision is 2 and nothing lower is storable.
  if not exists (select 1 from pg_constraint where conname = 'explore_areas_revision_check') then
    alter table public.explore_areas add constraint explore_areas_revision_check
      check (revision >= 2);
  end if;
  -- A place is all five fields or none of them: null together means the
  -- household cleared its area, and anything in between the client discards.
  if not exists (select 1 from pg_constraint where conname = 'explore_areas_place_complete_check') then
    alter table public.explore_areas add constraint explore_areas_place_complete_check
      check (num_nonnulls(place_id, place, state, label, timezone) in (0, 5));
  end if;
  -- `text(place[key], 300)` in validPlaces: at most 300 characters each.
  if not exists (select 1 from pg_constraint where conname = 'explore_areas_place_length_check') then
    alter table public.explore_areas add constraint explore_areas_place_length_check
      check (coalesce(char_length(place_id), 0) <= 300
         and coalesce(char_length(place), 0) <= 300
         and coalesce(char_length(state), 0) <= 300
         and coalesce(char_length(label), 0) <= 300
         and coalesce(char_length(timezone), 0) <= 300);
  end if;
  -- The control characters the client's `text()` rejects. Tab, line feed and
  -- carriage return are permitted, as they are there. A null column is
  -- allowed by the coalesce, and the check above keeps nulls together.
  if not exists (select 1 from pg_constraint where conname = 'explore_areas_place_control_check') then
    alter table public.explore_areas add constraint explore_areas_place_control_check
      check (coalesce(place_id, '') !~ E'[\x01-\x08\x0b\x0c\x0e-\x1f]'
         and coalesce(place, '') !~ E'[\x01-\x08\x0b\x0c\x0e-\x1f]'
         and coalesce(state, '') !~ E'[\x01-\x08\x0b\x0c\x0e-\x1f]'
         and coalesce(label, '') !~ E'[\x01-\x08\x0b\x0c\x0e-\x1f]'
         and coalesce(timezone, '') !~ E'[\x01-\x08\x0b\x0c\x0e-\x1f]');
  end if;
end $$;

alter table public.explore_areas enable row level security;

-- No policy, deliberately, and stricter than it looks: the owner cannot read
-- their own area with their own session either. Every read and write goes
-- through a route handler using the service role, which bypasses row level
-- security, after it has verified the token. Supabase's default privileges
-- would otherwise grant anon and authenticated arwdDxtm on this new public
-- table (confirmed by the 2026-10-17 catalog audit), so revoking here is what
-- actually closes that, the same way 0016 does for home_contexts, 0017 for
-- operations, 0018 for recovery_challenges, 0020 for the Luna tables and 0021
-- for profile_preferences.
revoke all on table public.explore_areas from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verification (read only). Expect one row, all five columns true.
-- ---------------------------------------------------------------------------
--   select
--     (select relrowsecurity from pg_class
--       where oid = 'public.explore_areas'::regclass) as rls_on,
--     (select count(*) from pg_policies
--       where schemaname = 'public' and tablename = 'explore_areas') = 0
--       as no_policies,
--     not exists (
--       select 1 from unnest(array['anon', 'authenticated']) as r
--        where has_any_column_privilege(r, 'public.explore_areas', 'SELECT')
--           or has_any_column_privilege(r, 'public.explore_areas', 'INSERT')
--           or has_any_column_privilege(r, 'public.explore_areas', 'UPDATE')
--           or has_table_privilege(r, 'public.explore_areas', 'DELETE'))
--       as no_client_access,
--     has_table_privilege('service_role', 'public.explore_areas', 'INSERT')
--       and has_table_privilege('service_role', 'public.explore_areas', 'UPDATE')
--       as service_role_can_write,
--     (select count(*) from pg_constraint
--       where conrelid = 'public.explore_areas'::regclass and contype = 'c') = 4
--       as four_checks;
--
-- ---------------------------------------------------------------------------
-- If you need to back out 0022
-- ---------------------------------------------------------------------------
-- GET and PATCH /api/explore/area go back to answering a non-retryable 503
-- feature_unavailable, exactly as they do before this is applied, so backing
-- out disables the saved discovery area rather than breaking the existing app.
--
-- What is lost: every household's chosen discovery area and its revision,
-- because the whole table is dropped. Revisions restart at 1 (never saved)
-- when 0022 is reapplied, so once a household has saved back up to the number
-- a stale client still holds, that client's revision check would pass again.
-- After a back-out and reapply, have every open client reload. Nothing
-- cascades: no other table references this one, and 0021's table and columns
-- are untouched.
--
-- The tested copy of this block is in docs/backend/YOUR_TODO.md, which is what
-- test/migrationBackout.test.mjs runs.
--
-- <!-- backout-0022 -->
-- drop table if exists public.explore_areas;
--
-- Then run: notify pgrst, 'reload schema';
