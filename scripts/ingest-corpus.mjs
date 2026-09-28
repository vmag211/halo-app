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
 * (ASSISTANT_MODEL_KEY or OPENAI_API_KEY). Defaults to OpenAI text-embedding-3-small
 * (1536-d, matching the schema); override with ASSISTANT_EMBED_URL / _MODEL.
 *
 * Usage:  node scripts/ingest-corpus.mjs [--replace]
 *   --replace   wipe existing corpus rows first. This script is the only writer,
 *               so a re-run WITHOUT --replace aborts rather than duplicating rows.
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { LEARN_TOPICS, LEARN_CONTENT } from '../lib/learnContent.js';

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
const EMBED_MODEL = process.env.ASSISTANT_EMBED_MODEL || 'text-embedding-3-small';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!KEY) {
  console.error('No embedding key (ASSISTANT_MODEL_KEY / OPENAI_API_KEY). Aborting.');
  process.exit(1);
}
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Supabase service credentials (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) missing. Aborting.');
  process.exit(1);
}

const replace = process.argv.includes('--replace');
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// retrieved is stored 'YYYY-MM' in learnContent; the column is a date → pin to day 01.
function normalizeRetrieved(r) {
  if (!r) return null;
  return /^\d{4}-\d{2}$/.test(r) ? `${r}-01` : r;
}

// Must match the assistant_corpus.embedding column (vector(2048) after migration 0013).
const EMBED_DIM = Number(process.env.ASSISTANT_EMBED_DIM || 1536);

// One "what it is" passage + one "how to reduce exposure" passage per topic,
// each attributed to a real Learn source. A source with no retrieval date is
// skipped with a warning — the column is NOT NULL, and an undated citation
// shouldn't be served anyway.
function buildPassages() {
  const rows = [];
  for (const topic of LEARN_TOPICS) {
    const c = LEARN_CONTENT[topic];
    const src = c.sources?.[0];
    if (!src) continue;
    if (!normalizeRetrieved(src.retrieved)) {
      console.warn(`Skipping ${topic}: its source has no retrieval date.`);
      continue;
    }
    rows.push({
      source_label: src.label,
      source_url: src.url,
      retrieved: normalizeRetrieved(src.retrieved),
      passage: `${topic.toUpperCase()} — ${c.what_it_is}`,
    });
    if (Array.isArray(c.protect) && c.protect.length) {
      const src2 = c.sources[1] && normalizeRetrieved(c.sources[1].retrieved) ? c.sources[1] : src;
      rows.push({
        source_label: src2.label,
        source_url: src2.url,
        retrieved: normalizeRetrieved(src2.retrieved),
        passage: `Ways to reduce ${topic} exposure: ${c.protect.join('; ')}.`,
      });
    }
  }
  return rows;
}

// Reference passages that aren't Learn topics but that the assistant must be
// able to cite — PFOS is HALO's headline contaminant, and without these the
// corpus never named it. Each is written only from the cited page's own text
// (EPA's PFAS drinking water regulation page, fetched 2026-09-28).
const REFERENCE_PASSAGES = [
  {
    source_label: 'EPA — PFAS drinking water regulation',
    source_url: 'https://www.epa.gov/sdwa/and-polyfluoroalkyl-substances-pfas',
    retrieved: '2026-09-28',
    passage:
      "PFOA, PFOS and other regulated PFAS — EPA's 2024 National Primary Drinking Water Regulation set legally enforceable limits (Maximum Contaminant Levels) for six PFAS in drinking water. PFOA and PFOS: 4.0 parts per trillion (ppt) each. PFHxS, PFNA and HFPO-DA (known as GenX chemicals): 10 ppt each. Mixtures of two or more of PFHxS, PFNA, HFPO-DA and PFBS are limited by a Hazard Index.",
  },
  {
    source_label: 'EPA — PFAS drinking water regulation',
    source_url: 'https://www.epa.gov/sdwa/and-polyfluoroalkyl-substances-pfas',
    retrieved: '2026-09-28',
    passage:
      'PFAS drinking water deadlines and proposed changes — Public water systems must finish initial PFAS monitoring by 2027 and have until 2029 to reduce PFAS if levels exceed the limits. EPA has proposed keeping the PFOA and PFOS limits, with an option for systems to request two more years (to 2031), and has proposed rescinding the limits for PFHxS, PFNA, HFPO-DA (GenX) and the Hazard Index mixture.',
  },
  {
    source_label: 'AirNow — Air Quality Index basics',
    source_url: 'https://www.airnow.gov/aqi/aqi-basics/',
    retrieved: '2026-09-28',
    passage:
      'Air quality index categories — 0 to 50, Good: air quality is satisfactory, and air pollution poses little or no risk. 51 to 100, Moderate: air quality is acceptable, but there may be a risk for some people, particularly those who are unusually sensitive to air pollution. 101 to 150, Unhealthy for Sensitive Groups: members of sensitive groups may experience health effects; the general public is less likely to be affected. 151 to 200, Unhealthy: some members of the general public may experience health effects, and members of sensitive groups may experience more serious health effects. 201 to 300, Very Unhealthy: health alert, the risk of health effects is increased for everyone. 301 and higher, Hazardous: health warning of emergency conditions; everyone is more likely to be affected.',
  },
  {
    source_label: 'EPA — Map of Radon Zones',
    source_url: 'https://www.epa.gov/radon/epa-map-radon-zones-0',
    retrieved: '2026-09-28',
    passage:
      'Radon zones — EPA sorts counties into three radon zones. Zone 1: highest potential; average indoor radon levels may be greater than 4 pCi/L. Zone 2: moderate potential; average indoor levels may be between 2 and 4 pCi/L. Zone 3: low potential; average indoor levels may be less than 2 pCi/L. Homes with elevated radon have been found in all three zones, all homes should be tested, and the map should not be used to decide whether a particular home needs testing.',
  },
  {
    source_label: 'EPA — UV Index Scale',
    source_url: 'https://www.epa.gov/sunsafety/uv-index-scale-0',
    retrieved: '2026-09-28',
    passage:
      'UV index scale and sun protection — UV index 1 to 2 (Low): no protection needed; you can safely stay outside using minimal sun protection. 3 to 7 (Moderate to High): protection needed; seek shade during late morning through mid-afternoon, and when outside generously apply broad-spectrum SPF 15 or higher sunscreen on exposed skin and wear protective clothing, a wide-brimmed hat, and sunglasses. 8 and above (Very High to Extreme): extra protection needed; be careful outside, especially late morning through mid-afternoon — if your shadow is shorter than you, seek shade, cover up, and apply at least SPF 15 broad-spectrum sunscreen.',
  },
];

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
  const passages = [...buildPassages(), ...REFERENCE_PASSAGES];
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
