-- HALO: outreach drafts, a household's prepared copies of a question to a
-- public office, kept so the person can copy them into their own email (B17
-- plan, docs/backend/plans/b17-outreach-preparation.md, Rulings O5 to O8).
-- HALO never sends them: there is no email provider, no OAuth connection and
-- no send attempt anywhere in this migration.
--
-- Run once in the Supabase SQL editor, AFTER 0017 (the ledger). It does not
-- need 0018 to 0030 and may go before or after any of them. A draft that
-- includes notes checks them against 0026's household_workspace_records at
-- run time, so 0026 is needed only for that (the route refuses notes until
-- it is applied). Safe to re-run.
--
-- Locks: creates one new table and its index, which no other statement can
-- be waiting on. The foreign key to profiles takes a brief SHARE ROW
-- EXCLUSIVE on profiles as it is created, so a new anonymous sign-up could
-- wait a moment. It also adds two triggers to public.operations (sections 4
-- and 5), each taking a brief SHARE ROW EXCLUSIVE on that table: every ledger
-- claim and settle waits for that moment. Nothing existing is read or
-- rewritten.
--
-- ONE SAVE, ONE TRANSACTION (the 0026 pattern). The route validates the
-- draft in JavaScript, claims its ledger row in domain 'outreach' and calls
-- public.save_outreach_draft, which in one statement:
--
--   1. locks the profile FOR KEY SHARE, then the caller's own ledger row,
--      this household's, domain 'outreach', still 'pending'. Otherwise
--      HALO_OPERATION_NOT_PENDING.
--   2. holds every selected note FOR KEY SHARE at its exact revision.
--      Otherwise HALO_STALE_REVISION.
--   3. creates the draft, or raises its revision by one when its content
--      changed (an identical prepare keeps the revision). A household holds at
--      most 100 drafts; a new one past that is HALO_LIMIT.
--   4. settles the ledger row 'succeeded' with a receipt of the draft id and
--      revision only, never its text.
--
-- So a draft change exists if and only if its operation is 'succeeded'.
--
-- Errors the functions raise, for the routes to map. Each is SQLSTATE P0001
-- with exactly this message; DETAIL never holds draft text:
--   HALO_INVALID_INPUT          an argument or p_draft is malformed
--   HALO_OPERATION_NOT_PENDING  the ledger row is missing, settled, another
--                               household's or another domain's
--   HALO_STALE_REVISION         a selected note is not there at its revision
--   HALO_LIMIT                  the household already holds 100 drafts
--   HALO_OPERATION_SETTLED      section 4: a settled 'outreach' row's status
--                               may not change
--
-- Degrades cleanly: until this is applied the B17 routes answer the
-- feature_unavailable refusal (a missing function is PGRST202 or 42883, a
-- missing table PGRST205 or 42P01). Nothing else reads this table.
--
-- DELETION. profile_id references profiles ON DELETE CASCADE, so deleting the
-- account deletes every draft. A privacy clear all (0024) resets the profile
-- instead, so section 5's trigger deletes the household's drafts when that
-- clear settles its own ledger row, inside the clear's transaction. Clear
-- Journal keeps this table.
--
-- Retention: drafts are kept until clear all or account deletion. No purge
-- job is defined and no period is invented: the routes stay behind the
-- `outreach` server flag, off by default, until Vibhav confirms it (O8).
--
-- Privacy: the service role is the only reader. Row level security is on
-- with no policy at all and the default privileges are revoked.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------

create table if not exists public.outreach_drafts (
  draft_id        uuid        primary key,
  -- The owner, from the verified session only.
  profile_id      uuid        not null references public.profiles (id) on delete cascade,
  -- recipient class and lowercased recipient address: one draft each (O6).
  draft_key       text        not null,
  recipient       text        not null,
  topic           text        not null,
  water           text        not null,
  -- The canonical saved Explore place the draft was written for, or null.
  area            jsonb,
  contact_name    text        not null default '',
  to_address      text        not null default '',
  subject         text        not null,
  body            text        not null,
  -- [{id, revision, title, description}]: the selected notes' fields as included.
  notes           jsonb       not null default '[]'::jsonb,
  -- {id, revision, title, text, scope, asOf, url} or null: the included source entry.
  public_context  jsonb,
  -- sha256 of the client's review signature; never shown.
  signature_hash  text        not null,
  revision        integer     not null default 1,
  -- The ledger operation that last changed the draft.
  operation_id    uuid        not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (profile_id, draft_key)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'outreach_drafts_recipient_check') then
    alter table public.outreach_drafts add constraint outreach_drafts_recipient_check
      check (recipient in ('Utility', 'Landlord', 'Representative', 'Local office'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'outreach_drafts_topic_check') then
    alter table public.outreach_drafts add constraint outreach_drafts_topic_check
      check (topic in ('Drinking water', 'Air & outdoor conditions', 'A home concern', 'Parks & public spaces',
                       'Volunteering', 'Another community question'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'outreach_drafts_water_check') then
    alter table public.outreach_drafts add constraint outreach_drafts_water_check
      check (water in ('Utility', 'Private well', 'Private spring'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'outreach_drafts_text_check') then
    alter table public.outreach_drafts add constraint outreach_drafts_text_check
      check (char_length(draft_key) between 1 and 300 and char_length(contact_name) <= 160
             and char_length(to_address) <= 254 and char_length(subject) between 1 and 200
             and char_length(body) between 1 and 20000 and signature_hash ~ '^[0-9a-f]{64}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'outreach_drafts_shape_check') then
    alter table public.outreach_drafts add constraint outreach_drafts_shape_check
      check (jsonb_typeof(notes) = 'array' and (area is null or jsonb_typeof(area) = 'object')
             and (public_context is null or jsonb_typeof(public_context) = 'object')
             and octet_length(notes::text) <= 200000 and revision >= 1);
  end if;
end $$;

-- A household's drafts, newest first.
create index if not exists outreach_drafts_owner_updated
  on public.outreach_drafts (profile_id, updated_at desc, draft_id);

alter table public.outreach_drafts enable row level security;

-- No policy, deliberately: every read and write goes through a route handler
-- using the service role after it has verified the token.
revoke all on table public.outreach_drafts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. A draft as the routes answer it, and the read
-- ---------------------------------------------------------------------------
-- `from` and `expiresAt` are null on purpose: there is no sender and no send
-- approval, so this is never a send review (O5).

create or replace function public.outreach_draft_json(d public.outreach_drafts)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', d.draft_id, 'revision', d.revision, 'status', 'draft', 'delivery', 'copy',
    'from', null, 'expiresAt', null,
    'recipient', d.recipient, 'topic', d.topic, 'water', d.water, 'area', d.area,
    'name', d.contact_name, 'to', d.to_address, 'subject', d.subject, 'body', d.body,
    'notes', d.notes, 'publicContext', d.public_context,
    'createdAt', d.created_at, 'updatedAt', d.updated_at);
$$;

revoke execute on function public.outreach_draft_json(public.outreach_drafts) from public, anon, authenticated;
grant execute on function public.outreach_draft_json(public.outreach_drafts) to service_role;

-- p_profile_id is trusted: only the service role may call this. With
-- p_draft_id, that one draft of this household ([] when it is not theirs);
-- without, every draft, newest first. One statement.
create or replace function public.read_outreach_drafts(p_profile_id uuid, p_draft_id uuid default null)
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
  return coalesce((
    select jsonb_agg(public.outreach_draft_json(d) order by d.updated_at desc, d.draft_id)
      from public.outreach_drafts d
     where d.profile_id = p_profile_id and (p_draft_id is null or d.draft_id = p_draft_id)), '[]'::jsonb);
end;
$$;

revoke execute on function public.read_outreach_drafts(uuid, uuid) from public, anon, authenticated;
grant execute on function public.read_outreach_drafts(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. save_outreach_draft: the atomic write
-- ---------------------------------------------------------------------------
-- p_draft has exactly these keys (lib/outreach.js draftRow):
--   id, key, recipient, topic, water, area, name, to, subject, body, notes,
--   publicContext, signatureHash
-- `id` is used only when the draft is created; an existing draft keeps its id.

create or replace function public.save_outreach_draft(
  p_profile_id    uuid,
  p_operation_id  uuid,
  p_draft         jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  draft_keys constant text[] := array['area', 'body', 'id', 'key', 'name', 'notes', 'publicContext', 'recipient',
                                      'signatureHash', 'subject', 'to', 'topic', 'water'];
  existing  public.outreach_drafts;
  saved     public.outreach_drafts;
  note      jsonb;
  touched   int;
  receipt   jsonb;
begin
  if p_profile_id is null or p_operation_id is null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_profile_id and p_operation_id are required';
  end if;
  if p_draft is null or jsonb_typeof(p_draft) <> 'object'
     or (select array_agg(k order by k) from jsonb_object_keys(p_draft) k) is distinct from draft_keys then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_draft must have exactly the draft keys';
  end if;
  if jsonb_typeof(p_draft -> 'notes') <> 'array'
     or exists (select 1 from jsonb_array_elements(p_draft -> 'notes') e
                 where jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'id') <> 'string'
                    or jsonb_typeof(e -> 'revision') <> 'number') then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'notes must be [{id, revision, ...}]';
  end if;
  if jsonb_typeof(p_draft -> 'id') <> 'string' or (p_draft ->> 'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'id must be a lowercase uuid';
  end if;

  -- 1. The profile, then this operation's own ledger row.
  perform 1 from public.profiles p where p.id = p_profile_id for key share;
  perform 1 from public.operations o
   where o.operation_id = p_operation_id and o.profile_id = p_profile_id
     and o.domain = 'outreach' and o.status = 'pending'
     for update;
  if not found then
    raise exception 'HALO_OPERATION_NOT_PENDING' using errcode = 'P0001';
  end if;

  -- 2. Every selected note, this household's, at its exact revision, held
  --    until the commit. 0026's table is named only when a note is selected.
  for note in select value from jsonb_array_elements(p_draft -> 'notes') loop
    perform 1 from public.household_workspace_records r
     where r.profile_id = p_profile_id and r.collection = 'exploreNotes' and r.record_id = note ->> 'id'
       and r.revision = (note ->> 'revision')::numeric
       for key share;
    if not found then
      raise exception 'HALO_STALE_REVISION' using errcode = 'P0001', detail = 'a selected note is not there at its revision';
    end if;
  end loop;

  -- 3. Create, or change at revision + 1 when the content differs.
  select * into existing from public.outreach_drafts d
   where d.profile_id = p_profile_id and d.draft_key = p_draft ->> 'key'
   for update;
  if found then
    if existing.recipient = p_draft ->> 'recipient' and existing.topic = p_draft ->> 'topic'
       and existing.water = p_draft ->> 'water' and existing.area is not distinct from nullif(p_draft -> 'area', 'null'::jsonb)
       and existing.contact_name = p_draft ->> 'name' and existing.to_address = p_draft ->> 'to'
       and existing.subject = p_draft ->> 'subject' and existing.body = p_draft ->> 'body'
       and existing.notes = p_draft -> 'notes'
       and existing.public_context is not distinct from nullif(p_draft -> 'publicContext', 'null'::jsonb)
       and existing.signature_hash = p_draft ->> 'signatureHash' then
      saved := existing;
    else
      update public.outreach_drafts d
         set recipient = p_draft ->> 'recipient', topic = p_draft ->> 'topic', water = p_draft ->> 'water',
             area = nullif(p_draft -> 'area', 'null'::jsonb), contact_name = p_draft ->> 'name',
             to_address = p_draft ->> 'to', subject = p_draft ->> 'subject', body = p_draft ->> 'body',
             notes = p_draft -> 'notes', public_context = nullif(p_draft -> 'publicContext', 'null'::jsonb),
             signature_hash = p_draft ->> 'signatureHash', revision = d.revision + 1,
             operation_id = p_operation_id, updated_at = clock_timestamp()
       where d.draft_id = existing.draft_id
       returning * into saved;
    end if;
  else
    if (select count(*) from public.outreach_drafts d where d.profile_id = p_profile_id) >= 100 then
      raise exception 'HALO_LIMIT' using errcode = 'P0001', detail = 'the household already holds 100 drafts';
    end if;
    insert into public.outreach_drafts (draft_id, profile_id, draft_key, recipient, topic, water, area, contact_name,
                                        to_address, subject, body, notes, public_context, signature_hash, revision,
                                        operation_id, created_at, updated_at)
    values ((p_draft ->> 'id')::uuid, p_profile_id, p_draft ->> 'key', p_draft ->> 'recipient', p_draft ->> 'topic',
            p_draft ->> 'water', nullif(p_draft -> 'area', 'null'::jsonb), p_draft ->> 'name', p_draft ->> 'to',
            p_draft ->> 'subject', p_draft ->> 'body', p_draft -> 'notes', nullif(p_draft -> 'publicContext', 'null'::jsonb),
            p_draft ->> 'signatureHash', 1, p_operation_id, clock_timestamp(), clock_timestamp())
    returning * into saved;
  end if;

  -- 4. Settle this operation's own row: the draft id and revision only.
  receipt := jsonb_build_object('status', 'succeeded', 'draftId', saved.draft_id, 'revision', saved.revision,
                                'unresolvedOperations', '[]'::jsonb);
  update public.operations o
     set status = 'succeeded', result = receipt || jsonb_build_object('operationId', p_operation_id), updated_at = now()
   where o.operation_id = p_operation_id and o.profile_id = p_profile_id
     and o.domain = 'outreach' and o.status = 'pending';
  get diagnostics touched = row_count;
  if touched <> 1 then
    raise exception 'HALO_OPERATION_NOT_PENDING' using errcode = 'P0001';
  end if;

  return jsonb_build_object('receipt', receipt, 'draft', public.outreach_draft_json(saved));
end;
$$;

revoke execute on function public.save_outreach_draft(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_outreach_draft(uuid, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4. A settled 'outreach' operation keeps its status (the 0026 guard)
-- ---------------------------------------------------------------------------
-- runOperation settles by operation id alone, and settles 'failed' whenever
-- its execute throws. If the save committed and its response was lost, that
-- settle would turn a 'succeeded' row whose draft was written into 'failed'.

create or replace function public.guard_settled_outreach_operation()
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

revoke execute on function public.guard_settled_outreach_operation() from public, anon, authenticated;

create or replace trigger operations_outreach_settled_guard
  before update on public.operations
  for each row
  when (old.domain = 'outreach' and old.status <> 'pending' and new.status is distinct from old.status)
  execute function public.guard_settled_outreach_operation();

-- ---------------------------------------------------------------------------
-- 5. Clear all removes the drafts too (the 0026 pattern)
-- ---------------------------------------------------------------------------
-- 0024's clear_household_records settles its own 'privacy.clear.all' row
-- from 'pending' to 'succeeded' as its last write, in its own transaction.
-- This trigger deletes the same household's drafts at that moment, so they
-- go with the clear or not at all, without changing 0024. Clear Journal does
-- not touch them.

create or replace function public.clear_outreach_with_privacy_clear()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.outreach_drafts d where d.profile_id = new.profile_id;
  return null;
end;
$$;

revoke execute on function public.clear_outreach_with_privacy_clear() from public, anon, authenticated;

create or replace trigger operations_privacy_clear_outreach
  after update on public.operations
  for each row
  when (new.domain = 'privacy' and new.kind = 'privacy.clear.all' and old.status = 'pending'
        and new.status = 'succeeded' and new.profile_id is not null)
  execute function public.clear_outreach_with_privacy_clear();

-- What a clear all would remove from the drafts, for the privacy review's
-- counts (lib/privacyStore.js merges it into privacy_counts' answer).
create or replace function public.outreach_privacy_counts(p_profile_id uuid)
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
  return jsonb_build_object('outreach_drafts',
    (select count(*) from public.outreach_drafts d where d.profile_id = p_profile_id));
end;
$$;

revoke execute on function public.outreach_privacy_counts(uuid) from public, anon, authenticated;
grant execute on function public.outreach_privacy_counts(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Verification (read only). Expect one row, all seven columns true.
-- ---------------------------------------------------------------------------
--   select
--     (select relrowsecurity from pg_class where oid = 'public.outreach_drafts'::regclass) as rls_on,
--     (select count(*) from pg_policies where schemaname = 'public' and tablename = 'outreach_drafts') = 0
--       as no_policies,
--     not exists (
--       select 1 from unnest(array['anon', 'authenticated']) as r
--        where has_any_column_privilege(r, 'public.outreach_drafts', 'SELECT')
--           or has_any_column_privilege(r, 'public.outreach_drafts', 'INSERT')
--           or has_any_column_privilege(r, 'public.outreach_drafts', 'UPDATE')
--           or has_table_privilege(r, 'public.outreach_drafts', 'DELETE'))
--       as no_client_access,
--     not exists (
--       select 1 from unnest(array['anon', 'authenticated']) as r
--        cross join unnest(array['public.outreach_draft_json(public.outreach_drafts)',
--                                'public.read_outreach_drafts(uuid, uuid)',
--                                'public.save_outreach_draft(uuid, uuid, jsonb)',
--                                'public.outreach_privacy_counts(uuid)',
--                                'public.guard_settled_outreach_operation()',
--                                'public.clear_outreach_with_privacy_clear()']) as f
--        where has_function_privilege(r, f, 'EXECUTE'))
--       and (select bool_and(has_function_privilege('service_role', f, 'EXECUTE'))
--              from unnest(array['public.read_outreach_drafts(uuid, uuid)',
--                                'public.save_outreach_draft(uuid, uuid, jsonb)',
--                                'public.outreach_privacy_counts(uuid)']) as f)
--       as functions_service_role_only,
--     (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and not p.prosecdef and 'search_path=public' = any (p.proconfig)
--         and p.proname in ('outreach_draft_json', 'read_outreach_drafts', 'save_outreach_draft', 'outreach_privacy_counts',
--                           'guard_settled_outreach_operation', 'clear_outreach_with_privacy_clear')) = 6
--       as functions_invoker_pinned,
--     (select count(*) from pg_trigger
--       where tgrelid = 'public.operations'::regclass
--         and tgname in ('operations_outreach_settled_guard', 'operations_privacy_clear_outreach')) = 2
--       as triggers_on,
--     (select count(*) from pg_constraint
--       where conrelid = 'public.outreach_drafts'::regclass and contype = 'c') = 5
--       as five_checks;
--
-- ---------------------------------------------------------------------------
-- If you need to back out 0031
-- ---------------------------------------------------------------------------
-- The B17 routes go back to answering feature_unavailable for drafts,
-- exactly as before this is applied; contacts, context and the connection
-- answer keep working. What is lost: every household's outreach drafts, for
-- good, because the table is dropped. Ledger rows in domain 'outreach' stay;
-- they hold draft ids, revisions and statuses only. Nothing was ever sent, so
-- nothing outside HALO is affected.
--
-- The tested copy of this block is in docs/backend/YOUR_TODO.md, which is what
-- test/migrationBackout.test.mjs runs.
--
-- <!-- backout-0031 -->
-- drop trigger if exists operations_privacy_clear_outreach on public.operations;
-- drop trigger if exists operations_outreach_settled_guard on public.operations;
-- drop function if exists public.clear_outreach_with_privacy_clear();
-- drop function if exists public.guard_settled_outreach_operation();
-- drop function if exists public.outreach_privacy_counts(uuid);
-- drop function if exists public.save_outreach_draft(uuid, uuid, jsonb);
-- drop function if exists public.read_outreach_drafts(uuid, uuid);
-- drop function if exists public.outreach_draft_json(public.outreach_drafts);
-- drop table if exists public.outreach_drafts;
--
-- Then run: notify pgrst, 'reload schema';
