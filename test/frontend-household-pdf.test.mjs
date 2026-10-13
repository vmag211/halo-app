import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire, Module } from 'node:module';
import ts from 'typescript';
import { PDFDocument } from 'pdf-lib';

const filename = fileURLToPath(new URL('../lib/frontend/household-pdf.ts', import.meta.url));
const source = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
const compiled = new Module(filename); compiled.filename = filename; compiled.require = createRequire(filename); compiled._compile(source, filename);
const { createHouseholdPdf, wrapReportText } = compiled.exports;
const font = new Uint8Array(readFileSync(new URL('../public/fonts/instrument-sans-report.ttf', import.meta.url)));
const fallback = new Uint8Array(readFileSync(new URL('../public/fonts/onest-variable.ttf', import.meta.url)));
const report = { title: 'Household review', generated: '2026-10-03T12:00:00Z', introduction: ['Sample-data review.'], sections: [{ title: 'Test records', lines: ['PFOS < 2.0 ng/L, September 2026. Original reporting limit 2.0 ng/L.'] }] };

test('report wrapping retains all content and breaks long identifiers without overflow', () => {
  const text = 'A longidentifierfortesting ends'; const rows = wrapReportText(text, { widthOfTextAtSize: text => text.length }, 10, 8);
  assert.ok(rows.every(row => row.length <= 8)); assert.equal(rows.join('').replaceAll(' ', ''), text.replaceAll(' ', ''));
});
test('report produces a genuine PDF with stable metadata and ascending real work progress', async () => {
  const progress = []; const result = await createHouseholdPdf(report, font, item => progress.push(item.value), new AbortController().signal);
  const doc = await PDFDocument.load(result.bytes); assert.equal(doc.getTitle(), 'HALO household summary'); assert.equal(doc.getPageCount(), result.pages);
  assert.deepEqual(doc.getCreationDate(), new Date(report.generated)); assert.ok(progress.every((value, index) => !index || value >= progress[index - 1]));
});
test('long reports paginate rather than silently truncating selected data', async () => {
  const long = { ...report, sections: [{ title: 'Selected results', lines: Array.from({ length: 250 }, (_, index) => `Record ${index + 1}: measured 0.20 µg/L. Original dated report, not a current household measurement. No result was inferred.`) }] };
  const result = await createHouseholdPdf(long, font, () => {}, new AbortController().signal, fallback);
  assert.ok(result.pages > 10); assert.ok(result.pages < 50);
});
test('cancelled report work and unsupported glyphs fail without a misleading file', async () => {
  const aborted = new AbortController(); aborted.abort(); await assert.rejects(createHouseholdPdf(report, font, () => {}, aborted.signal), { name: 'AbortError' });
  await assert.rejects(createHouseholdPdf({ ...report, title: 'Private note 🧪' }, font, () => {}, new AbortController().signal), /accessible text copy/);
});
