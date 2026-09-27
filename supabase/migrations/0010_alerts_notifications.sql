-- HALO — alerts: dismiss, notification preferences, device push, water change
-- tracking (punch list v3 item 16). Run once in the Supabase SQL editor, AFTER
-- 0006. Safe to re-run.

-- ── Dismiss (§19.4 swipe, with undo) ────────────────────────────────────────
alter table public.alerts
  add column if not exists dismissed boolean not null default false;

-- ── Notification preferences, one row per household ─────────────────────────
-- Every type defaults on. The daily job skips types turned off.
create table if not exists public.notification_prefs (
  profile_id          uuid primary key references public.profiles (id) on delete cascade,
  air_quality_change  boolean not null default true,
  weather_advisory    boolean not null default true,
  new_water_results   boolean not null default true,
  radon_season        boolean not null default true,
  season_summary      boolean not null default true,
  updated_at          timestamptz not null default now()
);

alter table public.notification_prefs enable row level security;
drop policy if exists "notification_prefs_select_own" on public.notification_prefs;
create policy "notification_prefs_select_own" on public.notification_prefs
  for select using (auth.uid() = profile_id);
drop policy if exists "notification_prefs_upsert_own" on public.notification_prefs;
create policy "notification_prefs_upsert_own" on public.notification_prefs
  for insert with check (auth.uid() = profile_id);
drop policy if exists "notification_prefs_update_own" on public.notification_prefs;
create policy "notification_prefs_update_own" on public.notification_prefs
  for update using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

-- ── Browser push subscriptions (§19.5) ───────────────────────────────────────
-- One row per browser/device. Written only by the server (service role) from the
-- verified session; endpoints that the push service reports expired are deleted.
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_profile on public.push_subscriptions (profile_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own" on public.push_subscriptions
  for select using (auth.uid() = profile_id);
-- No client writes: /api/push/subscribe writes with the service role.

-- ── Water result change tracking ─────────────────────────────────────────────
-- A fingerprint of each utility's stored readings. When a UCMR reload changes
-- it, the daily job alerts that utility's households (new_water_results) and
-- updates the fingerprint. Public reference data, server-written only.
create table if not exists public.water_snapshots (
  pwsid        text primary key,
  fingerprint  text not null,
  updated_at   timestamptz not null default now()
);
alter table public.water_snapshots enable row level security;
-- No policies: service role only.
