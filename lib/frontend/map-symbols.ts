/** One compact semantic family shared by the atlas and its accessible key. */
export const mapSymbols = {
  water: { body: 'M12 1C9 5 4 10 4 15a8 8 0 0 0 16 0C20 10 15 5 12 1Z', detail: 'M7 16c3 2 7 2 10 0' },
  facilities: { body: 'M2 21V10l7-4v6l7-4v5h3V3h3v18Z', detail: 'M6 16v2m5-2v2m5-2v2' },
  air: { body: '', detail: 'M2 8h12c5 0 5-6 1-6-2 0-3 1-3 2M2 12h17c5 0 5-6 1-6M2 16h10c5 0 5 6 1 6-2 0-3-1-3-2' },
  radon: { body: 'M4 3 12 1 20 5 22 13 17 21 8 23 2 16Z', detail: '' },
} as const;

/** Same shape area changes with the supplied population, bounded for legibility. */
export function waterSymbolRadius(population?: number | null) {
  return Math.min(16, Math.max(8, Math.sqrt(Math.max(population ?? 0, 0) / 10000) * 5));
}

/** Canvas does not inherit CSS OpenType tabular numerals. Space digits explicitly. */
export function mapNumberLayout(text: string, measure: (character: string) => number) {
  const digitWidth = Math.max(...'0123456789'.split('').map(measure));
  let width = 0;
  const characters = [...text].map(character => {
    const natural = measure(character), advance = /[0-9]/.test(character) ? digitWidth : natural;
    const item = { character, x: width + (advance - natural) / 2 };
    width += advance;
    return item;
  });
  return { width, characters };
}
