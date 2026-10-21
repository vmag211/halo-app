#!/usr/bin/env node
/**
 * Ingest the assistant corpus (§18) — BUILT, NOT TESTED (needs an embedding key).
 *
 * Turns the app's already-vetted Learn content (lib/learnContent.js — each topic
 * carries real agency sources) into embedded passages in public.assistant_corpus,
 * so the assistant answers from the SAME sources the Learn tab cites. No new,
 * unvetted agency claims are invented here; expand the corpus later by adding
 * source-attributed passages, not by loosening this.
 *
 * Prereqs: migrations 0007 + 0008 applied; an embedding key in the environment
 * (ASSISTANT_MODEL_KEY or OPENAI_API_KEY) and ASSISTANT_EMBED_MODEL set to the SAME
 * model the app embeds questions with (vectors from different models are not
 * comparable). There is no default model, as in lib/assistantRag.js (Ruling L1):
 * the old default was a paid OpenAI model at 1536 dimensions, which the 2048-wide
 * column from migration 0013 refuses. ASSISTANT_EMBED_DIM defaults to 2048.
 *
 * Usage:  node scripts/ingest-corpus.mjs [--replace]
 *   --replace   wipe existing corpus rows first. This script is the only writer,
 *               so a re-run WITHOUT --replace aborts rather than duplicating rows.
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { LEARN_TOPICS, LEARN_CONTENT } from '../lib/learnContent.js';
import { corpusPassages } from '../lib/corpusPassages.js';

// --- env (mirror the app's names) ---
try {
  const env = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      // Strip one pair of matching surrounding quotes (KEY="value").
      process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
  }
} catch {
  /* env may already be exported in the shell */
}

const KEY = process.env.ASSISTANT_MODEL_KEY || process.env.OPENAI_API_KEY;
const EMBED_URL = process.env.ASSISTANT_EMBED_URL || 'https://api.openai.com/v1/embeddings';
const EMBED_MODEL = (process.env.ASSISTANT_EMBED_MODEL || '').trim();
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!KEY) {
  console.error('No embedding key (ASSISTANT_MODEL_KEY / OPENAI_API_KEY). Aborting.');
  process.exit(1);
}
if (!EMBED_MODEL) {
  console.error('ASSISTANT_EMBED_MODEL is not set, and there is no default: set it to the model the app embeds questions with. Aborting.');
  process.exit(1);
}
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Supabase service credentials (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) missing. Aborting.');
  process.exit(1);
}

const replace = process.argv.includes('--replace');
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// Must match the assistant_corpus.embedding column (vector(2048) after migration 0013).
const EMBED_DIM = Number(process.env.ASSISTANT_EMBED_DIM || 2048);

async function embedAll(texts) {
  const res = await fetch(EMBED_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`Embedding request failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  const items = Array.isArray(data?.data) ? [...data.data] : [];
  // Align by the API's own index rather than trusting array order.
  items.sort((a, b) => a.index - b.index);
  if (items.length !== texts.length) {
    throw new Error(`Expected ${texts.length} embeddings, got ${items.length}`);
  }
  const vectors = items.map((d) => d.embedding);
  vectors.forEach((v, i) => {
    if (!Array.isArray(v) || v.length !== EMBED_DIM) {
      throw new Error(`Embedding ${i} has ${v?.length ?? 0} dimensions; the corpus expects ${EMBED_DIM}`);
    }
  });
  return vectors;
}

async function main() {
  const { passages, skipped } = corpusPassages(LEARN_TOPICS, LEARN_CONTENT);
  for (const topic of skipped) console.warn(`Skipping ${topic}: its source has no retrieval date.`);
  console.log(`Prepared ${passages.length} passages from ${LEARN_TOPICS.length} Learn topics.`);

  const { count, error: countErr } = await sb
    .from('assistant_corpus')
    .select('id', { count: 'exact', head: true });
  if (countErr) throw new Error(`Count failed (is migration 0007 applied?): ${countErr.message}`);

  if (count && !replace) {
    console.error(`assistant_corpus already has ${count} rows. Re-run with --replace to wipe and re-ingest.`);
    process.exit(1);
  }

  // Embed BEFORE touching existing rows: if the key is wrong or the API is down,
  // the current corpus stays intact instead of being wiped.
  const embeddings = await embedAll(passages.map((p) => p.passage));
  const rows = passages.map((p, i) => ({ ...p, embedding: embeddings[i] }));

  if (count && replace) {
    const { error } = await sb
      .from('assistant_corpus')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) throw new Error(error.message);
    console.log(`Cleared ${count} existing rows.`);
  }

  const { error } = await sb.from('assistant_corpus').insert(rows);
  if (error) throw new Error(error.message);
  console.log(`Ingested ${rows.length} passages into assistant_corpus. Assistant grounded answers are live.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
