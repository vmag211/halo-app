-- HALO: the My Week journal (`weekJournal`) on the journal table that already
-- exists, public.symptom_logs (0003), so Journal, Patterns and Season save and
-- reload real check-ins through the workspace routes (B11's `workspace.load`
-- and `workspace.execute`) without a second store of the same entries.
--
-- Run once in the Supabase SQL editor, AFTER 0003, 0015, 0016 and 0017. It
-- reads 0026's ledger guard if it is there but does not need it. Safe to
-- re-run.
--
-- Locks: three ADD COLUMN IF NOT EXISTS with constant defaults (metadata only,
-- no table rewrite), one partial unique index (over no row yet: record_id is
-- null everywhere) and one trigger, each taking a brief lock on symptom_logs
-- that a journal save waits behind for a moment. No existing row is
-- rewritten, so the NOT VALID checks of 0015 are never re-evaluated here.
--
-- WHAT THIS IS FOR. The frontend keeps check-ins as a workspace collection:
-- records with an app id, a server revision and the home they were made for
-- (HomeWorkspaceState.tsx, WeekJournal.tsx). symptom_logs had none of the
-- three. This adds them as columns and two functions the routes call as the
-- service role:
--
--   read_week_journal(profile)              the household's entries, newest
--                                           first, at most 1000, and the total
--   commit_week_journal(profile, op, write) one create, update or delete at its
--                                           expected revision, the settle of
--                                           the caller's own ledger row
--                                           (domain 'workspace'), and the
--                                           entries as they now stand, in one
--                                           transaction
--
-- So a journal save exists if and only if its operation is 'succeeded', the
-- same rule as 0026. The legacy route (POST /api/journal) still writes this
-- table by (date, group); the trigger below gives its updates a new revision
-- too, so a workspace edit made against an older copy is refused, not lost.
--
-- IDS. `record_id` is the app's id, kept exactly as the device sent it. A row
-- written before this migration (or by the legacy route) has none; its id is
-- `journal:<date>:<group>`, which is unique because (profile, date, group) is
-- (0003). Once such a row is edited here its id is written down, so a change of
-- date or group never changes it.
--
-- RETENTION (Vibhav, 2026-10-25): a check-in is kept until the person deletes
-- it, clears the journal or all records, or deletes the account. No purge job
-- and no period, the same rule as tasks and Luna. Clear Journal and clear all
-- (0024) already delete symptom_logs, the privacy export already includes it,
-- and the profile's ON DELETE CASCADE removes it with the account.
--
-- Errors, each SQLSTATE P0001 with exactly this message, never record content:
--   HALO_INVALID_INPUT          an argument or p_write is malformed
--   HALO_OPERATION_NOT_PENDING  the ledger row is missing, settled, another
--                               household's or another domain's
--   HALO_INVALID_REFERENCE      the home named is not this household's
--   HALO_STALE_REVISION         the entry is not there at the revision expected,
--                               or a created id already exists
--   HALO_JOURNAL_DAY_TAKEN      another entry already holds that date and group
--
-- Degrades cleanly: until this is applied, and while the `journal` server flag
-- is off, the workspace routes answer `weekJournal` unavailable, exactly as
-- before (a missing function is PGRST202 or 42883).
--
-- Privacy: only the service role may call the functions. The new columns are
-- covered by 0015's revoke (no client writes) and by 0003's select-own policy.

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------

alter table public.symptom_logs add column if not exists revision integer not null default 1;
alter table public.symptom_logs add column if not exists record_id text;
alter table public.symptom_logs add column if not exists home_context_id text;

-- No new check constraints: the only writer of the three columns is
-- commit_week_journal, which checks the id's length and that the home is this
-- household's, and the revision only ever starts at 1 and moves up by one
-- (section 2). 0015's checks on the entry itself stay exactly as they are.

create unique index if not exists symptom_logs_owner_record
  on public.symptom_logs (profile_id, record_id) where record_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Every update is a new revision
-- ---------------------------------------------------------------------------
-- Whoever writes (the commit below or the legacy upsert), an update moves the
-- revision on by one, so an edit made against an older copy is refused.

create or replace function public.bump_symptom_log_revision()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.revision := old.revision + 1;
  return new;
end;
$$;

revoke execute on function public.bump_symptom_log_revision() from public, anon, authenticated;

create or replace trigger symptom_logs_revision
  before update on public.symptom_logs
  for each row
  execute function public.bump_symptom_log_revision();

-- ---------------------------------------------------------------------------
-- 3. read_week_journal: the entries, one consistent read
-- ---------------------------------------------------------------------------
-- Returns {rows: [...], total: n}: at most 1000 entries (the workspace's
-- collection limit, Ruling W7; one entry per day and group never needs a
-- cap on writes), newest date first,
-- each {id, revision, entry_date, band, symptoms, severity, note,
-- retrospective, possibly_illness, home_context_id}. One statement, so not
-- truncated by PostgREST's max_rows. p_profile_id is trusted (service role).

create or replace function public.read_week_journal(p_profile_id uuid)
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
    'total', (select count(*) from public.symptom_logs s where s.profile_id = p_profile_id),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', coalesce(r.record_id, 'journal:' || to_char(r.entry_date, 'YYYY-MM-DD') || ':' || r.band),
               'revision', r.revision,
               'entry_date', to_char(r.entry_date, 'YYYY-MM-DD'),
               'band', r.band,
               'symptoms', to_jsonb(coalesce(r.symptoms, '{}'::text[])),
               'severity', r.severity,
               'note', r.note,
               'retrospective', r.retrospective,
               'possibly_illness', r.possibly_illness,
               'home_context_id', r.home_context_id)
             order by r.entry_date desc, r.band, r.id)
        from (select * from public.symptom_logs s
               where s.profile_id = p_profile_id
               order by s.entry_date desc, s.band, s.id
               limit 1000) r), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.read_week_journal(uuid) from public, anon, authenticated;
grant execute on function public.read_week_journal(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. commit_week_journal: the atomic write
-- ---------------------------------------------------------------------------
-- p_operation_id is the caller's own ledger row, already claimed by
-- runOperation. p_write is the route's plan (lib/weekJournalStore.js):
--
--   {kind: 'write', id, expectedRevision, homeContextId, entry}
--       expectedRevision null creates (the id must not exist); a number
--       updates at exactly that stored revision. homeContextId is null or a
--       home of this household. entry is {entry_date, band, symptoms,
--       severity, note, retrospective, possibly_illness}, already checked
--       against lib/journalInput.js; 0003 and 0015 check it again.
--   {kind: 'remove', id, expectedRevision}
--
-- Nothing is written for any refusal. Returns {receipt, journal}, journal
-- being read_week_journal's answer inside this transaction.

create or replace function public.commit_week_journal(
  p_profile_id    uuid,
  p_operation_id  uuid,
  p_write         jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  w_kind      text;
  w_id        text;
  w_home      text;
  w_entry     jsonb;
  w_expected  int;
  w_create    boolean;
  touched     int;
  new_rev     int;
  receipt     jsonb;
begin
  if p_profile_id is null or p_operation_id is null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_profile_id and p_operation_id are required';
  end if;
  if p_write is null or jsonb_typeof(p_write) <> 'object' then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_write must be a JSON object';
  end if;
  w_kind := p_write ->> 'kind';
  w_id := p_write ->> 'id';
  if w_kind is null or w_kind not in ('write', 'remove') or jsonb_typeof(p_write -> 'id') is distinct from 'string'
     or char_length(w_id) not between 1 and 200 then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_write needs kind write or remove and an id';
  end if;
  w_create := jsonb_typeof(p_write -> 'expectedRevision') is not distinct from 'null' or not (p_write ? 'expectedRevision');
  if w_kind = 'remove' and w_create then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'a remove needs its expected revision';
  end if;
  if not w_create then
    if jsonb_typeof(p_write -> 'expectedRevision') <> 'number'
       or (p_write ->> 'expectedRevision')::numeric < 1
       or (p_write ->> 'expectedRevision')::numeric <> trunc((p_write ->> 'expectedRevision')::numeric)
       or (p_write ->> 'expectedRevision')::numeric >= 2147483647 then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'expectedRevision must be a whole number from 1';
    end if;
    w_expected := (p_write ->> 'expectedRevision')::int;
  end if;
  if w_kind = 'write' then
    w_entry := p_write -> 'entry';
    if jsonb_typeof(w_entry) is distinct from 'object'
       or jsonb_typeof(w_entry -> 'entry_date') is distinct from 'string'
       or jsonb_typeof(w_entry -> 'band') is distinct from 'string'
       or jsonb_typeof(w_entry -> 'symptoms') is distinct from 'array'
       or jsonb_typeof(w_entry -> 'severity') not in ('string', 'null')
       or jsonb_typeof(w_entry -> 'note') not in ('string', 'null')
       or jsonb_typeof(w_entry -> 'retrospective') is distinct from 'boolean'
       or jsonb_typeof(w_entry -> 'possibly_illness') is distinct from 'boolean'
       or exists (select 1 from jsonb_array_elements(w_entry -> 'symptoms') e where jsonb_typeof(e) <> 'string') then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'entry is malformed';
    end if;
    if jsonb_typeof(p_write -> 'homeContextId') not in ('string', 'null') then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'homeContextId must be a string or null';
    end if;
    w_home := p_write ->> 'homeContextId';
  end if;

  -- 1. The profile, then this operation's own ledger row (the 0026 order).
  perform 1 from public.profiles p where p.id = p_profile_id for key share;
  perform 1 from public.operations o
   where o.operation_id = p_operation_id and o.profile_id = p_profile_id
     and o.domain = 'workspace' and o.status = 'pending'
     for update;
  if not found then
    raise exception 'HALO_OPERATION_NOT_PENDING' using errcode = 'P0001';
  end if;
  -- One journal commit of a household at a time, so the id check below holds.
  perform pg_advisory_xact_lock(hashtextextended('halo.week_journal:' || p_profile_id::text, 0));

  -- 2. The home, compared as text, so a value that is not a uuid is not found.
  if w_home is not null and not exists (
       select 1 from public.home_contexts c where c.profile_id = p_profile_id and c.id::text = w_home) then
    raise exception 'HALO_INVALID_REFERENCE' using errcode = 'P0001', detail = 'the home is not this household''s';
  end if;

  -- 3. The change.
  if w_kind = 'remove' then
    delete from public.symptom_logs s
     where s.profile_id = p_profile_id
       and coalesce(s.record_id, 'journal:' || to_char(s.entry_date, 'YYYY-MM-DD') || ':' || s.band) = w_id
       and s.revision = w_expected;
    get diagnostics touched = row_count;
    if touched <> 1 then
      raise exception 'HALO_STALE_REVISION' using errcode = 'P0001', detail = 'the entry is not there at its expected revision';
    end if;
  elsif w_create then
    if exists (select 1 from public.symptom_logs s
                where s.profile_id = p_profile_id
                  and coalesce(s.record_id, 'journal:' || to_char(s.entry_date, 'YYYY-MM-DD') || ':' || s.band) = w_id) then
      raise exception 'HALO_STALE_REVISION' using errcode = 'P0001', detail = 'a created id exists';
    end if;
    begin
      insert into public.symptom_logs (profile_id, record_id, home_context_id, entry_date, band, symptoms, severity,
                                       note, retrospective, possibly_illness, revision, created_at, updated_at)
      values (p_profile_id, w_id, w_home, (w_entry ->> 'entry_date')::date, w_entry ->> 'band',
              array(select jsonb_array_elements_text(w_entry -> 'symptoms')), w_entry ->> 'severity',
              w_entry ->> 'note', (w_entry ->> 'retrospective')::boolean, (w_entry ->> 'possibly_illness')::boolean,
              1, now(), now());
    exception when unique_violation then
      raise exception 'HALO_JOURNAL_DAY_TAKEN' using errcode = 'P0001', detail = 'another entry holds that date and group';
    end;
    new_rev := 1;
  else
    begin
      update public.symptom_logs s
         set record_id = coalesce(s.record_id, 'journal:' || to_char(s.entry_date, 'YYYY-MM-DD') || ':' || s.band),
             home_context_id = w_home,
             entry_date = (w_entry ->> 'entry_date')::date,
             band = w_entry ->> 'band',
             symptoms = array(select jsonb_array_elements_text(w_entry -> 'symptoms')),
             severity = w_entry ->> 'severity',
             note = w_entry ->> 'note',
             retrospective = (w_entry ->> 'retrospective')::boolean,
             possibly_illness = (w_entry ->> 'possibly_illness')::boolean,
             updated_at = now()
       where s.profile_id = p_profile_id
         and coalesce(s.record_id, 'journal:' || to_char(s.entry_date, 'YYYY-MM-DD') || ':' || s.band) = w_id
         and s.revision = w_expected
      returning s.revision into new_rev;
    exception when unique_violation then
      raise exception 'HALO_JOURNAL_DAY_TAKEN' using errcode = 'P0001', detail = 'another entry holds that date and group';
    end;
    if new_rev is null then
      raise exception 'HALO_STALE_REVISION' using errcode = 'P0001', detail = 'the entry is not there at its expected revision';
    end if;
  end if;

  -- 4. Settle this operation's own row: the collection, the id and the revision only.
  receipt := jsonb_build_object(
    'status', 'succeeded',
    'collections', jsonb_build_array('weekJournal'),
    'affected', case when w_kind = 'write'
                     then jsonb_build_array(jsonb_build_object('collection', 'weekJournal', 'id', w_id, 'revision', new_rev))
                     else '[]'::jsonb end,
    'removed', case when w_kind = 'remove'
                    then jsonb_build_array(jsonb_build_object('collection', 'weekJournal', 'id', w_id))
                    else '[]'::jsonb end,
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

  -- 5. The entries as they now stand, read in this transaction.
  return jsonb_build_object('receipt', receipt, 'journal', public.read_week_journal(p_profile_id));
end;
$$;

revoke execute on function public.commit_week_journal(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.commit_week_journal(uuid, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Verification (read only). Expect one row, all five columns true.
-- ---------------------------------------------------------------------------
--   select
--     (select count(*) from information_schema.columns
--       where table_schema = 'public' and table_name = 'symptom_logs'
--         and column_name in ('revision', 'record_id', 'home_context_id')) = 3
--       as columns_added,
--     to_regclass('public.symptom_logs_owner_record') is not null as record_index_on,
--     (select count(*) from pg_trigger
--       where tgrelid = 'public.symptom_logs'::regclass and tgname = 'symptom_logs_revision') = 1
--       as revision_trigger_on,
--     not exists (
--       select 1 from unnest(array['anon', 'authenticated']) as r
--        cross join unnest(array['public.read_week_journal(uuid)',
--                                'public.commit_week_journal(uuid, uuid, jsonb)',
--                                'public.bump_symptom_log_revision()']) as f
--        where has_function_privilege(r, f, 'EXECUTE'))
--       and (select bool_and(has_function_privilege('service_role', f, 'EXECUTE'))
--              from unnest(array['public.read_week_journal(uuid)',
--                                'public.commit_week_journal(uuid, uuid, jsonb)']) as f)
--       as functions_service_role_only,
--     (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and not p.prosecdef and 'search_path=public' = any (p.proconfig)
--         and p.proname in ('read_week_journal', 'commit_week_journal', 'bump_symptom_log_revision')) = 3
--       as functions_invoker_pinned;
--
-- ---------------------------------------------------------------------------
-- If you need to back out 0034
-- ---------------------------------------------------------------------------
-- The workspace routes go back to answering `weekJournal` unavailable (turn
-- HALO_FEATURE_JOURNAL off first). Every check-in stays in symptom_logs; only
-- its app id, revision and home are dropped, so an entry saved here then reads
-- through the legacy route like any other. The tested copy of this block is in
-- docs/backend/YOUR_TODO.md (<!-- backout-0034 -->).
--
--   drop function if exists public.commit_week_journal(uuid, uuid, jsonb);
--   drop function if exists public.read_week_journal(uuid);
--   drop trigger if exists symptom_logs_revision on public.symptom_logs;
--   drop function if exists public.bump_symptom_log_revision();
--   drop index if exists public.symptom_logs_owner_record;
--   alter table public.symptom_logs drop column if exists home_context_id;
--   alter table public.symptom_logs drop column if exists record_id;
--   alter table public.symptom_logs drop column if exists revision;
--
-- Then run: notify pgrst, 'reload schema';
