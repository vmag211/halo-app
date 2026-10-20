-- HALO: the Homeguard workspace, a household's own records in the shared
-- collections (tests and results, home care, kitchen, fish notes, gardens,
-- usage, grower inquiries and the Explore notes, outcomes, projects and
-- engagements), with one read function and one atomic commit function (B11
-- plan, docs/backend/plans/b11-homeguard-workspace.md, Rulings W5 to W12).
--
-- Run once in the Supabase SQL editor, AFTER 0017 (the ledger) and 0016 (home
-- contexts). It does not need 0023, 0024 or 0025 and may go before or after
-- any of them. Safe to re-run.
--
-- Locks: creates one new table and one index, which no other statement can be
-- waiting on. The foreign key to profiles takes a brief SHARE ROW EXCLUSIVE on
-- profiles as it is created, so a new anonymous sign-up could wait a moment.
-- It also adds two triggers to public.operations (sections 4 and 5), each
-- taking a brief SHARE ROW EXCLUSIVE on that table: every ledger claim and
-- settle waits for that moment. Nothing existing is read or rewritten.
--
-- WHAT THIS IS FOR. Homeguard (`/home`) and Explore load each owned
-- collection with `workspace.load` and change it with `workspace.execute`
-- (the frontend's runtime.ts:22-23). Nothing on the server could hold these
-- records. Every record is stored exactly as the client's own row check
-- (lib/frontend/production/home-records.ts, transcribed in
-- lib/workspaceRecords.js) accepted it, as one jsonb value, because the
-- client discards a whole collection for one row it does not recognise and
-- keeps unknown future fields (home-records.ts:20). `id` and `revision` are
-- columns: the server assigns the revision, and the read function writes both
-- over the stored value, so a stored record can never disagree with them.
--
-- ONE COMMIT, ONE TRANSACTION (Ruling W12, the 0023 pattern). The route
-- validates the command and the resulting records in JavaScript and then
-- calls public.commit_household_workspace. A function call is one statement,
-- so every reference check, every delete and upsert at its expected revision,
-- the settle of the caller's own ledger row, and the read of the touched
-- collections commit together or none of them does:
--
--   1. The profile, FOR KEY SHARE, as every writer of a household takes it
--      first (0024's lock order), then the caller's own ledger row, locked,
--      this household's, domain 'workspace', still 'pending'. Otherwise
--      HALO_OPERATION_NOT_PENDING.
--   2. Every reference the command adds names a row this household owns
--      (Ruling W10), held FOR KEY SHARE until the commit. Otherwise
--      HALO_INVALID_REFERENCE.
--   3. Deletes, then upserts, every statement scoped to p_profile_id. A
--      delete or update at a revision that is not the stored one, or a create
--      of an id that exists, is HALO_STALE_REVISION.
--   4. Each touched collection stays within its limits (Ruling W7), or
--      HALO_LIMIT.
--   5. The ledger row is settled 'succeeded' with a receipt of collection
--      names, ids and revisions only, never record content.
--   6. It returns {receipt, changes}: every row of each touched collection.
--
-- So a workspace write exists if and only if its operation is 'succeeded'.
-- The reaper in lib/operations.js settles an abandoned row with a conditional
-- `update ... where status = 'pending'`, and step 1 locks the same row under
-- the same condition, so a reaped row can never become 'succeeded' and a
-- committed write can never be reaped.
--
-- Errors the functions raise, for the routes to map. Each is SQLSTATE P0001
-- with exactly this message; DETAIL says more and never holds record content:
--   HALO_INVALID_INPUT          an argument or p_writes is malformed
--   HALO_OPERATION_NOT_PENDING  the ledger row is missing, settled, another
--                               household's or another domain's
--   HALO_INVALID_REFERENCE      a referenced record or home is not this household's
--   HALO_STALE_REVISION         a record is not there at the revision expected,
--                               or a created id already exists
--   HALO_LIMIT                  a collection would exceed its limits
--   HALO_OPERATION_SETTLED      section 4: a settled 'workspace' row's status may
--                               not change
--
-- Degrades cleanly: until this is applied the B11 routes answer a
-- non-retryable 503 feature_unavailable (a missing function is PGRST202 or
-- 42883, a missing table PGRST205 or 42P01). Nothing else reads this table.
--
-- DELETION. profile_id references profiles ON DELETE CASCADE, so deleting the
-- account deletes every record. A privacy clear all (0024) resets the profile
-- instead of deleting it, so the cascade does not fire there: section 5's
-- trigger deletes the household's rows when that clear settles its own ledger
-- row, inside the clear's transaction (Ruling W8). Clear Journal keeps this
-- table: the week journal is not stored (Ruling W2).
--
-- Retention: rows are kept until the household deletes the record, clears
-- all, or deletes the account. No purge job is defined here on purpose, and no
-- period is invented: the workspace stays behind the `workspace` server flag,
-- off by default, until Vibhav confirms its retention (Ruling W1).
--
-- Privacy: the service role is the only reader. Row level security is on with
-- no policy at all and the default privileges are revoked, so not even the
-- owner can read their own records with their own session.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------

create table if not exists public.household_workspace_records (
  -- The owner, from the verified session only.
  profile_id  uuid        not null references public.profiles (id) on delete cascade,
  -- One of the fourteen stored collections (home-service.ts; HomeWorkspaceState.tsx:36
  -- less weekJournal and homeTransitions, Rulings W2 and W3).
  collection  text        not null,
  -- HomeServiceRecord.id, app-generated on the device (`test-<uuid>`,
  -- `food-question-...`). Unique per household and collection.
  record_id   text        not null,
  -- A positive integer assigned by the server: 1 on create, + 1 on update.
  revision    integer     not null default 1,
  -- The record as the client's row check accepted it. `id` and `revision` in
  -- it are overwritten by the columns on every read.
  record      jsonb       not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (profile_id, collection, record_id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'household_workspace_records_collection_check') then
    alter table public.household_workspace_records add constraint household_workspace_records_collection_check
      check (collection in ('tests', 'assets', 'observations', 'gardens', 'usage', 'pantryItems', 'foodQuestions',
                            'fishNotes', 'foodFollows', 'growerInquiries', 'exploreNotes', 'exploreOutcomes',
                            'exploreProjects', 'exploreEngagements'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'household_workspace_records_id_check') then
    alter table public.household_workspace_records add constraint household_workspace_records_id_check
      check (char_length(record_id) between 1 and 200);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'household_workspace_records_revision_check') then
    alter table public.household_workspace_records add constraint household_workspace_records_revision_check
      check (revision >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'household_workspace_records_record_check') then
    alter table public.household_workspace_records add constraint household_workspace_records_record_check
      check (jsonb_typeof(record) = 'object');
  end if;
  -- A backstop for Ruling W7's 262,144-byte record, which the route checks
  -- first on the JSON it received.
  if not exists (select 1 from pg_constraint where conname = 'household_workspace_records_size_check') then
    alter table public.household_workspace_records add constraint household_workspace_records_size_check
      check (octet_length(record::text) <= 300000);
  end if;
end $$;

-- A collection's order: oldest first, the id breaking a tie.
create index if not exists household_workspace_records_owner_created
  on public.household_workspace_records (profile_id, collection, created_at, record_id);

alter table public.household_workspace_records enable row level security;

-- No policy, deliberately: every read and write goes through a route handler
-- using the service role after it has verified the token. Supabase's default
-- privileges would otherwise grant anon and authenticated arwdDxtm on a new
-- public table, so revoking here is what actually closes that.
revoke all on table public.household_workspace_records from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. read_household_workspace: the collections, one consistent read
-- ---------------------------------------------------------------------------
-- p_profile_id is trusted: only the service role may call this, and the routes
-- pass the verified session's user id. Returns {<collection>: [record, ...]}
-- with every requested collection present ([] when it has no rows), oldest
-- first. One statement, so not truncated by PostgREST's max_rows.

create or replace function public.read_household_workspace(p_profile_id uuid, p_collections text[])
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
  if p_collections is null or cardinality(p_collections) = 0 or cardinality(p_collections) > 16 then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_collections must name 1 to 16 collections';
  end if;
  return (
    select coalesce(jsonb_object_agg(c.name, coalesce((
             select jsonb_agg(r.record || jsonb_build_object('id', r.record_id, 'revision', r.revision)
                              order by r.created_at, r.record_id)
               from public.household_workspace_records r
              where r.profile_id = p_profile_id and r.collection = c.name), '[]'::jsonb)), '{}'::jsonb)
      from (select distinct unnest(p_collections) as name) c
  );
end;
$$;

revoke execute on function public.read_household_workspace(uuid, text[]) from public, anon, authenticated;
grant execute on function public.read_household_workspace(uuid, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- 3. commit_household_workspace: the atomic write
-- ---------------------------------------------------------------------------
-- p_operation_id is the caller's own ledger row, already claimed by
-- runOperation. p_writes is the route's plan (lib/workspaceStore.js,
-- planWorkspaceCommand), exactly these keys, each optional except collections:
--
--   upserts       [{collection, id, expectedRevision, record}]
--                 expectedRevision null creates (the id must not exist);
--                 a number updates at exactly that stored revision
--   deletes       [{collection, id, expectedRevision}]
--                 a number deletes at exactly that revision; null is a linked
--                 delete (Ruling W11) of a row that may not exist
--   references    [{collection, id}] rows that must be this household's
--   homeContexts  [text] home context ids that must be this household's
--   contexts      [text] ids that must be this household's home context or garden
--   collections   [text] the collections to return, every touched one included
--
-- A record id appears at most once across upserts and deletes per collection.
-- Nothing is written for any refusal.

create or replace function public.commit_household_workspace(
  p_profile_id    uuid,
  p_operation_id  uuid,
  p_writes        jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  stored_collections constant text[] := array['tests', 'assets', 'observations', 'gardens', 'usage', 'pantryItems',
    'foodQuestions', 'fishNotes', 'foodFollows', 'growerInquiries', 'exploreNotes', 'exploreOutcomes',
    'exploreProjects', 'exploreEngagements'];
  write_keys   constant text[] := array['collections', 'contexts', 'deletes', 'homeContexts', 'references', 'upserts'];
  w_upserts     jsonb;
  w_deletes     jsonb;
  w_references  jsonb;
  w_homes       jsonb;
  w_contexts    jsonb;
  w_collections text[];
  item          jsonb;
  bad           text;
  touched       int;
  expected_rev  numeric;
  receipt       jsonb;
  stamp         timestamptz := clock_timestamp();
  at            int := 0;
begin
  -- Arguments first: nothing is read or written for a malformed call.
  if p_profile_id is null or p_operation_id is null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_profile_id and p_operation_id are required';
  end if;
  if p_writes is null or jsonb_typeof(p_writes) <> 'object' then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_writes must be a JSON object';
  end if;
  select string_agg(k, ', ' order by k) into bad from jsonb_object_keys(p_writes) k where k <> all (write_keys);
  if bad is not null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('p_writes has unknown keys: %s', bad);
  end if;
  w_upserts    := coalesce(p_writes -> 'upserts', '[]'::jsonb);
  w_deletes    := coalesce(p_writes -> 'deletes', '[]'::jsonb);
  w_references := coalesce(p_writes -> 'references', '[]'::jsonb);
  w_homes      := coalesce(p_writes -> 'homeContexts', '[]'::jsonb);
  w_contexts   := coalesce(p_writes -> 'contexts', '[]'::jsonb);
  if jsonb_typeof(w_upserts) <> 'array' or jsonb_typeof(w_deletes) <> 'array' or jsonb_typeof(w_references) <> 'array'
     or jsonb_typeof(w_homes) <> 'array' or jsonb_typeof(w_contexts) <> 'array'
     or jsonb_typeof(p_writes -> 'collections') is distinct from 'array' then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'every p_writes value must be an array';
  end if;
  if exists (select 1 from jsonb_array_elements(p_writes -> 'collections') e
              where jsonb_typeof(e) <> 'string' or (e #>> '{}') <> all (stored_collections)) then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'collections must name stored collections';
  end if;
  select array_agg(distinct e #>> '{}') into w_collections from jsonb_array_elements(p_writes -> 'collections') e;
  if w_collections is null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'collections must not be empty';
  end if;

  for item in select value from jsonb_array_elements(w_upserts) loop
    if jsonb_typeof(item) <> 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(item) k) is distinct from array['collection', 'expectedRevision', 'id', 'record'] then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('upserts[%s] must have exactly collection, expectedRevision, id and record', at);
    end if;
    if jsonb_typeof(item -> 'record') <> 'object' or jsonb_typeof(item -> 'id') <> 'string'
       or jsonb_typeof(item -> 'collection') <> 'string' or jsonb_typeof(item -> 'expectedRevision') not in ('number', 'null') then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('upserts[%s] has a value of the wrong type', at);
    end if;
    at := at + 1;
  end loop;
  at := 0;
  for item in select value from jsonb_array_elements(w_deletes) loop
    if jsonb_typeof(item) <> 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(item) k) is distinct from array['collection', 'expectedRevision', 'id']
       or jsonb_typeof(item -> 'id') <> 'string' or jsonb_typeof(item -> 'collection') <> 'string'
       or jsonb_typeof(item -> 'expectedRevision') not in ('number', 'null') then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('deletes[%s] must have exactly collection, expectedRevision and id', at);
    end if;
    at := at + 1;
  end loop;
  if exists (select 1 from (select value as e from jsonb_array_elements(w_upserts) union all select value from jsonb_array_elements(w_deletes)) w
              where (w.e ->> 'collection') <> all (w_collections)) then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'every written collection must be listed in collections';
  end if;
  if exists (select 1 from (select value as e from jsonb_array_elements(w_upserts) union all select value from jsonb_array_elements(w_deletes)) w
              where jsonb_typeof(w.e -> 'expectedRevision') = 'number'
                and ((w.e ->> 'expectedRevision')::numeric < 1 or (w.e ->> 'expectedRevision')::numeric <> trunc((w.e ->> 'expectedRevision')::numeric)
                     or (w.e ->> 'expectedRevision')::numeric >= 2147483647)) then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'an expectedRevision must be a whole number from 1';
  end if;
  if exists (select 1 from (select value as e from jsonb_array_elements(w_upserts) union all select value from jsonb_array_elements(w_deletes)) w
              group by w.e ->> 'collection', w.e ->> 'id' having count(*) > 1) then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'a record appears more than once';
  end if;
  if exists (select 1 from jsonb_array_elements(w_references) e
              where jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'id') <> 'string' or jsonb_typeof(e -> 'collection') <> 'string')
     or exists (select 1 from jsonb_array_elements(w_homes) e where jsonb_typeof(e) <> 'string')
     or exists (select 1 from jsonb_array_elements(w_contexts) e where jsonb_typeof(e) <> 'string') then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'references, homeContexts and contexts are malformed';
  end if;

  -- 1. The profile, then this operation's own ledger row.
  perform 1 from public.profiles p where p.id = p_profile_id for key share;
  perform 1 from public.operations o
   where o.operation_id = p_operation_id and o.profile_id = p_profile_id
     and o.domain = 'workspace' and o.status = 'pending'
     for update;
  if not found then
    raise exception 'HALO_OPERATION_NOT_PENDING' using errcode = 'P0001';
  end if;

  -- 2. References (Ruling W10). Another household's id is simply not found.
  --    Compared as text, so a value that is not a uuid is not found either.
  --    Locked first, so a concurrent delete waits for this commit.
  perform 1 from public.household_workspace_records r
   where r.profile_id = p_profile_id
     and (r.collection, r.record_id) in (select e ->> 'collection', e ->> 'id' from jsonb_array_elements(w_references) e)
     for key share;
  if exists (
    select 1 from jsonb_array_elements(w_references) e
     where not exists (select 1 from public.household_workspace_records r
                        where r.profile_id = p_profile_id and r.collection = e ->> 'collection' and r.record_id = e ->> 'id')
  ) then
    raise exception 'HALO_INVALID_REFERENCE' using errcode = 'P0001', detail = 'a referenced record is not this household''s';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(w_homes) h
     where not exists (select 1 from public.home_contexts c where c.profile_id = p_profile_id and c.id::text = h)
  ) then
    raise exception 'HALO_INVALID_REFERENCE' using errcode = 'P0001', detail = 'a home context is not this household''s';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(w_contexts) x
     where not exists (select 1 from public.home_contexts c where c.profile_id = p_profile_id and c.id::text = x)
       and not exists (select 1 from public.household_workspace_records r
                        where r.profile_id = p_profile_id and r.collection = 'gardens' and r.record_id = x)
  ) then
    raise exception 'HALO_INVALID_REFERENCE' using errcode = 'P0001', detail = 'a sample context is not this household''s';
  end if;

  -- 3. Deletes, then upserts.
  for item in select value from jsonb_array_elements(w_deletes) loop
    if jsonb_typeof(item -> 'expectedRevision') = 'null' then
      delete from public.household_workspace_records r
       where r.profile_id = p_profile_id and r.collection = item ->> 'collection' and r.record_id = item ->> 'id';
    else
      delete from public.household_workspace_records r
       where r.profile_id = p_profile_id and r.collection = item ->> 'collection' and r.record_id = item ->> 'id'
         and r.revision = (item ->> 'expectedRevision')::int;
      get diagnostics touched = row_count;
      if touched <> 1 then
        raise exception 'HALO_STALE_REVISION' using errcode = 'P0001', detail = 'a deleted record is not there at its expected revision';
      end if;
    end if;
  end loop;

  at := 0;
  for item in select value from jsonb_array_elements(w_upserts) loop
    if jsonb_typeof(item -> 'expectedRevision') = 'null' then
      insert into public.household_workspace_records (profile_id, collection, record_id, revision, record, created_at, updated_at)
      values (p_profile_id, item ->> 'collection', item ->> 'id', 1, item -> 'record',
              stamp + at * interval '1 microsecond', stamp)
      on conflict (profile_id, collection, record_id) do nothing;
    else
      expected_rev := (item ->> 'expectedRevision')::numeric;
      update public.household_workspace_records r
         set record = item -> 'record', revision = r.revision + 1, updated_at = now()
       where r.profile_id = p_profile_id and r.collection = item ->> 'collection' and r.record_id = item ->> 'id'
         and r.revision = expected_rev::int;
    end if;
    get diagnostics touched = row_count;
    if touched <> 1 then
      raise exception 'HALO_STALE_REVISION' using errcode = 'P0001', detail = 'a record is not there at its expected revision, or a created id exists';
    end if;
    at := at + 1;
  end loop;

  -- 4. Limits (Ruling W7), for every touched collection.
  if exists (
    select 1 from public.household_workspace_records r
     where r.profile_id = p_profile_id and r.collection = any (w_collections)
     group by r.collection
    having count(*) > 1000 or sum(octet_length(r.record::text)) > 1500000
  ) then
    raise exception 'HALO_LIMIT' using errcode = 'P0001', detail = 'a collection would exceed its record or size limit';
  end if;

  -- 5. Settle this operation's own row: names, ids and revisions only.
  receipt := jsonb_build_object(
    'status', 'succeeded',
    'collections', to_jsonb(w_collections),
    'affected', coalesce((
      select jsonb_agg(jsonb_build_object('collection', r.collection, 'id', r.record_id, 'revision', r.revision)
                       order by r.collection, r.record_id)
        from public.household_workspace_records r
       where r.profile_id = p_profile_id
         and (r.collection, r.record_id) in (select e ->> 'collection', e ->> 'id' from jsonb_array_elements(w_upserts) e)), '[]'::jsonb),
    'removed', coalesce((
      select jsonb_agg(jsonb_build_object('collection', e ->> 'collection', 'id', e ->> 'id'))
        from jsonb_array_elements(w_deletes) e), '[]'::jsonb),
    'unresolvedOperations', '[]'::jsonb
  );
  update public.operations o
     set status = 'succeeded', result = receipt, updated_at = now()
   where o.operation_id = p_operation_id and o.profile_id = p_profile_id
     and o.domain = 'workspace' and o.status = 'pending';
  get diagnostics touched = row_count;
  if touched <> 1 then
    raise exception 'HALO_OPERATION_NOT_PENDING' using errcode = 'P0001';
  end if;

  -- 6. The touched collections as they now stand, read in this transaction.
  return jsonb_build_object('receipt', receipt, 'changes', public.read_household_workspace(p_profile_id, w_collections));
end;
$$;

revoke execute on function public.commit_household_workspace(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.commit_household_workspace(uuid, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4. A settled 'workspace' operation keeps its status (the 0023 guard)
-- ---------------------------------------------------------------------------
-- runOperation settles by operation id alone and settles 'failed' whenever
-- its execute throws. If the commit function committed and its response was
-- lost, that settle would turn a 'succeeded' row whose records were written
-- into 'failed'. In the 'workspace' domain only, a row that has left
-- 'pending' may not change its status: the settle fails, lib/operations.js
-- logs it rather than throwing, and the row keeps telling the truth.

create or replace function public.guard_settled_workspace_operation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'HALO_OPERATION_SETTLED' using errcode = 'P0001',
    detail = format('operation %s is already %s', old.operation_id, old.status);
end;
$$;

revoke execute on function public.guard_settled_workspace_operation() from public, anon, authenticated;

create or replace trigger operations_workspace_settled_guard
  before update on public.operations
  for each row
  when (old.domain = 'workspace' and old.status <> 'pending' and new.status is distinct from old.status)
  execute function public.guard_settled_workspace_operation();

-- ---------------------------------------------------------------------------
-- 5. Clear all removes the workspace too (Ruling W8)
-- ---------------------------------------------------------------------------
-- 0024's clear_household_records settles its own 'privacy.clear.all' row
-- from 'pending' to 'succeeded' as its last write, in its own transaction.
-- This trigger deletes the same household's workspace rows at that moment,
-- so they go with the clear or not at all, without changing 0024. A clear
-- that refuses raises before it settles, so it deletes nothing here. Clear
-- Journal ('privacy.clear.journal') does not touch the workspace.

create or replace function public.clear_workspace_with_privacy_clear()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.household_workspace_records r where r.profile_id = new.profile_id;
  return null;
end;
$$;

revoke execute on function public.clear_workspace_with_privacy_clear() from public, anon, authenticated;

create or replace trigger operations_privacy_clear_workspace
  after update on public.operations
  for each row
  when (new.domain = 'privacy' and new.kind = 'privacy.clear.all' and old.status = 'pending'
        and new.status = 'succeeded' and new.profile_id is not null)
  execute function public.clear_workspace_with_privacy_clear();

-- What a clear all would remove from the workspace, for the privacy review's
-- counts (lib/privacyStore.js merges it into privacy_counts' answer).
create or replace function public.workspace_privacy_counts(p_profile_id uuid)
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
  return jsonb_build_object('household_workspace_records',
    (select count(*) from public.household_workspace_records r where r.profile_id = p_profile_id));
end;
$$;

revoke execute on function public.workspace_privacy_counts(uuid) from public, anon, authenticated;
grant execute on function public.workspace_privacy_counts(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Verification (read only). Expect one row, all seven columns true.
-- ---------------------------------------------------------------------------
--   select
--     (select relrowsecurity from pg_class where oid = 'public.household_workspace_records'::regclass) as rls_on,
--     (select count(*) from pg_policies
--       where schemaname = 'public' and tablename = 'household_workspace_records') = 0
--       as no_policies,
--     not exists (
--       select 1 from unnest(array['anon', 'authenticated']) as r
--        where has_any_column_privilege(r, 'public.household_workspace_records', 'SELECT')
--           or has_any_column_privilege(r, 'public.household_workspace_records', 'INSERT')
--           or has_any_column_privilege(r, 'public.household_workspace_records', 'UPDATE')
--           or has_table_privilege(r, 'public.household_workspace_records', 'DELETE'))
--       as no_client_access,
--     not exists (
--       select 1 from unnest(array['anon', 'authenticated']) as r
--        cross join unnest(array['public.read_household_workspace(uuid, text[])',
--                                'public.commit_household_workspace(uuid, uuid, jsonb)',
--                                'public.workspace_privacy_counts(uuid)',
--                                'public.guard_settled_workspace_operation()',
--                                'public.clear_workspace_with_privacy_clear()']) as f
--        where has_function_privilege(r, f, 'EXECUTE'))
--       and (select bool_and(has_function_privilege('service_role', f, 'EXECUTE'))
--              from unnest(array['public.read_household_workspace(uuid, text[])',
--                                'public.commit_household_workspace(uuid, uuid, jsonb)',
--                                'public.workspace_privacy_counts(uuid)']) as f)
--       as functions_service_role_only,
--     (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and not p.prosecdef and 'search_path=public' = any (p.proconfig)
--         and p.proname in ('read_household_workspace', 'commit_household_workspace', 'workspace_privacy_counts',
--                           'guard_settled_workspace_operation', 'clear_workspace_with_privacy_clear')) = 5
--       as functions_invoker_pinned,
--     (select count(*) from pg_trigger
--       where tgrelid = 'public.operations'::regclass
--         and tgname in ('operations_workspace_settled_guard', 'operations_privacy_clear_workspace')) = 2
--       as triggers_on,
--     (select count(*) from pg_constraint
--       where conrelid = 'public.household_workspace_records'::regclass and contype = 'c') = 5
--       as five_checks;
--
-- ---------------------------------------------------------------------------
-- If you need to back out 0026
-- ---------------------------------------------------------------------------
-- The B11 routes go back to answering a non-retryable 503
-- feature_unavailable, exactly as before this is applied, so backing out
-- disables the workspace rather than breaking the existing app.
--
-- What is lost: every household's workspace records, for good, because the
-- table is dropped. Ledger rows in domain 'workspace' stay in
-- public.operations; they hold collection names, record ids, revisions and
-- statuses only. The two triggers go too, so those rows are ordinary ledger
-- rows again and clear all no longer has a workspace to delete. Nothing else
-- references this table, and 0016 to 0025 are untouched.
--
-- The tested copy of this block is in docs/backend/YOUR_TODO.md, which is what
-- test/migrationBackout.test.mjs runs.
--
-- <!-- backout-0026 -->
-- drop trigger if exists operations_privacy_clear_workspace on public.operations;
-- drop trigger if exists operations_workspace_settled_guard on public.operations;
-- drop function if exists public.clear_workspace_with_privacy_clear();
-- drop function if exists public.guard_settled_workspace_operation();
-- drop function if exists public.workspace_privacy_counts(uuid);
-- drop function if exists public.commit_household_workspace(uuid, uuid, jsonb);
-- drop function if exists public.read_household_workspace(uuid, text[]);
-- drop table if exists public.household_workspace_records;
--
-- Then run: notify pgrst, 'reload schema';
