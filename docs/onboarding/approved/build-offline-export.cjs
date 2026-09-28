// Mechanical archival transform of the skill-generated standalone wrapper.
// The byte-for-byte approved fragment and normal export are never modified.
const fs = require('node:fs');
const path = require('node:path');
const assets = path.join(__dirname, 'assets');
const asset = (name, mime) => `data:${mime};base64,${fs.readFileSync(path.join(assets, name)).toString('base64')}`;
const fonts = {
  '6NU78FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0KxC9TeA.woff2': 'fraunces-latin.woff2',
  '6NU78FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0KxCFTeO-U.woff2': 'fraunces-latin-ext.woff2',
  '6NU78FyLNQOQZAnv9bYEvDiIdE9Ea92uemAk_WBq8U_9v0c2Wa0KxCBTeO-U.woff2': 'fraunces-vietnamese.woff2',
  'pxiTypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr0SZe1Q.woff2': 'instrument-sans-latin.woff2',
  'pxiTypc9vsFDm051Uf6KVwgkfoSxQ0GsQv8ToedPibnr0She1YmV.woff2': 'instrument-sans-latin-ext.woff2',
};
const fontCss = fs.readFileSync(path.join(assets, 'fonts-google.css'), 'utf8').replace(
  /https:\/\/fonts\.gstatic\.com\/[^)\s]+/g,
  (url) => {
    const name = fonts[url.split('/').pop()];
    if (!name) throw new Error(`Unarchived font: ${url}`);
    return asset(name, 'font/woff2');
  },
);
let html = fs.readFileSync(path.join(__dirname, 'halo-onboarding-wireframes.html'), 'utf8');
const replacements = [
  ['https://unpkg.com/@floating-ui/core@1.7.3/dist/floating-ui.core.umd.min.js', asset('floating-ui.core.umd.min.js', 'application/javascript')],
  ['https://unpkg.com/@floating-ui/dom@1.7.4/dist/floating-ui.dom.umd.min.js', asset('floating-ui.dom.umd.min.js', 'application/javascript')],
  ['https://unpkg.com/lucide@1.17.0/dist/umd/lucide.js', asset('lucide.js', 'application/javascript')],
];
for (const [url, replacement] of replacements) {
  if (!html.includes(url)) throw new Error(`Missing expected resource: ${url}`);
  html = html.replaceAll(url, replacement);
}
html = html.replace(/https:\/\/fonts\.googleapis\.com\/css2\?[^"<>\s]+(?=&quot;)/g,
  `data:text/css;base64,${Buffer.from(fontCss).toString('base64')}`);
if (html.includes('href=&quot;https://fonts.googleapis.com')) throw new Error('Font link not frozen');
fs.writeFileSync(path.join(__dirname, 'halo-onboarding-wireframes.offline.html'), html);
console.log('Offline export rebuilt with embedded fonts, icons, and preview libraries.');
