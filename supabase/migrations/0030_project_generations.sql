-- HALO: saved Explore project idea sets (B16 plan,
-- docs/backend/plans/b16-explore-projects.md, Rulings J1 to J14). One row per
-- generation request: the household's idea set as the routes returned it, so
-- `projects.current` restores it and `projects.generation` answers a check.
--
-- Run once in the Supabase SQL editor, AFTER 0017 (the ledger). It does not
-- need 0018 to 0029 and may go before or after any of them. Safe to re-run.
--
-- Locks: creates one new table and one index, which no other statement can be
-- waiting on. The foreign key to profiles takes a brief SHARE ROW EXCLUSIVE on
-- profiles as it is created, so a new anonymous sign-up could wait a moment.
-- It adds one trigger to public.operations (section 3), taking a brief SHARE
-- ROW EXCLUSIVE on that table: a ledger claim or settle at that moment waits
-- for it. Nothing existing is read or rewritten.
--
-- WHAT THIS IS FOR. Explore's project ideas are a deterministic selection
-- from a curated, source-backed library (lib/data/exploreProjectLibrary.json),
-- ranked by the household's dated evidence and stated choices. No model and no
-- paid service is called (Ruling J1). The selection is fast, so a request
-- completes inside its own call, but the frontend's contract is asynchronous
-- (generate, check status, cancel), and an idea set must survive a reload.
-- This table is that memory:
--
--   - generation_id is the request's Idempotency-Key (a UUID the client makes)
--     and is also the job id the client checks by. The primary key
--     (profile_id, generation_id) makes a repeat of one request return the
--     same row, and lets a cancellation that arrives first leave a
--     'cancelled' row the late request then finds (Ruling J6);
--   - idea_set is the ProjectGenerationResult exactly as the routes answered it
--     (lib/frontend/production/explore-service.ts validProjectGeneration):
--     the batch, the guides it names, and the evidence it used, each with its
--     date and scope. It holds the person's typed interest text, so it is
--     private text in the privacy export.
--
-- Errors the functions raise, for the routes to map. Each is SQLSTATE P0001
-- with exactly this message; DETAIL never holds a value:
--   HALO_INVALID_INPUT   an argument is malformed
--
-- Degrades cleanly: until this is applied the B16 routes answer
-- "unavailable" (a missing function is PGRST202 or 42883, a missing table
-- PGRST205 or 42P01): generate a 200 'failed' result that changes nothing, the
-- reads a non-retryable 503 feature_unavailable.
--
-- DELETION. profile_id references profiles ON DELETE CASCADE, so deleting the
-- account deletes every row. A privacy clear all (0024) resets the profile
-- instead of deleting it, so section 3's trigger deletes the household's rows
-- when that clear settles its own ledger row, inside the clear's transaction
-- (the 0026 pattern). Clear Journal keeps them.
--
-- Retention (Ruling J9, proposed): the newest 20 rows a household has, and
-- always its newest completed set; older rows are deleted by the next
-- request's insert. The routes stay behind the `projects` server flag, off by
-- default.
--
-- Privacy: the service role is the only reader or writer. Row level security
-- is on with no policy and the default privileges are revoked.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------

create table if not exists public.household_project_generations (
  -- The owner, from the verified session only.
  profile_id     uuid        not null references public.profiles (id) on delete cascade,
  -- The request's Idempotency-Key, which is also the job id the client checks by.
  generation_id  uuid        not null,
  -- The runtime's scopeKey the request was made for (identity:home:revision).
  context_key    text        not null,
  status         text        not null,
  -- The ProjectGenerationResult as answered.
  idea_set       jsonb       not null,
  created_at     timestamptz not null default now(),
  primary key (profile_id, generation_id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'household_project_generations_status_check') then
    alter table public.household_project_generations add constraint household_project_generations_status_check
      check (status in ('completed', 'failed', 'cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'household_project_generations_context_check') then
    alter table public.household_project_generations add constraint household_project_generations_context_check
      check (char_length(context_key) between 1 and 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'household_project_generations_idea_set_check') then
    alter table public.household_project_generations add constraint household_project_generations_idea_set_check
      check (jsonb_typeof(idea_set) = 'object');
  end if;
  -- A backstop: fifteen guides and sixty evidence items are about 120 kB as
  -- JSON. jsonb prints up to 1.5 times longer as text.
  if not exists (select 1 from pg_constraint where conname = 'household_project_generations_size_check') then
    alter table public.household_project_generations add constraint household_project_generations_size_check
      check (octet_length(idea_set::text) <= 600000);
  end if;
end $$;

create index if not exists household_project_generations_owner_created
  on public.household_project_generations (profile_id, created_at desc, generation_id);

alter table public.household_project_generations enable row level security;

-- No policy, deliberately: every read and write goes through a route handler
-- using the service role after it has verified the token.
revoke all on table public.household_project_generations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The functions
-- ---------------------------------------------------------------------------
-- p_profile_id is trusted: only the service role may call these, and the
-- routes pass the verified session's user id. A row is answered as
-- {generationId, contextKey, status, result, createdAt}.

create or replace function public.project_generation_json(r public.household_project_generations)
returns jsonb
language sql
immutable
security invoker
set search_path = public
as $$
  select jsonb_build_object('generationId', r.generation_id, 'contextKey', r.context_key, 'status', r.status,
                            'result', r.idea_set, 'createdAt', r.created_at);
$$;

revoke execute on function public.project_generation_json(public.household_project_generations) from public, anon, authenticated;
grant execute on function public.project_generation_json(public.household_project_generations) to service_role;

-- Records one request's answer, unless the household already has a row for
-- this id (a repeat, or a cancellation that arrived first): then that row is
-- kept and returned. Returns {inserted, row}. Then keeps the household's
-- newest 20 rows and its newest completed row (Ruling J9).
create or replace function public.record_project_generation(
  p_profile_id uuid, p_generation_id uuid, p_context_key text, p_status text, p_result jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.household_project_generations;
  v_inserted boolean := false;
begin
  if p_profile_id is null or p_generation_id is null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_profile_id and p_generation_id are required';
  end if;
  if p_status is null or p_status not in ('completed', 'failed', 'cancelled')
     or p_context_key is null or char_length(p_context_key) not between 1 and 500
     or p_result is null or jsonb_typeof(p_result) <> 'object' then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'status, context key or result is malformed';
  end if;

  insert into public.household_project_generations (profile_id, generation_id, context_key, status, idea_set)
  values (p_profile_id, p_generation_id, p_context_key, p_status, p_result)
  on conflict (profile_id, generation_id) do nothing
  returning * into v_row;
  v_inserted := found;
  if not v_inserted then
    select * into v_row from public.household_project_generations g
     where g.profile_id = p_profile_id and g.generation_id = p_generation_id;
  end if;

  delete from public.household_project_generations g
   where g.profile_id = p_profile_id
     and g.generation_id not in (
       select k.generation_id from public.household_project_generations k
        where k.profile_id = p_profile_id
        order by k.created_at desc, k.generation_id desc
        limit 20)
     and g.generation_id is distinct from (
       select c.generation_id from public.household_project_generations c
        where c.profile_id = p_profile_id and c.status = 'completed'
        order by c.created_at desc, c.generation_id desc
        limit 1);

  return jsonb_build_object('inserted', v_inserted, 'row', public.project_generation_json(v_row));
end;
$$;

revoke execute on function public.record_project_generation(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_project_generation(uuid, uuid, text, text, jsonb) to service_role;

-- One row by its id, or null.
create or replace function public.read_project_generation(p_profile_id uuid, p_generation_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if p_profile_id is null or p_generation_id is null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_profile_id and p_generation_id are required';
  end if;
  return (select public.project_generation_json(g) from public.household_project_generations g
           where g.profile_id = p_profile_id and g.generation_id = p_generation_id);
end;
$$;

revoke execute on function public.read_project_generation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.read_project_generation(uuid, uuid) to service_role;

-- The household's newest completed row, or null.
create or replace function public.read_current_project_generation(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if p_profile_id is null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_profile_id is required';
  end if;
  return (select public.project_generation_json(g) from public.household_project_generations g
           where g.profile_id = p_profile_id and g.status = 'completed'
           order by g.created_at desc, g.generation_id desc
           limit 1);
end;
$$;

revoke execute on function public.read_current_project_generation(uuid) from public, anon, authenticated;
grant execute on function public.read_current_project_generation(uuid) to service_role;

-- What a clear all would remove, for the privacy review's counts
-- (lib/privacyStore.js merges it into privacy_counts' answer).
create or replace function public.project_privacy_counts(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if p_profile_id is null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_profile_id is required';
  end if;
  return jsonb_build_object('household_project_generations',
    (select count(*) from public.household_project_generations g where g.profile_id = p_profile_id));
end;
$$;

revoke execute on function public.project_privacy_counts(uuid) from public, anon, authenticated;
grant execute on function public.project_privacy_counts(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Clear all removes every idea set (the 0026 pattern)
-- ---------------------------------------------------------------------------

create or replace function public.clear_project_generations_with_privacy_clear()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.household_project_generations g where g.profile_id = new.profile_id;
  return null;
end;
$$;

revoke execute on function public.clear_project_generations_with_privacy_clear() from public, anon, authenticated;

create or replace trigger operations_privacy_clear_project_generations
  after update on public.operations
  for each row
  when (new.domain = 'privacy' and new.kind = 'privacy.clear.all' and old.status = 'pending'
        and new.status = 'succeeded' and new.profile_id is not null)
  execute function public.clear_project_generations_with_privacy_clear();

-- ---------------------------------------------------------------------------
-- Verification (read only). Expect one row, all six columns true.
-- ---------------------------------------------------------------------------
--   select
--     (select relrowsecurity from pg_class where oid = 'public.household_project_generations'::regclass) as rls_on,
--     (select count(*) from pg_policies
--       where schemaname = 'public' and tablename = 'household_project_generations') = 0
--       as no_policies,
--     not exists (
--       select 1 from unnest(array['anon', 'authenticated']) as r
--        where has_any_column_privilege(r, 'public.household_project_generations', 'SELECT')
--           or has_any_column_privilege(r, 'public.household_project_generations', 'INSERT')
--           or has_any_column_privilege(r, 'public.household_project_generations', 'UPDATE')
--           or has_table_privilege(r, 'public.household_project_generations', 'DELETE'))
--       as no_client_access,
--     not exists (
--       select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--        cross join unnest(array['anon', 'authenticated']) as r
--        where n.nspname = 'public' and has_function_privilege(r, p.oid, 'EXECUTE')
--          and p.proname in ('project_generation_json', 'record_project_generation', 'read_project_generation',
--                            'read_current_project_generation', 'project_privacy_counts',
--                            'clear_project_generations_with_privacy_clear'))
--       as functions_not_client,
--     (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and not p.prosecdef and 'search_path=public' = any (p.proconfig)
--         and p.proname in ('project_generation_json', 'record_project_generation', 'read_project_generation',
--                           'read_current_project_generation', 'project_privacy_counts',
--                           'clear_project_generations_with_privacy_clear')) = 6
--       as functions_invoker_pinned,
--     (select count(*) from pg_trigger
--       where tgrelid = 'public.operations'::regclass
--         and tgname = 'operations_privacy_clear_project_generations') = 1
--       as trigger_on;
--
-- ---------------------------------------------------------------------------
-- If you need to back out 0030
-- ---------------------------------------------------------------------------
-- The B16 routes go back to answering "unavailable", exactly as before this
-- is applied. What is lost: every household's saved idea sets, for good,
-- because the table is dropped. Projects a household started are workspace
-- records (0026) and are not touched; ledger rows in domains 'projects' and
-- 'workspace' stay, holding ids and statuses only.
--
-- The tested copy of this block is this one: test/projectsSchema.test.mjs
-- runs it.
--
-- <!-- backout-0030 -->
-- drop trigger if exists operations_privacy_clear_project_generations on public.operations;
-- drop function if exists public.clear_project_generations_with_privacy_clear();
-- drop function if exists public.project_privacy_counts(uuid);
-- drop function if exists public.read_current_project_generation(uuid);
-- drop function if exists public.read_project_generation(uuid, uuid);
-- drop function if exists public.record_project_generation(uuid, uuid, text, text, jsonb);
-- drop function if exists public.project_generation_json(public.household_project_generations);
-- drop table if exists public.household_project_generations;
--
-- Then run: notify pgrst, 'reload schema';
