-- HALO — assistant knowledge base (§9.2, §18)
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Curated source documents from federal health/environmental agencies, a national
-- lung-health org, and state agencies, broken into passages. Each passage stores
-- its source label + URL + retrieval date and an embedding used to find relevant
-- passages. Public reference data.
--
-- Ingesting passages and computing embeddings needs an embedding-model key
-- (§38 "Assistant model key"); that is a separate script and is NOT built/tested
-- here. The embedding dimension below assumes a 1536-d model (e.g. OpenAI
-- text-embedding-3-small); change it to match whichever model is used.

create extension if not exists vector with schema extensions;

create table if not exists public.assistant_corpus (
  id           uuid primary key default gen_random_uuid(),
  source_label text not null,
  source_url   text not null,
  retrieved    date not null,
  passage      text not null,
  embedding    extensions.vector(1536),
  created_at   timestamptz not null default now()
);

-- Approximate-nearest-neighbour index for retrieval (cosine distance).
-- HNSW, not IVFFlat: IVFFlat built on an empty table has meaningless list
-- centres, and with the default probes=1 a small corpus (the starter ingest is
-- ~14 passages) would return no rows for most questions — silently turning
-- every answer into "no source". HNSW works at any size and needs no rebuild.
--
-- Re-run guard: 0013 later widens the column to 2,048 dimensions and drops this
-- index, because HNSW allows at most 2,000. The index is therefore only created
-- while the column's declared dimension is 2,000 or fewer, which is always true
-- on a first run (1,536). Running this file again after 0013 then skips it
-- instead of failing.
do $$
begin
  if (select a.atttypmod
        from pg_attribute a
       where a.attrelid = 'public.assistant_corpus'::regclass
         and a.attname = 'embedding'
         and not a.attisdropped) between 1 and 2000 then
    create index if not exists assistant_corpus_embedding
      on public.assistant_corpus
      using hnsw (embedding extensions.vector_cosine_ops);
  end if;
end $$;

alter table public.assistant_corpus enable row level security;

drop policy if exists "assistant_corpus_public_read" on public.assistant_corpus;
create policy "assistant_corpus_public_read" on public.assistant_corpus
  for select using (true);
-- No user writes: only the ingestion script (service role) populates it.
