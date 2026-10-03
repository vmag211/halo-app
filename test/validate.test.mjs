import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseIsoDate,
  parseDateRange,
  parseCoordinates,
  parseBoundedInt,
  parseEnum,
  parseUuid,
  parseText,
  readJsonBody,
} from '../lib/validate.js';

const TODAY = '2026-09-29';

/** Minimal request double: lets a test control the header and the body independently. */
function fakeRequest(body, headers = {}) {
  const state = { reads: 0 };
  return {
    state,
    headers: new Headers(headers),
    async text() {
      state.reads += 1;
      return body;
    },
  };
}

function failureOf(result) {
  assert.equal(result.ok, false, `expected a failure, got ${JSON.stringify(result)}`);
  return result;
}

function fieldErrorsOf(result) {
  return failureOf(result).fieldErrors;
}

// --------------------------------------------------------------- parseIsoDate

test('parseIsoDate accepts a real calendar date', () => {
  assert.deepEqual(parseIsoDate('2026-09-29'), { ok: true, value: '2026-09-29' });
});

test('parseIsoDate accepts only strings in YYYY-MM-DD form', () => {
  for (const bad of [
    20260929,
    null,
    undefined,
    true,
    {},
    [],
    new Date('2026-09-29T00:00:00Z'),
    '',
    '2026-9-29',
    '2026-09-9',
    '26-09-29',
    '20260929',
    '2026/09/29',
    '2026-09-29T00:00:00Z',
    ' 2026-09-29',
    '2026-09-29 ',
    '2026-09-29\n',
  ]) {
    const result = failureOf(parseIsoDate(bad));
    assert.equal(result.code, 'invalid_date', `input ${JSON.stringify(bad)}`);
    assert.equal(typeof result.message, 'string');
  }
});

test('parseIsoDate rejects dates that are not on the calendar', () => {
  for (const bad of ['2026-02-31', '2026-13-01', '2026-00-10', '2026-01-00', '2025-02-29', '2026-04-31', '2026-06-31', '2100-02-29']) {
    assert.equal(failureOf(parseIsoDate(bad)).code, 'invalid_date', bad);
  }
});

test('parseIsoDate accepts calendar edges including leap days', () => {
  for (const good of ['2024-02-29', '2000-02-29', '2026-02-28', '2026-01-31', '2026-04-30', '2026-12-31']) {
    assert.deepEqual(parseIsoDate(good), { ok: true, value: good });
  }
});

test('parseIsoDate defaults min to 2000-01-01', () => {
  assert.deepEqual(parseIsoDate('2000-01-01'), { ok: true, value: '2000-01-01' });
  const result = failureOf(parseIsoDate('1999-12-31'));
  assert.equal(result.code, 'date_out_of_range');
});

test('parseIsoDate enforces custom min and max inclusively', () => {
  const opts = { min: '2026-01-01', max: '2026-12-31' };
  assert.equal(parseIsoDate('2026-01-01', opts).ok, true);
  assert.equal(parseIsoDate('2026-12-31', opts).ok, true);
  assert.equal(failureOf(parseIsoDate('2025-12-31', opts)).code, 'date_out_of_range');
  assert.equal(failureOf(parseIsoDate('2027-01-01', opts)).code, 'date_out_of_range');
});

test('parseIsoDate treats max: null as no upper bound', () => {
  assert.equal(parseIsoDate('2099-12-31', { max: null }).ok, true);
});

test('parseIsoDate reports a bad calendar date before a range problem', () => {
  assert.equal(failureOf(parseIsoDate('1999-02-31')).code, 'invalid_date');
});

// ------------------------------------------------------------- parseDateRange

test('parseDateRange defaults to the 90 days ending today', () => {
  assert.deepEqual(parseDateRange({}, { today: TODAY }), { ok: true, value: { from: '2026-07-02', to: TODAY } });
  assert.deepEqual(parseDateRange({ from: null, to: undefined }, { today: TODAY }), {
    ok: true,
    value: { from: '2026-07-02', to: TODAY },
  });
});

test('parseDateRange derives a missing from from the given to', () => {
  assert.deepEqual(parseDateRange({ to: '2026-03-31' }, { today: TODAY }), {
    ok: true,
    value: { from: '2026-01-01', to: '2026-03-31' },
  });
});

test('parseDateRange derives a missing to as today', () => {
  assert.deepEqual(parseDateRange({ from: '2026-09-01' }, { today: TODAY }), {
    ok: true,
    value: { from: '2026-09-01', to: TODAY },
  });
});

test('parseDateRange honours a custom defaultDays', () => {
  assert.deepEqual(parseDateRange({}, { today: TODAY, defaultDays: 7 }), {
    ok: true,
    value: { from: '2026-09-23', to: TODAY },
  });
});

test('parseDateRange keeps a derived from at or above min', () => {
  const result = parseDateRange({ to: '2000-01-10' }, { today: TODAY });
  assert.deepEqual(result, { ok: true, value: { from: '2000-01-01', to: '2000-01-10' } });
});

test('parseDateRange accepts a one-day range', () => {
  assert.deepEqual(parseDateRange({ from: '2026-09-01', to: '2026-09-01' }, { today: TODAY }), {
    ok: true,
    value: { from: '2026-09-01', to: '2026-09-01' },
  });
});

test('parseDateRange allows to at today plus maxFutureDays but not beyond', () => {
  assert.equal(parseDateRange({ to: '2026-09-30' }, { today: TODAY }).ok, true);
  const errors = fieldErrorsOf(parseDateRange({ to: '2026-10-01' }, { today: TODAY }));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, 'to');
  assert.equal(errors[0].code, 'date_out_of_range');
  assert.equal(parseDateRange({ to: '2026-10-01' }, { today: TODAY, maxFutureDays: 2 }).ok, true);
  assert.equal(parseDateRange({ to: '2026-09-30' }, { today: TODAY, maxFutureDays: 0 }).ok, false);
});

test('parseDateRange rejects an inverted range', () => {
  const errors = fieldErrorsOf(parseDateRange({ from: '2026-09-10', to: '2026-09-09' }, { today: TODAY }));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'range_inverted');
  assert.equal(errors[0].field, 'from');
});

test('parseDateRange allows exactly maxDays inclusive and rejects one more', () => {
  // 2025-09-29 .. 2026-09-29 is 366 days inclusive.
  assert.equal(parseDateRange({ from: '2025-09-29', to: '2026-09-29' }, { today: TODAY }).ok, true);
  const errors = fieldErrorsOf(parseDateRange({ from: '2025-09-28', to: '2026-09-29' }, { today: TODAY }));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'range_too_large');
  assert.equal(errors[0].field, 'from');
  assert.equal(parseDateRange({ from: '2026-09-01', to: '2026-09-10' }, { today: TODAY, maxDays: 10 }).ok, true);
  assert.equal(parseDateRange({ from: '2026-09-01', to: '2026-09-11' }, { today: TODAY, maxDays: 10 }).ok, false);
});

test('parseDateRange applies a missing-from default inside maxDays', () => {
  const result = fieldErrorsOf(parseDateRange({}, { today: TODAY, defaultDays: 30, maxDays: 10 }));
  assert.equal(result[0].code, 'range_too_large');
});

test('parseDateRange reports invalid dates per field', () => {
  const onlyFrom = fieldErrorsOf(parseDateRange({ from: '2026-02-31', to: '2026-03-01' }, { today: TODAY }));
  assert.deepEqual(onlyFrom.map((e) => [e.field, e.code]), [['from', 'invalid_date']]);

  const onlyTo = fieldErrorsOf(parseDateRange({ from: '2026-03-01', to: 'tomorrow' }, { today: TODAY }));
  assert.deepEqual(onlyTo.map((e) => [e.field, e.code]), [['to', 'invalid_date']]);

  const both = fieldErrorsOf(parseDateRange({ from: '2026-13-01', to: '2025-02-29' }, { today: TODAY }));
  assert.deepEqual(both.map((e) => [e.field, e.code]), [['from', 'invalid_date'], ['to', 'invalid_date']]);
});

test('parseDateRange treats non-string and empty-string values as invalid dates', () => {
  for (const bad of [20260101, '', {}, true]) {
    const errors = fieldErrorsOf(parseDateRange({ from: bad }, { today: TODAY }));
    assert.deepEqual(errors.map((e) => [e.field, e.code]), [['from', 'invalid_date']], JSON.stringify(bad));
  }
});

test('parseDateRange enforces min on explicit dates', () => {
  const errors = fieldErrorsOf(parseDateRange({ from: '1999-12-31', to: '2000-01-05' }, { today: TODAY }));
  assert.deepEqual(errors.map((e) => [e.field, e.code]), [['from', 'date_out_of_range']]);
  assert.equal(parseDateRange({ from: '2026-01-01', to: '2026-01-05' }, { today: TODAY, min: '2026-01-01' }).ok, true);
  assert.equal(parseDateRange({ from: '2025-12-31', to: '2026-01-05' }, { today: TODAY, min: '2026-01-01' }).ok, false);
});

test('parseDateRange does not report range errors while a date is invalid', () => {
  const errors = fieldErrorsOf(parseDateRange({ from: '2026-09-10', to: '2026-09-31' }, { today: TODAY }));
  assert.deepEqual(errors.map((e) => e.code), ['invalid_date']);
});

test('parseDateRange field errors carry field, code and message only', () => {
  const [error] = fieldErrorsOf(parseDateRange({ from: 'x' }, { today: TODAY }));
  assert.deepEqual(Object.keys(error).sort(), ['code', 'field', 'message']);
  assert.equal(typeof error.message, 'string');
  assert.ok(error.message.length > 0);
});

// ---------------------------------------------------------- parseCoordinates

test('parseCoordinates accepts finite numbers', () => {
  assert.deepEqual(parseCoordinates({ lat: 35.7796, lng: -78.6382 }), { ok: true, value: { lat: 35.7796, lng: -78.6382 } });
});

test('parseCoordinates accepts numeric strings and returns numbers', () => {
  assert.deepEqual(parseCoordinates({ lat: '35.7796', lng: ' -78.6382 ' }), { ok: true, value: { lat: 35.7796, lng: -78.6382 } });
  assert.deepEqual(parseCoordinates({ lat: '0', lng: '0' }), { ok: true, value: { lat: 0, lng: 0 } });
  assert.deepEqual(parseCoordinates({ lat: '+35', lng: '.5' }), { ok: true, value: { lat: 35, lng: 0.5 } });
});

test('parseCoordinates rejects the empty-string trap instead of reading it as 0', () => {
  for (const blank of ['', ' ', '   ', '\t', '\n']) {
    const errors = fieldErrorsOf(parseCoordinates({ lat: blank, lng: '10' }));
    assert.deepEqual(errors.map((e) => [e.field, e.code]), [['lat', 'invalid_coordinate']], JSON.stringify(blank));
  }
});

test('parseCoordinates rejects values that are not plain finite numbers', () => {
  for (const bad of [null, undefined, [], [35], {}, true, false, NaN, Infinity, -Infinity, 'abc', '1e1', '0x10', 'Infinity', 'NaN', '35,5', '--5', '1.2.3', () => 1, 10n]) {
    const errors = fieldErrorsOf(parseCoordinates({ lat: bad, lng: 10 }));
    assert.deepEqual(errors.map((e) => [e.field, e.code]), [['lat', 'invalid_coordinate']], String(bad));
    const lngErrors = fieldErrorsOf(parseCoordinates({ lat: 10, lng: bad }));
    assert.deepEqual(lngErrors.map((e) => [e.field, e.code]), [['lng', 'invalid_coordinate']], String(bad));
  }
});

test('parseCoordinates accepts the boundary values and rejects just beyond them', () => {
  assert.equal(parseCoordinates({ lat: 90, lng: 180 }).ok, true);
  assert.equal(parseCoordinates({ lat: -90, lng: -180 }).ok, true);
  assert.deepEqual(parseCoordinates({ lat: '90', lng: '-180' }), { ok: true, value: { lat: 90, lng: -180 } });

  const latHigh = fieldErrorsOf(parseCoordinates({ lat: 90.0001, lng: 0 }));
  assert.deepEqual(latHigh.map((e) => [e.field, e.code]), [['lat', 'coordinate_out_of_range']]);
  const latLow = fieldErrorsOf(parseCoordinates({ lat: -90.0001, lng: 0 }));
  assert.deepEqual(latLow.map((e) => [e.field, e.code]), [['lat', 'coordinate_out_of_range']]);
  const lngHigh = fieldErrorsOf(parseCoordinates({ lat: 0, lng: 180.0001 }));
  assert.deepEqual(lngHigh.map((e) => [e.field, e.code]), [['lng', 'coordinate_out_of_range']]);
  const lngLow = fieldErrorsOf(parseCoordinates({ lat: 0, lng: '-180.0001' }));
  assert.deepEqual(lngLow.map((e) => [e.field, e.code]), [['lng', 'coordinate_out_of_range']]);
});

test('parseCoordinates keeps lat in [-90, 90] even when lng would allow the value', () => {
  assert.equal(parseCoordinates({ lat: 120, lng: 120 }).ok, false);
  assert.equal(parseCoordinates({ lat: 45, lng: 120 }).ok, true);
});

test('parseCoordinates reports lat and lng errors independently', () => {
  const both = fieldErrorsOf(parseCoordinates({ lat: '', lng: 500 }));
  assert.deepEqual(both.map((e) => [e.field, e.code]), [
    ['lat', 'invalid_coordinate'],
    ['lng', 'coordinate_out_of_range'],
  ]);
  const none = fieldErrorsOf(parseCoordinates({}));
  assert.deepEqual(none.map((e) => e.field), ['lat', 'lng']);
  for (const error of both) {
    assert.deepEqual(Object.keys(error).sort(), ['code', 'field', 'message']);
  }
});

// ------------------------------------------------------------ parseBoundedInt

test('parseBoundedInt accepts integers and integer strings within range', () => {
  const opts = { min: 1, max: 10 };
  assert.deepEqual(parseBoundedInt(5, opts), { ok: true, value: 5 });
  assert.deepEqual(parseBoundedInt('5', opts), { ok: true, value: 5 });
  assert.deepEqual(parseBoundedInt(' 7 ', opts), { ok: true, value: 7 });
  assert.deepEqual(parseBoundedInt('+3', opts), { ok: true, value: 3 });
  assert.deepEqual(parseBoundedInt(1, opts), { ok: true, value: 1 });
  assert.deepEqual(parseBoundedInt(10, opts), { ok: true, value: 10 });
  assert.deepEqual(parseBoundedInt('-4', { min: -5, max: 5 }), { ok: true, value: -4 });
});

test('parseBoundedInt rejects non-integers, exponent forms and junk', () => {
  for (const bad of [1.5, '1.5', '1e3', 1e21, 'abc', '0x10', ' ', '--1', '1 2', NaN, Infinity, true, [], [1], {}, '99999999999999999999']) {
    const result = failureOf(parseBoundedInt(bad, { min: 0, max: 1e21, fallback: 7 }));
    assert.equal(result.code, 'invalid_integer', String(bad));
    assert.equal(typeof result.message, 'string');
  }
});

test('parseBoundedInt treats out of range as an error, not a clamp', () => {
  const opts = { min: 1, max: 10 };
  assert.equal(failureOf(parseBoundedInt(0, opts)).code, 'integer_out_of_range');
  assert.equal(failureOf(parseBoundedInt(11, opts)).code, 'integer_out_of_range');
  assert.equal(failureOf(parseBoundedInt('-1', opts)).code, 'integer_out_of_range');
  assert.equal(failureOf(parseBoundedInt('1000', opts)).code, 'integer_out_of_range');
});

test('parseBoundedInt uses fallback only for null, undefined and the empty string', () => {
  const opts = { min: 1, max: 10, fallback: 3 };
  assert.deepEqual(parseBoundedInt(null, opts), { ok: true, value: 3 });
  assert.deepEqual(parseBoundedInt(undefined, opts), { ok: true, value: 3 });
  assert.deepEqual(parseBoundedInt('', opts), { ok: true, value: 3 });
  assert.equal(failureOf(parseBoundedInt('abc', opts)).code, 'invalid_integer');
  assert.equal(failureOf(parseBoundedInt(99, opts)).code, 'integer_out_of_range');
  assert.equal(failureOf(parseBoundedInt(0, opts)).code, 'integer_out_of_range');
  // Zero is a real value, not a missing one.
  assert.deepEqual(parseBoundedInt(0, { min: 0, max: 10, fallback: 3 }), { ok: true, value: 0 });
});

test('parseBoundedInt allows a null fallback to mean "absent"', () => {
  assert.deepEqual(parseBoundedInt(undefined, { min: 1, max: 10, fallback: null }), { ok: true, value: null });
});

test('parseBoundedInt without a fallback reports a missing value as an error', () => {
  for (const missing of [null, undefined, '']) {
    assert.equal(failureOf(parseBoundedInt(missing, { min: 1, max: 10 })).code, 'invalid_integer');
  }
});

// ------------------------------------------------------------------ parseEnum

test('parseEnum accepts exact members', () => {
  assert.deepEqual(parseEnum('daily', ['daily', 'weekly']), { ok: true, value: 'daily' });
});

test('parseEnum is case sensitive by default and returns the canonical member when insensitive', () => {
  assert.equal(failureOf(parseEnum('Daily', ['daily', 'weekly'])).code, 'invalid_option');
  assert.deepEqual(parseEnum('DAILY', ['daily', 'weekly'], { caseInsensitive: true }), { ok: true, value: 'daily' });
  assert.deepEqual(parseEnum('daily', ['Daily', 'Weekly'], { caseInsensitive: true }), { ok: true, value: 'Daily' });
});

test('parseEnum rejects unknown, non-string and prototype-style values', () => {
  for (const bad of ['monthly', 1, true, {}, [], ['daily'], '__proto__', 'constructor', 'toString']) {
    assert.equal(failureOf(parseEnum(bad, ['daily', 'weekly'])).code, 'invalid_option', String(bad));
  }
  assert.equal(failureOf(parseEnum(1, ['1', '2'], { caseInsensitive: true })).code, 'invalid_option');
});

test('parseEnum uses fallback only for null, undefined and the empty string', () => {
  const opts = { fallback: 'daily' };
  assert.deepEqual(parseEnum(null, ['daily', 'weekly'], opts), { ok: true, value: 'daily' });
  assert.deepEqual(parseEnum(undefined, ['daily', 'weekly'], opts), { ok: true, value: 'daily' });
  assert.deepEqual(parseEnum('', ['daily', 'weekly'], opts), { ok: true, value: 'daily' });
  assert.equal(failureOf(parseEnum('monthly', ['daily', 'weekly'], opts)).code, 'invalid_option');
  assert.deepEqual(parseEnum(undefined, ['daily'], { fallback: null }), { ok: true, value: null });
});

test('parseEnum without a fallback reports a missing value as an error', () => {
  for (const missing of [null, undefined, '']) {
    assert.equal(failureOf(parseEnum(missing, ['daily'])).code, 'invalid_option');
  }
});

// ------------------------------------------------------------------ parseUuid

test('parseUuid accepts a standard 8-4-4-4-12 hex uuid', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000';
  assert.deepEqual(parseUuid(id), { ok: true, value: id });
});

test('parseUuid returns the lowercase form of an uppercase uuid', () => {
  assert.deepEqual(parseUuid('123E4567-E89B-12D3-A456-426614174000'), {
    ok: true,
    value: '123e4567-e89b-12d3-a456-426614174000',
  });
});

test('parseUuid rejects anything else', () => {
  for (const bad of [
    '',
    '123e4567e89b12d3a456426614174000',
    '123e4567-e89b-12d3-a456-42661417400',
    '123e4567-e89b-12d3-a456-4266141740000',
    '123e4567-e89b-12d3-a456-42661417400g',
    ' 123e4567-e89b-12d3-a456-426614174000',
    '123e4567-e89b-12d3-a456-426614174000\n',
    '{123e4567-e89b-12d3-a456-426614174000}',
    'urn:uuid:123e4567-e89b-12d3-a456-426614174000',
    '123e4567-e89b-12d3-a456-426614174000-extra',
    null,
    undefined,
    123,
    {},
    ['123e4567-e89b-12d3-a456-426614174000'],
  ]) {
    assert.equal(failureOf(parseUuid(bad)).code, 'invalid_uuid', JSON.stringify(bad));
  }
});

// ------------------------------------------------------------------ parseText

test('parseText returns the trimmed string by default', () => {
  assert.deepEqual(parseText('  hello  ', { maxLength: 20 }), { ok: true, value: 'hello' });
});

test('parseText keeps surrounding whitespace when trim is false', () => {
  assert.deepEqual(parseText('  hello  ', { maxLength: 20, trim: false }), { ok: true, value: '  hello  ' });
});

test('parseText rejects non-strings', () => {
  for (const bad of [42, {}, [], ['a'], true, null, undefined, 10n]) {
    assert.equal(failureOf(parseText(bad, { maxLength: 20 })).code, 'invalid_text', String(bad));
  }
});

test('parseText rejects over-long text instead of truncating it', () => {
  assert.deepEqual(parseText('abcde', { maxLength: 5 }), { ok: true, value: 'abcde' });
  const result = failureOf(parseText('abcdef', { maxLength: 5 }));
  assert.equal(result.code, 'text_too_long');
  assert.equal(result.value, undefined);
});

test('parseText measures length after trimming', () => {
  assert.equal(parseText('   abcde   ', { maxLength: 5 }).ok, true);
  assert.equal(parseText('   abcde   ', { maxLength: 5, trim: false }).ok, false);
});

test('parseText counts an emoji as one character', () => {
  assert.equal('\u{1F600}'.length, 2, 'precondition: one emoji is two UTF-16 units');
  const fiveEmoji = '\u{1F600}'.repeat(5);
  assert.deepEqual(parseText(fiveEmoji, { maxLength: 5 }), { ok: true, value: fiveEmoji });
  assert.equal(failureOf(parseText('\u{1F600}'.repeat(6), { maxLength: 5 })).code, 'text_too_long');
  // Family emoji is several code points; each code point counts once.
  const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
  assert.equal(Array.from(family).length, 5);
  assert.equal(parseText(family, { maxLength: 5 }).ok, true);
  assert.equal(parseText(family, { maxLength: 4 }).ok, false);
});

test('parseText treats empty text as an error only when required', () => {
  assert.deepEqual(parseText('', { maxLength: 10 }), { ok: true, value: '' });
  assert.deepEqual(parseText('   ', { maxLength: 10 }), { ok: true, value: '' });
  assert.equal(failureOf(parseText('', { maxLength: 10, required: true })).code, 'text_required');
  assert.equal(failureOf(parseText('   ', { maxLength: 10, required: true })).code, 'text_required');
  assert.equal(parseText('a', { maxLength: 10, required: true }).ok, true);
});

// ---------------------------------------------------------------- readJsonBody

test('readJsonBody returns a parsed plain object', async () => {
  const result = await readJsonBody(fakeRequest('{"a":1,"b":{"c":[true,null]}}'));
  assert.deepEqual(result, { ok: true, value: { a: 1, b: { c: [true, null] } } });
});

test('readJsonBody works on a real Request', async () => {
  const request = new Request('http://localhost/api/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hello: 'world' }),
  });
  assert.deepEqual(await readJsonBody(request), { ok: true, value: { hello: 'world' } });
});

test('readJsonBody treats an empty body as an empty object', async () => {
  assert.deepEqual(await readJsonBody(fakeRequest('')), { ok: true, value: {} });
  const noBody = new Request('http://localhost/api/x', { method: 'POST' });
  assert.deepEqual(await readJsonBody(noBody), { ok: true, value: {} });
});

test('readJsonBody rejects invalid JSON with 400 bad_request', async () => {
  for (const body of ['{', '{"a":1,}', 'not json', "{'a':1}", '   ']) {
    const result = failureOf(await readJsonBody(fakeRequest(body)));
    assert.equal(result.status, 400, body);
    assert.equal(result.code, 'bad_request', body);
    assert.equal(typeof result.message, 'string');
  }
});

test('readJsonBody rejects a JSON top level that is not an object', async () => {
  for (const body of ['[]', '[{"a":1}]', 'null', '"text"', '42', 'true', 'false']) {
    const result = failureOf(await readJsonBody(fakeRequest(body)));
    assert.equal(result.status, 400, body);
    assert.equal(result.code, 'bad_request', body);
  }
});

test('readJsonBody rejects a Content-Length over the limit without reading the body', async () => {
  const request = fakeRequest('{"a":1}', { 'content-length': '16385' });
  const result = failureOf(await readJsonBody(request));
  assert.equal(result.status, 413);
  assert.equal(result.code, 'payload_too_large');
  assert.equal(request.state.reads, 0);

  const custom = fakeRequest('{}', { 'content-length': '101' });
  assert.equal(failureOf(await readJsonBody(custom, { maxBytes: 100 })).status, 413);
  assert.equal(custom.state.reads, 0);
});

test('readJsonBody still catches a body that is larger than its Content-Length claims', async () => {
  const big = JSON.stringify({ pad: 'x'.repeat(20000) });
  const request = fakeRequest(big, { 'content-length': '10' });
  const result = failureOf(await readJsonBody(request));
  assert.equal(result.status, 413);
  assert.equal(result.code, 'payload_too_large');
  assert.equal(request.state.reads, 1);
});

test('readJsonBody rejects an oversize body that has no Content-Length', async () => {
  const result = failureOf(await readJsonBody(fakeRequest('x'.repeat(16385))));
  assert.equal(result.status, 413);
  assert.equal(result.code, 'payload_too_large');
});

test('readJsonBody measures bytes, not characters', async () => {
  // 12 characters but 20 bytes.
  const body = '{"a":"\u20AC\u20AC\u20AC\u20AC"}';
  assert.equal(body.length, 12);
  assert.equal(failureOf(await readJsonBody(fakeRequest(body), { maxBytes: 15 })).status, 413);
  assert.equal((await readJsonBody(fakeRequest(body), { maxBytes: 20 })).ok, true);
});

test('readJsonBody accepts a body of exactly maxBytes', async () => {
  const body = '{"a":"bcd"}';
  assert.equal(Buffer.byteLength(body), 11);
  assert.equal((await readJsonBody(fakeRequest(body), { maxBytes: 11 })).ok, true);
  assert.equal(failureOf(await readJsonBody(fakeRequest(body), { maxBytes: 10 })).status, 413);
});

test('readJsonBody ignores a Content-Length that is not a number', async () => {
  const result = await readJsonBody(fakeRequest('{"a":1}', { 'content-length': 'lots' }));
  assert.deepEqual(result, { ok: true, value: { a: 1 } });
});

test('readJsonBody reports an unreadable body as 400 instead of throwing', async () => {
  const request = {
    headers: new Headers(),
    async text() {
      throw new TypeError('terminated');
    },
  };
  const result = failureOf(await readJsonBody(request));
  assert.equal(result.status, 400);
  assert.equal(result.code, 'bad_request');
});

// ------------------------------------------------------------------ copy rule

test('validate source has no em dashes', () => {
  const source = readFileSync(new URL('../lib/validate.js', import.meta.url), 'utf8');
  assert.equal(source.includes('\u2014'), false);
});
