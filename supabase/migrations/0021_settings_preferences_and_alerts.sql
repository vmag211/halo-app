-- HALO: the settings preferences table, a three-state tenure and the alerts
-- presentation columns (B04 plan, Task 1, Rulings S2, S3 and S4).
--
-- Run once in the Supabase SQL editor, AFTER 0020. Safe to re-run.
--
-- Locks: creates one new table, adds one column to public.profiles and five to
-- public.alerts. Every added column has either no default or a constant one, so
-- Postgres records it in the catalog rather than rewriting either table and no
-- existing row is scanned; the ACCESS EXCLUSIVE lock on each is held for the
-- moment the catalog is written. The two checks on profiles and the four on
-- alerts are added validated rather than NOT VALID, which does scan those two
-- tables, because no existing row can fail them: every new column starts null
-- on an existing row, and alerts.revision starts at the constant 1. Both tables
-- are small (one row per household, a handful of alerts each). The foreign key
-- to profiles takes a brief SHARE ROW EXCLUSIVE on profiles as it is created.
--
-- WHY THERE IS A MIGRATION AT ALL (Ruling S2). Neither surface in this package
-- can be served from the tables that already exist. The derivation is section 8
-- of .superpowers/sdd/b04-settings-alerts-evidence/contract-digest.md, which
-- cites every claim to a file and line on the frontend branch:
--
--   GET/PATCH /api/settings  The snapshot's year, water source, language, five
--                            notification booleans and seven household bands
--                            all have homes already (profiles, notification_prefs,
--                            household_bands). Its display values, quiet hours,
--                            calendar values, Luna-context switches and its one
--                            aggregate `revision` have none, and neither does a
--                            tenure with three states.
--   GET /api/alerts          The id, title, body, read and dismissed flags and
--   POST /api/alerts/state   kind all have homes on public.alerts. A per-alert
--                            `revision`, a `category` and a navigation target
--                            have none.
--
-- ONE ROW PER HOUSEHOLD, AND NOTHING COPIED INTO IT. public.profile_preferences
-- is keyed by profile_id and holds only what had nowhere else to live. It does
-- not copy home_year, water_source, locale, renter_mode, the notification
-- booleans or the household bands: those stay where every existing reader
-- already looks, and duplicating them would create two answers to one question.
-- The column names are the contract's own key paths flattened with an
-- underscore (`display.appearance` -> display_appearance), the same way
-- notification_prefs matches `notificationKinds` and household_bands matches
-- `HouseholdBands` name for name, so a route's projection is mechanical.
--
-- THE REVISION IS A REAL COLUMN (Ruling S4). The account revision counts
-- operation-ledger rows, and because a ledger row is written before the effect
-- is attempted, a FAILED command advances it. That wart was accepted in B02
-- because adding a column would have meant another hand-applied migration. Here
-- the table is being created anyway, so a column costs nothing extra, and a
-- column incremented only on a successful save does not have the wart. A route
-- compares it against `If-Match` and increments it in the same statement that
-- writes the values; nothing else may touch it.
--
-- EVERY STORED VALUE IS ONE THE CLIENT CAN READ BACK. The checks below are the
-- client's own validator (lib/frontend/production/preferences-service.ts and
-- lib/frontend/production/alerts-service.ts): a value outside them is not
-- "slightly wrong", it makes `validSettingsSnapshot` or `validAlertSnapshot`
-- reject the WHOLE response, so the person sees "Settings could not be
-- verified. Please retry." and no values at all. The database refuses to hold
-- something that could only ever be thrown away. Three consequences worth
-- naming, because each is easy to get backwards:
--
--   * display_scale is TEXT. The validator accepts the strings '100', '115',
--     '130' and '150'; the number 100 fails it.
--   * display_palette is the one nullable value here. The validator rejects
--     `palette: null` outright but accepts the key being absent, so NULL in
--     this column means "send no palette key", and the client then shows its
--     own default. Nothing else may be null, because the validator requires a
--     value for every other field on every read.
--   * quiet_from and quiet_to must be well-formed HH:MM even when
--     quiet_enabled is false, so they are NOT NULL with sensible defaults. A
--     null would make the entire snapshot unreadable for a household that has
--     never opened the quiet-hours panel.
--
-- A ZONE CHECK IS A FLOOR, NOT THE CLIENT'S TEST. The client accepts any zone
-- `Intl.DateTimeFormat` knows, and a check constraint cannot ask Postgres that:
-- pg_timezone_names is a function, so it cannot appear in a check, and no
-- immutable equivalent exists. The regex here refuses what could never be a
-- zone name (empty, spaces, a path, something absurdly long) and nothing more.
-- 'Not/A_Zone' passes it. Validating the zone is the route's job, with Intl,
-- before it writes.
--
-- LUNA'S CONTEXT SWITCHES DEFAULT TO OFF. luna_tasks, luna_home and
-- luna_projects say what Luna may be told about this household. A row created
-- before anybody answered must not hand it over by accident, so the default is
-- false for all three, in the same spirit as 0020's Ruling L2.
--
-- TENURE IS A NEW COLUMN BESIDE THE OLD ONE (Ruling S3). The contract needs
-- 'owner' | 'renter' | 'other' and profiles.renter_mode boolean cannot tell
-- 'owner' from 'other'. renter_mode is left exactly as it is, because every
-- existing reader uses it and migrating them is a separate job nobody asked
-- for. Two consequences:
--
--   * tenure is NULLABLE with no default, and nothing is backfilled. A backfill
--     from renter_mode would have to write 'owner' for every household that is
--     not a renter, which is precisely the claim the boolean cannot support.
--     NULL means "the three-state question was never asked"; a route reports
--     the derived answer (renter_mode -> 'renter', otherwise 'owner') and must
--     not pretend the household chose it.
--   * a check keeps the two in step, so they can never contradict each other:
--     once tenure is set, renter_mode must equal (tenure = 'renter'). A writer
--     therefore sets both in one statement. While tenure is null the check says
--     nothing, so neither boolean value is a contradiction.
--
-- THE ALERTS COLUMNS. revision is NOT NULL DEFAULT 1 because the client rejects
-- any snapshot containing a row whose revision is not a positive integer, and
-- that has to be true of the rows that existed before this migration too; 1 is
-- not an invention, it is "this row has never been patched". The database
-- guarantees only `>= 1`; the STRICT increase per patched row that
-- `alertReceiptCovers` requires is the route's obligation, expressed as
-- `revision = revision + 1` in the same statement that applies the patch.
--
-- category, target_tab, target_destination and target_learn are nullable with
-- no default, for the same reason tenure is: the contract gives no mapping from
-- an alert's kind to a category or a target, so any default would be this
-- server's invention written into the catalog, and an existing row has no
-- stored answer. NULL means "the producer named none"; the route supplies one
-- for the row's kind from a constant in code, which is where a mapping that may
-- change belongs. The target checks are the client's routing table verbatim,
-- including the part most likely to be got wrong: `destinations.today` is the
-- empty array, so the `today` tab admits NO destination at all, and a
-- destination without a tab could never be routed.
--
-- NO source COLUMN, deliberately. `AlertItem.source` is optional in the
-- validator and nothing produces one today, so a response simply omits the
-- key. These migrations are applied by hand; an unused column is not free. If a
-- producer appears, it gets its own migration and its own review.
--
-- Degrades cleanly: until this is applied, GET/PATCH /api/settings and
-- GET /api/alerts plus POST /api/alerts/state answer a non-retryable 503
-- feature_unavailable, the same convention 0016, 0017, 0018, 0019 and 0020 use.
-- The existing GET /api/alerts fields, /api/notifications and /api/household
-- are unaffected.
--
-- Retention: a preferences row is kept until the owner is deleted
-- (ON DELETE CASCADE). No purge job is defined here on purpose, and no period
-- is invented: retention for preference rows is UNDECIDED and listed as such in
-- docs/backend/privacy-and-retention.md, alongside every other open period.
-- The alerts columns change nothing about how long an alert is kept.
--
-- Privacy: the service role is the only reader of profile_preferences. Row
-- level security is on with no policy at all and the default privileges are
-- revoked, so not even the owner can read their own preferences with their own
-- session; they come back through GET /api/settings, which reads them with the
-- service role after verifying the token. The alerts columns inherit the
-- select-own policy 0006 already gives that table.

create table if not exists public.profile_preferences (
  profile_id         uuid        primary key references public.profiles (id) on delete cascade,
  -- The settings aggregate revision, compared against If-Match and advanced
  -- only by a save that actually applied (Ruling S4).
  revision           integer     not null default 1,
  -- display.*: the appearance block. palette is the one value a server may
  -- omit, so NULL means "send no palette key".
  display_appearance text        not null default 'system',
  display_palette    text,
  display_ambient    boolean     not null default false,
  display_scale      text        not null default '100',
  display_motion     text        not null default 'system',
  display_contrast   boolean     not null default false,
  -- values.quiet.*: from and to are required to be well-formed HH:MM even while
  -- enabled is false, so they are not null with a sensible default window.
  quiet_enabled      boolean     not null default false,
  quiet_from         text        not null default '21:00',
  quiet_to           text        not null default '08:00',
  quiet_zone         text        not null default 'UTC',
  -- calendar.*
  calendar_zone      text        not null default 'UTC',
  calendar_streak    boolean     not null default false,
  calendar_linked    boolean     not null default false,
  -- values.luna.*: what Luna may be told about this household. Off by default.
  luna_tasks         boolean     not null default false,
  luna_home          boolean     not null default false,
  luna_projects      boolean     not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.profiles
  add column if not exists tenure text;

alter table public.alerts
  add column if not exists revision integer not null default 1,
  add column if not exists category text,
  add column if not exists target_tab text,
  add column if not exists target_destination text,
  add column if not exists target_learn text;

-- Each check is added separately and idempotently, so re-running is safe and a
-- partially applied earlier run is completed rather than erroring. Every bound
-- below is the client's own validator; see the header for why a value outside
-- one of them would make the client discard the whole response.
do $$
begin
  -- `Number.isSafeInteger(v.revision) && v.revision >= 1` in validSettingsSnapshot.
  if not exists (select 1 from pg_constraint where conname = 'profile_preferences_revision_check') then
    alter table public.profile_preferences add constraint profile_preferences_revision_check
      check (revision >= 1);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'profile_preferences_display_appearance_check') then
    alter table public.profile_preferences add constraint profile_preferences_display_appearance_check
      check (display_appearance in ('system', 'light', 'dark'));
  end if;
  -- Optional, and `palette: null` is rejected on the wire: NULL here means the
  -- response omits the key rather than sending a null.
  if not exists (select 1 from pg_constraint where conname = 'profile_preferences_display_palette_check') then
    alter table public.profile_preferences add constraint profile_preferences_display_palette_check
      check (display_palette is null or display_palette in ('ocean', 'forest', 'iris'));
  end if;
  -- The STRINGS '100' | '115' | '130' | '150'. The number 100 fails the client.
  if not exists (select 1 from pg_constraint where conname = 'profile_preferences_display_scale_check') then
    alter table public.profile_preferences add constraint profile_preferences_display_scale_check
      check (display_scale in ('100', '115', '130', '150'));
  end if;
  -- 'full' is never sent by the control, which renders it as 'system', but the
  -- response validator accepts it, so a stored 'full' is readable.
  if not exists (select 1 from pg_constraint where conname = 'profile_preferences_display_motion_check') then
    alter table public.profile_preferences add constraint profile_preferences_display_motion_check
      check (display_motion in ('system', 'full', 'reduce'));
  end if;

  -- 24-hour HH:MM, required whether or not quiet hours are switched on.
  if not exists (select 1 from pg_constraint where conname = 'profile_preferences_quiet_hours_check') then
    alter table public.profile_preferences add constraint profile_preferences_quiet_hours_check
      check (quiet_from ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         and quiet_to   ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  end if;
  -- The client refuses to send a window whose ends are equal while it is on,
  -- because a window from a time to itself is not a window. Switched off, the
  -- two values are only a remembered draft and may be anything well formed.
  if not exists (select 1 from pg_constraint where conname = 'profile_preferences_quiet_window_check') then
    alter table public.profile_preferences add constraint profile_preferences_quiet_window_check
      check (not quiet_enabled or quiet_from <> quiet_to);
  end if;

  -- A floor on the shape of an IANA zone name, not the client's Intl test: at
  -- most three segments of safe characters. See the header.
  if not exists (select 1 from pg_constraint where conname = 'profile_preferences_quiet_zone_check') then
    alter table public.profile_preferences add constraint profile_preferences_quiet_zone_check
      check (quiet_zone ~ '^[A-Za-z][A-Za-z0-9_+-]{0,39}(/[A-Za-z0-9_+-]{1,40}){0,2}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profile_preferences_calendar_zone_check') then
    alter table public.profile_preferences add constraint profile_preferences_calendar_zone_check
      check (calendar_zone ~ '^[A-Za-z][A-Za-z0-9_+-]{0,39}(/[A-Za-z0-9_+-]{1,40}){0,2}$');
  end if;

  -- Ruling S3: three states, and null for a household that was never asked.
  if not exists (select 1 from pg_constraint where conname = 'profiles_tenure_check') then
    alter table public.profiles add constraint profiles_tenure_check
      check (tenure is null or tenure in ('owner', 'renter', 'other'));
  end if;
  -- renter_mode stays the derived boolean every existing reader uses, so it may
  -- not contradict the answer tenure records. Null tenure constrains nothing.
  if not exists (select 1 from pg_constraint where conname = 'profiles_tenure_renter_mode_check') then
    alter table public.profiles add constraint profiles_tenure_renter_mode_check
      check (tenure is null or renter_mode = (tenure = 'renter'));
  end if;

  -- `Number.isSafeInteger(item.revision) && item.revision > 0` in
  -- validAlertSnapshot. The strict increase per patched row is the route's job.
  if not exists (select 1 from pg_constraint where conname = 'alerts_revision_check') then
    alter table public.alerts add constraint alerts_revision_check
      check (revision >= 1);
  end if;
  -- Case sensitive and exact: these three strings pick the row icon and drive
  -- the inbox filter.
  if not exists (select 1 from pg_constraint where conname = 'alerts_category_check') then
    alter table public.alerts add constraint alerts_category_check
      check (category is null or category in ('Home', 'Your week', 'Conditions'));
  end if;
  -- The client's routing table verbatim. `destinations.today` is the empty
  -- array, so the today tab admits no destination, and a destination with no
  -- tab could never be routed. The explicit `target_tab is not null` guard is
  -- what makes that last rule bite: without it a null tab would make both
  -- comparisons null, and a check that evaluates to null passes.
  if not exists (select 1 from pg_constraint where conname = 'alerts_target_check') then
    alter table public.alerts add constraint alerts_target_check
      check ((target_tab is null or target_tab in ('home', 'plan', 'today'))
         and (target_destination is null
              or (target_tab is not null
                  and ((target_tab = 'home' and target_destination in ('tests', 'maintenance', 'food', 'summary'))
                       or (target_tab = 'plan' and target_destination in ('journal', 'patterns', 'recap', 'outdoors', 'reminders'))))));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'alerts_target_learn_check') then
    alter table public.alerts add constraint alerts_target_learn_check
      check (target_learn is null
             or target_learn in ('air', 'uv', 'pollen', 'mold', 'pfas', 'radon', 'lead'));
  end if;
end $$;

alter table public.profile_preferences enable row level security;

-- No policy, deliberately, and stricter than it looks: the owner cannot read
-- their own preferences with their own session either. Every read and write
-- goes through a route handler using the service role, which bypasses row level
-- security, after it has verified the token. Supabase's default privileges would
-- otherwise grant anon and authenticated arwdDxtm on this new public table
-- (confirmed by the 2026-10-17 catalog audit), so revoking here is what
-- actually closes that, the same way 0016 does for home_contexts, 0017 for
-- operations, 0018 for recovery_challenges and 0020 for the Luna tables.
revoke all on table public.profile_preferences from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Verification (read only). Expect one row, all six columns true.
-- ---------------------------------------------------------------------------
--   select
--     (select relrowsecurity from pg_class
--       where oid = 'public.profile_preferences'::regclass) as rls_on,
--     (select count(*) from pg_policies
--       where schemaname = 'public' and tablename = 'profile_preferences') = 0
--       as no_policies,
--     not exists (
--       select 1 from unnest(array['anon', 'authenticated']) as r
--        where has_any_column_privilege(r, 'public.profile_preferences', 'SELECT')
--           or has_any_column_privilege(r, 'public.profile_preferences', 'INSERT')
--           or has_any_column_privilege(r, 'public.profile_preferences', 'UPDATE')
--           or has_table_privilege(r, 'public.profile_preferences', 'DELETE'))
--       as no_client_access,
--     has_table_privilege('service_role', 'public.profile_preferences', 'INSERT')
--       and has_table_privilege('service_role', 'public.profile_preferences', 'UPDATE')
--       as service_role_can_write,
--     (select count(*) from pg_constraint
--       where conrelid = 'public.profile_preferences'::regclass and contype = 'c') = 9
--       as nine_checks,
--     (select count(*) from pg_attribute
--       where attrelid = 'public.profiles'::regclass and attname = 'tenure' and not attisdropped)
--     + (select count(*) from pg_attribute
--         where attrelid = 'public.alerts'::regclass and not attisdropped
--           and attname in ('revision', 'category', 'target_tab', 'target_destination', 'target_learn'))
--       = 6 as tenure_and_alert_columns;
--
-- ---------------------------------------------------------------------------
-- If you need to back out 0021
-- ---------------------------------------------------------------------------
-- The settings and alerts-state routes go back to answering a non-retryable
-- 503 feature_unavailable, exactly as they do before this is applied, so
-- backing out disables the two new surfaces rather than breaking the existing
-- app. The existing GET /api/alerts fields, PUT /api/notifications and
-- PUT /api/household keep working, because none of them reads anything this
-- migration added.
--
-- What is lost: every household's display, quiet-hours, calendar and
-- Luna-context choices, and the settings revision with them, because the whole
-- table is dropped. Every alert keeps its id, title, body, read and dismissed
-- state; what goes is each one's revision, category and navigation target, so a
-- client holding a revision can no longer patch against it and has to reload.
-- The tenure answer is lost too, and reapplying leaves every household
-- unanswered again rather than guessing from renter_mode. Nothing cascades:
-- renter_mode, the notification preferences and the household bands are
-- untouched, so the existing settings screens keep their values.
--
-- The tested copy of this block is in docs/backend/YOUR_TODO.md, which is what
-- test/migrationBackout.test.mjs runs.
--
-- <!-- backout-0021 -->
-- drop table if exists public.profile_preferences;
-- alter table public.alerts
--   drop column if exists target_learn,
--   drop column if exists target_destination,
--   drop column if exists target_tab,
--   drop column if exists category,
--   drop column if exists revision;
-- alter table public.profiles drop column if exists tenure;
--
-- Then run: notify pgrst, 'reload schema';
