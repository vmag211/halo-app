-- HALO: a household's tasks, their planning details and task preferences,
-- with one read function and one atomic commit function (B06 plan, Task 1,
-- Rulings H2, H3, H6, H8, H9 and H10).
--
-- Run once in the Supabase SQL editor, AFTER 0022. Safe to re-run.
--
-- Locks: creates three new tables and one index, which no other statement can
-- be waiting on. The foreign keys to profiles take a brief SHARE ROW EXCLUSIVE
-- on profiles as they are created, so a new anonymous sign-up could wait a
-- moment. It also adds one trigger to public.operations (section 4), which
-- takes a brief SHARE ROW EXCLUSIVE on that table: every ledger claim and
-- settle waits for that moment. Nothing existing is read or rewritten.
--
-- WHAT THIS IS FOR. My Week (`/app`, `/plan`) loads a household's tasks with
-- `actions.load` and changes them with `actions.commit` (the frontend's
-- runtime.ts:29-30). Nothing on the server could hold a task, its per-task
-- revision, its planning details or the six task preferences, and
-- public.operations is a receipt, never record content (0017). Every column
-- below is derived from the contract digest
-- (.superpowers/sdd/b06-home-actions-week/contract-digest.md, sections 3.1 and
-- 7.1 to 7.5), cited inline. The household version is the one internal
-- addition, and it is never emitted (Ruling H10).
--
-- TASKS BELONG TO THE HOUSEHOLD, NOT TO A HOME (Ruling H2). Every table is
-- keyed by profile_id, there is no home context column, and a task key is
-- unique per household. The key can be widened later without moving data
-- (B06 Open question 2).
--
-- ONE READ, ONE SNAPSHOT (Ruling H9). public.read_household_actions builds
-- `{version, actions, metas, preferences}` as one jsonb value in one
-- statement, so it is one consistent snapshot and is not truncated by
-- PostgREST's max_rows the way a plain select of more than 1,000 tasks would
-- be. Every action object is exactly {id, key, title, reason, origin, date,
-- state, revision}, with `date` formatted by to_char (never through DateStyle)
-- and '' for no date, so the client's add-of-an-existing-key comparison sees
-- identical key sets on every read. `version` is internal and the routes
-- strip it.
--
-- ONE COMMIT, ONE TRANSACTION (Rulings H6, H8, H10). The routes work out the
-- change in JavaScript (lib/actionRules.js), validate the whole resulting
-- snapshot with the client's own rules, and then call
-- public.commit_household_actions with the version they read. A function call
-- is one statement, so the version advance, every task insert, update and
-- delete, every meta and every preference, and the settle of the caller's own
-- ledger row all commit together or none of them does:
--
--   1. The caller's own ledger row is locked, and must be this household's,
--      in domain 'actions', still 'pending'. Otherwise HALO_OPERATION_NOT_PENDING.
--   2. The household version advances from p_base_version, or HALO_STALE_BASE.
--      This is what serializes two commits of one household: per-task
--      revisions cannot, because a meta changes without its task's revision
--      moving, so two commits could each validate half of a pair neither
--      validated (Ruling H10, finding F5).
--   3. The writes are applied, every statement scoped to p_profile_id.
--   4. The ledger row is settled 'succeeded' with a receipt of ids and
--      revisions only, never record content (Ruling H3).
--   5. It returns {receipt, snapshot}, the snapshot read after the writes.
--
-- So a task write exists if and only if its operation is 'succeeded' (Ruling
-- H8). The reaper in lib/operations.js settles an abandoned row with a
-- conditional `update ... where status = 'pending'`, and step 1 here locks the
-- same row under the same condition: whichever commits first wins and the
-- other finds nothing to do, so a reaped row can never become 'succeeded', and
-- a committed task can never be reaped. runOperation's own settle afterwards
-- rewrites the same receipt with operationId added, which section 4 allows.
--
-- Errors the functions raise, for the routes to map. Each is SQLSTATE P0001
-- with exactly this message; DETAIL says more:
--   HALO_INVALID_INPUT          an argument or p_writes is malformed (DETAIL names it)
--   HALO_OPERATION_NOT_PENDING  the ledger row is missing, settled, another
--                               household's or another domain's (all the same error)
--   HALO_STALE_BASE             the household version moved since it was read,
--                               or a write named a row that is not there at the
--                               revision it expected. The route recomputes from
--                               a fresh read (at most three attempts)
--   HALO_OPERATION_SETTLED      section 4: a settled 'actions' row's status may
--                               not change
-- A CHECK violation (23514) or a duplicate key (23505) inside the commit is
-- Postgres's own error, and it too leaves nothing applied and the ledger row
-- still 'pending'.
--
-- Degrades cleanly: until this is applied the B06 routes answer a
-- non-retryable 503 feature_unavailable (a missing function is PGRST202 or
-- 42883, a missing table PGRST205 or 42P01, as lib/homeContextRpc.js reads
-- them). Nothing else reads these tables.
--
-- Retention: rows are kept until the owner is deleted (ON DELETE CASCADE) or
-- the household deletes the task. No purge job is defined here on purpose,
-- and no period is invented: retention for tasks, their planning details and
-- task preferences is UNDECIDED and listed as such in
-- docs/backend/privacy-and-retention.md. A task is free text a person typed,
-- so the capability stays behind a server flag that is off until Vibhav
-- approves a retention period (Ruling H1; confirmed by him on 2026-10-18).
--
-- Privacy: the service role is the only reader. Row level security is on with
-- no policy at all and the default privileges are revoked, so not even the
-- owner can read their own tasks with their own session; they come back
-- through GET /api/frontend/actions, which reads them with the service role
-- after verifying the token.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table if not exists public.household_actions (
  -- PreviewAction.id. Server-assigned: the route generates it in JavaScript
  -- before the commit (lib/actionRules.js), so the planned snapshot and the
  -- stored one carry the same id (digest 7.1).
  id          uuid        primary key default gen_random_uuid(),
  -- The owner, from the verified session only (BE-199, Ruling H2).
  profile_id  uuid        not null references public.profiles (id) on delete cascade,
  -- PreviewAction.key, client-supplied in `seeds`; unique per household
  -- (dedupe by key, digest 7.1).
  action_key  text        not null,
  -- Trimmed by the route with JavaScript's own trim, 1 to 160 (digest 7.1).
  title       text        not null,
  -- Any string; the contract sets no cap (digest 7.1, Ruling H23).
  reason      text        not null,
  origin      text        not null,
  -- PreviewAction.date: '' or an ISO calendar date, never a UTC instant. Null
  -- is read back as '' (digest 7.1).
  due_date    date,
  -- saved, waiting or completed: the client's three, not the spec's seven
  -- (digest 8 C5, trap T15).
  state       text        not null,
  -- An integer at least 1, advanced by the server on every changed task
  -- (digest 7.1). A meta change alone does not move it.
  revision    integer     not null default 1,
  -- The task's WeekMeta exactly as sent, unknown keys included, or null for
  -- none (digest 7.2, Ruling H13). One nullable column on the task row, so a
  -- meta exists only for an existing task and goes with it.
  meta        jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (profile_id, action_key)
);

create table if not exists public.household_action_preferences (
  profile_id  uuid        not null references public.profiles (id) on delete cascade,
  -- One of the six keys of digest 2.2.3, validated by validActionPreferences
  -- before it is written (Ruling H15). Not merged into 0021's
  -- profile_preferences: the contract keeps them apart (digest 7.3).
  pref_key    text        not null,
  value       jsonb       not null,
  updated_at  timestamptz not null default now(),
  primary key (profile_id, pref_key)
);

create table if not exists public.household_action_state (
  profile_id  uuid        primary key references public.profiles (id) on delete cascade,
  -- Internal, never emitted (Ruling H10). No row reads as version 0; the
  -- first commit writes 1, so a stored 0 is refused below.
  version     bigint      not null,
  updated_at  timestamptz not null default now()
);

-- Each check is added separately and idempotently, so re-running is safe and a
-- partially applied earlier run is completed rather than erroring. They are
-- backstops: the route validates first with the client's own rules, and a value
-- outside them would make the client discard the whole snapshot (trap T5).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'household_actions_state_check') then
    alter table public.household_actions add constraint household_actions_state_check
      check (state in ('saved', 'waiting', 'completed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'household_actions_revision_check') then
    alter table public.household_actions add constraint household_actions_revision_check
      check (revision >= 1);
  end if;
  -- char_length counts code points; the client counts UTF-16 units, which are
  -- never fewer, so this is never tighter than the client (finding F3).
  if not exists (select 1 from pg_constraint where conname = 'household_actions_title_check') then
    alter table public.household_actions add constraint household_actions_title_check
      check (char_length(title) between 1 and 160);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'household_actions_key_check') then
    alter table public.household_actions add constraint household_actions_key_check
      check (char_length(action_key) >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'household_actions_meta_check') then
    alter table public.household_actions add constraint household_actions_meta_check
      check (meta is null or jsonb_typeof(meta) = 'object');
  end if;
  -- The note is at most 3,000 characters (actionMetadataError,
  -- action-service.ts:29). A backstop like the title's (Ruling H23):
  -- char_length counts code points, never more than the client's UTF-16
  -- units, so it is never tighter (finding F3). A meta with no note, or a
  -- note that is not a string, is the planner's to refuse, not this check's.
  if not exists (select 1 from pg_constraint where conname = 'household_actions_note_check') then
    alter table public.household_actions add constraint household_actions_note_check
      check (meta is null or jsonb_typeof(meta -> 'note') is distinct from 'string'
             or char_length(meta ->> 'note') <= 3000);
  end if;
  -- The read function formats the date as YYYY-MM-DD, which only round-trips
  -- for years 1 to 9999; anything else would read back as a date the client
  -- rejects (validActionDate takes a four-digit year).
  if not exists (select 1 from pg_constraint where conname = 'household_actions_due_date_check') then
    alter table public.household_actions add constraint household_actions_due_date_check
      check (due_date between date '0001-01-01' and date '9999-12-31');
  end if;
  -- validActionPreferences rejects any other key, and `null` for any key, so
  -- no preference can be deleted (digest 2.2.3).
  if not exists (select 1 from pg_constraint where conname = 'household_action_preferences_key_check') then
    alter table public.household_action_preferences add constraint household_action_preferences_key_check
      check (pref_key in ('week:focus', 'food-interests', 'week:availability',
                          'week:season-dismissals', 'week:review-preferences', 'outdoorPlan'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'household_action_preferences_value_check') then
    alter table public.household_action_preferences add constraint household_action_preferences_value_check
      check (value <> 'null'::jsonb);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'household_action_state_version_check') then
    alter table public.household_action_state add constraint household_action_state_version_check
      check (version >= 1);
  end if;
end $$;

-- The snapshot's order: oldest first, the id breaking a tie.
create index if not exists household_actions_owner_created
  on public.household_actions (profile_id, created_at, id);

alter table public.household_actions enable row level security;
alter table public.household_action_preferences enable row level security;
alter table public.household_action_state enable row level security;

-- No policy, deliberately, and stricter than it looks: the owner cannot read
-- their own tasks with their own session either. Every read and write goes
-- through a route handler using the service role, which bypasses row level
-- security, after it has verified the token. Supabase's default privileges
-- would otherwise grant anon and authenticated arwdDxtm on these new public
-- tables (confirmed by the 2026-10-17 catalog audit), so revoking here is what
-- actually closes that, the same way 0017, 0018 and 0020 to 0022 do.
revoke all on table public.household_actions from anon, authenticated;
revoke all on table public.household_action_preferences from anon, authenticated;
revoke all on table public.household_action_state from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. read_household_actions: the one snapshot (Ruling H9)
-- ---------------------------------------------------------------------------
-- p_profile_id is trusted: only the service role may call this, and the routes
-- pass the verified session's user id. Returns
--   {version, actions, metas, preferences}
-- version 0 when the household has never committed; actions oldest first;
-- metas keyed by task key, only for tasks that have one; preferences keyed by
-- preference key. A household with nothing reads as
--   {"version": 0, "actions": [], "metas": {}, "preferences": {}}

create or replace function public.read_household_actions(p_profile_id uuid)
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
  return jsonb_build_object(
    'version', coalesce((select s.version from public.household_action_state s where s.profile_id = p_profile_id), 0),
    'actions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id,
               'key', a.action_key,
               'title', a.title,
               'reason', a.reason,
               'origin', a.origin,
               'date', coalesce(to_char(a.due_date, 'YYYY-MM-DD'), ''),
               'state', a.state,
               'revision', a.revision
             ) order by a.created_at, a.id)
        from public.household_actions a
       where a.profile_id = p_profile_id), '[]'::jsonb),
    'metas', coalesce((
      select jsonb_object_agg(a.action_key, a.meta)
        from public.household_actions a
       where a.profile_id = p_profile_id and a.meta is not null), '{}'::jsonb),
    'preferences', coalesce((
      select jsonb_object_agg(p.pref_key, p.value)
        from public.household_action_preferences p
       where p.profile_id = p_profile_id), '{}'::jsonb)
  );
end;
$$;

revoke execute on function public.read_household_actions(uuid)
  from public, anon, authenticated;
grant execute on function public.read_household_actions(uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. commit_household_actions: the atomic write (Rulings H6, H8, H10)
-- ---------------------------------------------------------------------------
-- p_profile_id is trusted for the same reason as above. p_operation_id is the
-- caller's own ledger row, already claimed by runOperation. p_base_version is
-- the version read with the snapshot the change was planned from (0 when the
-- household had none). p_writes is the planner's `writes`
-- (lib/actionRules.js, planActionCommand), exactly these keys, each optional:
--
--   inserts      [{id, key, title, reason, origin, date, state, revision, meta}]
--                new tasks: id a lowercase uuid the route generated, revision
--                1, meta an object or null
--   updates      [{id, baseRevision, revision, title, date, state}]
--                a changed task, written only at baseRevision, and revision
--                must be baseRevision + 1
--   metas        [{id, key, meta}] a meta set (an object) or cleared (null) on
--                an existing task; its revision does not move
--   deletes      [id] (the task's meta goes with it)
--   preferences  {key: value} upserted, last write wins (Ruling H5)
--
-- `date` is '' (no date) or YYYY-MM-DD. An id may appear in updates and metas
-- together (a revise that changes the meta too) but in no other two lists, and
-- at most once in each. A write that names a row this household does not have,
-- or a task at another revision, raises HALO_STALE_BASE: it cannot happen
-- under the version check, so it is defensive, and another household's id is
-- simply not found. Nothing is written for any refusal.
--
-- The receipt stored on the ledger row and returned is
--   {status: 'succeeded', affected: [{id, revision}], removed: [id]}
-- affected being every task inserted or changed (its meta included), oldest
-- first, with its revision after the commit. No title, reason, origin, date,
-- meta or preference is in it (Ruling H3): a replay rebuilds the snapshot from
-- the tables at read time (Ruling H18).
--
-- Inserted tasks keep their batch order: they are stamped with one clock
-- reading plus one microsecond per position, because a single now() for all
-- of them would leave their order to their random ids.

create or replace function public.commit_household_actions(
  p_profile_id     uuid,
  p_operation_id   uuid,
  p_base_version   bigint,
  p_writes         jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  uuid_pattern   constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  date_pattern   constant text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
  write_keys     constant text[] := array['deletes', 'inserts', 'metas', 'preferences', 'updates'];
  insert_keys    constant text[] := array['date', 'id', 'key', 'meta', 'origin', 'reason', 'revision', 'state', 'title'];
  update_keys    constant text[] := array['baseRevision', 'date', 'id', 'revision', 'state', 'title'];
  meta_keys      constant text[] := array['id', 'key', 'meta'];
  w_inserts      jsonb;
  w_updates      jsonb;
  w_metas        jsonb;
  w_deletes      jsonb;
  w_preferences  jsonb;
  item           jsonb;
  at             int;
  bad            text;
  base_revision  numeric;
  expected       int;
  touched        int;
  stamp          timestamptz;
  receipt        jsonb;
begin
  -- Arguments first: nothing is read or written for a malformed call.
  if p_profile_id is null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_profile_id is required';
  end if;
  if p_operation_id is null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_operation_id is required';
  end if;
  if p_base_version is null or p_base_version < 0 then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_base_version must be 0 or more';
  end if;
  if p_writes is null or jsonb_typeof(p_writes) <> 'object' then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_writes must be a JSON object';
  end if;
  select string_agg(k, ', ' order by k) into bad
    from jsonb_object_keys(p_writes) k where k <> all (write_keys);
  if bad is not null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('p_writes has unknown keys: %s', bad);
  end if;
  w_inserts     := coalesce(p_writes -> 'inserts', '[]'::jsonb);
  w_updates     := coalesce(p_writes -> 'updates', '[]'::jsonb);
  w_metas       := coalesce(p_writes -> 'metas', '[]'::jsonb);
  w_deletes     := coalesce(p_writes -> 'deletes', '[]'::jsonb);
  w_preferences := coalesce(p_writes -> 'preferences', '{}'::jsonb);
  if jsonb_typeof(w_inserts) <> 'array' or jsonb_typeof(w_updates) <> 'array'
     or jsonb_typeof(w_metas) <> 'array' or jsonb_typeof(w_deletes) <> 'array' then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001',
      detail = 'p_writes.inserts, updates, metas and deletes must be arrays';
  end if;
  if jsonb_typeof(w_preferences) <> 'object' then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_writes.preferences must be an object';
  end if;

  -- Each element on its own. One test per statement, in order, because SQL
  -- does not promise to evaluate `a or b` left to right.
  at := 0;
  for item in select value from jsonb_array_elements(w_inserts) loop
    if jsonb_typeof(item) <> 'object' then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('inserts[%s] must be an object', at);
    end if;
    if (select array_agg(k order by k) from jsonb_object_keys(item) k) is distinct from insert_keys then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001',
        detail = format('inserts[%s] must have exactly the keys %s', at, array_to_string(insert_keys, ', '));
    end if;
    if jsonb_typeof(item -> 'id') <> 'string' then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('inserts[%s].id must be a lowercase uuid', at);
    end if;
    if (item ->> 'id') !~ uuid_pattern then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('inserts[%s].id must be a lowercase uuid', at);
    end if;
    if jsonb_typeof(item -> 'key') <> 'string' or jsonb_typeof(item -> 'title') <> 'string'
       or jsonb_typeof(item -> 'reason') <> 'string' or jsonb_typeof(item -> 'origin') <> 'string'
       or jsonb_typeof(item -> 'state') <> 'string' or jsonb_typeof(item -> 'date') <> 'string' then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001',
        detail = format('inserts[%s]: key, title, reason, origin, state and date must be strings', at);
    end if;
    if item -> 'revision' is distinct from '1'::jsonb then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('inserts[%s].revision must be 1', at);
    end if;
    if jsonb_typeof(item -> 'meta') not in ('object', 'null') then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('inserts[%s].meta must be an object or null', at);
    end if;
    at := at + 1;
  end loop;

  at := 0;
  for item in select value from jsonb_array_elements(w_updates) loop
    if jsonb_typeof(item) <> 'object' then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('updates[%s] must be an object', at);
    end if;
    if (select array_agg(k order by k) from jsonb_object_keys(item) k) is distinct from update_keys then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001',
        detail = format('updates[%s] must have exactly the keys %s', at, array_to_string(update_keys, ', '));
    end if;
    if jsonb_typeof(item -> 'id') <> 'string' then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('updates[%s].id must be a lowercase uuid', at);
    end if;
    if (item ->> 'id') !~ uuid_pattern then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('updates[%s].id must be a lowercase uuid', at);
    end if;
    if jsonb_typeof(item -> 'title') <> 'string' or jsonb_typeof(item -> 'state') <> 'string'
       or jsonb_typeof(item -> 'date') <> 'string' then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001',
        detail = format('updates[%s]: title, state and date must be strings', at);
    end if;
    if jsonb_typeof(item -> 'baseRevision') <> 'number' or jsonb_typeof(item -> 'revision') <> 'number' then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001',
        detail = format('updates[%s]: baseRevision and revision must be numbers', at);
    end if;
    base_revision := (item ->> 'baseRevision')::numeric;
    if base_revision <> trunc(base_revision) or base_revision < 1 or base_revision >= 2147483647 then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001',
        detail = format('updates[%s].baseRevision must be a whole number from 1', at);
    end if;
    if (item ->> 'revision')::numeric <> base_revision + 1 then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001',
        detail = format('updates[%s].revision must be baseRevision + 1', at);
    end if;
    at := at + 1;
  end loop;

  at := 0;
  for item in select value from jsonb_array_elements(w_metas) loop
    if jsonb_typeof(item) <> 'object' then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('metas[%s] must be an object', at);
    end if;
    if (select array_agg(k order by k) from jsonb_object_keys(item) k) is distinct from meta_keys then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001',
        detail = format('metas[%s] must have exactly the keys %s', at, array_to_string(meta_keys, ', '));
    end if;
    if jsonb_typeof(item -> 'id') <> 'string' then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('metas[%s].id must be a lowercase uuid', at);
    end if;
    if (item ->> 'id') !~ uuid_pattern then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('metas[%s].id must be a lowercase uuid', at);
    end if;
    if jsonb_typeof(item -> 'key') <> 'string' then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('metas[%s].key must be a string', at);
    end if;
    if jsonb_typeof(item -> 'meta') not in ('object', 'null') then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('metas[%s].meta must be an object or null', at);
    end if;
    at := at + 1;
  end loop;

  at := 0;
  for item in select value from jsonb_array_elements(w_deletes) loop
    if jsonb_typeof(item) <> 'string' then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('deletes[%s] must be a lowercase uuid', at);
    end if;
    if (item #>> '{}') !~ uuid_pattern then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('deletes[%s] must be a lowercase uuid', at);
    end if;
    at := at + 1;
  end loop;

  -- Every date is '' or a real calendar date from year 1 to 9999. Checked
  -- without casting, because an impossible date such as 2026-02-30 would
  -- otherwise surface as Postgres's own 22008 rather than HALO_INVALID_INPUT.
  select string_agg(d, ', ') into bad
    from (select e ->> 'date' as d from jsonb_array_elements(w_inserts) e
          union all
          select e ->> 'date' from jsonb_array_elements(w_updates) e) dates
   where d <> ''
     and case
           when d !~ date_pattern then true
           when substr(d, 1, 4)::int < 1 or substr(d, 6, 2)::int not between 1 and 12 then true
           else substr(d, 9, 2)::int not between 1 and extract(day from
                  make_date(substr(d, 1, 4)::int, substr(d, 6, 2)::int, 1) + interval '1 month' - interval '1 day')::int
         end;
  if bad is not null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001',
      detail = 'every date must be empty or a YYYY-MM-DD calendar date';
  end if;

  -- One task, one kind of write: an id is inserted, updated or deleted at most
  -- once, and a meta write names a task that is neither new nor deleted.
  if exists (
    select 1 from (
      select e ->> 'id' as id from jsonb_array_elements(w_inserts) e
      union all select e ->> 'id' from jsonb_array_elements(w_updates) e
      union all select e #>> '{}' from jsonb_array_elements(w_deletes) e
    ) ids group by id having count(*) > 1
  ) then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001',
      detail = 'an id appears more than once across inserts, updates and deletes';
  end if;
  if exists (select 1 from jsonb_array_elements(w_metas) e group by e ->> 'id' having count(*) > 1) then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'an id appears more than once in metas';
  end if;
  if exists (
    select 1 from jsonb_array_elements(w_metas) m
     where m ->> 'id' in (select e ->> 'id' from jsonb_array_elements(w_inserts) e
                          union all select e #>> '{}' from jsonb_array_elements(w_deletes) e)
  ) then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001',
      detail = 'a meta write names a task that is inserted or deleted in the same commit';
  end if;
  if exists (select 1 from jsonb_array_elements(w_inserts) e group by e ->> 'key' having count(*) > 1) then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'a key appears more than once in inserts';
  end if;

  -- 1. The caller's own ledger row, locked, before anything is written. The
  --    reaper's conditional update and this lock exclude each other: if the
  --    reaper settled the row first, nothing matches here; if this commit
  --    holds the row, the reaper waits and then finds it no longer pending.
  perform 1 from public.operations o
   where o.operation_id = p_operation_id and o.profile_id = p_profile_id
     and o.domain = 'actions' and o.status = 'pending'
     for update;
  if not found then
    raise exception 'HALO_OPERATION_NOT_PENDING' using errcode = 'P0001';
  end if;

  -- 2. The household version (Ruling H10). The first commit inserts 1, and a
  --    concurrent first commit waits on the key and then inserts nothing; a
  --    later one advances only from the version its snapshot was read at.
  if p_base_version = 0 then
    insert into public.household_action_state (profile_id, version)
    values (p_profile_id, 1)
    on conflict (profile_id) do nothing;
  else
    update public.household_action_state s
       set version = s.version + 1, updated_at = now()
     where s.profile_id = p_profile_id and s.version = p_base_version;
  end if;
  get diagnostics touched = row_count;
  if touched = 0 then
    raise exception 'HALO_STALE_BASE' using errcode = 'P0001',
      detail = 'the household version is no longer the one this change was planned from';
  end if;

  -- 3. The writes, every statement scoped to this household. A short count
  --    means a row is not there as planned: defensive, since step 2 already
  --    proved nothing moved, and another household's id is never found.
  expected := jsonb_array_length(w_deletes);
  if expected > 0 then
    delete from public.household_actions a
     where a.profile_id = p_profile_id
       and a.id in (select (e #>> '{}')::uuid from jsonb_array_elements(w_deletes) e);
    get diagnostics touched = row_count;
    if touched <> expected then
      raise exception 'HALO_STALE_BASE' using errcode = 'P0001', detail = 'a deleted task is not there';
    end if;
  end if;

  expected := jsonb_array_length(w_updates);
  if expected > 0 then
    update public.household_actions a
       set title = u.title,
           due_date = nullif(u.date, '')::date,
           state = u.state,
           revision = u.revision,
           updated_at = now()
      from jsonb_to_recordset(w_updates) as u(id uuid, "baseRevision" int, revision int, title text, date text, state text)
     where a.profile_id = p_profile_id and a.id = u.id and a.revision = u."baseRevision";
    get diagnostics touched = row_count;
    if touched <> expected then
      raise exception 'HALO_STALE_BASE' using errcode = 'P0001', detail = 'an updated task is not there at its base revision';
    end if;
  end if;

  expected := jsonb_array_length(w_metas);
  if expected > 0 then
    update public.household_actions a
       set meta = case when jsonb_typeof(m.item -> 'meta') = 'null' then null else m.item -> 'meta' end,
           updated_at = now()
      from (select e as item from jsonb_array_elements(w_metas) e) m
     where a.profile_id = p_profile_id and a.id = (m.item ->> 'id')::uuid and a.action_key = m.item ->> 'key';
    get diagnostics touched = row_count;
    if touched <> expected then
      raise exception 'HALO_STALE_BASE' using errcode = 'P0001', detail = 'a task whose meta changes is not there';
    end if;
  end if;

  if jsonb_array_length(w_inserts) > 0 then
    stamp := clock_timestamp();
    insert into public.household_actions
      (id, profile_id, action_key, title, reason, origin, due_date, state, revision, meta, created_at, updated_at)
    select (e.item ->> 'id')::uuid, p_profile_id, e.item ->> 'key', e.item ->> 'title', e.item ->> 'reason',
           e.item ->> 'origin', nullif(e.item ->> 'date', '')::date, e.item ->> 'state', 1,
           case when jsonb_typeof(e.item -> 'meta') = 'null' then null else e.item -> 'meta' end,
           stamp + (e.position - 1) * interval '1 microsecond', stamp
      from jsonb_array_elements(w_inserts) with ordinality as e(item, position)
     order by e.position;
  end if;

  insert into public.household_action_preferences (profile_id, pref_key, value)
  select p_profile_id, p.key, p.value from jsonb_each(w_preferences) p
  on conflict (profile_id, pref_key) do update
    set value = excluded.value, updated_at = now();

  -- 4. Settle this operation's own row, in this transaction (Ruling H8): ids
  --    and revisions only (Ruling H3).
  receipt := jsonb_build_object(
    'status', 'succeeded',
    'affected', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'revision', a.revision) order by a.created_at, a.id)
        from public.household_actions a
       where a.profile_id = p_profile_id
         and a.id in (select (e ->> 'id')::uuid from jsonb_array_elements(w_inserts) e
                      union select (e ->> 'id')::uuid from jsonb_array_elements(w_updates) e
                      union select (e ->> 'id')::uuid from jsonb_array_elements(w_metas) e)), '[]'::jsonb),
    'removed', w_deletes
  );
  update public.operations o
     set status = 'succeeded', result = receipt, updated_at = now()
   where o.operation_id = p_operation_id and o.profile_id = p_profile_id
     and o.domain = 'actions' and o.status = 'pending';
  get diagnostics touched = row_count;
  if touched <> 1 then
    -- Cannot happen while step 1's lock is held; kept so the settle is never
    -- assumed.
    raise exception 'HALO_OPERATION_NOT_PENDING' using errcode = 'P0001';
  end if;

  -- 5. The snapshot as it now stands, read in this transaction.
  return jsonb_build_object('receipt', receipt, 'snapshot', public.read_household_actions(p_profile_id));
end;
$$;

revoke execute on function public.commit_household_actions(uuid, uuid, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_household_actions(uuid, uuid, bigint, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. A settled 'actions' operation keeps its status
-- ---------------------------------------------------------------------------
-- Why. runOperation (lib/operations.js) settles by operation id alone, with no
-- status condition, and settles 'failed' whenever its execute throws. If the
-- commit function has committed and its response is then lost on the way back
-- (a dropped connection, a timeout between PostgREST and the route), execute
-- throws and that settle would turn a 'succeeded' row whose tasks were written
-- into 'failed', and the client would then say "No save was applied. Your
-- draft is kept for review." That is the very sentence Ruling H8 exists to
-- make true. So, in the 'actions' domain only, a row that has left 'pending'
-- may not change its status: the settle fails, lib/operations.js logs it
-- rather than throwing, and the row keeps telling the truth. Rewriting the
-- receipt of a 'succeeded' row as 'succeeded' (runOperation adding
-- operationId) is still allowed, and so is the reaper, which only ever
-- touches 'pending' rows. Every other domain is unchanged.

create or replace function public.guard_settled_action_operation()
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

revoke execute on function public.guard_settled_action_operation()
  from public, anon, authenticated;

create or replace trigger operations_actions_settled_guard
  before update on public.operations
  for each row
  when (old.domain = 'actions' and old.status <> 'pending' and new.status is distinct from old.status)
  execute function public.guard_settled_action_operation();

-- ---------------------------------------------------------------------------
-- Verification (read only). Expect one row, all six columns true.
-- ---------------------------------------------------------------------------
--   select
--     (select bool_and(c.relrowsecurity) from pg_class c
--       where c.oid in ('public.household_actions'::regclass,
--                       'public.household_action_preferences'::regclass,
--                       'public.household_action_state'::regclass)) as rls_on,
--     (select count(*) from pg_policies
--       where schemaname = 'public'
--         and tablename in ('household_actions', 'household_action_preferences', 'household_action_state')) = 0
--       as no_policies,
--     not exists (
--       select 1 from unnest(array['anon', 'authenticated']) as r
--        cross join unnest(array['public.household_actions', 'public.household_action_preferences',
--                                'public.household_action_state']) as t
--        where has_any_column_privilege(r, t, 'SELECT')
--           or has_any_column_privilege(r, t, 'INSERT')
--           or has_any_column_privilege(r, t, 'UPDATE')
--           or has_table_privilege(r, t, 'DELETE'))
--       as no_client_access,
--     not (has_function_privilege('anon', 'public.read_household_actions(uuid)', 'EXECUTE')
--       or has_function_privilege('authenticated', 'public.read_household_actions(uuid)', 'EXECUTE')
--       or has_function_privilege('anon', 'public.commit_household_actions(uuid, uuid, bigint, jsonb)', 'EXECUTE')
--       or has_function_privilege('authenticated', 'public.commit_household_actions(uuid, uuid, bigint, jsonb)', 'EXECUTE'))
--       and has_function_privilege('service_role', 'public.read_household_actions(uuid)', 'EXECUTE')
--       and has_function_privilege('service_role', 'public.commit_household_actions(uuid, uuid, bigint, jsonb)', 'EXECUTE')
--       as functions_service_role_only,
--     exists (select 1 from pg_trigger
--       where tgrelid = 'public.operations'::regclass and tgname = 'operations_actions_settled_guard')
--       as settled_guard_on,
--     (select count(*) from pg_constraint
--       where conrelid in ('public.household_actions'::regclass,
--                          'public.household_action_preferences'::regclass,
--                          'public.household_action_state'::regclass) and contype = 'c') = 10
--       as ten_checks;
--
-- ---------------------------------------------------------------------------
-- If you need to back out 0023
-- ---------------------------------------------------------------------------
-- The B06 routes go back to answering a non-retryable 503
-- feature_unavailable, exactly as they do before this is applied, so backing
-- out disables My Week's tasks rather than breaking the existing app.
--
-- What is lost: every household's tasks, their planning details (notes,
-- history, times, recurrence) and their task preferences, for good, because
-- the three tables are dropped, and the household version with them. Ledger
-- rows in domain 'actions' stay in public.operations; they hold ids, revisions
-- and statuses only, no task content, and a replay of one can no longer
-- rebuild a snapshot. The guard trigger goes too, so those rows are ordinary
-- ledger rows again. Nothing else references these tables, and 0022 is
-- untouched.
--
-- The tested copy of this block is in docs/backend/YOUR_TODO.md, which is what
-- test/migrationBackout.test.mjs runs.
--
-- <!-- backout-0023 -->
-- drop trigger if exists operations_actions_settled_guard on public.operations;
-- drop function if exists public.guard_settled_action_operation();
-- drop function if exists public.commit_household_actions(uuid, uuid, bigint, jsonb);
-- drop function if exists public.read_household_actions(uuid);
-- drop table if exists public.household_action_state;
-- drop table if exists public.household_action_preferences;
-- drop table if exists public.household_actions;
--
-- Then run: notify pgrst, 'reload schema';
