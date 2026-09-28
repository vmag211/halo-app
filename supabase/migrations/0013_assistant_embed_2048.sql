-- HALO — assistant embeddings at 2,048 dimensions (OpenRouter free model)
-- Run once in the Supabase SQL editor, AFTER 0007/0008. Safe to re-run.
--
-- The assistant now embeds with nvidia/nemotron-3-embed-1b (via OpenRouter's
-- free tier), which only produces 2,048-dimension vectors. pgvector's HNSW index
-- supports at most 2,000 dimensions, so the approximate index is dropped:
-- the curated corpus is ~14 passages, and an exact scan of it is instant (and
-- slightly more accurate than an approximate index). If the corpus ever grows to
-- tens of thousands of passages, add an HNSW index on embedding::halfvec(2048).
--
-- Embeddings from different models are not comparable, so any rows embedded
-- with the old 1,536-dimension model are removed; re-run
-- `node scripts/ingest-corpus.mjs` afterwards.

drop index if exists public.assistant_corpus_embedding;

delete from public.assistant_corpus
 where embedding is not null and extensions.vector_dims(embedding) <> 2048;

alter table public.assistant_corpus
  alter column embedding type extensions.vector(2048);

drop function if exists public.match_assistant_corpus(extensions.vector, int, double precision);

create or replace function public.match_assistant_corpus(
  query_embedding extensions.vector(2048),
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
