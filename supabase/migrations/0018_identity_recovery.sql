-- HALO: the account recovery challenge table (B02 plan, Task 1).
--
-- Run once in the Supabase SQL editor, AFTER 0017. Safe to re-run.
--
-- Locks: creates one new table and its indexes. It does not read or write any
-- existing table, so nothing else is blocked while it runs. The foreign key to
-- profiles takes a brief SHARE ROW EXCLUSIVE on profiles as it is created.
--
-- What a row is: one attempt to prove ownership of an email that is already
-- linked to an identity. POST /api/recovery/request creates it, /status reads
-- it, /complete consumes it. The decision this implements is Option B, email
-- only, accepted 2026-10-17 (docs/backend/decisions/B01-optional-recovery.md).
--
-- Why this table is unusually strict. The caller is NOT signed in while these
-- rows are in play, so the row is the only thing between a stranger and
-- someone's household. Three rules follow from that, and all three are enforced
-- here rather than only in route code:
--
--   1. Hashes only, never the value. email_hash, nonce_hash and
--      restore_token_hash each accept 64 lowercase hex characters and nothing
--      else, so a plaintext address, nonce or token cannot physically be
--      written to the column even by mistake (BE-201: nothing proof-bearing
--      leaves the server, and a leaked row must not be replayable). It also
--      means this table never holds an attacker-chosen address in readable
--      form.
--   2. The service role is the only reader. Row level security is on with no
--      policy at all, and the default privileges are revoked, so not even the
--      owner can read their own challenge with their own session. There is no
--      legitimate browser reason to read it: the status comes back from
--      POST /api/recovery/status, which checks the client nonce first.
--   3. A verified row must carry a restore token hash. The frontend's
--      `validRecoveryStatus` rejects a verified response carrying neither a
--      restoreToken nor a session (lib/frontend/production/recovery-service.ts),
--      so a verified row that could not produce one is a bug, not a state.
--
-- Single use (BE-334 replay expiry): consumed_at records when the restore token
-- was spent. It cannot be set on a row that never had a token, so a replay
-- cannot be dressed up as a first use. The route adds the rest: /complete
-- consumes the token and a second attempt is answered from the operation ledger
-- in 0017 rather than by minting a second session.
--
-- Statuses are exactly the ones the frontend accepts, minus one: 'unknown' is
-- never stored. Like a stale pending row in the operation ledger, 'unknown' is
-- what a route reports when it cannot truthfully say more, not a state the
-- database records.
--
-- Identities are never merged (BE-334). An address already linked to another
-- identity is recorded as 'collision' and the flow stops; nothing in this file
-- can rekey or reassign an owned row.
--
-- Degrades cleanly: every recovery route returns a non-retryable 503
-- feature_unavailable until this table exists, the same convention 0016 and
-- 0017 use. The capability also stays behind a server-enforced feature flag
-- (BE-351), so applying this migration does not by itself turn recovery on.
--
-- Retention: rows are kept until the owner is deleted (ON DELETE CASCADE). No
-- purge job is defined here on purpose. Retention periods are still unapproved
-- in docs/backend/privacy-and-retention.md and this file does not invent one.
-- A consumed or expired challenge still holds a hashed address, so an expiry
-- decision is needed before recovery ships, not after.

create table if not exists public.recovery_challenges (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid        not null references public.profiles (id) on delete cascade,
  email_hash          text        not null,
  nonce_hash          text        not null,
  restore_token_hash  text,
  status              text        not null default 'pending',
  attempts            integer     not null default 0,
  expires_at          timestamptz not null,
  consumed_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Each check is added separately and idempotently, so re-running is safe and a
-- partially applied earlier run is completed rather than erroring.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'recovery_challenges_email_hash_check') then
    alter table public.recovery_challenges add constraint recovery_challenges_email_hash_check
      check (email_hash ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recovery_challenges_nonce_hash_check') then
    alter table public.recovery_challenges add constraint recovery_challenges_nonce_hash_check
      check (nonce_hash ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recovery_challenges_restore_token_hash_check') then
    alter table public.recovery_challenges add constraint recovery_challenges_restore_token_hash_check
      check (restore_token_hash is null or restore_token_hash ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recovery_challenges_status_check') then
    alter table public.recovery_challenges add constraint recovery_challenges_status_check
      check (status in ('pending', 'verified', 'expired', 'collision', 'failed'));
  end if;
  -- A verified row must be able to produce what the client requires of it.
  if not exists (select 1 from pg_constraint where conname = 'recovery_challenges_verified_restore_token_check') then
    alter table public.recovery_challenges add constraint recovery_challenges_verified_restore_token_check
      check (status <> 'verified' or restore_token_hash is not null);
  end if;
  -- Nothing can be consumed that was never issued.
  if not exists (select 1 from pg_constraint where conname = 'recovery_challenges_consumed_at_check') then
    alter table public.recovery_challenges add constraint recovery_challenges_consumed_at_check
      check (consumed_at is null or restore_token_hash is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recovery_challenges_attempts_check') then
    alter table public.recovery_challenges add constraint recovery_challenges_attempts_check
      check (attempts >= 0);
  end if;
end $$;

-- Rate limiting per address hash reads the recent rows for one hash (Task 5).
create index if not exists recovery_challenges_email_hash_created
  on public.recovery_challenges (email_hash, created_at desc);

-- GET /api/account reports the owner's current challenge, masked.
create index if not exists recovery_challenges_profile
  on public.recovery_challenges (profile_id, created_at desc);

-- Finding the challenges that are still live, for expiry and for "is one open".
create index if not exists recovery_challenges_open
  on public.recovery_challenges (expires_at)
  where consumed_at is null;

alter table public.recovery_challenges enable row level security;

-- No policy, deliberately, and stricter than it looks: the owner cannot read
-- their own challenge either. Supabase's default privileges would otherwise
-- grant anon and authenticated arwdDxtm on this new public table (confirmed by
-- the 2026-10-17 catalog audit), so revoking here is what actually closes it,
-- the same way 0016 does for home_contexts and 0017 for operations.
revoke all on table public.recovery_challenges from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verification (read only). Expect one row, all five columns true.
-- ---------------------------------------------------------------------------
--   select
--     (select relrowsecurity from pg_class
--       where oid = 'public.recovery_challenges'::regclass) as rls_on,
--     (select count(*) from pg_policies
--       where schemaname = 'public' and tablename = 'recovery_challenges') = 0
--       as no_policies,
--     not (has_any_column_privilege('anon', 'public.recovery_challenges', 'SELECT')
--       or has_any_column_privilege('anon', 'public.recovery_challenges', 'INSERT')
--       or has_any_column_privilege('authenticated', 'public.recovery_challenges', 'SELECT')
--       or has_any_column_privilege('authenticated', 'public.recovery_challenges', 'INSERT')
--       or has_table_privilege('anon', 'public.recovery_challenges', 'DELETE')
--       or has_table_privilege('authenticated', 'public.recovery_challenges', 'DELETE'))
--       as no_client_access,
--     has_table_privilege('service_role', 'public.recovery_challenges', 'INSERT')
--       and has_table_privilege('service_role', 'public.recovery_challenges', 'UPDATE')
--       as service_role_can_write,
--     (select count(*) from pg_constraint
--       where conrelid = 'public.recovery_challenges'::regclass and contype = 'c') = 7
--       as seven_checks;
--
-- ---------------------------------------------------------------------------
-- If you need to back out 0018
-- ---------------------------------------------------------------------------
-- The recovery routes degrade to a non-retryable 503 feature_unavailable
-- without this table, exactly as they do before it is applied, so backing out
-- disables recovery rather than breaking the existing app. Any challenge in
-- flight is deleted: whoever was part way through proving ownership of their
-- address must start again once it is reapplied. No owned household record is
-- touched, because nothing outside this table references it.
--
-- The tested copy of this block is in docs/backend/YOUR_TODO.md, which is what
-- test/migrationBackout.test.mjs runs.
--
-- <!-- backout-0018 -->
-- drop table if exists public.recovery_challenges;
--
-- Then run: notify pgrst, 'reload schema';
