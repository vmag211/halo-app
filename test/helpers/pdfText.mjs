/**
 * The text a PDF built by lib/frontend/household-pdf.ts shows, read back from
 * its bytes: each page's content stream is decoded, every `Tj` string is
 * mapped to Unicode through its font's ToUnicode CMap (pdf-lib writes one for
 * every embedded font), and the shown strings are joined with spaces. The
 * builder wraps only at spaces, so a sentence reads back whole. No new
 * dependency: pdf-lib parses, this file only walks what it parsed.
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

const latin1 = (bytes) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');
const streamText = (stream) => latin1(stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents());
const hexToString = (hex) => {
  let out = '';
  for (let i = 0; i + 3 < hex.length; i += 4) out += String.fromCodePoint(parseInt(hex.slice(i, i + 4), 16));
  return out;
};

/** glyph hex (as written in the content stream) -> Unicode text, from a ToUnicode CMap. */
function parseCMap(text) {
  const map = new Map();
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, from, to] of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map.set(from.toUpperCase(), hexToString(to));
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const [, lo, hi, rest] of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(\[[^\]]*\]|<[0-9A-Fa-f]+>)/g)) {
      const start = parseInt(lo, 16); const end = parseInt(hi, 16);
      const targets = rest.startsWith('[') ? [...rest.matchAll(/<([0-9A-Fa-f]+)>/g)].map((m) => m[1]) : null;
      for (let code = start; code <= end; code += 1) {
        const key = code.toString(16).toUpperCase().padStart(lo.length, '0');
        if (targets) map.set(key, hexToString(targets[code - start] ?? ''));
        else map.set(key, String.fromCodePoint(parseInt(rest.slice(1, -1), 16) + (code - start)));
      }
    }
  }
  return map;
}

export async function pdfText(bytes) {
  const doc = await PDFDocument.load(bytes);
  const pages = [];
  for (const page of doc.getPages()) {
    const fonts = new Map();
    const fontDict = page.node.Resources()?.lookup(PDFName.of('Font'), PDFDict);
    for (const [name, ref] of fontDict?.entries() ?? []) {
      const font = doc.context.lookup(ref, PDFDict);
      const unicode = font.lookup(PDFName.of('ToUnicode'));
      fonts.set(name.asString(), unicode ? parseCMap(streamText(unicode)) : null);
    }
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
    const shown = [];
    let current = null;
    for (const stream of streams) {
      const text = streamText(stream);
      for (const match of text.matchAll(/(\/[^\s/]+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]*)>\s*Tj/g)) {
        if (match[1]) { current = fonts.get(match[1]) ?? null; continue; }
        const hex = match[2].toUpperCase();
        if (!current) { shown.push(latin1(Buffer.from(hex, 'hex'))); continue; }
        const width = [...current.keys()][0]?.length ?? 4;
        let row = '';
        for (let i = 0; i < hex.length; i += width) row += current.get(hex.slice(i, i + width)) ?? '�';
        shown.push(row);
      }
    }
    pages.push(shown.join(' '));
  }
  return pages.join(' ').replace(/\s+/g, ' ');
}
