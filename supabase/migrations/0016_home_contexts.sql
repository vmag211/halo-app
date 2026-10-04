-- HALO: home contexts. A household's readings belong to the home they were
-- measured at; a move closes the old home and opens the new one, so the old
-- home's readings are never shown as the new home's history (HO-066, HO-099).
-- Run once in the Supabase SQL editor, AFTER 0015. Safe to re-run.
--
-- Four things happen here:
--   1. public.home_contexts: one row per stay at one located home. At most one
--      per household is current (effective_to is null). Owners may read their
--      own rows; nobody but the service role writes them.
--   2. daily_scores.home_context_id: which stay a reading belongs to. A
--      composite foreign key means a reading can only point at its own
--      household's context.
--   3. Two functions, for the service role only:
--        transition_home_context(p_profile_id, p_location, p_attributes, p_request_id)
--        update_home_context_attributes(p_profile_id, p_context_id, p_expected_revision, p_attributes)
--   4. Every household that already has a location gets a legacy context, and
--      its existing readings are linked to it.
--
-- No route uses any of this yet: onboard and profile will call the functions,
-- and history and the daily writers will read and set the link, in a later
-- change. Until then the routes keep working exactly as before: the new
-- column is nullable and nothing reads the table.
--
-- Errors the functions raise, for the routes to map. Each is SQLSTATE P0001
-- with exactly this message; DETAIL says more:
--   HALO_INVALID_INPUT       an argument is missing or malformed (DETAIL names it)
--   HALO_PROFILE_NOT_FOUND   the household has no profiles row
--   HALO_CONTEXT_NOT_FOUND   no such context for this household (another
--                            household's context gives exactly the same error)
--   HALO_CONTEXT_CLOSED      the context is closed (the household has moved on)
--   HALO_STALE_REVISION      the context changed since it was read; DETAIL is
--                            JSON with the current revision: {"revision": 3}
--
-- Is it a move? transition_home_context compares the new point with the
-- current context's stored point, inside the call, after locking the
-- household's profile row: a move is a stored point (lat and lng both set)
-- that differs from the new one. That is locationMoved from lib/geocode.js,
-- and lib/homeContext.js shouldOpenNewContext mirrors it. Rounding is NOT
-- repeated here: the route rounds lat and lng to 3 decimals with roundCoord
-- (JavaScript, a half rounds toward +infinity) and this function refuses a
-- point with more than 3 decimals. Postgres round() rounds a half away from
-- zero (-80.4565 becomes -80.457, roundCoord gives -80.456), so a second
-- rounding here could disagree with the first. Comparing under the lock, not
-- trusting a flag the route worked out from an earlier read, means two
-- requests racing cannot both decide against the same old state.
-- test/homeContextDb.test.mjs runs both on one table of coordinate pairs.
--
-- Account deletion. Deleting a profiles row (which deleting the auth user
-- does) still removes everything: home_contexts and daily_scores both
-- cascade from profiles. The link from daily_scores to home_contexts is ON
-- DELETE NO ACTION, which Postgres checks after the profile's cascades have
-- run, so the readings are gone by then (test/homeContextDb.test.mjs deletes
-- households with the two cascades from profiles in either order). What NO
-- ACTION changes is a context deleted on its own: while it still has
-- readings, that fails. Nothing deletes contexts (no route does and no API
-- role may), and a stray delete should not take a stay's history with it
-- (CASCADE) or cut readings loose from their home (SET NULL), which would let
-- an old home's readings pass for the current home's.
--
-- Known limitation of the legacy contexts (section 4). Before this migration
-- nothing recorded moves. A household that moved earlier has readings from
-- both homes, and they cannot be told apart: all of them are linked to the
-- one legacy context made from today's profile location. Such a context is
-- marked origin = 'legacy_migration', so the API can flag its readings as
-- assumed rather than known to be from the current home. Its effective_from
-- is when this migration ran, not when the household moved in (unknown).
--
-- To check it took (read only; it shows yes or no answers, never a
-- household's data), run this and expect one row with every column true:
--
--   select
--     (select relrowsecurity from pg_class where oid = 'public.home_contexts'::regclass)
--       as home_contexts_rls_on,
--     (select array_agg(cmd::text) from pg_policies
--       where schemaname = 'public' and tablename = 'home_contexts') = array['SELECT']
--       as owner_select_policy_only,
--     not (has_any_column_privilege('authenticated', 'public.home_contexts', 'INSERT')
--       or has_any_column_privilege('authenticated', 'public.home_contexts', 'UPDATE')
--       or has_table_privilege('authenticated', 'public.home_contexts', 'DELETE')
--       or has_any_column_privilege('anon', 'public.home_contexts', 'SELECT')
--       or has_any_column_privilege('anon', 'public.home_contexts', 'INSERT')
--       or has_any_column_privilege('anon', 'public.home_contexts', 'UPDATE')
--       or has_table_privilege('anon', 'public.home_contexts', 'DELETE'))
--       as no_direct_writes,
--     not (has_function_privilege('anon', 'public.transition_home_context(uuid, jsonb, jsonb, uuid)', 'EXECUTE')
--       or has_function_privilege('authenticated', 'public.transition_home_context(uuid, jsonb, jsonb, uuid)', 'EXECUTE')
--       or has_function_privilege('anon', 'public.update_home_context_attributes(uuid, uuid, integer, jsonb)', 'EXECUTE')
--       or has_function_privilege('authenticated', 'public.update_home_context_attributes(uuid, uuid, integer, jsonb)', 'EXECUTE'))
--       and has_function_privilege('service_role', 'public.transition_home_context(uuid, jsonb, jsonb, uuid)', 'EXECUTE')
--       and has_function_privilege('service_role', 'public.update_home_context_attributes(uuid, uuid, integer, jsonb)', 'EXECUTE')
--       as functions_service_role_only,
--     exists (select 1 from pg_constraint
--              where conrelid = 'public.daily_scores'::regclass and conname = 'daily_scores_home_context_fkey')
--       as readings_link_checked,
--     not exists (select 1 from public.profiles p
--                  where p.lat is not null
--                    and not exists (select 1 from public.home_contexts h where h.profile_id = p.id))
--       as every_located_household_has_a_context,
--     not exists (select 1 from public.daily_scores s
--                  join public.home_contexts h
--                    on h.profile_id = s.profile_id and h.origin = 'legacy_migration' and h.effective_to is null
--                  where s.home_context_id is null)
--       as legacy_readings_linked,
--     not exists (select 1 from public.profiles p
--                  join public.home_contexts h on h.profile_id = p.id and h.effective_to is null
--                  where p.lat is distinct from h.lat or p.lng is distinct from h.lng)
--       as profiles_match_current_context;
--
-- An error that public.home_contexts does not exist means this file has not
-- run. The last three columns are true straight after it runs. While the
-- routes do not use contexts yet, they can turn false: a household onboarded
-- after this file has no context, a reading written since has none, and a
-- household that changes address moves its profile but not its context.
-- Running this file again fixes the first two, not the third.

-- ---------------------------------------------------------------------------
-- 1. home_contexts
-- ---------------------------------------------------------------------------
-- sequence: 1, 2, 3 per household, in the order of its homes.
-- revision: starts at 1 and goes up on every change to the row's attributes,
--   for optimistic concurrency (update_home_context_attributes).
-- origin: 'onboard' (the first home), 'move' (every later one) or
--   'legacy_migration' (made by section 4 from an existing profile).
-- lat, lng: the household's point, rounded to 3 decimals by the route (about
--   110 m), as profiles stores it. Kept for closed stays too.
-- match_method: how the location was found, for example
--   'mapbox_geocode_arcgis_point' or 'legacy_profile'.
-- backfill_*: the history backfill for this stay, written by the server.
-- effective_from, effective_to: when the stay began and ended; effective_to is
--   null for the current stay, and closed_reason says why it ended.

create table if not exists public.home_contexts (
  id                   uuid primary key default gen_random_uuid(),
  profile_id           uuid not null references public.profiles (id) on delete cascade,
  sequence             int not null,
  revision             int not null default 1,
  origin               text not null check (origin in ('onboard', 'move', 'legacy_migration')),
  lat                  double precision,
  lng                  double precision,
  county               text,
  state                text,
  pwsid                text,
  service_area_status  text,
  water_source         text,
  home_year            int,
  match_method         text,
  onboard_request_id   uuid,
  backfill_state       text not null default 'not_started'
                         check (backfill_state in ('not_started', 'running', 'complete', 'partial', 'failed', 'not_applicable')),
  backfill_from        date,
  backfill_to          date,
  backfill_updated_at  timestamptz,
  effective_from       timestamptz not null default now(),
  effective_to         timestamptz,
  closed_reason        text check (closed_reason in ('moved')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (profile_id, sequence),
  unique (profile_id, id)
);

-- At most one current context per household. The functions also lock the
-- household's profile row, so this is the backstop, not the mechanism.
create unique index if not exists home_contexts_one_current
  on public.home_contexts (profile_id)
  where effective_to is null;

alter table public.home_contexts enable row level security;

drop policy if exists "home_contexts_select_own" on public.home_contexts;
create policy "home_contexts_select_own" on public.home_contexts
  for select using (auth.uid() = profile_id);

-- No insert, update or delete policy, and no such privilege either: Supabase's
-- default privileges grant every new table to anon and authenticated, so they
-- are revoked (with them TRUNCATE, REFERENCES and TRIGGER, and any column
-- grant). A signed-in owner may select their own rows; anon may not select.
revoke all on table public.home_contexts from anon, authenticated;
grant select on table public.home_contexts to authenticated;

-- ---------------------------------------------------------------------------
-- 2. daily_scores.home_context_id
-- ---------------------------------------------------------------------------
-- Nullable: readings written before this file, and by routes that do not set
-- it yet, have none. MATCH SIMPLE (the default) skips the check when it is
-- null; otherwise (profile_id, home_context_id) must be one of that same
-- household's contexts. ON DELETE NO ACTION: see "Account deletion" above.

alter table public.daily_scores
  add column if not exists home_context_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.daily_scores'::regclass
                    and conname = 'daily_scores_home_context_fkey') then
    alter table public.daily_scores
      add constraint daily_scores_home_context_fkey
      foreign key (profile_id, home_context_id)
      references public.home_contexts (profile_id, id)
      on delete no action;
  end if;
end $$;

create index if not exists daily_scores_profile_context_date
  on public.daily_scores (profile_id, home_context_id, date);

-- ---------------------------------------------------------------------------
-- 3a. transition_home_context: save the household's home
-- ---------------------------------------------------------------------------
-- p_profile_id is trusted: only the service role may call this, and the route
-- passes the id from the verified session token, never one from the request.
--
-- p_location: { lat, lng, county?, state? }. lat and lng are required numbers,
--   already rounded to 3 decimals.
-- p_attributes: { pwsid?, service_area_status?, water_source?, home_year?,
--   match_method? } or null for none.
-- p_request_id: the client's id for this onboarding request, or null.
-- lib/homeContext.js toContextAttributes builds the two objects. Any other key
-- is HALO_INVALID_INPUT. A key that is given (JSON null included) is written;
-- a key left out keeps the stored value when the home is the same, and is
-- null at a new home: nothing about the old home is carried over.
-- A failed utility lookup (service_area_status 'lookup_failed') never
-- overwrites a stored utility: at the same home pwsid and service_area_status
-- keep their stored values; at a new home pwsid is null. Any pwsid sent with
-- it is ignored.
--
-- In one transaction, after locking the household's profile row:
--   * Same request id as the current context's onboard_request_id: a retry.
--     The current context comes back with moved false and nothing changes. A
--     request id that matches only an earlier, closed context is a new request
--     (a closed context is never reopened).
--   * No current context: sequence max + 1 (1 for a new household), origin
--     'onboard'.
--   * A move: the current context closes (effective_to = now(), closed_reason
--     'moved') and the next sequence opens with origin 'move', starting at the
--     same instant. The household's readings that have no context (written
--     before the routes set one) predate the new home, so they are linked to
--     the closing context and never pass for the new home's history. Then
--     today's readings of the closed context are deleted (the household's
--     calendar day, America/New_York as lib/localDate.js): they describe the
--     old home and would otherwise stand in for the new home's first reading.
--     No other day is touched.
--   * Otherwise the current context is updated in place and its revision goes
--     up by one.
--   * Except on a retry, the profiles columns the existing routes read follow
--     the resulting context: lat, lng, county, state, pwsid, water_source,
--     home_year, and onboard_request_id (when one is given). zip is cleared,
--     as the onboard route always has.
--
-- Returns { context, moved, previous_context_id }: the resulting row, whether
-- a context was closed, and that context's id (else null).

create or replace function public.transition_home_context(
  p_profile_id uuid,
  p_location   jsonb,
  p_attributes jsonb,
  p_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  location_keys   constant text[] := array['lat', 'lng', 'county', 'state'];
  text_location   constant text[] := array['county', 'state'];
  attribute_keys  constant text[] := array['pwsid', 'service_area_status', 'water_source', 'home_year', 'match_method'];
  text_attributes constant text[] := array['pwsid', 'service_area_status', 'water_source', 'match_method'];
  attrs           jsonb := coalesce(p_attributes, '{}'::jsonb);
  bad             text;
  key             text;
  new_lat         double precision;
  new_lng         double precision;
  lookup_failed   boolean;
  cur             public.home_contexts%rowtype;
  saved           public.home_contexts%rowtype;
  has_current     boolean;
  moved           boolean := false;
  next_sequence   int;
begin
  -- Arguments first: nothing is read or written for a malformed call.
  if p_profile_id is null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_profile_id is required';
  end if;
  if p_location is null or jsonb_typeof(p_location) <> 'object' then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_location must be a JSON object';
  end if;
  if jsonb_typeof(attrs) <> 'object' then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_attributes must be a JSON object or null';
  end if;
  select string_agg(k, ', ' order by k) into bad from jsonb_object_keys(p_location) k where k <> all (location_keys);
  if bad is not null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('p_location has unknown keys: %s', bad);
  end if;
  select string_agg(k, ', ' order by k) into bad from jsonb_object_keys(attrs) k where k <> all (attribute_keys);
  if bad is not null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('p_attributes has unknown keys: %s', bad);
  end if;
  foreach key in array array['lat', 'lng'] loop
    if jsonb_typeof(p_location -> key) is distinct from 'number' then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('p_location.%s must be a number', key);
    end if;
  end loop;
  -- Range checked as numeric, before the cast, so a huge number is refused rather than overflowing.
  if (p_location ->> 'lat')::numeric not between -90 and 90 then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_location.lat must be between -90 and 90';
  end if;
  if (p_location ->> 'lng')::numeric not between -180 and 180 then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_location.lng must be between -180 and 180';
  end if;
  new_lat := (p_location ->> 'lat')::double precision;
  new_lng := (p_location ->> 'lng')::double precision;
  if new_lat <> round(new_lat::numeric, 3)::double precision
     or new_lng <> round(new_lng::numeric, 3)::double precision then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001',
      detail = 'p_location.lat and p_location.lng must be rounded to 3 decimals (roundCoord)';
  end if;
  foreach key in array text_location loop
    if jsonb_typeof(p_location -> key) not in ('string', 'null') then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('p_location.%s must be a string or null', key);
    end if;
  end loop;
  foreach key in array text_attributes loop
    if jsonb_typeof(attrs -> key) not in ('string', 'null') then
      raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('p_attributes.%s must be a string or null', key);
    end if;
  end loop;
  if jsonb_typeof(attrs -> 'home_year') not in ('number', 'null')
     or (jsonb_typeof(attrs -> 'home_year') = 'number'
         and ((attrs ->> 'home_year')::numeric <> trunc((attrs ->> 'home_year')::numeric)
              or (attrs ->> 'home_year')::numeric not between -2147483648 and 2147483647)) then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_attributes.home_year must be a whole number or null';
  end if;
  lookup_failed := (attrs ->> 'service_area_status') is not distinct from 'lookup_failed';

  -- One household at a time: a second call for the same household waits here
  -- until this one commits. FOR NO KEY UPDATE conflicts with itself but not
  -- with the key-share locks other tables' inserts take on this row (a
  -- reading written meanwhile does not wait).
  perform 1 from public.profiles where id = p_profile_id for no key update;
  if not found then
    raise exception 'HALO_PROFILE_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into cur from public.home_contexts where profile_id = p_profile_id and effective_to is null;
  has_current := found;

  if has_current and p_request_id is not null and cur.onboard_request_id = p_request_id then
    return jsonb_build_object('context', to_jsonb(cur), 'moved', false, 'previous_context_id', null);
  end if;

  if has_current then
    moved := cur.lat is not null and cur.lng is not null and (cur.lat <> new_lat or cur.lng <> new_lng);
  end if;

  if has_current and not moved then
    update public.home_contexts hc set
      lat                 = new_lat,
      lng                 = new_lng,
      county              = case when p_location ? 'county' then p_location ->> 'county' else hc.county end,
      state               = case when p_location ? 'state' then p_location ->> 'state' else hc.state end,
      pwsid               = case when lookup_failed or not attrs ? 'pwsid' then hc.pwsid else attrs ->> 'pwsid' end,
      service_area_status = case when lookup_failed or not attrs ? 'service_area_status' then hc.service_area_status
                                 else attrs ->> 'service_area_status' end,
      water_source        = case when attrs ? 'water_source' then attrs ->> 'water_source' else hc.water_source end,
      home_year           = case when attrs ? 'home_year' then (attrs ->> 'home_year')::numeric::int else hc.home_year end,
      match_method        = case when attrs ? 'match_method' then attrs ->> 'match_method' else hc.match_method end,
      onboard_request_id  = coalesce(p_request_id, hc.onboard_request_id),
      revision            = hc.revision + 1,
      updated_at          = now()
    where hc.id = cur.id
    returning hc.* into saved;
  else
    if moved then
      update public.home_contexts
         set effective_to = now(), closed_reason = 'moved', updated_at = now()
       where id = cur.id;
    end if;

    select coalesce(max(sequence), 0) + 1 into next_sequence
      from public.home_contexts where profile_id = p_profile_id;

    insert into public.home_contexts (
      profile_id, sequence, origin, lat, lng, county, state, pwsid, service_area_status,
      water_source, home_year, match_method, onboard_request_id, effective_from
    ) values (
      p_profile_id,
      next_sequence,
      case when moved then 'move' else 'onboard' end,
      new_lat,
      new_lng,
      p_location ->> 'county',
      p_location ->> 'state',
      case when lookup_failed then null else attrs ->> 'pwsid' end,
      attrs ->> 'service_area_status',
      attrs ->> 'water_source',
      (attrs ->> 'home_year')::numeric::int,
      attrs ->> 'match_method',
      p_request_id,
      now()
    )
    returning * into saved;

    if moved then
      update public.daily_scores
         set home_context_id = cur.id
       where profile_id = p_profile_id and home_context_id is null;

      delete from public.daily_scores
       where profile_id = p_profile_id
         and home_context_id = cur.id
         and date = (now() at time zone 'America/New_York')::date;
    end if;
  end if;

  update public.profiles set
    lat                = saved.lat,
    lng                = saved.lng,
    county             = saved.county,
    state              = saved.state,
    pwsid              = saved.pwsid,
    water_source       = saved.water_source,
    home_year          = saved.home_year,
    onboard_request_id = coalesce(p_request_id, onboard_request_id),
    zip                = null
  where id = p_profile_id;

  return jsonb_build_object(
    'context', to_jsonb(saved),
    'moved', moved,
    'previous_context_id', case when moved then cur.id end
  );
end;
$$;

revoke execute on function public.transition_home_context(uuid, jsonb, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.transition_home_context(uuid, jsonb, jsonb, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3b. update_home_context_attributes: change answers about the current home
-- ---------------------------------------------------------------------------
-- p_profile_id is trusted for the same reason as above. p_context_id is only a
-- lookup key: it is matched together with p_profile_id, so another
-- household's context is HALO_CONTEXT_NOT_FOUND, exactly like a missing one.
--
-- p_attributes: { water_source?, home_year? }, at least one of them; JSON null
-- clears it. Anything else (the location, the utility, the revision) is
-- HALO_INVALID_INPUT: those change only through transition_home_context.
--
-- After locking the household's profile row: a closed context is
-- HALO_CONTEXT_CLOSED; a revision other than p_expected_revision is
-- HALO_STALE_REVISION, with the current one in DETAIL. Otherwise the
-- attributes given are written, revision goes up by one, and the profile's
-- water_source and home_year follow. Returns { context }: the updated row.

create or replace function public.update_home_context_attributes(
  p_profile_id        uuid,
  p_context_id        uuid,
  p_expected_revision int,
  p_attributes        jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  bad   text;
  cur   public.home_contexts%rowtype;
  saved public.home_contexts%rowtype;
begin
  if p_profile_id is null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_profile_id is required';
  end if;
  if p_context_id is null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_context_id is required';
  end if;
  if p_expected_revision is null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_expected_revision is required';
  end if;
  if p_attributes is null or jsonb_typeof(p_attributes) <> 'object' or p_attributes = '{}'::jsonb then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001',
      detail = 'p_attributes must be a JSON object with water_source or home_year';
  end if;
  select string_agg(k, ', ' order by k) into bad
    from jsonb_object_keys(p_attributes) k where k not in ('water_source', 'home_year');
  if bad is not null then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = format('p_attributes has keys that cannot change here: %s', bad);
  end if;
  if jsonb_typeof(p_attributes -> 'water_source') not in ('string', 'null') then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_attributes.water_source must be a string or null';
  end if;
  if jsonb_typeof(p_attributes -> 'home_year') not in ('number', 'null')
     or (jsonb_typeof(p_attributes -> 'home_year') = 'number'
         and ((p_attributes ->> 'home_year')::numeric <> trunc((p_attributes ->> 'home_year')::numeric)
              or (p_attributes ->> 'home_year')::numeric not between -2147483648 and 2147483647)) then
    raise exception 'HALO_INVALID_INPUT' using errcode = 'P0001', detail = 'p_attributes.home_year must be a whole number or null';
  end if;

  -- The same lock as transition_home_context, so the two never interleave.
  perform 1 from public.profiles where id = p_profile_id for no key update;
  if not found then
    raise exception 'HALO_PROFILE_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into cur from public.home_contexts where id = p_context_id and profile_id = p_profile_id;
  if not found then
    raise exception 'HALO_CONTEXT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if cur.effective_to is not null then
    raise exception 'HALO_CONTEXT_CLOSED' using errcode = 'P0001';
  end if;
  if cur.revision <> p_expected_revision then
    raise exception 'HALO_STALE_REVISION' using errcode = 'P0001',
      detail = jsonb_build_object('revision', cur.revision)::text;
  end if;

  update public.home_contexts hc set
    water_source = case when p_attributes ? 'water_source' then p_attributes ->> 'water_source' else hc.water_source end,
    home_year    = case when p_attributes ? 'home_year' then (p_attributes ->> 'home_year')::numeric::int else hc.home_year end,
    revision     = hc.revision + 1,
    updated_at   = now()
  where hc.id = cur.id
  returning hc.* into saved;

  update public.profiles
     set water_source = saved.water_source, home_year = saved.home_year
   where id = p_profile_id;

  return jsonb_build_object('context', to_jsonb(saved));
end;
$$;

revoke execute on function public.update_home_context_attributes(uuid, uuid, int, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_home_context_attributes(uuid, uuid, int, jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. Legacy contexts for households located before this migration
-- ---------------------------------------------------------------------------
-- Safe to re-run: a household that has any context gets no other, and a
-- reading that has a context is never re-pointed. A reading without one is
-- linked only while the legacy context is still current (after a move, an
-- unlinked reading cannot be placed, so it is left alone). See "Known
-- limitation" above.

insert into public.home_contexts (
  profile_id, sequence, origin, lat, lng, county, state, pwsid, water_source,
  home_year, match_method, onboard_request_id, backfill_state
)
select p.id, 1, 'legacy_migration', p.lat, p.lng, p.county, p.state, p.pwsid, p.water_source,
       p.home_year, 'legacy_profile', p.onboard_request_id, 'not_applicable'
  from public.profiles p
 where p.lat is not null
   and not exists (select 1 from public.home_contexts h where h.profile_id = p.id);

update public.daily_scores s
   set home_context_id = h.id
  from public.home_contexts h
 where h.profile_id = s.profile_id
   and h.origin = 'legacy_migration'
   and h.effective_to is null
   and s.home_context_id is null;
