-- HALO — assistant retrieval function (§18)
-- Run once in the Supabase SQL editor, AFTER 0007. Safe to re-run.
--
-- Cosine-similarity retrieval over the curated corpus. Called by /api/assistant
-- via supabaseAdmin.rpc('match_assistant_corpus', {...}) once an embedding-model
-- key exists and passages have been ingested (scripts/ingest-corpus.mjs).
--
-- pgvector's `<=>` is cosine DISTANCE (0 = identical), so cosine similarity is
-- `1 - (a <=> b)`. Passages below `min_similarity` are dropped so an off-topic
-- corpus yields no rows and the route declines with NO_SOURCE rather than
-- citing something irrelevant. Reads reference data only — never household rows.
--
-- search_path is pinned so `<=>` resolves from the extensions schema regardless
-- of the caller's path, and execution is limited to the service role (the only
-- caller) with the result count clamped, so it isn't an open public endpoint.

create or replace function public.match_assistant_corpus(
  query_embedding extensions.vector(1536),
  match_count     int default 6,
  min_similarity  double precision default 0.4
)
returns table (
  id           uuid,
  source_label text,
  source_url   text,
  retrieved    date,
  passage      text,
  similarity   double precision
)
language sql
stable
set search_path = public, extensions
as $$
  select
    c.id,
    c.source_label,
    c.source_url,
    c.retrieved,
    c.passage,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.assistant_corpus c
  where c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) >= min_similarity
  order by c.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 20);
$$;

revoke execute on function public.match_assistant_corpus(extensions.vector, int, double precision)
  from public, anon, authenticated;
grant execute on function public.match_assistant_corpus(extensions.vector, int, double precision)
  to service_role;
