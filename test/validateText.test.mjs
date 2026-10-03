import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './helpers/routeLoader.mjs'; // registers the module hooks, so lib files load as ES modules without the typeless-package warning

const { parseText, hasControlCharacters } = await import('../lib/validate.js');

// Control characters are built from code points: a literal one in a source file
// is invisible, and a NUL would corrupt the file.
const chr = (code) => String.fromCharCode(code);
const NUL = chr(0x00);
const ESC = chr(0x1b);
const DEL = chr(0x7f);
const NEL = chr(0x85); // a C1 control
const LINE_SEPARATOR = chr(0x2028);
const PARAGRAPH_SEPARATOR = chr(0x2029);
const TAB = chr(0x09);
const LF = chr(0x0a);
const CR = chr(0x0d);

const failureOf = (result) => {
  assert.equal(result.ok, false);
  return result;
};

test('parseText without rejectControl still accepts control characters (the option is opt in)', () => {
  for (const text of [`a${NUL}b`, `a${ESC}b`, `a${LF}b`, `a${LINE_SEPARATOR}b`]) {
    assert.equal(parseText(text, { maxLength: 20 }).ok, true);
  }
});

test('rejectControl rejects NUL, other C0 controls, DEL, C1 controls and the two Unicode separators', () => {
  const bad = [NUL, chr(0x01), chr(0x08), chr(0x0b), chr(0x0c), chr(0x0e), ESC, chr(0x1f), DEL, chr(0x80), NEL, chr(0x9f), LINE_SEPARATOR, PARAGRAPH_SEPARATOR, TAB, LF, CR];
  for (const control of bad) {
    const result = failureOf(parseText(`a${control}b`, { maxLength: 20, rejectControl: true }));
    assert.equal(result.code, 'invalid_characters', `U+${control.charCodeAt(0).toString(16).padStart(4, '0')}`);
    assert.equal(result.message, 'Remove line breaks and other control characters.');
  }
});

test('rejectControl accepts ordinary text: punctuation, accents, emoji, a space and the characters next to the control ranges', () => {
  for (const text of ['Cabarrus County', 'caf' + chr(0xe9) + ' ' + chr(0x2603), '\u{1F4A7}\u{1F4A7}', 'it\'s "fine", (ok); 100%', chr(0x20) + 'a' + chr(0x7e) + chr(0xa0) + chr(0xa1), chr(0x2027) + chr(0x202a)]) {
    assert.deepEqual(parseText(text, { maxLength: 40, rejectControl: true }), { ok: true, value: text.trim() });
  }
});

test('rejectControl is judged after trimming: a control that trim removes is gone, one inside the text is rejected', () => {
  assert.deepEqual(parseText(`${LF}${TAB} hello ${CR}${LF}`, { maxLength: 20, rejectControl: true }), { ok: true, value: 'hello' });
  assert.equal(failureOf(parseText(` hel${LF}lo `, { maxLength: 20, rejectControl: true })).code, 'invalid_characters');
  // A NUL is not whitespace, so trim never hides it.
  assert.equal(failureOf(parseText(`hello${NUL}`, { maxLength: 20, rejectControl: true })).code, 'invalid_characters');
  assert.equal(failureOf(parseText(`${NUL}hello`, { maxLength: 20, rejectControl: true })).code, 'invalid_characters');
});

test('rejectControl is judged on the text as given when trim is false', () => {
  assert.equal(failureOf(parseText(`hello${LINE_SEPARATOR}`, { maxLength: 20, rejectControl: true, trim: false })).code, 'invalid_characters');
  assert.deepEqual(parseText(`hello${LF}`, { maxLength: 20, rejectControl: true, trim: false, allowNewlines: true }), { ok: true, value: `hello${LF}` });
});

test('the length check comes before the control check, so an over-long text reports its length', () => {
  assert.equal(failureOf(parseText(`${'a'.repeat(10)}${NUL}`, { maxLength: 5, rejectControl: true })).code, 'text_too_long');
});

test('allowNewlines keeps tab, line feed and carriage return and still rejects every other control', () => {
  const note = `Line one${LF}line two${CR}${LF}${TAB}indented`;
  assert.deepEqual(parseText(note, { maxLength: 100, rejectControl: true, allowNewlines: true }), { ok: true, value: note });
  for (const control of [NUL, chr(0x01), chr(0x08), chr(0x0b), chr(0x0c), chr(0x0e), ESC, DEL, NEL, LINE_SEPARATOR, PARAGRAPH_SEPARATOR]) {
    const result = failureOf(parseText(`a${control}b`, { maxLength: 20, rejectControl: true, allowNewlines: true }));
    assert.equal(result.code, 'invalid_characters', `U+${control.charCodeAt(0).toString(16).padStart(4, '0')}`);
    assert.equal(result.message, 'Remove control characters from this text.');
  }
});

test('allowNewlines does nothing without rejectControl', () => {
  assert.equal(parseText(`a${NUL}b`, { maxLength: 20, allowNewlines: true }).ok, true);
});

test('rejectControl also rejects a lone surrogate, which cannot be encoded as UTF-8, but not a pair', () => {
  for (const lone of [chr(0xd800), chr(0xdbff), chr(0xdc00), chr(0xdfff)]) {
    assert.equal(failureOf(parseText(`a${lone}b`, { maxLength: 20, rejectControl: true })).code, 'invalid_characters');
  }
  assert.equal(failureOf(parseText(`a${chr(0xd83d)}`, { maxLength: 20, rejectControl: true })).code, 'invalid_characters', 'a high surrogate at the end');
  assert.equal(failureOf(parseText(`${chr(0xde00)}a`, { maxLength: 20, rejectControl: true })).code, 'invalid_characters', 'a low surrogate at the start');
  assert.equal(parseText('a\u{1F600}b', { maxLength: 20, rejectControl: true }).ok, true);
});

test('rejectControl keeps the other parseText rules: non-strings, required, and the length cap', () => {
  assert.equal(failureOf(parseText(5, { maxLength: 20, rejectControl: true })).code, 'invalid_text');
  assert.equal(failureOf(parseText('  ', { maxLength: 20, rejectControl: true, required: true })).code, 'text_required');
  assert.deepEqual(parseText('', { maxLength: 20, rejectControl: true }), { ok: true, value: '' });
  assert.equal(parseText('a'.repeat(20), { maxLength: 20, rejectControl: true }).ok, true);
  assert.equal(failureOf(parseText('a'.repeat(21), { maxLength: 20, rejectControl: true })).code, 'text_too_long');
});

test('hasControlCharacters is the same rule on its own', () => {
  assert.equal(hasControlCharacters('plain'), false);
  assert.equal(hasControlCharacters(`a${LF}b`), true);
  assert.equal(hasControlCharacters(`a${LF}b`, { allowNewlines: true }), false);
  assert.equal(hasControlCharacters(`a${NUL}b`, { allowNewlines: true }), true);
  assert.equal(hasControlCharacters(`a${PARAGRAPH_SEPARATOR}b`, { allowNewlines: true }), true);
});

test('lib/validate.js and lib/directoryInput.js hold one copy of the control rule and no em dash', () => {
  const validate = readFileSync(new URL('../lib/validate.js', import.meta.url), 'utf8');
  const directory = readFileSync(new URL('../lib/directoryInput.js', import.meta.url), 'utf8');
  assert.equal(directory.includes('CONTROL ='), false, 'directoryInput.js uses the shared rule');
  assert.equal(directory.includes('hasControlCharacters'), true);
  for (const source of [validate, directory]) assert.equal(source.includes(String.fromCharCode(0x2014)), false);
});
