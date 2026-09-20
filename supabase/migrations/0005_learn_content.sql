-- HALO — educational content (§9.2, §17)
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- One record per topic per language. Public reference data, readable by everyone.
--
-- The canonical content lives in code (lib/learnContent.js) so it can be reviewed
-- and unit-tested; /api/learn serves from there and composes the "why yours" line
-- from the household's own value at request time. This table is the spec'd
-- persistence layer for future DB-backed editing/translation; seed it from the
-- code module (a seed route/script) once this migration is applied. Spanish
-- (locale 'es') is stored as separate rows, human-reviewed, never machine-translated
-- at display time (§17.10).

create table if not exists public.learn_content (
  topic       text not null,     -- pfas | radon | lead | air | pollen | uv | mold
  locale      text not null default 'en' check (locale in ('en', 'es')),
  what_it_is  text not null,
  protect     jsonb not null default '[]',   -- ordered checklist of protective actions
  household   jsonb not null default '{}',   -- per-group framing branches
  sources     jsonb not null default '[]',   -- [{label, url, retrieved}]
  updated_at  timestamptz not null default now(),
  primary key (topic, locale)
);

alter table public.learn_content enable row level security;

drop policy if exists "learn_content_public_read" on public.learn_content;
create policy "learn_content_public_read" on public.learn_content
  for select using (true);
-- No user writes: only the service role seeds/edits.
