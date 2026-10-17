-- HALO: the operation ledger. Every mutation the new frontend sends carries an
-- Idempotency-Key, and the frontend treats a lost response as "unknown", not as
-- failure: it must be able to ask later what actually happened. This table is
-- that answer (BE-197, BE-199, and the "idempotent operation ledger" rule in
-- the frontend integration contract).
--
-- Run once in the Supabase SQL editor, AFTER 0016. Safe to re-run.
--
-- Locks: creates one new table and its indexes. It does not read or write any
-- existing table, so nothing else is blocked while it runs. The foreign key to
-- profiles takes a brief SHARE ROW EXCLUSIVE on profiles as it is created.
--
-- What a row is: one attempted operation, identified by the client-generated
-- operationId that was sent as the Idempotency-Key. The row is written BEFORE
-- the effect is attempted, so a crash leaves evidence that the attempt existed.
-- `result` holds the exact canonical receipt the route returned, because
-- GET /api/operations replays it verbatim to reconcile an unknown outcome.
--
-- Statuses, matching what the frontend already checks for:
--   pending    recorded, effect not yet confirmed. A reader may see this when
--              another request is still running, or when a process died.
--   succeeded  effect applied; `result` is the receipt to replay.
--   failed     effect definitively did not apply.
--   cancelled  the caller withdrew it where the domain supports cancellation.
-- "unknown" is NOT stored. It is what a route reports for a pending row that is
-- older than the caller's staleness window, so a dead process can never be
-- mistaken for work still in progress.
--
-- Ownership: profile_id is the verified session owner, so a household can only
-- ever reconcile its own operations. It is nullable for exactly one reason:
-- account recovery runs before the caller has an authenticated identity. The
-- check constraint below allows a null owner ONLY in the 'recovery' domain, so
-- no authenticated domain can accidentally create an unowned, unscoped row.
--
-- Retention: rows are kept until the owner is deleted (ON DELETE CASCADE).
-- No purge job is defined here on purpose. Retention periods are still
-- unapproved in docs/backend/privacy-and-retention.md, and this file does not
-- invent one. Recovery rows have no owner to cascade from and therefore need
-- an explicit expiry decision before recovery ships.
--
-- Privacy: `result` is a receipt, not record content. Routes must keep health
-- notes, exact locations, attachments and provider payloads out of it (BE-313).

create table if not exists public.operations (
  operation_id  uuid primary key,
  profile_id    uuid references public.profiles (id) on delete cascade,
  domain        text        not null,
  kind          text        not null,
  status        text        not null default 'pending',
  request_hash  text,
  result        jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Each check is added separately and idempotently, so re-running is safe and a
-- partially applied earlier run is completed rather than erroring.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'operations_status_check') then
    alter table public.operations add constraint operations_status_check
      check (status in ('pending', 'succeeded', 'failed', 'cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'operations_domain_check') then
    alter table public.operations add constraint operations_domain_check
      check (domain ~ '^[a-z][a-z0-9-]{0,63}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'operations_kind_check') then
    alter table public.operations add constraint operations_kind_check
      check (kind ~ '^[a-z][a-z0-9.-]{0,63}$');
  end if;
  -- Only account recovery may record an operation with no owner, because it
  -- runs before the caller is authenticated. Everything else must be scoped.
  if not exists (select 1 from pg_constraint where conname = 'operations_owner_check') then
    alter table public.operations add constraint operations_owner_check
      check (profile_id is not null or domain = 'recovery');
  end if;
  -- A finished operation must carry its receipt so it can be replayed.
  if not exists (select 1 from pg_constraint where conname = 'operations_result_check') then
    alter table public.operations add constraint operations_result_check
      check (status <> 'succeeded' or result is not null);
  end if;
end $$;

-- Listing a household's recent operations in one domain, newest first.
create index if not exists operations_owner_domain
  on public.operations (profile_id, domain, created_at desc)
  where profile_id is not null;

-- Finding stale pending rows regardless of owner (recovery rows have none).
create index if not exists operations_pending_created
  on public.operations (created_at)
  where status = 'pending';

alter table public.operations enable row level security;

-- No policy, deliberately. Every read and write goes through a route handler
-- using the service role, which bypasses row level security. A signed-in
-- browser has no reason to touch this table directly, and Supabase's default
-- privileges would otherwise grant it everything (confirmed by the 2026-10-17
-- catalog audit: anon and authenticated hold arwdDxtm on every new public
-- table). Revoking here is what actually closes that, the same way 0016 does
-- for home_contexts.
revoke all on table public.operations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verification (read only). Expect one row, all five columns true.
-- ---------------------------------------------------------------------------
--   select
--     (select relrowsecurity from pg_class
--       where oid = 'public.operations'::regclass) as rls_on,
--     (select count(*) from pg_policies
--       where schemaname = 'public' and tablename = 'operations') = 0
--       as no_policies,
--     not (has_any_column_privilege('anon', 'public.operations', 'SELECT')
--       or has_any_column_privilege('anon', 'public.operations', 'INSERT')
--       or has_any_column_privilege('authenticated', 'public.operations', 'SELECT')
--       or has_any_column_privilege('authenticated', 'public.operations', 'INSERT')
--       or has_table_privilege('anon', 'public.operations', 'DELETE')
--       or has_table_privilege('authenticated', 'public.operations', 'DELETE'))
--       as no_client_access,
--     has_table_privilege('service_role', 'public.operations', 'INSERT')
--       and has_table_privilege('service_role', 'public.operations', 'UPDATE')
--       as service_role_can_write,
--     (select count(*) from pg_constraint
--       where conrelid = 'public.operations'::regclass and contype = 'c') = 5
--       as five_checks;
--
-- ---------------------------------------------------------------------------
-- If you need to back out 0017
-- ---------------------------------------------------------------------------
-- The routes degrade to a non-retryable 503 feature_unavailable without this
-- table, exactly as they do before it is applied, so backing out disables the
-- new operations rather than breaking the existing app. Every recorded outcome
-- is deleted for good: an in-flight unknown operation can no longer be
-- reconciled by its caller, and a client holding that operationId will be told
-- the feature is unavailable rather than being given a stale answer.
--
-- <!-- backout-0017 -->
-- drop table if exists public.operations;
--
-- Then run: notify pgrst, 'reload schema';
