-- HALO — volunteer organizations (§9.2, §15.3)
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Public reference data (not household data), readable by everyone. Written only
-- by whoever maintains the directory. `last_verified` forces periodic human
-- re-checking — a directory of dead links would undermine the hand-verified claim.
--
-- The seed below is a STARTER set of real NC environmental organizations. Per
-- §41/§66 every entry must be human-verified (operating + link resolves) before
-- launch; `last_verified` is left NULL until that happens, and the interface
-- should render NULL as "not yet verified" rather than a date.

create table if not exists public.volunteer_orgs (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text not null,
  counties      text[] not null default '{}',   -- county names, or the literal 'statewide'
  causes        text[] not null default '{}',   -- cause tags: water, pfas, radon, air, wells, advocacy
  url           text not null,
  last_verified date,                            -- NULL until a human checks it
  created_at    timestamptz not null default now()
);

alter table public.volunteer_orgs enable row level security;

drop policy if exists "volunteer_orgs_public_read" on public.volunteer_orgs;
create policy "volunteer_orgs_public_read" on public.volunteer_orgs
  for select using (true);
-- No insert/update/delete policies: only the service role writes.

-- ── Starter seed (real orgs; VERIFY before launch) ──
insert into public.volunteer_orgs (name, description, counties, causes, url, last_verified) values
  ('Yadkin Riverkeeper',
   'Protects the Yadkin–Pee Dee River basin, which drains much of NC-08, through monitoring, advocacy, and volunteer water sampling.',
   array['statewide'], array['water','pfas','advocacy'], 'https://www.yadkinriverkeeper.org', null),
  ('Catawba Riverkeeper Foundation',
   'Monitors and defends the Catawba–Wateree basin, including the Charlotte metro and Cabarrus area.',
   array['statewide'], array['water','pfas','advocacy'], 'https://www.catawbariverkeeper.org', null),
  ('Cape Fear River Watch',
   'Works on PFAS and pollution in the Cape Fear River basin, including the downstream communities affected by GenX.',
   array['statewide'], array['water','pfas','advocacy'], 'https://capefearriverwatch.org', null),
  ('Clean Water for North Carolina',
   'Statewide environmental justice group focused on drinking water, private wells, and community organizing.',
   array['statewide'], array['water','wells','advocacy'], 'https://www.cwfnc.org', null),
  ('NC Conservation Network',
   'A statewide network coordinating advocacy on clean water, clean air, and environmental policy across North Carolina.',
   array['statewide'], array['water','air','advocacy'], 'https://www.ncconservationnetwork.org', null)
on conflict do nothing;
