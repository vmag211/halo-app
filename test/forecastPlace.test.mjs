/**
 * B10 Task 2: lib/forecast/place.js, `resolveForecastPlace` and `roundForProvider` (plan F1, F3).
 * Every Acceptance bullet of Task 2 is a test here. Pure: the gazetteer is the repo's own JSON, and
 * a fetch stub proves no call leaves the process.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const {
  resolveForecastPlace,
  roundForProvider,
  NC_TIMEZONE,
  MAX_AMBIGUOUS_LABELS,
  UNMATCHED_REASONS,
  STATES,
} = await import('../lib/forecast/place.js');
const { allPlaces, placePoint } = await import('../lib/places.js');

const resolve = resolveForecastPlace;
const CHARLOTTE = 'us-place:3712000';
const MECKLENBURG = 'us-county:37119';
const kindOf = (id) => id.slice(0, id.indexOf(':'));

test('empty and blank text is the household home', () => {
  for (const text of ['', '   ', '\t', ' \n ']) assert.deepEqual(resolve(text), { kind: 'home' }, JSON.stringify(text));
  // Not blank: punctuation alone is text that names nothing, never the home.
  for (const text of [',', ';', '.', ' , ']) assert.equal(resolve(text).kind, 'unmatched', JSON.stringify(text));
  // A value that is not a string never reads the home.
  for (const value of [null, undefined, 28202, {}, ['Charlotte']]) assert.equal(resolve(value).kind, 'unmatched', JSON.stringify(value));
});

test('the handoff test value resolves to ZIP 28202, with its Census point and zone', () => {
  // W: test/ui/production-outdoor-handoff.spec.ts:36
  assert.deepEqual(resolve('Environmental Learning Center, Charlotte, NC 28202'), {
    kind: 'matched',
    id: 'us-zcta:28202',
    label: 'ZIP 28202, NC',
    ...placePoint('us-zcta:28202'),
    timezone: 'America/New_York',
  });
});

test('Charlotte, with a state, and after a segment that names nothing', () => {
  for (const text of ['Charlotte', 'charlotte, nc', 'Charlotte, North Carolina', 'Freedom Park, Charlotte', '  CHARLOTTE  ',
    'Charlotte; NC', 'Charlotte NC', 'Charlotte N.C.', 'Charlotte, N.C.', 'Charlotte, USA', 'Charlotte, NC, USA']) {
    const found = resolve(text);
    assert.equal(found.kind, 'matched', text);
    assert.equal(found.id, CHARLOTTE, text);
    assert.equal(found.label, 'Charlotte, NC', text);
  }
});

test('no prefix and no fuzzy match: Char, Charl, Charlo are unmatched', () => {
  for (const text of ['Char', 'Charl', 'Charlo', 'Charlott', 'Charlottee', 'Mecklen', 'Wake Cou', 'Sai', 'Fair', 'Raleigh Durham']) {
    assert.deepEqual(resolve(text), { kind: 'unmatched', reason: UNMATCHED_REASONS.name }, text);
  }
  assert.equal(UNMATCHED_REASONS.name, 'not a North Carolina city, county or ZIP code');
});

test('Mecklenburg in each county spelling resolves to the county', () => {
  for (const text of ['Mecklenburg', 'Mecklenburg County', 'Mecklenburg Co.', 'mecklenburg co', 'Mecklenburg County, NC']) {
    const found = resolve(text);
    assert.equal(found.kind, 'matched', text);
    assert.equal(found.id, MECKLENBURG, text);
    assert.equal(found.label, 'Mecklenburg County, NC', text);
  }
});

test('specificity: Columbus is the town, Columbus County the county; a place outranks a county across segments', () => {
  assert.equal(resolve('Columbus').id, 'us-place:3713980');
  assert.equal(resolve('Columbus').label, 'Columbus, NC');
  assert.equal(resolve('Columbus County').id, 'us-county:37047');
  assert.equal(resolve('Columbus County').label, 'Columbus County, NC');
  // A place and its county named in two segments: the place, the more specific kind.
  assert.equal(resolve('Charlotte, Mecklenburg County').id, CHARLOTTE);
  // A ZCTA outranks both, wherever it appears.
  assert.equal(resolve('Mecklenburg County, Charlotte, 28202').id, 'us-zcta:28202');
});

test('ambiguous: two places of one name, two named places, two ZIP codes; a disambiguated name is matched', () => {
  assert.deepEqual(resolve('Fairview'), { kind: 'ambiguous', labels: ['Fairview (Buncombe County), NC', 'Fairview (Union County), NC'] });
  const union = resolve('Fairview (Union County)');
  assert.equal(union.kind, 'matched');
  assert.equal(union.id, 'us-place:3722500');
  assert.equal(union.label, 'Fairview (Union County), NC');
  assert.deepEqual(resolve('Durham, Chapel Hill'), { kind: 'ambiguous', labels: ['Durham, NC', 'Chapel Hill, NC'] });
  assert.deepEqual(resolve('28202 28203'), { kind: 'ambiguous', labels: ['ZIP 28202, NC', 'ZIP 28203, NC'] });
  // The same ZIP twice is one distinct ZCTA, and the same place twice one place.
  assert.equal(resolve('28202, 28202-1234').kind, 'matched');
  assert.equal(resolve('Charlotte, Charlotte').id, CHARLOTTE);
});

test('ambiguous answers list at most five labels', () => {
  assert.equal(MAX_AMBIGUOUS_LABELS, 5);
  const found = resolve('Durham, Chapel Hill, Raleigh, Cary, Apex, Garner, Wake Forest');
  assert.equal(found.kind, 'ambiguous');
  assert.deepEqual(found.labels, ['Durham, NC', 'Chapel Hill, NC', 'Raleigh, NC', 'Cary, NC', 'Apex, NC']);
  assert.equal(resolve('27601 27603 27604 27605 27606 27607 27608').labels.length, 5);
});

test('ZIP codes: a ZIP+4 is its five digits; a non-NC ZIP is unmatched with the NC-ZIP reason', () => {
  for (const text of ['28202-1234', ' 28202-1234 ', 'ZIP 28202-1234', 'zip code 28202']) {
    const found = resolve(text);
    assert.equal(found.kind, 'matched', text);
    assert.equal(found.id, 'us-zcta:28202', text);
  }
  for (const text of ['29201', '99999', '29201-1234', 'Atlantis 29201', '28201']) {
    assert.deepEqual(resolve(text), { kind: 'unmatched', reason: 'not a North Carolina ZIP code' }, text);
  }
  assert.equal(UNMATCHED_REASONS.zip, 'not a North Carolina ZIP code');
  // Not a standalone five-digit run: part of a longer number or of a word.
  for (const text of ['282021', '2820', 'NC28202', '28202a']) assert.deepEqual(resolve(text), { kind: 'unmatched', reason: UNMATCHED_REASONS.name }, text);
  // A non-NC ZIP is ignored once a name matches, as any segment that names nothing is.
  assert.equal(resolve('Charlotte, NC 29201').id, CHARLOTTE);
  assert.equal(resolve('Columbia 29201').label, 'Columbia, NC', 'Columbia is also an NC town');
});

test('another state makes the answer outside; the first segment is never read as a state', () => {
  for (const text of ['Greenville, SC', 'Austin, Texas', 'Greenville, S.C.', 'Greenville, South Carolina', 'Greenville, SC 29601',
    'Raleigh; VA', 'Charlotte, NC, SC', 'Portland, OR, USA', 'Denver, CO', 'Durham, New Hampshire']) {
    assert.deepEqual(resolve(text), { kind: 'outside' }, text);
  }
  // Greenville and Washington are NC places too, and a state's name alone is that name.
  assert.equal(resolve('Greenville').label, 'Greenville, NC');
  assert.equal(resolve('Washington').label, 'Washington, NC');
  assert.equal(resolve('Washington, NC').label, 'Washington, NC');
  assert.equal(resolve('Texas').kind, 'unmatched');
  // Without a comma a state word is part of the segment, which then names nothing exactly.
  assert.equal(resolve('Greenville SC').kind, 'unmatched');
});

test('"Co" after an exact NC county segment is the county word, never Colorado', () => {
  for (const text of ['Yadkin, Co', 'Yadkin, Co.', 'yadkin; CO', 'Yadkin, Co, NC', 'Yadkin County, Co']) {
    const found = resolve(text);
    assert.equal(found.kind, 'matched', text);
    assert.equal(found.id, 'us-county:37197', text);
    assert.equal(found.label, 'Yadkin County, NC', text);
  }
  // Folded into the county segment, so Columbus is the county here, not the town.
  assert.equal(resolve('Columbus, Co').id, 'us-county:37047');
  // No NC county before it: Colorado.
  assert.deepEqual(resolve('Denver, CO'), { kind: 'outside' });
  assert.deepEqual(resolve('Charlotte, CO'), { kind: 'outside' }, 'Charlotte is a place, not a county');
  assert.deepEqual(resolve('Freedom Park, CO'), { kind: 'outside' });
  // Only straight after the county segment.
  assert.deepEqual(resolve('Yadkin, Charlotte, CO'), { kind: 'outside' });
});

test('the state table is the 50 states, codes and names distinct', () => {
  assert.equal(STATES.length, 50);
  assert.equal(new Set(STATES.map(([code]) => code)).size, 50);
  assert.equal(new Set(STATES.map(([, name]) => name)).size, 50);
  assert.ok(STATES.every(([code]) => /^[A-Z]{2}$/.test(code)));
  assert.ok(STATES.some(([code, name]) => code === 'NC' && name === 'North Carolina'));
  assert.ok(!STATES.some(([code]) => code === 'DC'), 'DC is not a state');
  assert.ok(Object.isFrozen(STATES) && STATES.every(Object.isFrozen));
  // Every other state by code and by name, after a place, is outside.
  for (const [code, name] of STATES.filter(([code]) => code !== 'NC')) {
    assert.deepEqual(resolve(`Charlotte, ${code}`), { kind: 'outside' }, code);
    assert.deepEqual(resolve(`Charlotte, ${name}`), { kind: 'outside' }, name);
  }
});

test('Charlotte, NC 27601 is ZIP 27601: the ZIP wins, and the label says so', () => {
  const found = resolve('Charlotte, NC 27601');
  assert.equal(found.kind, 'matched');
  assert.equal(found.id, 'us-zcta:27601');
  assert.equal(found.label, 'ZIP 27601, NC');
  assert.deepEqual({ lat: found.lat, lng: found.lng }, placePoint('us-zcta:27601'));
  // One NC ZIP wins outright, even beside another state.
  assert.equal(resolve('Charlotte, SC 28202').id, 'us-zcta:28202');
});

test('a match carries the candidate id and label, the Census point and America/New_York, and never the typed text', () => {
  assert.equal(NC_TIMEZONE, 'America/New_York');
  const everything = allPlaces();
  // The gazetteer's own zone agrees (drift guard).
  assert.ok(everything.every((c) => c.timezone === NC_TIMEZONE));
  // Every county and place resolves by its own name to itself or, where names repeat, is ambiguous.
  let matched = 0;
  for (const candidate of everything) {
    const found = resolve(candidate.place);
    if (found.kind === 'ambiguous') {
      assert.ok(found.labels.includes(candidate.label) || kindOf(candidate.id) === 'us-county', candidate.id);
      continue;
    }
    assert.equal(found.kind, 'matched', candidate.id);
    if (found.id !== candidate.id) {
      // A county whose name is also a place's: the place is more specific.
      assert.equal(kindOf(candidate.id), 'us-county', candidate.id);
      assert.equal(kindOf(found.id), 'us-place', candidate.id);
      continue;
    }
    matched += 1;
    assert.deepEqual(Object.keys(found).sort(), ['id', 'kind', 'label', 'lat', 'lng', 'timezone']);
    assert.deepEqual(found, { kind: 'matched', id: candidate.id, label: candidate.label, ...placePoint(candidate.id), timezone: NC_TIMEZONE });
  }
  assert.ok(matched > 1600, `${matched} matched by their own names`);
  const found = resolve('Freedom Park, Charlotte');
  assert.ok(!JSON.stringify(found).includes('Freedom'), 'the typed text is not echoed');
});

test('no I/O: the module imports only the gazetteer module and makes no call', async () => {
  const source = readFileSync(new URL('../lib/forecast/place.js', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['../places.js']);
  for (const word of ['fetch', 'process.env', 'console.', 'Date.now', 'new Date', 'node:', 'require(', 'await ']) {
    assert.ok(!source.includes(word), word);
  }
  assert.ok(!source.includes('\u2014'), 'no U+2014');
  for (const value of Object.values(UNMATCHED_REASONS)) assert.ok(!value.includes('\u2014'));
  // And at run time: a fetch stub sees nothing.
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('no network');
  };
  try {
    for (const text of ['Charlotte', '28202', 'Fairview', 'Greenville, SC', 'Char', '']) resolve(text);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(calls, 0);
});

test('a 100-character string resolves in under 5 ms (median of many runs)', () => {
  const pad = (text) => (text + ' '.repeat(100)).slice(0, 100);
  const inputs = [
    pad('Environmental Learning Center, Charlotte, NC 28202'),
    'a,'.repeat(50),
    'a;b,'.repeat(25),
    'Charlotte '.repeat(10),
    `${'28202 '.repeat(16)}2820`,
    'Durham, Chapel Hill, Raleigh, Cary, Apex, Garner, Wake Forest, Holly Springs, Fuquay-Varina, Morrisv',
    'x'.repeat(100),
    pad('Saint Mt Ft Saint Mt Ft Saint Mt Ft Saint Mt Ft Saint Mt Ft Saint Mt Ft, NC, North Carolina, N.C.'),
  ];
  for (const text of inputs) assert.equal(text.length, 100, JSON.stringify(text));
  for (const text of inputs) for (let i = 0; i < 20; i += 1) resolve(text); // warm up
  for (const text of inputs) {
    const samples = [];
    for (let i = 0; i < 101; i += 1) {
      const start = performance.now();
      resolve(text);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const median = samples[50];
    assert.ok(median < 5, `${JSON.stringify(text.slice(0, 30))}: median ${median.toFixed(3)} ms`);
  }
});

test('roundForProvider: 2 decimals, never more precision than the input', () => {
  assert.deepEqual(roundForProvider({ lat: 35.227, lng: -80.843 }), { lat: 35.23, lng: -80.84 });
  // Halves round away from zero on the decimal digits, not on the binary product (35.205 * 100 is 3520.4999...).
  assert.deepEqual(roundForProvider({ lat: 35.205, lng: -80.835 }), { lat: 35.21, lng: -80.84 });
  assert.deepEqual(roundForProvider({ lat: 35.2, lng: -80 }), { lat: 35.2, lng: -80 });
  assert.deepEqual(roundForProvider({ lat: 35, lng: -80.8 }), { lat: 35, lng: -80.8 });
  assert.deepEqual(roundForProvider({ lat: -0.001, lng: 0.004 }), { lat: 0, lng: 0 });
  assert.ok(Object.is(roundForProvider({ lat: -0.001, lng: 0 }).lat, 0), 'never -0');
  assert.deepEqual(roundForProvider({ lat: 90, lng: -180 }), { lat: 90, lng: -180 });
  for (const point of [null, undefined, {}, { lat: 35 }, { lat: '35.2', lng: -80 }, { lat: NaN, lng: 0 }, { lat: 0, lng: Infinity },
    { lat: 90.01, lng: 0 }, { lat: 0, lng: -180.5 }]) {
    assert.equal(roundForProvider(point), null, JSON.stringify(point));
  }
  // Every gazetteer point and a spread of arbitrary values: at most 2 decimals, never more than the
  // input has, within half a hundredth, and the same text the cache key writes (toFixed(2)).
  const decimals = (value) => (String(value).split('.')[1] ?? '').length;
  const values = allPlaces().flatMap((c) => Object.values(placePoint(c.id)));
  for (let i = 0; i < 2000; i += 1) values.push(((i * 7919) % 18001) / 100 - 90 + (i % 7) / 1000, -(i * 0.0137) % 180);
  for (const value of values) {
    const { lat } = roundForProvider({ lat: Math.max(-90, Math.min(90, value)), lng: 0 });
    const input = Math.max(-90, Math.min(90, value));
    assert.ok(decimals(lat) <= Math.min(2, decimals(input)), `${input} -> ${lat}`);
    assert.ok(Math.abs(lat - input) <= 0.005 + 1e-9, `${input} -> ${lat}`);
    assert.equal(Number(lat.toFixed(2)), lat, `${input} -> ${lat}`);
  }
  // A matched place's point rounds to the 2-decimal point the providers are sent.
  const charlotte = resolve('Charlotte');
  assert.deepEqual(roundForProvider(charlotte), { lat: 35.21, lng: -80.83 });
});
