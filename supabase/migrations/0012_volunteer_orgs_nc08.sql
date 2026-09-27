-- HALO — volunteer organizations for NC-08 (punch list v3 item 17)
-- Run once in the Supabase SQL editor, AFTER 0004. Safe to re-run.
--
-- Tags the starter organizations to the NC-08 counties they actually serve, and
-- adds organizations researched for NC-08's counties and causes — including
-- radon, which none covered before (a radon-only household got an empty list).
--
-- link_checked: the date each website was confirmed to load.
-- last_verified stays NULL: a PERSON must still confirm each organization is
-- operating and serves these counties before launch (§41, §66 item 8). The
-- interface shows NULL as "not yet verified". "Twenty verified beats forty
-- unverified" (§68) — this list is deliberately short and sourced.
--
-- Left out on purpose: Sierra Club Central Piedmont Group (its sierraclub.org
-- page redirects endlessly and its own site hasn't been updated since 2016).

alter table public.volunteer_orgs
  add column if not exists link_checked date;

insert into public.volunteer_orgs (name, description, counties, causes, url, link_checked) values
  -- Existing five, now tagged to the NC-08 counties in their river basins.
  ('Yadkin Riverkeeper',
   'Protects the Yadkin–Pee Dee River basin, which drains most of NC-08, through water monitoring, advocacy, and volunteer sampling.',
   array['Anson County','Cabarrus County','Montgomery County','Richmond County','Stanly County','Union County'],
   array['water','pfas','advocacy'], 'https://www.yadkinriverkeeper.org', '2026-09-27'),
  ('Catawba Riverkeeper Foundation',
   'Monitors and defends the Catawba–Wateree River basin, including the Charlotte area and western Union County.',
   array['Mecklenburg County','Union County'],
   array['water','pfas','advocacy'], 'https://www.catawbariverkeeper.org', '2026-09-27'),
  ('Cape Fear River Watch',
   'Works on PFAS and other pollution in the Cape Fear River basin, including the downstream communities affected by GenX.',
   array['statewide'], array['water','pfas','advocacy'], 'https://capefearriverwatch.org', '2026-09-27'),
  ('Clean Water for North Carolina',
   'Statewide environmental justice group focused on drinking water, private wells, and community organizing.',
   array['statewide'], array['water','wells','advocacy'], 'https://www.cwfnc.org', '2026-09-27'),
  ('NC Conservation Network',
   'A statewide network coordinating advocacy on clean water, clean air, and environmental policy across North Carolina.',
   array['statewide'], array['water','air','advocacy'], 'https://www.ncconservationnetwork.org', '2026-09-27'),

  -- New.
  ('Three Rivers Land Trust',
   'Conserves land and water in a fifteen-county region of the central Piedmont and Sandhills, with volunteer workdays on protected land.',
   array['Anson County','Cabarrus County','Montgomery County','Richmond County','Scotland County','Stanly County'],
   array['water'], 'https://trlt.org', '2026-09-27'),
  ('Winyah Rivers Alliance (Lumber Riverkeeper)',
   'Protects the Lumber River watershed through its Lumber Riverkeeper, with water monitoring and advocacy on pollution along the river.',
   array['Robeson County','Scotland County'],
   array['water','advocacy'], 'https://winyahrivers.org', '2026-09-27'),
  ('Catawba Lands Conservancy',
   'A land trust permanently conserving land and streams in the southern Piedmont, with volunteer trail and cleanup days.',
   array['Mecklenburg County','Union County'],
   array['water'], 'https://catawbalands.org', '2026-09-27'),
  ('CleanAIRE NC',
   'Advocates for clean air and climate solutions from offices in Charlotte and RTP; its AirKeepers volunteers run community air-quality sensors.',
   array['Mecklenburg County','statewide'],
   array['air','advocacy'], 'https://cleanairenc.org', '2026-09-27'),
  ('American Lung Association in North Carolina',
   'Works on lung health, air quality, and radon awareness in North Carolina, with volunteer and advocacy opportunities.',
   array['statewide'],
   array['air','radon','advocacy'], 'https://www.lung.org/about-us/local-associations/north-carolina.html', '2026-09-27'),
  ('North Carolina Radon Program (NCDHHS)',
   'The state radon program: free home radon test kits each January, radon data by county, and help finding mitigation.',
   array['statewide'],
   array['radon'], 'https://radon.ncdhhs.gov', '2026-09-27'),
  ('North Carolina Environmental Justice Network',
   'A grassroots, people-of-color-led coalition supporting communities facing environmental injustice, including meetings held in Robeson County.',
   array['Robeson County','statewide'],
   array['water','air','advocacy'], 'https://ncejn.org', '2026-09-27'),
  ('Toxic Free NC',
   'Statewide education and advocacy on pesticide and toxic exposures, focused on families and communities most at risk.',
   array['statewide'],
   array['advocacy'], 'https://toxicfreenc.org', '2026-09-27')
on conflict (name) do update set
  description  = excluded.description,
  counties     = excluded.counties,
  causes       = excluded.causes,
  url          = excluded.url,
  link_checked = excluded.link_checked;
  -- last_verified is deliberately untouched: only a person sets it.
