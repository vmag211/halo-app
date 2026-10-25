/**
 * Learn library search. People type abbreviations ("AQI", "PM2.5", "UV") that the topic prose spells
 * out, so each topic and glossary term carries the standard abbreviations and plain synonyms its
 * published content actually covers. Matching ignores case, accents, spacing and punctuation, so
 * "pm 2.5", "PM2.5" and "pm25" are the same query. Aliases only widen matching; they add no claims.
 */

/** Abbreviations and synonyms per Learn topic. Each one names something that topic's content explains. */
export const LEARN_TOPIC_ALIASES: Record<string, readonly string[]> = {
  air: ['AQI', 'air quality index', 'AirNow', 'ozone', 'O3', 'particle pollution', 'particulate matter', 'PM2.5', 'PM10', 'smog'],
  uv: ['UV', 'UVI', 'UV index', 'ultraviolet index', 'sun', 'sunburn', 'sunscreen', 'SPF'],
  pollen: ['allergy', 'allergies', 'hay fever', 'tree pollen', 'grass pollen', 'weed pollen'],
  mold: ['mould', 'mildew', 'damp', 'dampness', 'humidity', 'moisture'],
  pfas: ['PFOA', 'PFOS', 'forever chemicals', 'per- and polyfluoroalkyl substances', 'polyfluoroalkyl', 'perfluoroalkyl'],
  radon: ['radon gas', 'pCi/L', 'picocuries', 'soil gas', 'radioactive gas'],
  lead: ['Pb', 'lead pipes', 'lead service line', 'solder', 'plumbing'],
};

/** Abbreviations and synonyms per glossary term id. */
export const LEARN_TERM_ALIASES: Record<string, readonly string[]> = {
  'non-detect': ['ND', 'not detected', 'below detection', 'detection limit', 'reporting limit', 'MRL'],
  coverage: ['missing data', 'data gaps', 'no data'],
  modeled: ['model', 'modelled', 'estimate', 'estimated', 'measurement'],
  'source-date': ['observation date', 'published date', 'retrieved date', 'data age'],
  score: ['HALO score', 'rating', 'units'],
  forecast: ['outlook', 'prediction'],
};

/**
 * Lowercase, strip accents, delete in-word joiners (so "PM2.5" is "pm25", "non-detect" is "nondetect"
 * and "pCi/L" is "pcil") and split on everything else. Returns the words in order.
 */
export function searchWords(text: string) {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[.'’\-/]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
}

/** True when some run of consecutive words, joined without spaces, starts with `needle`. Matches begin at a word start only. */
function startsAtWord(words: readonly string[], needle: string) {
  for (let i = 0; i < words.length; i++) {
    let run = '';
    for (let j = i; j < words.length && run.length < needle.length; j++) run += words[j];
    if (run.startsWith(needle)) return true;
  }
  return false;
}

/**
 * True when `query` matches any of `fields`. An empty query matches everything. The whole query is tried
 * as one run with its spaces removed ("pm 2.5" finds "PM2.5", "airquality" finds "air quality"), then each
 * query word of three or more letters must start a word somewhere, so "index air" still finds "air quality index". Matching at word
 * starts keeps a short query such as "EPA" from matching across "keep a".
 */
export function learnSearchMatches(query: string, fields: readonly string[]) {
  const queryWords = searchWords(query);
  if (!queryWords.length) return true;
  const words = fields.flatMap(searchWords);
  if (startsAtWord(words, queryWords.join(''))) return true;
  // Word-by-word matching is for real words only: "pm 10" must not find "4:00 PM" next to an unrelated 10.
  return queryWords.length > 1 && queryWords.every(word => word.length >= 3 && startsAtWord(words, word));
}

type TopicContent = { title: string; what_it_is: string; protect?: readonly string[]; sources?: readonly { label: string }[] };

/** Every searchable field for one Learn topic: its key, title, explanation, protection steps, source names and aliases. */
export function learnTopicFields(key: string, content: TopicContent) {
  return [key, content.title, content.what_it_is, ...(content.protect ?? []), ...(content.sources ?? []).map(source => source.label), ...(LEARN_TOPIC_ALIASES[key] ?? [])];
}

/** Every searchable field for one glossary term: its title, text and aliases. */
export function learnTermFields(term: { id: string; title: string; text: string }) {
  return [term.title, term.text, ...(LEARN_TERM_ALIASES[term.id] ?? [])];
}
