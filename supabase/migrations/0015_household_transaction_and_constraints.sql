-- HALO: one transaction for the household save, journal limits in the
-- database, and one validated write path for household rows.
-- Run once in the Supabase SQL editor, AFTER 0014. Safe to re-run.
--
-- Three things happen here:
--   1. public.save_household(...) saves a household's composition and, when
--      given, its renter mode and language in one transaction, for
--      PUT /api/household. Until this file runs, that route saves in two steps
--      and answers `transactional: false`; afterwards it answers
--      `transactional: true`.
--   2. symptom_logs gets check constraints that repeat the journal route's
--      limits (lib/limits.js; test/dbConstraints.test.mjs fails when the two
--      disagree). They are added NOT VALID: see section 2 before validating.
--   3. A signed-in household can no longer insert, update or delete
--      profiles, household_bands, symptom_logs or notification_prefs directly
--      with the public anon key. Every write goes through a HALO route, which
--      validates it and writes with the service role. Reading their own rows
--      and the row level security policies stay as they are.

-- ---------------------------------------------------------------------------
-- 1. save_household: the household save in one transaction
-- ---------------------------------------------------------------------------
-- p_bands holds the seven group booleans. A key that is missing or JSON null is
-- false, so a save replaces the composition, as the route always has; any
-- other key is ignored. renter_mode and locale change only when not null.
-- A missing profile, a group that is not a boolean, or a locale the profiles
-- table refuses (profiles_locale_check, 0002) fails the whole call, and
-- because a function call is one statement, nothing it wrote is kept.
--
-- Returns the saved state: { household, renter_mode, locale, updated_at }.
--
-- security invoker: it runs with the caller's rights, and only the service
-- role may call it (below). Supabase grants every new function in public to
-- anon and authenticated by default, so the revoke is required.

create or replace function public.save_household(
  p_profile_id  uuid,
  p_bands       jsonb,
  p_renter_mode boolean,
  p_locale      text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  band_keys constant text[] := array[
    'has_toddler', 'has_child', 'has_teen', 'has_adult',
    'has_senior', 'has_pregnant', 'has_respiratory'
  ];
  band_key text;
  saved    public.household_bands%rowtype;
  prefs    record;
begin
  if p_profile_id is null then
    raise exception 'save_household: p_profile_id is required' using errcode = '22004';
  end if;
  if p_bands is not null and jsonb_typeof(p_bands) <> 'object' then
    raise exception 'save_household: p_bands must be a JSON object' using errcode = '22023';
  end if;
  foreach band_key in array band_keys loop
    if jsonb_typeof(p_bands -> band_key) not in ('boolean', 'null') then
      raise exception 'save_household: % must be true or false', band_key using errcode = '22023';
    end if;
  end loop;

  -- Lock the household's profile row for the rest of the call; no row, no save.
  perform 1 from public.profiles where id = p_profile_id for no key update;
  if not found then
    raise exception 'save_household: no profile row for this household' using errcode = 'P0002';
  end if;

  insert into public.household_bands as hb (
    profile_id, has_toddler, has_child, has_teen, has_adult,
    has_senior, has_pregnant, has_respiratory, updated_at
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
    has_toddler     = excluded.has_toddler,
    has_child       = excluded.has_child,
    has_teen        = excluded.has_teen,
    has_adult       = excluded.has_adult,
    has_senior      = excluded.has_senior,
    has_pregnant    = excluded.has_pregnant,
    has_respiratory = excluded.has_respiratory,
    updated_at      = excluded.updated_at
  returning hb.* into saved;

  -- After the composition, in the same transaction: a refused locale undoes it.
  if p_renter_mode is not null or p_locale is not null then
    update public.profiles
       set renter_mode = coalesce(p_renter_mode, renter_mode),
           locale      = coalesce(p_locale, locale)
     where id = p_profile_id;
  end if;

  select renter_mode, locale into prefs from public.profiles where id = p_profile_id;

  return jsonb_build_object(
    'household', jsonb_build_object(
      'has_toddler',     saved.has_toddler,
      'has_child',       saved.has_child,
      'has_teen',        saved.has_teen,
      'has_adult',       saved.has_adult,
      'has_senior',      saved.has_senior,
      'has_pregnant',    saved.has_pregnant,
      'has_respiratory', saved.has_respiratory
    ),
    'renter_mode', prefs.renter_mode,
    'locale',      prefs.locale,
    'updated_at',  saved.updated_at
  );
end;
$$;

revoke execute on function public.save_household(uuid, jsonb, boolean, text)
  from public, anon, authenticated;
grant execute on function public.save_household(uuid, jsonb, boolean, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. symptom_logs: the journal's limits as check constraints
-- ---------------------------------------------------------------------------
-- The same rules as POST /api/journal (lib/limits.js): the group is one of the
-- seven household groups or 'household'; the rating is empty, mild, moderate
-- or bad; a note has at most 500 characters; an entry has at most 20
-- symptoms; the date is 2000-01-01 or later.
--
-- NOT VALID: Postgres checks every row inserted from now on, and every row an
-- UPDATE changes, but does not scan the rows already there. An UPDATE of an
-- older row that breaks a rule therefore fails, even when it changes another
-- column. (The journal route replaces every checked column when it saves a
-- day again, so it is not affected.)
--
-- Before validating, list the older rows that break a rule (read only; it
-- shows each row's id, date, group, rating and sizes, never a note or a
-- symptom):
--
--   select id, entry_date, band, severity,
--          char_length(note) as note_characters,
--          coalesce(array_length(symptoms, 1), 0) as symptom_count
--     from public.symptom_logs
--    where band not in ('has_toddler', 'has_child', 'has_teen', 'has_adult',
--                       'has_senior', 'has_pregnant', 'has_respiratory', 'household')
--       or (severity is not null and severity not in ('mild', 'moderate', 'bad'))
--       or char_length(note) > 500
--       or coalesce(array_length(symptoms, 1), 0) > 20
--       or entry_date < date '2000-01-01';
--
-- When it returns no rows (after fixing or deleting what it lists), make them
-- full constraints:
--
--   alter table public.symptom_logs validate constraint symptom_logs_band_check;
--   alter table public.symptom_logs validate constraint symptom_logs_severity_check;
--   alter table public.symptom_logs validate constraint symptom_logs_note_length_check;
--   alter table public.symptom_logs validate constraint symptom_logs_symptoms_count_check;
--   alter table public.symptom_logs validate constraint symptom_logs_entry_date_check;
--
-- The severity rule already exists from 0003 (as symptom_logs_severity_check,
-- validated); it is added here only where it is missing.

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.symptom_logs'::regclass
                    and conname = 'symptom_logs_band_check') then
    alter table public.symptom_logs
      add constraint symptom_logs_band_check
      check (band in ('has_toddler', 'has_child', 'has_teen', 'has_adult',
                      'has_senior', 'has_pregnant', 'has_respiratory', 'household'))
      not valid;
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.symptom_logs'::regclass
                    and conname = 'symptom_logs_severity_check') then
    alter table public.symptom_logs
      add constraint symptom_logs_severity_check
      check (severity is null or severity in ('mild', 'moderate', 'bad'))
      not valid;
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.symptom_logs'::regclass
                    and conname = 'symptom_logs_note_length_check') then
    alter table public.symptom_logs
      add constraint symptom_logs_note_length_check
      check (char_length(note) <= 500)
      not valid;
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.symptom_logs'::regclass
                    and conname = 'symptom_logs_symptoms_count_check') then
    alter table public.symptom_logs
      add constraint symptom_logs_symptoms_count_check
      check (coalesce(array_length(symptoms, 1), 0) <= 20)
      not valid;
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.symptom_logs'::regclass
                    and conname = 'symptom_logs_entry_date_check') then
    alter table public.symptom_logs
      add constraint symptom_logs_entry_date_check
      check (entry_date >= date '2000-01-01')
      not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. One validated write path for household rows
-- ---------------------------------------------------------------------------
-- No HALO client writes these tables with the anon key (the browser uses it
-- for sign-in only); the routes write them with the service role after
-- validating. Without this, row level security still let a signed-in user
-- write their own rows directly, skipping that validation (for example a
-- precise location in profiles.lat/lng, or an unbounded journal note).
--
-- Revoking a table privilege also revokes it from every column, so no column
-- grant is left behind. SELECT stays, and so do the policies, as a second
-- guard. The service role, and the handle_new_user trigger from 0001 (security
-- definer), are not affected.

revoke insert, update, delete
  on public.profiles, public.household_bands, public.symptom_logs, public.notification_prefs
  from anon, authenticated;
