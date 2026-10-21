-- HALO: Luna's conversations, turns and runs (B03 plan, Task 1).
--
-- Run once in the Supabase SQL editor, AFTER 0019. Safe to re-run.
--
-- Locks: creates three new tables and their indexes. It does not read or write
-- any existing table, so nothing else is blocked while it runs. The foreign
-- keys to profiles take a brief SHARE ROW EXCLUSIVE on profiles as they are
-- created.
--
-- WHAT THESE TABLES ARE FOR, in the client's own terms.
--
-- Luna's conversation is held by the SERVER. The browser sends one new
-- sentence per turn and nothing else: no history, no household block
-- (test/ui/luna-live.spec.ts asserts the body carries neither). It also never
-- appends the person's own message to the transcript it shows; it only
-- replaces the whole conversation with what the server returned. So the
-- ordered transcript stored here, INCLUDING the person's own turn, is the only
-- thing that can put their question back on their screen. A payload missing
-- that turn loses their own words.
--
--   luna_conversations  one per household, with the positive integer revision
--                       the client requires and uses as an If-Match
--                       precondition when it clears the conversation.
--   luna_turns          the ordered transcript. `seq` is the order, because
--                       the client renders `messages` in array order and the
--                       contract has no timestamp on a message. Only an
--                       assistant turn may carry `sources` and `evidence`; a
--                       user turn carrying either makes the client's validator
--                       discard the whole conversation.
--   luna_runs           one attempt to answer one turn. POST /api/luna/messages
--                       must return a run inside the client's hard 20 second
--                       timeout and must not hold the connection open, so the
--                       answer is written later and collected by polling
--                       GET /api/luna/runs/status.
--
-- STATUSES ARE EXACTLY THE ONES THE CLIENT ACCEPTS, and 'unknown' is not one
-- of them. For a run there is no 'unknown' in the contract at all, so the
-- equivalent of the operation ledger's "a pending row past its window reads as
-- unknown" (0017) is: an unsettled run past its window READS AS 'failed'
-- (lib/luna.js). That derivation is why `settled_at` exists as a column of its
-- own and why a check keeps it in step with the status: a reader must be able
-- to tell "still working" from "finished" without guessing, and a process
-- killed by the invocation ceiling must not leave a run that looks like work
-- still in progress for ever.
--
-- OWNERSHIP IS ENFORCED TWICE. Every row carries `profile_id` and cascades
-- from the account like every other owned table. A turn and a run ALSO carry a
-- composite foreign key to (conversation id, owner), so a row cannot be
-- attached to another household's conversation even if route code passes the
-- wrong owner. The one unique key on `luna_conversations.profile_id` is the
-- second half of that: a household has exactly one conversation, which is all
-- the client surface has words for (`GET /api/luna/conversations?current=true`
-- takes no id, no cursor and no page), and it makes "start one if there is
-- none" an atomic insert rather than a read-then-write race. A later package
-- that wants several conversations per household drops that one constraint and
-- adds a current-conversation pointer.
--
-- NO HOUSEHOLD DATA (Ruling L2). There is no column here for a reading, a
-- symptom, a journal entry or a location. Luna answers from the public corpus
-- (`assistant_corpus`, migrations 0007/0008/0013) only in this package, and
-- whether household readings and symptom names may reach a free-tier model is
-- an open decision. Storing household data here would need a migration, which
-- is exactly the visibility that decision deserves.
--
-- CLEARING. `POST /api/luna/conversations/clear` deletes the turns and raises
-- the revision, keeping the conversation id. Keeping the id is deliberate: the
-- client ignores a server conversation whose id differs from the one it holds,
-- so rotating the id out from under a live session would silently strand it.
-- Deleting the rows rather than marking them cleared is also deliberate: a
-- turn is free text a person typed, and "clear" has to mean the text is gone.
--
-- Degrades cleanly: every Luna route answers a non-retryable 503
-- feature_unavailable until this migration is applied, the same convention
-- 0016, 0017, 0018 and 0019 use. The capability also sits behind a
-- server-enforced feature flag that is off by default (BE-351), so applying
-- this does not turn Luna on.
--
-- Retention: rows are kept until the owner is deleted (ON DELETE CASCADE), or
-- until the person clears the conversation. No purge job is defined here on
-- purpose. Retention periods are still unapproved in
-- docs/backend/privacy-and-retention.md and this file does not invent one. A
-- turn is free text somebody typed, which makes the period more sensitive than
-- most of the open ones, not less.
--
-- Privacy: the service role is the only reader. Row level security is on with
-- no policy at all and the default privileges are revoked, so not even the
-- owner can read their own conversation with their own session; it comes back
-- through the Luna routes, which read it with the service role after verifying
-- the token.

create table if not exists public.luna_conversations (
  id          uuid        primary key default gen_random_uuid(),
  profile_id  uuid        not null unique references public.profiles (id) on delete cascade,
  revision    integer     not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- What the composite foreign keys below point at, so a turn or a run can
  -- never belong to one household's conversation and another's profile.
  unique (id, profile_id)
);

create table if not exists public.luna_turns (
  id              uuid        primary key default gen_random_uuid(),
  conversation_id uuid        not null,
  profile_id      uuid        not null references public.profiles (id) on delete cascade,
  -- Array order is the contract, so it is stored rather than derived. An
  -- identity column means two concurrent appends cannot claim one position and
  -- no reader has to ask for the highest one first.
  seq             bigint      not null generated by default as identity,
  role            text        not null,
  body            text        not null,
  sources         jsonb,
  evidence        jsonb,
  created_at      timestamptz not null default now(),
  unique (conversation_id, seq),
  foreign key (conversation_id, profile_id)
    references public.luna_conversations (id, profile_id) on delete cascade
);

create table if not exists public.luna_runs (
  id                uuid        primary key default gen_random_uuid(),
  profile_id        uuid        not null references public.profiles (id) on delete cascade,
  conversation_id   uuid        not null,
  -- The turn this run answers. It is what `pendingRequest.text` is read from
  -- after a reload, so the question is never stored twice.
  turn_id           uuid        not null unique references public.luna_turns (id) on delete cascade,
  -- The client's own id for the message. It polls by this id when it never saw
  -- a run id, so it must be findable by either (and it is not a uuid column:
  -- the contract calls it a string of up to 200 characters).
  client_message_id text        not null,
  status            text        not null default 'queued',
  message           text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  settled_at        timestamptz,
  unique (profile_id, client_message_id),
  foreign key (conversation_id, profile_id)
    references public.luna_conversations (id, profile_id) on delete cascade
);

-- Each check is added separately and idempotently, so re-running is safe and a
-- partially applied earlier run is completed rather than erroring. The bounds
-- are the client's own validators (lib/frontend/production/luna-service.ts):
-- a payload outside them is not "slightly wrong", it is discarded whole, so
-- the database refuses to hold something that could only ever be thrown away.
do $$
begin
  -- The client requires an integer strictly greater than 0.
  if not exists (select 1 from pg_constraint where conname = 'luna_conversations_revision_check') then
    alter table public.luna_conversations add constraint luna_conversations_revision_check
      check (revision >= 1);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'luna_turns_role_check') then
    alter table public.luna_turns add constraint luna_turns_role_check
      check (role in ('user', 'assistant'));
  end if;
  -- 16000 is the client's text cap; 1000 is what its composer can send, and
  -- what `pendingRequest.text` is validated against when a reload restores it.
  if not exists (select 1 from pg_constraint where conname = 'luna_turns_body_length_check') then
    alter table public.luna_turns add constraint luna_turns_body_length_check
      check (char_length(body) between 1 and 16000
             and (role <> 'user' or char_length(body) <= 1000));
  end if;
  -- The control characters the client's `text()` rejects. Tab, newline and
  -- carriage return are permitted, because a pasted question has them.
  if not exists (select 1 from pg_constraint where conname = 'luna_turns_body_control_check') then
    alter table public.luna_turns add constraint luna_turns_body_control_check
      check (body !~ E'[\x01-\x08\x0b\x0c\x0e-\x1f]');
  end if;
  -- Evidence on a user turn makes the client discard the whole conversation,
  -- and sources on one would be a claim nobody made.
  if not exists (select 1 from pg_constraint where conname = 'luna_turns_qualified_check') then
    alter table public.luna_turns add constraint luna_turns_qualified_check
      check (role = 'assistant' or (sources is null and evidence is null));
  end if;
  -- At most 30 sources; evidence, when present, is 1 to 20 blocks (the client
  -- rejects an empty evidence array outright).
  if not exists (select 1 from pg_constraint where conname = 'luna_turns_payload_shape_check') then
    alter table public.luna_turns add constraint luna_turns_payload_shape_check
      check ((sources is null or (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 30))
             and (evidence is null or (jsonb_typeof(evidence) = 'array'
                                       and jsonb_array_length(evidence) between 1 and 20)));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'luna_runs_status_check') then
    alter table public.luna_runs add constraint luna_runs_status_check
      check (status in ('queued', 'generating', 'completed', 'failed', 'cancelled'));
  end if;
  -- "Still working" and "finished" must not be confusable: a settled run says
  -- when it settled, and an unsettled one cannot pretend it did.
  if not exists (select 1 from pg_constraint where conname = 'luna_runs_settled_check') then
    alter table public.luna_runs add constraint luna_runs_settled_check
      check ((status in ('queued', 'generating')) = (settled_at is null));
  end if;
  -- `LunaRun.message` is optional and capped at 1000 characters.
  if not exists (select 1 from pg_constraint where conname = 'luna_runs_message_check') then
    alter table public.luna_runs add constraint luna_runs_message_check
      check (message is null or char_length(message) between 1 and 1000);
  end if;
  -- A client id of up to 200 printable characters, which is what the contract
  -- allows and what a lookup key can safely be.
  if not exists (select 1 from pg_constraint where conname = 'luna_runs_client_message_id_check') then
    alter table public.luna_runs add constraint luna_runs_client_message_id_check
      check (client_message_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$');
  end if;
end $$;

-- The one run a conversation may still be waiting on, newest first. This is
-- what `pendingRequest` is built from after a reload.
create index if not exists luna_runs_open
  on public.luna_runs (conversation_id, created_at desc)
  where settled_at is null;

alter table public.luna_conversations enable row level security;
alter table public.luna_turns enable row level security;
alter table public.luna_runs enable row level security;

-- No policy, deliberately, and stricter than it looks: the owner cannot read
-- their own conversation with their own session either. Every read and write
-- goes through a route handler using the service role, which bypasses row
-- level security, after it has verified the token. Supabase's default
-- privileges would otherwise grant anon and authenticated arwdDxtm on these
-- new public tables (confirmed by the 2026-10-17 catalog audit), so revoking
-- here is what actually closes that, the same way 0016 does for home_contexts,
-- 0017 for operations and 0018 for recovery_challenges.
revoke all on table public.luna_conversations from anon, authenticated;
revoke all on table public.luna_turns from anon, authenticated;
revoke all on table public.luna_runs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verification (read only). Expect one row, all five columns true.
-- ---------------------------------------------------------------------------
--   select
--     (select bool_and(c.relrowsecurity) from pg_class c
--       where c.oid in ('public.luna_conversations'::regclass,
--                       'public.luna_turns'::regclass,
--                       'public.luna_runs'::regclass)) as rls_on,
--     (select count(*) from pg_policies
--       where schemaname = 'public'
--         and tablename in ('luna_conversations', 'luna_turns', 'luna_runs')) = 0
--       as no_policies,
--     not exists (
--       select 1 from unnest(array['public.luna_conversations', 'public.luna_turns', 'public.luna_runs']) as t,
--                   unnest(array['anon', 'authenticated']) as r
--        where has_any_column_privilege(r, t, 'SELECT')
--           or has_any_column_privilege(r, t, 'INSERT')
--           or has_any_column_privilege(r, t, 'UPDATE')
--           or has_table_privilege(r, t, 'DELETE'))
--       as no_client_access,
--     (select bool_and(has_table_privilege('service_role', t, 'INSERT')
--                  and has_table_privilege('service_role', t, 'UPDATE'))
--        from unnest(array['public.luna_conversations', 'public.luna_turns', 'public.luna_runs']) as t)
--       as service_role_can_write,
--     (select count(*) from pg_constraint
--       where conrelid in ('public.luna_conversations'::regclass,
--                          'public.luna_turns'::regclass,
--                          'public.luna_runs'::regclass)
--         and contype = 'c') = 10
--       as ten_checks;
--
-- ---------------------------------------------------------------------------
-- If you need to back out 0020
-- ---------------------------------------------------------------------------
-- Every Luna route goes back to answering a non-retryable 503
-- feature_unavailable, exactly as it does before this is applied, so backing
-- out disables Luna rather than breaking the existing app. The legacy
-- assistant at /api/assistant does not use these tables and is unaffected.
--
-- What is lost: every conversation, every turn and every run. A question
-- somebody asked and the answer Luna gave are deleted for good, and a run in
-- flight can no longer be collected by the browser waiting on it; it is told
-- the feature is unavailable rather than given a stale answer. No owned
-- household record is touched, because nothing outside these three tables
-- references them.
--
-- The tested copy of this block is in docs/backend/YOUR_TODO.md, which is what
-- test/migrationBackout.test.mjs runs.
--
-- <!-- backout-0020 -->
-- drop table if exists public.luna_runs;
-- drop table if exists public.luna_turns;
-- drop table if exists public.luna_conversations;
--
-- Then run: notify pgrst, 'reload schema';
