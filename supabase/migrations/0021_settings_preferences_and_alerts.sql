-- HALO: the settings preferences table, a three-state tenure and the alerts
-- presentation columns (B04 plan, Task 1, Rulings S2, S3 and S4).
--
-- Run once in the Supabase SQL editor, AFTER 0020. Safe to re-run.
--
-- Locks: creates one new table, adds one column to public.profiles and five to
-- public.alerts. Every added column has either no default or a constant one, so
-- Postgres records it in the catalog rather than rewriting either table and no
-- existing row is scanned; the ACCESS EXCLUSIVE lock on each is held for the
-- moment the catalog is written. The one check on profiles and the four on
-- alerts are added validated rather than NOT VALID, which does scan those two
-- tables, because no existing row can fail them: every new column starts null
-- on an existing row, and alerts.revision starts at the constant 1. Both tables
-- are small (one row per household, a handful of alerts each). The foreign key
-- to profiles takes a brief SHARE ROW EXCLUSIVE on profiles as it is created.
-- It also creates three functions and seven triggers (Rulings S11 to S13,
-- below). Creating a trigger takes SHARE ROW EXCLUSIVE on profiles,
-- notification_prefs and household_bands for a moment, and a re-run drops each
-- one first, which takes ACCESS EXCLUSIVE for a moment; a save on one of those
-- tables waits that long and then goes on.
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
-- column incremented only on a successful save does not have the wart.
-- save_settings (below) compares it against `If-Match` and advances it in the
-- same transaction that writes the values (Ruling S11), and triggers advance it
-- whenever any other writer changes a value in the snapshot (Ruling S12).
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
-- false for all three, in the same spirit as 0020's Ruling L2. This is a fail
-- safe, not a product choice: whether household data reaches a model at all is
-- Vibhav's open decision 2, and the client's own preview defaults differ
-- (lib/frontend/settings-preview.ts:20 on the frontend branch has tasks and
-- projects on). Ruling S9 keeps them off until that decision is made.
--
-- THE ZONES DEFAULT TO America/New_York (Ruling S9), the zone the client's own
-- initialSettings and displayZones lead with (lib/frontend/settings-preview.ts:19
-- and :22), so a household that never opened the panel sees what the UI
-- already shows. calendar_linked defaults to false, unlike the client's draft
-- default of true (components/expanded/SettingsWorkspace.tsx:40), because
-- nothing is linked and true would be a false claim.
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
--     NULL means "the three-state question was never asked", and it must
--     never be reported as 'owner' (Ruling S8): reading 'owner' on every
--     request makes the same unsupported claim a backfill would. The client's
--     validator cannot express "unanswered" at all: validSettingsSnapshot
--     requires home.tenure to be exactly 'owner', 'renter' or 'other' and
--     rejects null, a missing key and a boolean
--     (lib/frontend/production/preferences-service.ts:10 on the frontend
--     branch; contract digest section 2.2). So the route reports a NULL from
--     renter_mode, the person's own answer to the older question: 'renter'
--     when it is true, and otherwise 'other', which the client's select labels
--     "Other / Not sure" (lib/frontend/copy/app-polish.ts:8) and which is its
--     own default. That is the controller's ruling (S8 as amended, and S13),
--     applied in lib/settings.js.
--   * there is deliberately NO check tying tenure to renter_mode (Ruling S7).
--     Existing writers that predate tenure, save_household (0015) and the
--     two-step fallback in app/api/household/route.js, write renter_mode
--     without touching tenure, and renter_mode is part of the published B01
--     PUT /api/household contract. A cross-column check would turn that valid
--     request into a 500 and roll the band change back with it. So once this
--     is applied, consistency is kept on write instead, by a BEFORE trigger
--     on profiles (profiles_tenure_reconcile, Rulings S7 and S13, below). It
--     reconciles the pair inside the very row write that would have made them
--     disagree, so a legacy save still succeeds and keeps its band change, and
--     no separate statement is left for another request to land in front of.
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
-- Degrades cleanly (Ruling S10): until this is applied, GET/PATCH
-- /api/settings and POST /api/alerts/state answer a non-retryable 503
-- feature_unavailable, the same convention 0016, 0017, 0018, 0019 and 0020 use.
-- GET /api/alerts never answers 503 for a missing 0021: it keeps every legacy
-- key the current app reads (alerts, count, unread, truncated) and degrades only
-- the new fields (the added item fields and unresolvedOperations).
-- PUT /api/notifications and PUT /api/household read nothing this migration
-- adds. Once it is applied, the database advances the settings revision when
-- either changes a value in the snapshot, and keeps tenure in step with
-- PUT /api/household's renter_mode in the same row write; neither route does
-- anything extra, and neither can fail because of it.
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
  -- The zone the client leads with (Ruling S9), not UTC.
  quiet_zone         text        not null default 'America/New_York',
  -- calendar.*
  -- The zone the client leads with (Ruling S9), not UTC.
  calendar_zone      text        not null default 'America/New_York',
  calendar_streak    boolean     not null default false,
  -- False because nothing is linked; true would be a false claim (Ruling S9).
  calendar_linked    boolean     not null default false,
  -- values.luna.*: what Luna may be told about this household.
  -- Off: a fail safe pending Vibhav's decision 2 on household data to a model.
  luna_tasks         boolean     not null default false,
  -- Off: a fail safe pending Vibhav's decision 2 on household data to a model.
  luna_home          boolean     not null default false,
  -- Off: a fail safe pending Vibhav's decision 2 on household data to a model.
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
  -- Deliberately no check against renter_mode (Ruling S7): a legacy household
  -- save writes renter_mode alone, and must not fail. See the header.
  if not exists (select 1 from pg_constraint where conname = 'profiles_tenure_check') then
    alter table public.profiles add constraint profiles_tenure_check
      check (tenure is null or tenure in ('owner', 'renter', 'other'));
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
-- The settings revision is kept by the database (Ruling S12)
-- ---------------------------------------------------------------------------
-- The snapshot's values live in four tables: profile_preferences itself,
-- profiles (home_year, water_source, locale, tenure and renter_mode, which a
-- null tenure is read from), notification_prefs (the five switches) and
-- household_bands (the seven bands a home save writes). Five routes write
-- them besides PATCH /api/settings: PUT /api/notifications, PUT
-- /api/household, PATCH /api/profile, POST /api/onboard and PATCH
-- /api/home-contexts/[id] (the last three through the 0016 functions, which
-- keep the profile in step). A settings save diffs what it is sent against the
-- stored values and compares only the revision, so any of them that changed a
-- value without advancing the revision would have that change silently
-- reverted by the next save from a device that had not seen it.
--
-- So every one of those tables carries an AFTER row trigger that advances
-- profile_preferences.revision for its household in the same transaction as
-- the write. A reader can then never see a changed value with the old
-- revision once both have committed, and a save holding the old revision
-- conflicts. Precisely:
--   * column scoped (UPDATE OF those columns) and value scoped (WHEN the
--     stored values differ), so a write that changes nothing advances nothing;
--   * one row per household in each of these tables, so a statement advances
--     each household it changed exactly once; two statements in one
--     transaction (save_household writes the bands and then the profile)
--     advance it twice, which costs nothing, since a client only ever
--     compares for equality;
--   * an INSERT of a notification or band row advances it only when the row
--     differs from what no row reads as (every switch on, every band off);
--   * a household with no preferences row has never been shown a revision,
--     so nothing is advanced and no row is made;
--   * on profile_preferences itself, only an update that changed a value and
--     did not set the revision itself: save_settings, below, sets it.
-- The trigger function is security invoker, like every function here: the
-- writers are the service role and the migration owner, both of which may
-- update profile_preferences, and no API role may write these tables (0015,
-- and this file for profile_preferences).

create or replace function public.advance_settings_revision()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- TG_ARGV[0] is the owner column of the table that fired: id on profiles,
  -- profile_id everywhere else. Only the revision and updated_at are set, so
  -- this update does not fire the trigger on profile_preferences again.
  update public.profile_preferences
     set revision = revision + 1, updated_at = now()
   where profile_id = (to_jsonb(new) ->> tg_argv[0])::uuid;
  return null;
end;
$$;

revoke execute on function public.advance_settings_revision() from public, anon, authenticated;

drop trigger if exists profile_preferences_settings_revision on public.profile_preferences;
create trigger profile_preferences_settings_revision
  after update of display_appearance, display_palette, display_ambient, display_scale, display_motion,
                  display_contrast, quiet_enabled, quiet_from, quiet_to, quiet_zone, calendar_zone,
                  calendar_streak, calendar_linked, luna_tasks, luna_home, luna_projects
  on public.profile_preferences
  for each row
  when (new.revision = old.revision
        and (old.display_appearance, old.display_palette, old.display_ambient, old.display_scale,
             old.display_motion, old.display_contrast, old.quiet_enabled, old.quiet_from, old.quiet_to,
             old.quiet_zone, old.calendar_zone, old.calendar_streak, old.calendar_linked,
             old.luna_tasks, old.luna_home, old.luna_projects)
            is distinct from
            (new.display_appearance, new.display_palette, new.display_ambient, new.display_scale,
             new.display_motion, new.display_contrast, new.quiet_enabled, new.quiet_from, new.quiet_to,
             new.quiet_zone, new.calendar_zone, new.calendar_streak, new.calendar_linked,
             new.luna_tasks, new.luna_home, new.luna_projects))
  execute function public.advance_settings_revision('profile_id');

drop trigger if exists profiles_settings_revision on public.profiles;
create trigger profiles_settings_revision
  after update of home_year, water_source, locale, tenure, renter_mode
  on public.profiles
  for each row
  when ((old.home_year, old.water_source, old.locale, old.tenure, old.renter_mode)
        is distinct from (new.home_year, new.water_source, new.locale, new.tenure, new.renter_mode))
  execute function public.advance_settings_revision('id');

drop trigger if exists notification_prefs_settings_revision on public.notification_prefs;
create trigger notification_prefs_settings_revision
  after update of air_quality_change, weather_advisory, new_water_results, radon_season, season_summary
  on public.notification_prefs
  for each row
  when ((old.air_quality_change, old.weather_advisory, old.new_water_results, old.radon_season, old.season_summary)
        is distinct from (new.air_quality_change, new.weather_advisory, new.new_water_results, new.radon_season, new.season_summary))
  execute function public.advance_settings_revision('profile_id');

drop trigger if exists notification_prefs_settings_revision_insert on public.notification_prefs;
create trigger notification_prefs_settings_revision_insert
  after insert on public.notification_prefs
  for each row
  when (not (new.air_quality_change and new.weather_advisory and new.new_water_results
             and new.radon_season and new.season_summary))
  execute function public.advance_settings_revision('profile_id');

drop trigger if exists household_bands_settings_revision on public.household_bands;
create trigger household_bands_settings_revision
  after update of has_toddler, has_child, has_teen, has_adult, has_senior, has_pregnant, has_respiratory
  on public.household_bands
  for each row
  when ((old.has_toddler, old.has_child, old.has_teen, old.has_adult, old.has_senior, old.has_pregnant, old.has_respiratory)
        is distinct from (new.has_toddler, new.has_child, new.has_teen, new.has_adult, new.has_senior, new.has_pregnant, new.has_respiratory))
  execute function public.advance_settings_revision('profile_id');

drop trigger if exists household_bands_settings_revision_insert on public.household_bands;
create trigger household_bands_settings_revision_insert
  after insert on public.household_bands
  for each row
  when (new.has_toddler or new.has_child or new.has_teen or new.has_adult
        or new.has_senior or new.has_pregnant or new.has_respiratory)
  execute function public.advance_settings_revision('profile_id');

-- ---------------------------------------------------------------------------
-- Tenure follows renter_mode in the same row write (Rulings S7 and S13)
-- ---------------------------------------------------------------------------
-- Every writer of either column goes through this, so the two can never be
-- stored disagreeing, and the reconcile is part of the very row write that
-- would have made them disagree. There is no second statement for another
-- request to land in front of (review F3: a separate "clear tenure" update
-- after the household save could erase a tenure a settings save had just
-- written). The rules:
--   * a write that changes tenure to an answer sets renter_mode from it
--     (renter_mode = (tenure = 'renter')): the three-state answer is the more
--     precise one, so it wins, and it is what PATCH /api/settings sends;
--   * otherwise, renter_mode true with tenure 'owner' or 'other' makes tenure
--     'renter', because renter_mode true is the person's own answer that they
--     rent (PUT /api/household, save_household and its two-step fallback);
--   * renter_mode false with tenure 'renter' makes tenure null, unanswered,
--     because false cannot tell an owner from an other;
--   * anything else is left alone. A null tenure stays null: it reads as
--     'renter' while renter_mode is true and as 'other' otherwise (S13).
-- A BEFORE trigger, so the row is stored once, already consistent, and the
-- AFTER trigger above sees the final values.

create or replace function public.reconcile_profile_tenure()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  answered boolean;
begin
  if tg_op = 'INSERT' then
    answered := new.tenure is not null;
  else
    answered := new.tenure is not null and new.tenure is distinct from old.tenure;
  end if;

  if answered then
    new.renter_mode := new.tenure = 'renter';
  elsif new.renter_mode and new.tenure in ('owner', 'other') then
    new.tenure := 'renter';
  elsif not new.renter_mode and new.tenure = 'renter' then
    new.tenure := null;
  end if;
  return new;
end;
$$;

revoke execute on function public.reconcile_profile_tenure() from public, anon, authenticated;

drop trigger if exists profiles_tenure_reconcile on public.profiles;
create trigger profiles_tenure_reconcile
  before insert or update of tenure, renter_mode
  on public.profiles
  for each row
  execute function public.reconcile_profile_tenure();

-- ---------------------------------------------------------------------------
-- save_settings: one settings save, all or nothing (Ruling S11)
-- ---------------------------------------------------------------------------
-- PATCH /api/settings calls this once per save, with the service role, after
-- it has verified the token, read the snapshot and worked out what the save
-- changes. Everything the save writes happens here, in one transaction: the
-- compare-and-set on the revision, the group's own columns, and the home
-- details, tenure, language, switches and bands that live in other tables. A
-- refusal or an error anywhere rolls all of it back, so a failed save leaves
-- nothing applied and "not applied" is always true when the route says it.
--
-- p_profile_id is trusted for the same reason as in 0016: only the service
-- role may call this, and the route passes the id from the session token.
-- p_expected_revision is the client's If-Match. The other arguments are what
-- to write, each null for "nothing in that table":
--   p_preferences     profile_preferences columns, by name ({} for none);
--   p_profile         { tenure?, renter_mode?, locale? };
--   p_home            { water_source?, home_year? }, saved through the home
--                     context exactly as PATCH /api/profile saves them: with a
--                     current home through update_home_context_attributes at
--                     its revision; located with no home yet through
--                     transition_home_context at the stored point (which makes
--                     the legacy home); not located, on the profile itself.
--                     Both functions run inside this transaction and raise on
--                     a refusal, which rolls the whole save back (the route
--                     answers HALO_STALE_REVISION or HALO_CONTEXT_CLOSED as
--                     home_changed);
--   p_notifications   the switches to change;
--   p_bands           the bands to store.
-- Any other key is HALO_INVALID_INPUT, as in 0016.
--
-- Locks are taken in the order every other writer of these rows takes them,
-- so two writers wait for each other rather than deadlock: the profile first
-- (as save_household and the 0016 functions do), then the notification and
-- band rows, then the preferences row, which every trigger above takes last.
--
-- The revision advances exactly once per save. The compare-and-set sets it to
-- p_expected_revision + 1, and the writes after it fire the triggers above,
-- which advance it again inside this transaction; the last statement puts it
-- back to p_expected_revision + 1. Nobody can see the values in between: the
-- row is locked by this transaction until it commits.
--
-- Returns { saved: false, revision } when the revision is not
-- p_expected_revision (revision null when there is no preferences row), and
-- nothing is written. Otherwise { saved: true, revision, preferences,
-- profile, notifications }: the committed rows a snapshot is built from, read
-- at the end of this transaction, so the route builds its receipt from them
-- without reading anything after the commit.

create or replace function public.save_settings(
  p_profile_id        uuid,
  p_expected_revision int,
  p_preferences       jsonb,
  p_profile           jsonb,
  p_home              jsonb,
  p_notifications     jsonb,
  p_bands             jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  text_preferences constant text[] := array[
    'display_appearance', 'display_palette', 'display_scale', 'display_motion',
    'quiet_from', 'quiet_to', 'quiet_zone', 'calendar_zone'
  ];
  boolean_preferences constant text[] := array[
    'display_ambient', 'display_contrast', 'quiet_enabled', 'calendar_streak', 'calendar_linked',
    'luna_tasks', 'luna_home', 'luna_projects'
  ];
  notification_keys constant text[] := array[
    'air_quality_change', 'weather_advisory', 'new_water_results', 'radon_season', 'season_summary'
  ];
  band_keys constant text[] := array[
    'has_toddler', 'has_child', 'has_teen', 'has_adult', 'has_senior', 'has_pregnant', 'has_respiratory'
  ];
  prefs        jsonb := coalesce(p_preferences, '{}'::jsonb);
  bad          text;
  key          text;
  current_rev  int;
  saved        public.profile_preferences%rowtype;
  home         public.home_contexts%rowtype;
  located      record;
  profile_row  record;
  notification public.notification_prefs%rowtype;
  has_notes    boolean;
begin
  -- Arguments first: nothing is read or written for a malformed call.
  if p_profile_id is null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_profile_id is required';
  end if;
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_expected_revision must be a positive integer';
  end if;
  if jsonb_typeof(prefs) <> 'object' then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_preferences must be a JSON object or null';
  end if;
  select string_agg(k, ', ' order by k) into bad from jsonb_object_keys(prefs) k
   where k <> all (text_preferences) and k <> all (boolean_preferences);
  if bad is not null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('p_preferences has unknown keys: %s', bad);
  end if;
  foreach key in array text_preferences loop
    -- display_palette is the one nullable column (null: the response omits the key).
    if prefs ? key and jsonb_typeof(prefs -> key) is distinct from 'string'
       and not (key = 'display_palette' and jsonb_typeof(prefs -> key) = 'null') then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('p_preferences.%s must be a string', key);
    end if;
  end loop;
  foreach key in array boolean_preferences loop
    if prefs ? key and jsonb_typeof(prefs -> key) is distinct from 'boolean' then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('p_preferences.%s must be true or false', key);
    end if;
  end loop;

  if p_profile is not null then
    if jsonb_typeof(p_profile) <> 'object' then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_profile must be a JSON object or null';
    end if;
    select string_agg(k, ', ' order by k) into bad from jsonb_object_keys(p_profile) k
     where k not in ('tenure', 'renter_mode', 'locale');
    if bad is not null then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('p_profile has unknown keys: %s', bad);
    end if;
    if (p_profile ? 'tenure' and jsonb_typeof(p_profile -> 'tenure') is distinct from 'string')
       or (p_profile ? 'locale' and jsonb_typeof(p_profile -> 'locale') is distinct from 'string')
       or (p_profile ? 'renter_mode' and jsonb_typeof(p_profile -> 'renter_mode') is distinct from 'boolean') then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001',
        detail = 'p_profile.tenure and p_profile.locale must be strings and p_profile.renter_mode true or false';
    end if;
  end if;

  if p_home is not null then
    if jsonb_typeof(p_home) <> 'object' or p_home = '{}'::jsonb then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001',
        detail = 'p_home must be null or a JSON object with water_source or home_year';
    end if;
    select string_agg(k, ', ' order by k) into bad from jsonb_object_keys(p_home) k
     where k not in ('water_source', 'home_year');
    if bad is not null then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('p_home has unknown keys: %s', bad);
    end if;
    if jsonb_typeof(p_home -> 'water_source') not in ('string', 'null') then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_home.water_source must be a string or null';
    end if;
    if jsonb_typeof(p_home -> 'home_year') not in ('number', 'null')
       or (jsonb_typeof(p_home -> 'home_year') = 'number'
           and ((p_home ->> 'home_year')::numeric <> trunc((p_home ->> 'home_year')::numeric)
                or (p_home ->> 'home_year')::numeric not between -2147483648 and 2147483647)) then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_home.home_year must be a whole number or null';
    end if;
  end if;

  if p_notifications is not null then
    if jsonb_typeof(p_notifications) <> 'object' then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_notifications must be a JSON object or null';
    end if;
    select string_agg(k, ', ' order by k) into bad from jsonb_object_keys(p_notifications) k
     where k <> all (notification_keys) or jsonb_typeof(p_notifications -> k) <> 'boolean';
    if bad is not null then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001',
        detail = format('p_notifications has unknown or non-boolean keys: %s', bad);
    end if;
  end if;

  if p_bands is not null then
    if jsonb_typeof(p_bands) <> 'object' then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_bands must be a JSON object or null';
    end if;
    select string_agg(k, ', ' order by k) into bad from jsonb_object_keys(p_bands) k
     where k <> all (band_keys) or jsonb_typeof(p_bands -> k) <> 'boolean';
    if bad is not null then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001',
        detail = format('p_bands has unknown or non-boolean keys: %s', bad);
    end if;
  end if;

  -- The locks, in every writer's order (see above).
  perform 1 from public.profiles where id = p_profile_id for no key update;
  if not found then
    raise exception 'HALO_PROFILE_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform 1 from public.notification_prefs where profile_id = p_profile_id for no key update;
  perform 1 from public.household_bands where profile_id = p_profile_id for no key update;

  -- The compare-and-set, with the group's own columns. A miss writes nothing.
  update public.profile_preferences pp set
    display_appearance = case when prefs ? 'display_appearance' then prefs ->> 'display_appearance' else pp.display_appearance end,
    display_palette    = case when prefs ? 'display_palette' then prefs ->> 'display_palette' else pp.display_palette end,
    display_ambient    = case when prefs ? 'display_ambient' then (prefs ->> 'display_ambient')::boolean else pp.display_ambient end,
    display_scale      = case when prefs ? 'display_scale' then prefs ->> 'display_scale' else pp.display_scale end,
    display_motion     = case when prefs ? 'display_motion' then prefs ->> 'display_motion' else pp.display_motion end,
    display_contrast   = case when prefs ? 'display_contrast' then (prefs ->> 'display_contrast')::boolean else pp.display_contrast end,
    quiet_enabled      = case when prefs ? 'quiet_enabled' then (prefs ->> 'quiet_enabled')::boolean else pp.quiet_enabled end,
    quiet_from         = case when prefs ? 'quiet_from' then prefs ->> 'quiet_from' else pp.quiet_from end,
    quiet_to           = case when prefs ? 'quiet_to' then prefs ->> 'quiet_to' else pp.quiet_to end,
    quiet_zone         = case when prefs ? 'quiet_zone' then prefs ->> 'quiet_zone' else pp.quiet_zone end,
    calendar_zone      = case when prefs ? 'calendar_zone' then prefs ->> 'calendar_zone' else pp.calendar_zone end,
    calendar_streak    = case when prefs ? 'calendar_streak' then (prefs ->> 'calendar_streak')::boolean else pp.calendar_streak end,
    calendar_linked    = case when prefs ? 'calendar_linked' then (prefs ->> 'calendar_linked')::boolean else pp.calendar_linked end,
    luna_tasks         = case when prefs ? 'luna_tasks' then (prefs ->> 'luna_tasks')::boolean else pp.luna_tasks end,
    luna_home          = case when prefs ? 'luna_home' then (prefs ->> 'luna_home')::boolean else pp.luna_home end,
    luna_projects      = case when prefs ? 'luna_projects' then (prefs ->> 'luna_projects')::boolean else pp.luna_projects end,
    revision           = pp.revision + 1,
    updated_at         = now()
  where pp.profile_id = p_profile_id and pp.revision = p_expected_revision;
  if not found then
    select revision into current_rev from public.profile_preferences where profile_id = p_profile_id;
    return jsonb_build_object('saved', false, 'revision', current_rev);
  end if;

  -- The home details, through the home context (0016), inside this transaction.
  if p_home is not null then
    select * into home from public.home_contexts where profile_id = p_profile_id and effective_to is null;
    if found then
      perform public.update_home_context_attributes(p_profile_id, home.id, home.revision, p_home);
    else
      select lat, lng, county, state, pwsid, water_source, home_year into located
        from public.profiles where id = p_profile_id;
      -- A stored point transition_home_context takes as it is: both set, already
      -- rounded to 3 decimals (its own refusal test, and PATCH /api/profile's).
      if located.lat is not null and located.lng is not null
         and located.lat = round(located.lat::numeric, 3)::double precision
         and located.lng = round(located.lng::numeric, 3)::double precision then
        -- The same point is not a move, so the legacy home is made from the
        -- profile and updated in place. Every answer is sent, the kept one as it was.
        perform public.transition_home_context(
          p_profile_id,
          jsonb_build_object('lat', located.lat, 'lng', located.lng, 'county', located.county, 'state', located.state),
          jsonb_build_object(
            'pwsid', located.pwsid,
            'water_source', case when p_home ? 'water_source' then p_home -> 'water_source' else to_jsonb(located.water_source) end,
            'home_year', case when p_home ? 'home_year' then p_home -> 'home_year' else to_jsonb(located.home_year) end
          ),
          null
        );
      else
        -- Not located: there is no home to save the answers in yet.
        update public.profiles set
          water_source = case when p_home ? 'water_source' then p_home ->> 'water_source' else water_source end,
          home_year    = case when p_home ? 'home_year' then (p_home ->> 'home_year')::numeric::int else home_year end
        where id = p_profile_id;
      end if;
    end if;
  end if;

  -- Tenure is written with renter_mode (Ruling S7); the trigger above holds them together anyway.
  if p_profile is not null and p_profile <> '{}'::jsonb then
    update public.profiles set
      tenure      = case when p_profile ? 'tenure' then p_profile ->> 'tenure' else tenure end,
      renter_mode = case when p_profile ? 'renter_mode' then (p_profile ->> 'renter_mode')::boolean else renter_mode end,
      locale      = case when p_profile ? 'locale' then p_profile ->> 'locale' else locale end
    where id = p_profile_id;
  end if;

  if p_notifications is not null and p_notifications <> '{}'::jsonb then
    insert into public.notification_prefs as np (
      profile_id, air_quality_change, weather_advisory, new_water_results, radon_season, season_summary, updated_at
    ) values (
      p_profile_id,
      coalesce((p_notifications ->> 'air_quality_change')::boolean, true),
      coalesce((p_notifications ->> 'weather_advisory')::boolean, true),
      coalesce((p_notifications ->> 'new_water_results')::boolean, true),
      coalesce((p_notifications ->> 'radon_season')::boolean, true),
      coalesce((p_notifications ->> 'season_summary')::boolean, true),
      now()
    )
    on conflict (profile_id) do update set
      air_quality_change = case when p_notifications ? 'air_quality_change' then excluded.air_quality_change else np.air_quality_change end,
      weather_advisory   = case when p_notifications ? 'weather_advisory' then excluded.weather_advisory else np.weather_advisory end,
      new_water_results  = case when p_notifications ? 'new_water_results' then excluded.new_water_results else np.new_water_results end,
      radon_season       = case when p_notifications ? 'radon_season' then excluded.radon_season else np.radon_season end,
      season_summary     = case when p_notifications ? 'season_summary' then excluded.season_summary else np.season_summary end,
      updated_at         = excluded.updated_at;
  end if;

  if p_bands is not null and p_bands <> '{}'::jsonb then
    insert into public.household_bands as hb (
      profile_id, has_toddler, has_child, has_teen, has_adult, has_senior, has_pregnant, has_respiratory, updated_at
    ) values (
      p_profile_id,
      coalesce((p_bands ->> 'has_toddler')::boolean, false),
      coalesce((p_bands ->> 'has_child')::boolean, false),
      coalesce((p_bands ->> 'has_teen')::boolean, false),
      coalesce((p_bands ->> 'has_adult')::boolean, false),
      coalesce((p_bands ->> 'has_senior')::boolean, false),
      coalesce((p_bands ->> 'has_pregnant')::boolean, false),
      coalesce((p_bands ->> 'has_respiratory')::boolean, false),
      now()
    )
    on conflict (profile_id) do update set
      has_toddler     = case when p_bands ? 'has_toddler' then excluded.has_toddler else hb.has_toddler end,
      has_child       = case when p_bands ? 'has_child' then excluded.has_child else hb.has_child end,
      has_teen        = case when p_bands ? 'has_teen' then excluded.has_teen else hb.has_teen end,
      has_adult       = case when p_bands ? 'has_adult' then excluded.has_adult else hb.has_adult end,
      has_senior      = case when p_bands ? 'has_senior' then excluded.has_senior else hb.has_senior end,
      has_pregnant    = case when p_bands ? 'has_pregnant' then excluded.has_pregnant else hb.has_pregnant end,
      has_respiratory = case when p_bands ? 'has_respiratory' then excluded.has_respiratory else hb.has_respiratory end,
      updated_at      = excluded.updated_at;
  end if;

  -- Exactly one advance for the whole save (see above). Only revision is set,
  -- so no trigger fires.
  update public.profile_preferences
     set revision = p_expected_revision + 1
   where profile_id = p_profile_id and revision <> p_expected_revision + 1;

  select * into saved from public.profile_preferences where profile_id = p_profile_id;
  select home_year, water_source, locale, tenure, renter_mode into profile_row
    from public.profiles where id = p_profile_id;
  select * into notification from public.notification_prefs where profile_id = p_profile_id;
  has_notes := found;

  return jsonb_build_object(
    'saved', true,
    'revision', saved.revision,
    'preferences', to_jsonb(saved),
    'profile', jsonb_build_object(
      'home_year', profile_row.home_year,
      'water_source', profile_row.water_source,
      'locale', profile_row.locale,
      'tenure', profile_row.tenure,
      'renter_mode', profile_row.renter_mode
    ),
    'notifications', case when has_notes then to_jsonb(notification) end
  );
end;
$$;

revoke execute on function public.save_settings(uuid, int, jsonb, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_settings(uuid, int, jsonb, jsonb, jsonb, jsonb, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- Verification (read only). Expect one row, all seven columns true.
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
--       = 6 as tenure_and_alert_columns,
--     (select count(*) from pg_trigger
--       where not tgisinternal
--         and tgname in ('profile_preferences_settings_revision', 'profiles_settings_revision',
--                        'profiles_tenure_reconcile', 'notification_prefs_settings_revision',
--                        'notification_prefs_settings_revision_insert', 'household_bands_settings_revision',
--                        'household_bands_settings_revision_insert')) = 7
--     and has_function_privilege('service_role',
--           'public.save_settings(uuid, int, jsonb, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE')
--     and not exists (
--       select 1 from unnest(array['anon', 'authenticated']) as r
--        where has_function_privilege(r,
--                'public.save_settings(uuid, int, jsonb, jsonb, jsonb, jsonb, jsonb)', 'EXECUTE'))
--       as revision_kept_by_the_database;
--
-- ---------------------------------------------------------------------------
-- If you need to back out 0021
-- ---------------------------------------------------------------------------
-- The settings and alerts-state routes go back to answering a non-retryable
-- 503 feature_unavailable, exactly as they do before this is applied, so
-- backing out disables the two new surfaces rather than breaking the existing
-- app. GET /api/alerts keeps every legacy key and drops only the new fields,
-- and never answers 503 (Ruling S10). PUT /api/notifications,
-- PUT /api/household, PATCH /api/profile, POST /api/onboard and
-- PATCH /api/home-contexts/[id] keep working exactly as before 0021: none of
-- them reads anything this migration added, and the triggers that advanced the
-- settings revision and kept tenure in step with renter_mode go with it. The
-- triggers are dropped before the tenure column, because they name it.
--
-- What is lost: every household's display, quiet-hours, calendar and
-- Luna-context choices, and the settings revision with them, because the whole
-- table is dropped. Every alert keeps its id, title, body, read and dismissed
-- state; what goes is each one's revision, category and navigation target, so a
-- client holding a revision can no longer patch against it and has to reload.
-- Revisions restart at 1 when 0021 is reapplied, for alerts and for the
-- settings row alike, so once a row has been patched back up to the number a
-- stale client still holds, that client's revision check would pass again.
-- After a back-out and reapply, have every open client reload.
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
-- drop trigger if exists profiles_tenure_reconcile on public.profiles;
-- drop trigger if exists profiles_settings_revision on public.profiles;
-- drop trigger if exists notification_prefs_settings_revision on public.notification_prefs;
-- drop trigger if exists notification_prefs_settings_revision_insert on public.notification_prefs;
-- drop trigger if exists household_bands_settings_revision on public.household_bands;
-- drop trigger if exists household_bands_settings_revision_insert on public.household_bands;
-- drop function if exists public.save_settings(uuid, int, jsonb, jsonb, jsonb, jsonb, jsonb);
-- drop function if exists public.reconcile_profile_tenure();
-- drop function if exists public.advance_settings_revision();
-- alter table public.alerts
--   drop column if exists target_learn,
--   drop column if exists target_destination,
--   drop column if exists target_tab,
--   drop column if exists category,
--   drop column if exists revision;
-- alter table public.profiles drop column if exists tenure;
--
-- Then run: notify pgrst, 'reload schema';
