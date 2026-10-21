/**
 * The passages scripts/ingest-corpus.mjs embeds into public.assistant_corpus.
 * Luna shows a retrieved passage word for word under "From the source", so the
 * stored text must already read cleanly: no em dashes (the app turns them into
 * commas, which made "RADON, Radon is..."), and list items joined as sentences
 * (joining "...mailed to a lab." with "; " and a closing "." stored "lab.;"
 * and "fix.."). The wording of each source is otherwise unchanged.
 */

const EM_DASH = /\s*\u2014\s*/g;

/** Learn text as stored: an em dash becomes a comma, as the app would show it. */
export function tidyText(text) {
  return String(text).replace(EM_DASH, ', ').replace(/\s+/g, ' ').trim();
}

/** A source label with its first em dash as a colon: "EPA: A Citizen's Guide to Radon (2016)". */
export function tidyLabel(label) {
  return String(label).replace(/\s*\u2014\s*/, ': ').replace(EM_DASH, ', ').trim();
}

/** One sentence: ends with terminal punctuation exactly once. */
export function asSentence(text) {
  const t = tidyText(text).replace(/[;,:\s]+$/, '');
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/** How a topic key reads inside "Ways to reduce ... exposure". */
const TOPIC_NAMES = Object.freeze({ pfas: 'PFAS', uv: 'UV', air: 'air pollution' });

// retrieved is stored 'YYYY-MM' in learnContent; the column is a date, so pin to day 01.
export function normalizeRetrieved(r) {
  if (!r) return null;
  return /^\d{4}-\d{2}$/.test(r) ? `${r}-01` : r;
}

/**
 * One "what it is" passage and one "how to reduce exposure" passage per topic,
 * each attributed to a real Learn source. A source with no retrieval date is
 * skipped and reported in `skipped`: the column is NOT NULL, and an undated
 * citation shouldn't be served anyway.
 */
export function buildLearnPassages(topics, content) {
  const rows = [];
  const skipped = [];
  for (const topic of topics) {
    const c = content[topic];
    const src = c?.sources?.[0];
    if (!src) continue;
    if (!normalizeRetrieved(src.retrieved)) {
      skipped.push(topic);
      continue;
    }
    rows.push({
      source_label: tidyLabel(src.label),
      source_url: src.url,
      retrieved: normalizeRetrieved(src.retrieved),
      passage: asSentence(c.what_it_is),
    });
    if (Array.isArray(c.protect) && c.protect.length) {
      const src2 = c.sources[1] && normalizeRetrieved(c.sources[1].retrieved) ? c.sources[1] : src;
      rows.push({
        source_label: tidyLabel(src2.label),
        source_url: src2.url,
        retrieved: normalizeRetrieved(src2.retrieved),
        passage: `Ways to reduce ${TOPIC_NAMES[topic] ?? topic} exposure: ${c.protect.map(asSentence).join(' ')}`,
      });
    }
  }
  return { rows, skipped };
}

// Reference passages that aren't Learn topics but that the assistant must be
// able to cite: PFOS is HALO's headline contaminant, and without these the
// corpus never named it. Each is written only from the cited page's own text
// (fetched 2026-09-28).
export const REFERENCE_PASSAGES = [
  {
    source_label: 'EPA: PFAS drinking water regulation',
    source_url: 'https://www.epa.gov/sdwa/and-polyfluoroalkyl-substances-pfas',
    retrieved: '2026-09-28',
    passage:
      "PFOA, PFOS and other regulated PFAS: EPA's 2024 National Primary Drinking Water Regulation set legally enforceable limits (Maximum Contaminant Levels) for six PFAS in drinking water. PFOA and PFOS: 4.0 parts per trillion (ppt) each. PFHxS, PFNA and HFPO-DA (known as GenX chemicals): 10 ppt each. Mixtures of two or more of PFHxS, PFNA, HFPO-DA and PFBS are limited by a Hazard Index.",
  },
  {
    source_label: 'EPA: PFAS drinking water regulation',
    source_url: 'https://www.epa.gov/sdwa/and-polyfluoroalkyl-substances-pfas',
    retrieved: '2026-09-28',
    passage:
      'PFAS drinking water deadlines and proposed changes: Public water systems must finish initial PFAS monitoring by 2027 and have until 2029 to reduce PFAS if levels exceed the limits. EPA has proposed keeping the PFOA and PFOS limits, with an option for systems to request two more years (to 2031), and has proposed rescinding the limits for PFHxS, PFNA, HFPO-DA (GenX) and the Hazard Index mixture.',
  },
  {
    source_label: 'AirNow: Air Quality Index basics',
    source_url: 'https://www.airnow.gov/aqi/aqi-basics/',
    retrieved: '2026-09-28',
    passage:
      'Air quality index categories: 0 to 50, Good: air quality is satisfactory, and air pollution poses little or no risk. 51 to 100, Moderate: air quality is acceptable, but there may be a risk for some people, particularly those who are unusually sensitive to air pollution. 101 to 150, Unhealthy for Sensitive Groups: members of sensitive groups may experience health effects; the general public is less likely to be affected. 151 to 200, Unhealthy: some members of the general public may experience health effects, and members of sensitive groups may experience more serious health effects. 201 to 300, Very Unhealthy: health alert, the risk of health effects is increased for everyone. 301 and higher, Hazardous: health warning of emergency conditions; everyone is more likely to be affected.',
  },
  {
    source_label: 'EPA: Map of Radon Zones',
    source_url: 'https://www.epa.gov/radon/epa-map-radon-zones-0',
    retrieved: '2026-09-28',
    passage:
      'Radon zones: EPA sorts counties into three radon zones. Zone 1: highest potential; average indoor radon levels may be greater than 4 pCi/L. Zone 2: moderate potential; average indoor levels may be between 2 and 4 pCi/L. Zone 3: low potential; average indoor levels may be less than 2 pCi/L. Homes with elevated radon have been found in all three zones, all homes should be tested, and the map should not be used to decide whether a particular home needs testing.',
  },
  {
    source_label: 'EPA: UV Index Scale',
    source_url: 'https://www.epa.gov/sunsafety/uv-index-scale-0',
    retrieved: '2026-09-28',
    passage:
      'UV index scale and sun protection: UV index 1 to 2 (Low): no protection needed; you can safely stay outside using minimal sun protection. 3 to 7 (Moderate to High): protection needed; seek shade during late morning through mid-afternoon, and when outside generously apply broad-spectrum SPF 15 or higher sunscreen on exposed skin and wear protective clothing, a wide-brimmed hat, and sunglasses. 8 and above (Very High to Extreme): extra protection needed; be careful outside, especially late morning through mid-afternoon, if your shadow is shorter than you, seek shade, cover up, and apply at least SPF 15 broad-spectrum sunscreen.',
  },
];

/** Every passage to embed, Learn topics first. */
export function corpusPassages(topics, content) {
  const { rows, skipped } = buildLearnPassages(topics, content);
  return { passages: [...rows, ...REFERENCE_PASSAGES], skipped };
}
