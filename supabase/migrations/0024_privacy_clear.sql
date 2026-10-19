-- HALO: privacy, the household's own clear of its records, the review
-- fingerprint, the inspect counts, the receipt purge, the status probe and a
-- freeze on settled privacy receipts (B07 plan, Task 1, Rulings P3, P4, P6,
-- P10, P11 and P16).
--
-- Run once in the Supabase SQL editor, AFTER 0023. Safe to re-run. Before the
-- first apply, run the profiles column check in docs/backend/YOUR_TODO.md 2.14
-- against production: it must return no rows.
--
-- Locks: creates six functions and one trigger, and no table. Creating the
-- trigger on public.operations takes a brief SHARE ROW EXCLUSIVE on that
-- table (a re-run replaces it under the same brief lock), so any ledger claim
-- or settle at that moment waits for it. Nothing existing is read or
-- rewritten.
--
-- REFUSES TO APPLY ON A LAGGING SCHEMA (Ruling P11). The first statement
-- checks that every table this file reads or deletes from exists, and that
-- profiles.tenure does (0016, 0017, 0020, 0021, 0022 and 0023), and raises
-- naming what is missing otherwise. So wherever clear_household_records
-- exists, every table it deletes from exists too, with one deliberate
-- exception: public.daily_maxima (0025, B08 Ruling E23) needs only 0016 and
-- may be applied before or after this file, so the clear and the counts
-- check for it with to_regclass and read it only when it is there.
--
-- ---------------------------------------------------------------------------
-- THE FUNCTIONS, FOR THE CALLERS (lib/privacyStore.js, Task 2)
-- ---------------------------------------------------------------------------
-- All six are security invoker with search_path pinned to public, and only
-- service_role may execute them. p_profile_id is always the verified session
-- owner: the routes pass it, never the client.
--
--   public.privacy_schema_version() returns int
--     Immutable, always 1. The status probe: a missing function (PGRST202 or
--     42883) means 0024 is not applied, and privacy answers 503 (P11).
--
--   public.privacy_fingerprint(p_profile_id uuid, p_tables text[]) returns text
--     Stable. 64 lowercase hex characters: SHA-256 over, for each listed table
--     in the fixed order below, the sorted md5 of each of the household's
--     rows as JSON (profiles: the reset columns only; home_contexts: every
--     column but backfill_state, backfill_from, backfill_to and
--     backfill_updated_at). p_tables must be a subset of, with no repeats:
--       profiles, home_contexts, household_bands, symptom_logs,
--       notification_prefs, push_subscriptions, profile_preferences,
--       explore_areas, household_actions, household_action_preferences,
--       luna_conversations, luna_turns
--     in any order (the order passed does not change the result). Anything
--     else is HALO_INVALID_INPUT. An empty array gives one fixed constant.
--     Server-written tables (daily_scores, alerts, home_risks, luna_runs,
--     household_action_state, operations, and daily_maxima where 0025 is
--     applied) are deliberately not fingerprinted (P6), so a background
--     refresh does not void a review. For the same
--     reason home_contexts is hashed without its four backfill_* columns,
--     which the history backfill writes in the background.
--     Luna's answer turns are server-written too, and so are the revision and
--     updated_at of the conversation they advance, but luna_turns and
--     luna_conversations ARE fingerprinted, on purpose: a turn is written
--     only because the person asked a question, and the transcript is what
--     the person reviewed, so a question answered between review and confirm
--     voids the review (the person asks again).
--     The tables clear_household_records checks for each scope:
--       journal  {symptom_logs}
--       all      every table in the list above
--
--   public.privacy_counts(p_profile_id uuid, p_scope text) returns jsonb
--     Stable. What clear_household_records would remove for p_scope, read in
--     one statement, as {<table>: n} with every key present (0 included):
--       journal  {"symptom_logs": n, "alerts": n}   alerts: season summaries only
--       all      {"profiles": 0 or 1, "home_contexts", "daily_scores",
--                 "home_risks", "household_bands", "symptom_logs", "alerts",
--                 "notification_prefs", "push_subscriptions",
--                 "profile_preferences", "explore_areas", "household_actions",
--                 "household_action_preferences", "household_action_state",
--                 "luna_conversations", "luna_turns", "luna_runs",
--                 "operations", "daily_maxima"}
--     daily_maxima is 0 where 0025 is not applied.
--     profiles is 1 when the row holds any value its reset would change.
--     operations counts the household's settled rows (a pending one makes the
--     clear refuse instead). recovery_challenges and auth.users are kept, so
--     they are not counted.
--
--   public.clear_household_records(p_profile_id uuid, p_operation_id uuid,
--                                  p_scope text, p_fingerprint text) returns jsonb
--     The clear, one transaction (P3, P4). p_scope is 'journal' or 'all';
--     p_fingerprint is privacy_fingerprint over that scope's tables, as the
--     review token bound it; p_operation_id is the caller's own pending ledger
--     row, domain 'privacy', kind 'privacy.clear.<scope>'. Returns
--       {"receipt": {"operationId": "<uuid>", "status": "succeeded",
--                    "scope": "journal" | "all"},
--        "removed": <int, total rows deleted plus 1 for a reset profile>}
--     and has already settled the ledger row 'succeeded' with exactly that
--     receipt. `removed` is for tests and logs, never for a response or the
--     ledger.
--
--   public.purge_privacy_receipts(p_profile_id uuid default null) returns int
--     Deletes settled 'privacy' ledger rows whose updated_at is more than 24
--     hours ago: only this owner's when p_profile_id is given, every
--     household's when it is null (the daily cron). Pending rows are never
--     touched (the reaper owns them). A row another transaction has locked
--     (a clear in progress) is skipped, not waited for, and goes on a later
--     run. Returns how many it deleted.
--
--   public.guard_settled_privacy_operation() returns trigger
--     The trigger function of operations_privacy_settled_guard (P16). Not
--     callable.
--
-- Refusals are SQLSTATE P0001 with exactly this message. DETAIL names the
-- argument or the rule, never a row value, an id or a fingerprint (0021
-- review finding B):
--   HALO_INVALID_INPUT          a null argument, a scope other than journal or
--                               all, a fingerprint that is not 64 lowercase hex
--                               characters, or a table outside the list
--   HALO_OPERATION_NOT_PENDING  the ledger row is missing, settled, another
--                               household's, another domain's or another
--                               kind's (all the same error); nothing written
--   HALO_REVIEW_CHANGED         the records moved since the review; nothing written
--   HALO_BUSY                   other work is pending (below); nothing written
--   HALO_OPERATION_SETTLED      the trigger: a settled privacy row's status may
--                               not change
-- Anything else (a deadlock, 40P01, see the lock graph) is Postgres's own
-- error, and it too leaves nothing deleted and the ledger row pending.
--
-- ---------------------------------------------------------------------------
-- THE CLEAR (Rulings P3 and P4, Vibhav's D-P1 and D-P4)
-- ---------------------------------------------------------------------------
-- One function call is one transaction, so every deletion, the profile reset
-- and the settle of the caller's own ledger row commit together or none of
-- them does:
--
--   1. Lock the profile FOR UPDATE. Every insert into an owned table takes FOR
--      KEY SHARE on it for its foreign key, so while the clear runs no new
--      household row, ledger claims included, can be written: they wait.
--   2. Lock this operation's own ledger row, which must be this household's,
--      domain 'privacy', kind 'privacy.clear.<scope>', still 'pending'.
--      Otherwise HALO_OPERATION_NOT_PENDING. The reaper settles an abandoned
--      row with a conditional `update ... where status = 'pending'`, so the
--      two exclude each other (the B06 H8 argument): a reaped row is never
--      cleared, and a clear that holds its row is never reaped.
--   3. Recompute the review fingerprint for the scope and compare it with
--      p_fingerprint, or HALO_REVIEW_CHANGED.
--   4. Refuse with HALO_BUSY while other work is pending. For 'all': any other
--      ledger row of this household that is 'pending', in any domain, or a
--      Luna run 'queued' or 'generating' updated within the last 120 seconds
--      (lib/operations.js DEFAULT_STALE_AFTER_MS; an older one is dead and is
--      cleared with its conversation). For 'journal': another pending
--      'privacy' row. Step 1 means no new claim can appear after this check.
--   5. Delete, every statement scoped to p_profile_id, in foreign-key-safe
--      order. 'journal': symptom_logs, and alerts of type 'season_summary'
--      (D-P4; journal findings are computed on read, so nothing else is
--      derived). 'all': Luna runs, turns, then conversations (what the
--      cascade from the conversation would remove, deleted child first so
--      each is counted); daily_scores before home_contexts (their composite
--      key is ON DELETE NO ACTION, 0016), and daily_maxima before
--      home_contexts too when 0025 is applied (its key cascades, but deleting
--      it first counts it); home_risks, symptom_logs, alerts;
--      notification_prefs, household_bands, push_subscriptions, then
--      profile_preferences (notifications before bands before preferences,
--      the order save_settings and the 0021 triggers take them);
--      explore_areas; household_actions, household_action_preferences,
--      household_action_state; then every settled ledger row of the household
--      except this one.
--   6. 'all' only: reset the profile. The row is NOT deleted: operations
--      cascades from it, so deleting it would delete this clear's own receipt
--      and reconcile would 404, and a login with no profile is a state no
--      route expects (0001's handle_new_user makes it only on sign-up). It
--      keeps id and created_at; every other column goes back to its column
--      default (`= default`), which on the schema as migrated is null for
--      address, lat, lng, zip, county, pwsid, build_year, water_source,
--      home_year, state, onboard_request_id and tenure, false for renter_mode
--      and 'en' for locale. With lat and lng null, GET /api/profile answers
--      onboarded: false. The 0021 triggers run as for any profile write and
--      change nothing: tenure is already null, and the settings revision
--      trigger finds the preferences row already deleted.
--   7. Settle the own ledger row 'succeeded' with the minimal receipt
--      {operationId, status, scope} (P10). No row content, no count.
--   8. Return {receipt, removed}.
--
-- So a deletion exists if and only if its operation is 'succeeded'. Every
-- refusal raises before anything is deleted, and any error after rolls the
-- deletions back with it, so "The request was not applied. Your data is
-- unchanged." is true for every 'failed' (trap P-13).
--
-- KEPT by 'all' (D-P1, P4): the auth.users row (the login), the reset profile
-- row, recovery_challenges (proof material about the login, Open question 2),
-- this clear's own receipt (purged 24 hours after it settles), and any other
-- household's rows, which no statement here can reach.
--
-- ---------------------------------------------------------------------------
-- THE LOCK GRAPH (reasoned on paper: PGlite has one connection)
-- ---------------------------------------------------------------------------
-- Resources for one household: A its auth.users row, P its profile row, O the
-- clear's own ledger row, O' any other ledger row, N notification_prefs, B
-- household_bands, R profile_preferences, C a Luna conversation row, H a home
-- context row, X any other owned row.
--
--   clear_household_records   P (for update) -> O (for update) -> reads, no
--                             locks -> deletes of child rows in the order of
--                             step 5 (X, C, H, N -> B -> R) -> O' (delete) ->
--                             P (update, held) -> O (settle, held). Never A:
--                             the reset changes no key column, so no foreign
--                             key check against auth.users runs.
--   DELETE /api/account       A -> P (delete) -> cascade to O, O', N, B, R, X.
--                             P before O, the same as the clear.
--   save_settings (0021)      P -> O_settings -> N -> B -> R.
--   save_household (0015),    P first.
--   0016 functions
--   commit_household_actions  O_actions -> household_action_state -> task
--   (0023)                    rows -> FOR KEY SHARE on P for each insert.
--   runOperation claim        inserts O_new, then FOR KEY SHARE on P.
--   runOperation settle       one O row by id, nothing else.
--   reaper                    pending O rows only, nothing else.
--   purge_privacy_receipts    settled privacy O' rows only, nothing else, and
--                             FOR UPDATE SKIP LOCKED: it never waits on a row.
--   PUT /api/notifications    N -> R (trigger); an insert also KEY SHARE on P.
--   Luna statements           single statements: a turn or run insert takes
--                             KEY SHARE on C, on its turn and on P.
--   daily cron                single statements: an alert insert KEY SHARE on
--                             P, a reading insert KEY SHARE on P and H.
--   record_daily_maxima       per row, KEY SHARE on P, then on H, then the
--   (0025)                    row. P first, so it waits on the clear's P and
--                             then skips the deleted home: no cycle.
--
-- Why no cycle forms with the house writers:
--   * account deletion, save_settings, save_household and the 0016 functions
--     all take P first, so each serializes with the clear on P. Account
--     deletion holds only A while it waits, which the clear never wants. If
--     it wins, the clear's ledger row is cascaded away and the clear raises
--     HALO_OPERATION_NOT_PENDING.
--   * commit_household_actions holds O_actions and task rows and then waits
--     on P. Its O_actions row was claimed, and committed as 'pending', by an
--     earlier statement, so a clear 'all' that holds P reads it at step 4 and
--     raises HALO_BUSY before it touches any task row; a clear 'journal'
--     never touches task rows. Either way the clear never waits on the
--     commit, the commit waits on the clear, and there is no cycle. (This
--     closes, for this pairing, the deadlock the plan's finding F3 allowed.)
--   * a ledger claim inserts O_new and then waits on P. The clear does not
--     see the uncommitted row, so it neither waits on it nor counts it busy;
--     the claim goes on after the clear commits (plan finding F2: a new,
--     deliberate request).
--   * the reaper and runOperation's settle hold O rows only and never wait on
--     P. If the reaper holds O, the clear waits, then finds O no longer
--     pending and refuses. Neither wants anything the clear holds.
--   * PUT /api/notifications takes N then R, and the clear deletes N before R,
--     the same order, so they wait rather than deadlock.
--   * purge_privacy_receipts selects its rows FOR UPDATE SKIP LOCKED, so it
--     skips every settled row the clear has deleted and not yet committed
--     (the clear removes them itself) and never waits on the clear. Without
--     SKIP LOCKED the two would delete the same household's settled privacy
--     rows each in its own scan order, and two such rows locked in opposite
--     orders would be a cycle.
--   * Luna and cron inserts (a turn or run insert: P and C; a reading insert:
--     P and H). An insert checks each of its foreign keys with an RI trigger,
--     and Postgres fires a table's triggers in name order. The RI triggers
--     are named RI_ConstraintTrigger_c_<trigger oid>, and on this schema the
--     profiles key's trigger sorts first on luna_turns, luna_runs and
--     daily_scores (it was created first, so its number is lower; the
--     ordering is pinned by test/privacyClearDb.test.mjs). So the insert
--     asks for KEY SHARE on P first, while it holds nothing but its own
--     uncommitted tuple, which the clear's deletes cannot see. It waits on P;
--     when the clear commits, the P check passes and the C or H check fails
--     with 23503 (the row is gone). The insert is refused, the clear is
--     whole, and no cycle forms.
-- Residual, accepted: the same Luna and cron inserts deadlock with the clear
-- only where the profiles key's trigger would sort AFTER the C or H key's.
-- That needs a production database whose trigger names sort differently from
-- PGlite's: the constraint oids straddling a change in digit count (for
-- example c_99999 before c_100000 compares as text the other way round), or
-- a constraint dropped and re-created after the other so its oid is higher.
-- Then the insert would hold KEY SHARE on C or H and wait on P while the clear
-- held P and waited on C or H; one side dies with 40P01. That is still
-- honest: a 40P01 on the clear rolls it back whole and leaves its row pending
-- (so 'failed' is true), and an aborted insert loses only its own write. No
-- cheap reordering helps: locking C and H before P would invert against the
-- P-first 0016 functions, and weakening the P lock to FOR NO KEY UPDATE would
-- let an insert land behind the deletes and survive a 'succeeded' clear.
--
-- ---------------------------------------------------------------------------
-- RETENTION AND PRIVACY
-- ---------------------------------------------------------------------------
-- No table is created, so nothing new is retained. Privacy receipts are
-- ordinary 0017 ledger rows in domain 'privacy' holding {operationId, status,
-- scope} (and an export's group names and private-text choice), and
-- purge_privacy_receipts removes them 24 hours after they settle (Ruling P10,
-- Open question 1). The fingerprint never leaves the server and is never
-- stored.
--
-- Degrades cleanly: until this is applied, privacy.status reports the
-- feature unavailable from its probe (P11), and nothing else calls these
-- functions.

-- ---------------------------------------------------------------------------
-- 1. Refuse to apply on a lagging schema (Ruling P11)
-- ---------------------------------------------------------------------------

do $$
declare
  missing text;
begin
  select string_agg(format('%s (%s)', t.name, t.migration), ', ' order by t.at) into missing
    from (values
      (1, 'public.home_contexts', '0016'),
      (2, 'public.operations', '0017'),
      (3, 'public.luna_conversations', '0020'),
      (4, 'public.luna_turns', '0020'),
      (5, 'public.luna_runs', '0020'),
      (6, 'public.profile_preferences', '0021'),
      (7, 'public.explore_areas', '0022'),
      (8, 'public.household_actions', '0023'),
      (9, 'public.household_action_preferences', '0023'),
      (10, 'public.household_action_state', '0023')
    ) as t(at, name, migration)
   where to_regclass(t.name) is null;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name = 'tenure'
  ) then
    missing := concat_ws(', ', missing, 'public.profiles.tenure (0021)');
  end if;
  if missing is not null then
    raise exception 'HALO 0024 cannot be applied: missing %. Apply 0016 to 0023 first.', missing;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. privacy_schema_version: the status probe (Ruling P11)
-- ---------------------------------------------------------------------------

create or replace function public.privacy_schema_version()
returns int
language sql
immutable
security invoker
set search_path = public
as $$
  select 1;
$$;

revoke execute on function public.privacy_schema_version() from public, anon, authenticated;
grant execute on function public.privacy_schema_version() to service_role;

-- ---------------------------------------------------------------------------
-- 3. privacy_fingerprint: what a review binds (Ruling P6)
-- ---------------------------------------------------------------------------
-- The JSON text of a row depends on two session settings: TimeZone (the
-- offset a timestamptz is written with) and extra_float_digits (how a double
-- precision is written). Both are pinned on the function, so a review minted
-- through one PostgREST session verifies through another. Hashes are sorted
-- byte-wise (collate "C"), so the result does not depend on the database's
-- collation or on the order rows were inserted in.

create or replace function public.privacy_fingerprint(p_profile_id uuid, p_tables text[])
returns text
language plpgsql
stable
security invoker
set search_path = public
set timezone to 'UTC'
set extra_float_digits to 1
as $$
declare
  -- The fixed order, and the whole of what may be fingerprinted.
  fingerprint_tables constant text[] := array[
    'profiles', 'home_contexts', 'household_bands', 'symptom_logs', 'notification_prefs',
    'push_subscriptions', 'profile_preferences', 'explore_areas', 'household_actions',
    'household_action_preferences', 'luna_conversations', 'luna_turns'
  ];
  material  text := 'halo:privacy-fingerprint:v1';
  tbl       text;
  part      text;
begin
  if p_profile_id is null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_profile_id is required';
  end if;
  if p_tables is null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_tables is required';
  end if;
  if array_position(p_tables, null) is not null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_tables may not contain null';
  end if;
  if exists (select 1 from unnest(p_tables) t where t <> all (fingerprint_tables)) then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001',
      detail = 'p_tables names a table the privacy fingerprint does not cover';
  end if;
  if exists (select 1 from unnest(p_tables) t group by t having count(*) > 1) then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_tables names a table more than once';
  end if;

  foreach tbl in array fingerprint_tables loop
    continue when not (tbl = any (p_tables));
    if tbl = 'profiles' then
      -- The reset columns only: id is the owner and created_at never changes.
      select coalesce(string_agg(s.h, ',' order by s.h collate "C"), '') into part
        from (select md5(row_to_json(r)::text) as h
                from (select p.address, p.lat, p.lng, p.zip, p.county, p.pwsid, p.build_year,
                             p.water_source, p.home_year, p.renter_mode, p.locale, p.state,
                             p.onboard_request_id, p.tenure
                        from public.profiles p where p.id = p_profile_id) r) s;
    elsif tbl = 'home_contexts' then
      -- Every column but the four backfill_* columns, which the server's
      -- history backfill writes after onboarding or a move
      -- (lib/homeContextRpc.js writeBackfillState). They change neither what
      -- a clear removes nor what the person reviewed, so a backfill between
      -- review and confirm does not void the review. revision and updated_at
      -- stay: they move only on the person's own answers.
      select coalesce(string_agg(s.h, ',' order by s.h collate "C"), '') into part
        from (select md5(row_to_json(r)::text) as h
                from (select c.id, c.profile_id, c.sequence, c.revision, c.origin, c.lat, c.lng,
                             c.county, c.state, c.pwsid, c.service_area_status, c.water_source,
                             c.home_year, c.match_method, c.onboard_request_id, c.effective_from,
                             c.effective_to, c.closed_reason, c.created_at, c.updated_at
                        from public.home_contexts c where c.profile_id = p_profile_id) r) s;
    else
      -- tbl is one of the constants above, never caller text.
      execute format(
        'select coalesce(string_agg(s.h, '','' order by s.h collate "C"), '''')
           from (select md5(row_to_json(t)::text) as h from public.%I t where t.profile_id = $1) s',
        tbl)
        into part using p_profile_id;
    end if;
    material := material || E'\n' || tbl || ':' || part;
  end loop;

  return encode(sha256(convert_to(material, 'UTF8')), 'hex');
end;
$$;

revoke execute on function public.privacy_fingerprint(uuid, text[]) from public, anon, authenticated;
grant execute on function public.privacy_fingerprint(uuid, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- 4. privacy_counts: what a clear would remove, for inspect's count
-- ---------------------------------------------------------------------------

create or replace function public.privacy_counts(p_profile_id uuid, p_scope text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  maxima bigint := 0;
begin
  if p_profile_id is null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_profile_id is required';
  end if;
  if p_scope is null or p_scope not in ('journal', 'all') then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_scope must be journal or all';
  end if;

  if p_scope = 'journal' then
    return jsonb_build_object(
      'symptom_logs', (select count(*) from public.symptom_logs x where x.profile_id = p_profile_id),
      'alerts', (select count(*) from public.alerts x where x.profile_id = p_profile_id and x.type = 'season_summary')
    );
  end if;

  -- 0025 may not be applied (header). A stable function reads every
  -- statement from one snapshot, so this is the same read as the rest.
  if to_regclass('public.daily_maxima') is not null then
    select count(*) into maxima from public.daily_maxima x where x.profile_id = p_profile_id;
  end if;

  return jsonb_build_object(
    -- The same test the clear's reset uses (section 5, step 6).
    'profiles', (select count(*) from public.profiles p
                  where p.id = p_profile_id
                    and (num_nonnulls(p.address, p.lat, p.lng, p.zip, p.county, p.pwsid, p.build_year,
                                      p.water_source, p.home_year, p.state, p.onboard_request_id, p.tenure) > 0
                         or p.renter_mode is distinct from false
                         or p.locale is distinct from 'en')),
    'home_contexts', (select count(*) from public.home_contexts x where x.profile_id = p_profile_id),
    'daily_scores', (select count(*) from public.daily_scores x where x.profile_id = p_profile_id),
    'home_risks', (select count(*) from public.home_risks x where x.profile_id = p_profile_id),
    'household_bands', (select count(*) from public.household_bands x where x.profile_id = p_profile_id),
    'symptom_logs', (select count(*) from public.symptom_logs x where x.profile_id = p_profile_id),
    'alerts', (select count(*) from public.alerts x where x.profile_id = p_profile_id),
    'notification_prefs', (select count(*) from public.notification_prefs x where x.profile_id = p_profile_id),
    'push_subscriptions', (select count(*) from public.push_subscriptions x where x.profile_id = p_profile_id),
    'profile_preferences', (select count(*) from public.profile_preferences x where x.profile_id = p_profile_id),
    'explore_areas', (select count(*) from public.explore_areas x where x.profile_id = p_profile_id),
    'household_actions', (select count(*) from public.household_actions x where x.profile_id = p_profile_id),
    'household_action_preferences', (select count(*) from public.household_action_preferences x where x.profile_id = p_profile_id),
    'household_action_state', (select count(*) from public.household_action_state x where x.profile_id = p_profile_id),
    'luna_conversations', (select count(*) from public.luna_conversations x where x.profile_id = p_profile_id),
    'luna_turns', (select count(*) from public.luna_turns x where x.profile_id = p_profile_id),
    'luna_runs', (select count(*) from public.luna_runs x where x.profile_id = p_profile_id),
    'operations', (select count(*) from public.operations x where x.profile_id = p_profile_id and x.status <> 'pending'),
    'daily_maxima', maxima
  );
end;
$$;

revoke execute on function public.privacy_counts(uuid, text) from public, anon, authenticated;
grant execute on function public.privacy_counts(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. clear_household_records: the atomic clear (Rulings P3 and P4)
-- ---------------------------------------------------------------------------
-- The steps and the lock graph are in the header.

create or replace function public.clear_household_records(
  p_profile_id    uuid,
  p_operation_id  uuid,
  p_scope         text,
  p_fingerprint   text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  journal_tables constant text[] := array['symptom_logs'];
  all_tables     constant text[] := array[
    'profiles', 'home_contexts', 'household_bands', 'symptom_logs', 'notification_prefs',
    'push_subscriptions', 'profile_preferences', 'explore_areas', 'household_actions',
    'household_action_preferences', 'luna_conversations', 'luna_turns'
  ];
  removed  bigint := 0;
  touched  bigint;
  receipt  jsonb;
begin
  -- Arguments first: nothing is read or written for a malformed call.
  if p_profile_id is null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_profile_id is required';
  end if;
  if p_operation_id is null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_operation_id is required';
  end if;
  if p_scope is null or p_scope not in ('journal', 'all') then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_scope must be journal or all';
  end if;
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001',
      detail = 'p_fingerprint must be 64 lowercase hexadecimal characters';
  end if;

  -- 1. The profile, first, as every writer of this household takes it. A
  --    missing profile is not an error of its own: its ledger rows cascaded
  --    with it, so step 2 refuses.
  perform 1 from public.profiles p where p.id = p_profile_id for update;

  -- 2. This operation's own ledger row, locked under the same condition the
  --    reaper updates it under.
  perform 1 from public.operations o
   where o.operation_id = p_operation_id and o.profile_id = p_profile_id
     and o.domain = 'privacy' and o.kind = 'privacy.clear.' || p_scope
     and o.status = 'pending'
     for update;
  if not found then
    raise exception 'HALO_OPERATION_NOT_PENDING' using errcode = 'P0001';
  end if;

  -- 3. The records are still the ones the person reviewed.
  if public.privacy_fingerprint(p_profile_id, case when p_scope = 'journal' then journal_tables else all_tables end)
     is distinct from p_fingerprint then
    raise exception 'HALO_REVIEW_CHANGED' using errcode = 'P0001',
      detail = 'the household records changed since the review';
  end if;

  -- 4. Nothing else in flight.
  if p_scope = 'all' then
    if exists (select 1 from public.operations o
                where o.profile_id = p_profile_id and o.operation_id <> p_operation_id
                  and o.status = 'pending') then
      raise exception 'HALO_BUSY' using errcode = 'P0001', detail = 'another operation of this household is pending';
    end if;
    if exists (select 1 from public.luna_runs r
                where r.profile_id = p_profile_id and r.status in ('queued', 'generating')
                  and r.updated_at > now() - interval '120 seconds') then
      raise exception 'HALO_BUSY' using errcode = 'P0001', detail = 'a Luna answer is being written';
    end if;
  else
    if exists (select 1 from public.operations o
                where o.profile_id = p_profile_id and o.operation_id <> p_operation_id
                  and o.domain = 'privacy' and o.status = 'pending') then
      raise exception 'HALO_BUSY' using errcode = 'P0001', detail = 'another privacy request of this household is pending';
    end if;
  end if;

  -- 5. Delete.
  if p_scope = 'journal' then
    delete from public.symptom_logs x where x.profile_id = p_profile_id;
    get diagnostics touched = row_count; removed := removed + touched;
    delete from public.alerts x where x.profile_id = p_profile_id and x.type = 'season_summary';
    get diagnostics touched = row_count; removed := removed + touched;
  else
    delete from public.luna_runs x where x.profile_id = p_profile_id;
    get diagnostics touched = row_count; removed := removed + touched;
    delete from public.luna_turns x where x.profile_id = p_profile_id;
    get diagnostics touched = row_count; removed := removed + touched;
    delete from public.luna_conversations x where x.profile_id = p_profile_id;
    get diagnostics touched = row_count; removed := removed + touched;
    -- Before home_contexts: (profile_id, home_context_id) is ON DELETE NO ACTION.
    delete from public.daily_scores x where x.profile_id = p_profile_id;
    get diagnostics touched = row_count; removed := removed + touched;
    -- 0025, when applied: its key cascades from home_contexts, but deleting
    -- it here first counts it, as privacy_counts does.
    if to_regclass('public.daily_maxima') is not null then
      delete from public.daily_maxima x where x.profile_id = p_profile_id;
      get diagnostics touched = row_count; removed := removed + touched;
    end if;
    delete from public.home_contexts x where x.profile_id = p_profile_id;
    get diagnostics touched = row_count; removed := removed + touched;
    delete from public.home_risks x where x.profile_id = p_profile_id;
    get diagnostics touched = row_count; removed := removed + touched;
    delete from public.symptom_logs x where x.profile_id = p_profile_id;
    get diagnostics touched = row_count; removed := removed + touched;
    delete from public.alerts x where x.profile_id = p_profile_id;
    get diagnostics touched = row_count; removed := removed + touched;
    -- Notifications, then bands, then preferences: the 0021 order.
    delete from public.notification_prefs x where x.profile_id = p_profile_id;
    get diagnostics touched = row_count; removed := removed + touched;
    delete from public.household_bands x where x.profile_id = p_profile_id;
    get diagnostics touched = row_count; removed := removed + touched;
    delete from public.push_subscriptions x where x.profile_id = p_profile_id;
    get diagnostics touched = row_count; removed := removed + touched;
    delete from public.profile_preferences x where x.profile_id = p_profile_id;
    get diagnostics touched = row_count; removed := removed + touched;
    delete from public.explore_areas x where x.profile_id = p_profile_id;
    get diagnostics touched = row_count; removed := removed + touched;
    delete from public.household_actions x where x.profile_id = p_profile_id;
    get diagnostics touched = row_count; removed := removed + touched;
    delete from public.household_action_preferences x where x.profile_id = p_profile_id;
    get diagnostics touched = row_count; removed := removed + touched;
    delete from public.household_action_state x where x.profile_id = p_profile_id;
    get diagnostics touched = row_count; removed := removed + touched;
    -- Every settled ledger row but this one. Step 4 proved none other is
    -- pending; the filter keeps that true by construction.
    delete from public.operations o
     where o.profile_id = p_profile_id and o.operation_id <> p_operation_id and o.status <> 'pending';
    get diagnostics touched = row_count; removed := removed + touched;

    -- 6. Reset the profile: every column but id and created_at to its default.
    --    test/privacyClearDb.test.mjs fails when profiles gains a column this
    --    list does not name.
    update public.profiles p
       set address = default, lat = default, lng = default, zip = default, county = default,
           pwsid = default, build_year = default, water_source = default, home_year = default,
           renter_mode = default, locale = default, state = default,
           onboard_request_id = default, tenure = default
     where p.id = p_profile_id
       and (num_nonnulls(p.address, p.lat, p.lng, p.zip, p.county, p.pwsid, p.build_year,
                         p.water_source, p.home_year, p.state, p.onboard_request_id, p.tenure) > 0
            or p.renter_mode is distinct from false
            or p.locale is distinct from 'en');
    get diagnostics touched = row_count; removed := removed + touched;
  end if;

  -- 7. Settle this operation's own row, in this transaction: the minimal
  --    receipt, no content and no count (Ruling P10).
  receipt := jsonb_build_object('operationId', p_operation_id, 'status', 'succeeded', 'scope', p_scope);
  update public.operations o
     set status = 'succeeded', result = receipt, updated_at = now()
   where o.operation_id = p_operation_id and o.profile_id = p_profile_id
     and o.domain = 'privacy' and o.status = 'pending';
  get diagnostics touched = row_count;
  if touched <> 1 then
    -- Cannot happen while step 2's lock is held; kept so the settle is never
    -- assumed.
    raise exception 'HALO_OPERATION_NOT_PENDING' using errcode = 'P0001';
  end if;

  -- 8.
  return jsonb_build_object('receipt', receipt, 'removed', removed);
end;
$$;

revoke execute on function public.clear_household_records(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.clear_household_records(uuid, uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. purge_privacy_receipts: settled receipts go after 24 hours (Ruling P10)
-- ---------------------------------------------------------------------------

create or replace function public.purge_privacy_receipts(p_profile_id uuid default null)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  purged int;
begin
  -- SKIP LOCKED: a row another transaction holds is left for the next run.
  -- The one such holder that matters is a clear 'all' deleting the same
  -- household's settled rows (step 5), which removes them itself when it
  -- commits. Without it, the clear and the purge could lock two of those rows
  -- in opposite orders and one of them would die with 40P01; with it, the
  -- purge never waits on a row, so no cycle can form through it.
  delete from public.operations o
   where o.operation_id in (
     select x.operation_id from public.operations x
      where x.domain = 'privacy' and x.status <> 'pending'
        and x.updated_at < now() - interval '24 hours'
        and (p_profile_id is null or x.profile_id = p_profile_id)
        for update skip locked);
  get diagnostics purged = row_count;
  return purged;
end;
$$;

revoke execute on function public.purge_privacy_receipts(uuid) from public, anon, authenticated;
grant execute on function public.purge_privacy_receipts(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. A settled 'privacy' operation keeps its status (Ruling P16)
-- ---------------------------------------------------------------------------
-- runOperation (lib/operations.js) settles by operation id alone and settles
-- 'failed' whenever its execute throws. A clear that committed and then lost
-- its answer on the way back would be turned from 'succeeded' into 'failed',
-- and the person told "Your data is unchanged." after everything was
-- deleted. So, in the 'privacy' domain only, a row that has left 'pending'
-- may not change its status: that settle fails, lib/operations.js logs it,
-- and the row keeps telling the truth. Rewriting a 'succeeded' receipt as
-- 'succeeded' (runOperation adding operationId) is allowed; the reaper only
-- touches 'pending' rows; purge_privacy_receipts deletes, which this does not
-- govern. The 0021 and 0023 guards are the same rule for their own domains.

create or replace function public.guard_settled_privacy_operation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'HALO_OPERATION_SETTLED' using errcode = 'P0001',
    detail = format('a settled privacy operation keeps its status (%s)', old.status);
end;
$$;

revoke execute on function public.guard_settled_privacy_operation() from public, anon, authenticated;

create or replace trigger operations_privacy_settled_guard
  before update on public.operations
  for each row
  when (old.domain = 'privacy' and old.status <> 'pending' and new.status is distinct from old.status)
  execute function public.guard_settled_privacy_operation();

-- ---------------------------------------------------------------------------
-- Verification (read only). Expect one row, all five columns true.
-- ---------------------------------------------------------------------------
--   select
--     not exists (
--       select 1 from unnest(array['anon', 'authenticated']) as r
--        cross join unnest(array['public.privacy_schema_version()', 'public.privacy_fingerprint(uuid, text[])',
--                                'public.privacy_counts(uuid, text)',
--                                'public.clear_household_records(uuid, uuid, text, text)',
--                                'public.purge_privacy_receipts(uuid)',
--                                'public.guard_settled_privacy_operation()']) as f
--        where has_function_privilege(r, f, 'EXECUTE'))
--       and (select bool_and(has_function_privilege('service_role', f, 'EXECUTE'))
--              from unnest(array['public.privacy_schema_version()', 'public.privacy_fingerprint(uuid, text[])',
--                                'public.privacy_counts(uuid, text)',
--                                'public.clear_household_records(uuid, uuid, text, text)',
--                                'public.purge_privacy_receipts(uuid)']) as f)
--       as functions_service_role_only,
--     (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--       where n.nspname = 'public' and not p.prosecdef and 'search_path=public' = any (p.proconfig)
--         and p.proname in ('privacy_schema_version', 'privacy_fingerprint', 'privacy_counts',
--                           'clear_household_records', 'purge_privacy_receipts',
--                           'guard_settled_privacy_operation')) = 6
--       as functions_invoker_pinned,
--     exists (select 1 from pg_trigger
--       where tgrelid = 'public.operations'::regclass and tgname = 'operations_privacy_settled_guard')
--       as settled_guard_on,
--     public.privacy_schema_version() = 1 as probe_answers,
--     not exists (
--       select 1 from information_schema.columns
--        where table_schema = 'public' and table_name = 'profiles'
--          and column_name not in ('id', 'created_at', 'address', 'lat', 'lng', 'zip', 'county',
--                                  'pwsid', 'build_year', 'water_source', 'home_year', 'renter_mode',
--                                  'locale', 'state', 'onboard_request_id', 'tenure'))
--       as profiles_reset_complete;
--
-- ---------------------------------------------------------------------------
-- If you need to back out 0024
-- ---------------------------------------------------------------------------
-- The privacy routes go back to answering a non-retryable 503
-- feature_unavailable from their probe, exactly as before this is applied, so
-- backing out disables privacy requests rather than breaking the existing
-- app. Nothing is lost: no table or row is dropped. Privacy receipts already
-- in public.operations stay, and with the guard gone they are ordinary ledger
-- rows again, no longer purged after 24 hours until 0024 is applied again.
-- Nothing else calls these functions, and 0023 is untouched.
--
-- The tested copy of this block is in docs/backend/YOUR_TODO.md, which is what
-- test/migrationBackout.test.mjs runs.
--
-- <!-- backout-0024 -->
-- drop trigger if exists operations_privacy_settled_guard on public.operations;
-- drop function if exists public.guard_settled_privacy_operation();
-- drop function if exists public.purge_privacy_receipts(uuid);
-- drop function if exists public.clear_household_records(uuid, uuid, text, text);
-- drop function if exists public.privacy_counts(uuid, text);
-- drop function if exists public.privacy_fingerprint(uuid, text[]);
-- drop function if exists public.privacy_schema_version();
--
-- Then run: notify pgrst, 'reload schema';
