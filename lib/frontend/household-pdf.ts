import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

export type HouseholdReport = { title: string; generated: string; introduction: string[]; sections: { title: string; lines: string[] }[] };
export type ReportProgress = { value: number; label: string };
const clean = (text: string) => text.replace(/\u2014/g, ', ').replace(/[\u2010-\u2013\u2212]/g, '-').replace(/[\u0000-\u0008\u000b-\u001f]/g, '');
const ink = rgb(.07, .17, .22), teal = rgb(.03, .39, .43), muted = rgb(.32, .40, .44);
const width = 612, height = 792, margin = 48, measure = width - margin * 2;

/** Wrap by measured glyph width, including long report IDs. No truncation of evidence. */
export function wrapReportText(text: string, font: Pick<PDFFont, 'widthOfTextAtSize'>, size: number, available: number): string[] {
  const rows: string[] = [];
  for (const paragraph of clean(text).split('\n')) {
    let row = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (font.widthOfTextAtSize(`${row}${row ? ' ' : ''}${word}`, size) <= available) { row += `${row ? ' ' : ''}${word}`; continue; }
      if (row) rows.push(row);
      row = '';
      for (const character of word) {
        if (row && font.widthOfTextAtSize(row + character, size) > available) { rows.push(row); row = ''; }
        row += character;
      }
    }
    rows.push(row);
  }
  return rows;
}

/** Local layout only: no AI request, upload, new measurements or inferred conclusions. */
export async function createHouseholdPdf(report: HouseholdReport, fontBytes: Uint8Array, onProgress: (progress: ReportProgress) => void, signal: AbortSignal, fallbackFontBytes?: Uint8Array) {
  const checkpoint = async (value: number, label: string) => {
    signal.throwIfAborted(); onProgress({ value, label });
    await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted();
  };
  await checkpoint(12, 'Preparing the document');
  const allText = clean(JSON.stringify(report));
  if (allText.length > 400_000) throw new Error('This report is too large for a local PDF. Choose fewer records or download the accessible text copy.');
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  let font = await pdf.embedFont(fontBytes, { subset: true });
  const supports = (candidate: PDFFont) => { const supported = new Set(candidate.getCharacterSet()); return Array.from(allText).every(char => supported.has(char.codePointAt(0)!) || /\s/.test(char)); };
  // Existing Onest and the PDF standard font cover additional unit glyphs.
  if (!supports(font) && fallbackFontBytes) font = await pdf.embedFont(fallbackFontBytes, { subset: true });
  if (!supports(font)) font = await pdf.embedFont(StandardFonts.Helvetica);
  if (!supports(font)) throw new Error('Some characters are not supported by the PDF font. Download the accessible text copy to keep the original wording.');
  pdf.setTitle('HALO household summary'); pdf.setCreator('HALO local report builder'); pdf.setSubject('Selected sample records and original evidence dates'); pdf.setLanguage('en-US');
  const timestamp = new Date(report.generated); if (Number.isFinite(timestamp.getTime())) pdf.setCreationDate(timestamp);
  let page = pdf.addPage([width, height]), y = height - 112;
  function decorate() {
    page.drawRectangle({ x: 0, y: height - 78, width, height: 78, color: rgb(.93, .97, .97) });
    const label = 'HALO  /  HOUSEHOLD SUMMARY';
    page.drawText(label, { x: (width - font.widthOfTextAtSize(label, 12)) / 2, y: height - 44, size: 12, font, color: teal });
  }
  decorate();
  function nextPage() {
    if (pdf.getPageCount() >= 200) throw new Error('This report exceeds 200 pages. Choose fewer records or use the accessible text copy.');
    page = pdf.addPage([width, height]); decorate(); y = height - 108;
  }
  function paragraph(text: string, size = 11, color = ink) {
    for (const row of wrapReportText(text, font, size, measure)) {
      if (y < 68) nextPage();
      page.drawText(row, { x: margin, y, size, font, color }); y -= size * 1.5;
    }
    y -= 9;
  }
  function heading(text: string, size = 15) {
    const rows = wrapReportText(text, font, size, measure);
    if (y < 106 + rows.length * size * 1.4) nextPage();
    y -= 5;
    for (const row of rows) { page.drawText(row, { x: (width - font.widthOfTextAtSize(row, size)) / 2, y, size, font, color: teal }); y -= size * 1.4; }
    y -= 12;
  }
  heading(report.title, 23);
  for (const text of report.introduction) paragraph(text, 10, muted);
  await checkpoint(25, 'Arranging selected sections');
  const count = Math.max(1, report.sections.reduce((total, section) => total + section.lines.length, 0)); let finished = 0;
  for (const section of report.sections) {
    heading(section.title);
    for (const text of section.lines) {
      signal.throwIfAborted(); paragraph(text); finished++;
      if (finished % 8 === 0) await checkpoint(25 + Math.floor(finished / count * 60), 'Laying out your selected records');
    }
    await checkpoint(25 + Math.floor(finished / count * 60), `Completed ${section.title.toLowerCase()}`);
  }
  const pages = pdf.getPages();
  pages.forEach((item, index) => {
    item.drawLine({ start: { x: margin, y: 48 }, end: { x: width - margin, y: 48 }, thickness: .6, color: rgb(.75, .83, .83) });
    item.drawText('Sample-data review. Not a live home assessment.', { x: margin, y: 32, size: 8, font, color: muted });
    const label = `${index + 1} / ${pages.length}`;
    item.drawText(label, { x: width - margin - font.widthOfTextAtSize(label, 8), y: 32, size: 8, font, color: muted });
  });
  await checkpoint(92, 'Packaging your PDF');
  const bytes = await pdf.save(); signal.throwIfAborted();
  return { bytes, pages: pages.length };
}
