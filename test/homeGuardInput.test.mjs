import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/routeLoader.mjs'; // registers the module hooks, so lib files load as ESM without the typeless-package warning

const { parseHomeGuardOverrides } = await import('../lib/homeGuardInput.js');

const parse = (query, options) => parseHomeGuardOverrides(new URLSearchParams(query), options);
const NOW = new Date('2026-10-03T12:00:00Z');

test('no overrides: ok with nothing set, so every default still comes from the profile', () => {
  assert.deepEqual(parse(''), { ok: true, value: {} });
  assert.deepEqual(parse('unrelated=1&profile_id=x'), { ok: true, value: {} });
});

test('valid overrides are trimmed and normalised; only the ones given are present', () => {
  const result = parse('county=%20Union%20County%20&pwsid=NC0160010&state=nc&water_source=City%20utility&home_year=1975', { now: NOW });
  assert.deepEqual(result, {
    ok: true,
    value: { county: 'Union County', pwsid: 'NC0160010', state: 'NC', waterSource: 'utility', homeYear: 1975 },
  });
  assert.deepEqual(parse('home_year=1975', { now: NOW }).value, { homeYear: 1975 });
});

test('a supplied but empty override is present, so it replaces the stored value instead of falling back to it', () => {
  const result = parse('county=&pwsid=&water_source=&home_year=', { now: NOW });
  assert.deepEqual(result, { ok: true, value: { county: '', pwsid: '', waterSource: null, homeYear: null } });
});

test('the literal words null and undefined stay acceptable for pwsid (older clients send them)', () => {
  assert.equal(parse('pwsid=null').value.pwsid, 'null');
  assert.equal(parse('pwsid=undefined').value.pwsid, 'undefined');
});

test('length caps: county 100, pwsid 20, water_source 40, home_year 10', () => {
  assert.equal(parse(`county=${'a'.repeat(100)}`).ok, true);
  assert.deepEqual(parse(`county=${'a'.repeat(101)}`).fieldErrors.map((e) => [e.field, e.code]), [['county', 'text_too_long']]);
  assert.deepEqual(parse(`pwsid=${'N'.repeat(21)}`).fieldErrors.map((e) => [e.field, e.code]), [['pwsid', 'text_too_long']]);
  assert.equal(parse(`water_source=${'spring'.padEnd(40, 's')}`).ok, true); // recognised, so no normaliser warning
  assert.deepEqual(parse(`water_source=${'w'.repeat(41)}`).fieldErrors.map((e) => [e.field, e.code]), [['water_source', 'text_too_long']]);
  assert.deepEqual(parse(`home_year=${'1'.repeat(11)}`).fieldErrors.map((e) => [e.field, e.code]), [['home_year', 'text_too_long']]);
});

test('free text overrides refuse control characters (NUL, line breaks, escape, DEL, separators)', () => {
  const reject = (query) => parse(query).fieldErrors?.map((e) => [e.field, e.code]);
  assert.deepEqual(reject('county=Union%00County'), [['county', 'invalid_characters']]);
  assert.deepEqual(reject('county=Union%0D%0ACounty'), [['county', 'invalid_characters']]);
  assert.deepEqual(reject('county=Union%1BCounty'), [['county', 'invalid_characters']]);
  assert.deepEqual(reject('county=Union%7FCounty'), [['county', 'invalid_characters']]);
  assert.deepEqual(reject('county=Union%E2%80%A8County'), [['county', 'invalid_characters']]); // U+2028
  assert.deepEqual(reject('water_source=we%00ll'), [['water_source', 'invalid_characters']]);
  assert.deepEqual(reject('home_year=19%0088'), [['home_year', 'invalid_characters']]);
  assert.deepEqual(reject('pwsid=NC01%0060010'), [['pwsid', 'invalid_characters']]);
  assert.equal(parse('county=Union%20County').ok, true, 'ordinary text and spaces are untouched');
  assert.equal(parse('county=Caf%C3%A9%20County').ok, true, 'accented letters are not control characters');
});

test('pwsid must look like a public water system id: two capital letters and five to nine digits', () => {
  for (const good of ['NC0160010', 'SC4010001', 'AK12345', 'NC123456789']) assert.equal(parse(`pwsid=${good}`).ok, true, good);
  for (const bad of ['nc0160010', 'NC12', 'N0160010', 'NC016001X', "NC1' OR '1'='1", 'NC0160010%20X', 'NC-0160010', '0160010']) {
    const result = parse(`pwsid=${bad}`);
    assert.deepEqual(result.fieldErrors?.map((e) => [e.field, e.code]), [['pwsid', 'invalid_pwsid']], bad);
  }
});

test('state is two letters, any case, and is returned in capitals', () => {
  assert.equal(parse('state=nc').value.state, 'NC');
  for (const bad of ['', 'N', 'NCC', 'North%20Carolina', '12', 'N%20']) {
    assert.deepEqual(parse(`state=${bad}`).fieldErrors?.map((e) => [e.field, e.code]), [['state', 'invalid_state']], bad);
  }
});

test('water_source goes through the existing normaliser; unrecognised text still becomes other, as that function documents', (t) => {
  t.mock.method(console, 'warn', () => {}); // normalizeWaterSource warns on unrecognised input
  assert.equal(parse('water_source=Well').value.waterSource, 'well');
  assert.equal(parse('water_source=private%20spring').value.waterSource, 'spring');
  assert.equal(parse('water_source=Municipal').value.waterSource, 'utility');
  assert.equal(parse('water_source=banana').value.waterSource, 'other');
});

test('home_year uses validateHomeYear: a whole year from 1700 to this year, or blank', () => {
  for (const good of ['1700', '1988', '2026']) assert.equal(parse(`home_year=${good}`, { now: NOW }).value.homeYear, Number(good));
  for (const bad of ['abc', '1988abc', '1699', '2027', '1988.5', '-1988']) {
    const result = parse(`home_year=${bad}`, { now: NOW });
    assert.deepEqual(result.fieldErrors?.map((e) => [e.field, e.code]), [['home_year', 'invalid_home_year']], bad);
    assert.match(result.fieldErrors[0].message, /whole year between 1700 and 2026/);
  }
});

test('every problem is reported at once, in a stable order', () => {
  const result = parse('home_year=abc&state=Narnia&pwsid=zz&county=' + 'c'.repeat(101));
  assert.equal(result.ok, false);
  assert.deepEqual(result.fieldErrors.map((e) => e.field), ['county', 'pwsid', 'state', 'home_year']);
  assert.ok(result.fieldErrors.every((e) => e.message.length > 0 && !e.message.includes('\u2014')));
});
