-- HALO: which intent wrote a recovery challenge (B02 plan, Task 5, Ruling 15).
--
-- Run once in the Supabase SQL editor, AFTER 0018. Safe to re-run.
--
-- Locks: one ALTER TABLE adding a column with a constant default and one check
-- constraint on a table that nothing else references. Postgres records a
-- constant default in the catalog rather than rewriting the table, so this does
-- not scan existing rows; the ACCESS EXCLUSIVE lock it takes on
-- public.recovery_challenges is held for the moment the catalog is written.
-- No other table is read or written.
--
-- Why this column exists. Two different operations write
-- public.recovery_challenges, and 0018 cannot tell their rows apart:
--
--   link     POST /api/account/commands, signed in. The caller attaches an
--            address to their own identity and the row records the wait for the
--            provider's confirmation.
--   recover  POST /api/recovery/request, NOT signed in. The row records one
--            attempt to prove ownership of an address that is already linked.
--
-- A fresh row of either kind carries a nonce hash, a null restore_token_hash
-- and a null consumed_at, so nothing in 0018 distinguishes them. That was safe
-- while only the link intent existed. It stops being safe the moment the
-- unauthenticated recover intent writes rows keyed by the same profile_id: the
-- link intent supersedes whatever the household had open before it inserts, and
-- an unnarrowed delete would take an in-flight recovery challenge with it,
-- which is a signed-in owner silently cancelling someone's recovery (or their
-- own, mid-flight). With this column every statement names the intent it means,
-- and a lookup for one intent can never return the other.
--
-- The default is 'link' so a row that already exists keeps the meaning it was
-- written with. Nothing needs backfilling, because the capability has never
-- been enabled and the table is empty in every environment; the default is what
-- makes that true rather than assumed.
--
-- One column and no others, deliberately: these migrations are applied by hand,
-- so the cheapest change that closes the problem is the right one. 'recover'
-- rows are found by the client nonce they carry, which only the browser that
-- started the attempt knows, so no new index is needed for them.
--
-- Degrades cleanly: until this is applied, every recovery route and the account
-- surface answer a non-retryable 503 feature_unavailable, the same convention
-- 0016, 0017 and 0018 use. The capability flag (BE-351) is separate and stays
-- off, so applying this does not turn recovery on.
--
-- Retention is unchanged and still undecided: see the recovery_challenges row
-- in docs/backend/privacy-and-retention.md. A recover row holds a hashed
-- address exactly like a link row.

alter table public.recovery_challenges
  add column if not exists intent text not null default 'link';

-- Added separately and idempotently, so re-running is safe and a partially
-- applied earlier run is completed rather than erroring.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'recovery_challenges_intent_check') then
    alter table public.recovery_challenges add constraint recovery_challenges_intent_check
      check (intent in ('link', 'recover'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Verification (read only). Expect one row, all three columns true.
-- ---------------------------------------------------------------------------
--   select
--     exists (select 1 from pg_attribute
--       where attrelid = 'public.recovery_challenges'::regclass
--         and attname = 'intent' and not attisdropped) as column_added,
--     (select attnotnull from pg_attribute
--       where attrelid = 'public.recovery_challenges'::regclass
--         and attname = 'intent') as not_null,
--     exists (select 1 from pg_constraint
--       where conname = 'recovery_challenges_intent_check') as check_added;
--
-- ---------------------------------------------------------------------------
-- If you need to back out 0019
-- ---------------------------------------------------------------------------
-- The recovery routes and the account surface go back to answering a
-- non-retryable 503 feature_unavailable, exactly as they do before it is
-- applied, so backing out disables recovery rather than breaking the existing
-- app. No row is deleted: every challenge stays, and what is lost is which
-- intent wrote it. Reapplying marks every surviving row as a link row, which is
-- the only answer the column can give once the distinction is gone.
--
-- The tested copy of this block is in docs/backend/YOUR_TODO.md, which is what
-- test/migrationBackout.test.mjs runs.
--
-- <!-- backout-0019 -->
-- alter table public.recovery_challenges drop column if exists intent;
--
-- Then run: notify pgrst, 'reload schema';
