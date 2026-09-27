-- HALO — pre-built map layers and district aggregate (punch list v3 items 18, 19)
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- The daily job assembles every map layer (water, radon, facilities, air) and
-- the NC-08 district aggregate once a day and stores the result here; /api/map
-- and /api/district serve it. A slow or unavailable government service can then
-- never slow or break the map (§13.10, §62.1). Public reference data only — no
-- household data. Server-written (service role) and server-read.

create table if not exists public.map_layers (
  layer         text primary key,          -- 'water' | 'radon' | 'facilities' | 'air' | 'district'
  payload       jsonb not null,
  assembled_at  timestamptz not null default now()
);

alter table public.map_layers enable row level security;
-- No policies: service role only.
