// Assemble a review contact sheet and inventory from real browser captures.
// Generated review evidence is not an approved or immutable design baseline.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const panels = ['shell', 'pills', 'controls', 'sheet-standard'];
const labels = ['Shell and reading cards', 'Severity and evidence', 'Shared controls', 'Bottom sheet'];
const source = await fs.readFile(path.join(root, 'lib/frontend/foundation-preview.ts'), 'utf8');
const scenarios = [...source.matchAll(/\['([^']+)', '([^']+)', '([^']+)'\]/g)];
if (scenarios.length !== 53) throw new Error('Update the review inventory for a changed scenario set.');
for (const appearance of ['light', 'dark']) {
  const background = appearance === 'light' ? '#eef8f7' : '#081725';
  const ink = appearance === 'light' ? '#0b1f33' : '#e8f3f5';
  const width = 1540, height = 966;
  const composites = panels.map((panel, i) => ({ input: path.join(directory, 'screenshots', `${appearance}-375-${panel}.png`), left: 20 + i * 375, top: 106 }));
  const headings = labels.map((label, i) => `<text x="${20 + i * 375}" y="90" font-size="18">${label}</text>`).join('');
  const caption = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><g fill="${ink}" font-family="Arial,sans-serif"><text x="20" y="32" font-size="25" font-weight="700">HALO: shared foundation wireframes</text><text x="20" y="57" font-size="16">Unapproved design review. Sample data only. ${appearance} appearance, 375px.</text>${headings}</g></svg>`);
  await sharp({ create: { width, height, channels: 4, background } }).composite([{ input: caption, left: 0, top: 0 }, ...composites]).png().toFile(path.join(directory, `${appearance}-overview.png`));
}
const rows = scenarios.map(([, key, group, label]) => `| ${group}: ${label} | [375](screenshots/light-375-${key}.png) / [320](screenshots/light-320-${key}.png) | [375](screenshots/dark-375-${key}.png) / [320](screenshots/dark-320-${key}.png) |`);
await fs.writeFile(path.join(directory, 'INDEX.md'), `# Foundation review screenshots\n\nThese are proposals, not approved baselines. Review the interactive preview for behavior and full content below the captured viewport.\n\n[Light overview](light-overview.png) · [Dark overview](dark-overview.png)\n\n| Review state | Light widths | Dark widths |\n| --- | --- | --- |\n${rows.join('\n')}\n\nAdditional stress captures: large-{320|430|900}-{shell|form|long-text|controls|sheet-tall|identity}.png. Text scale 150% except initial tall-sheet capture, which uses 100% because its native dialog makes the external review controls inert.\n`);
const dependencies = [
  'app/foundation/preview/page.tsx', 'app/foundation/preview/preview.css',
  'components/foundation/FoundationPreview.tsx', 'components/ui/Foundation.tsx',
  'lib/frontend/foundation-preview.ts', 'lib/frontend/copy/foundation-preview.ts',
  'components/ui/Button.tsx', 'components/ui/SeverityPill.tsx',
  'lib/frontend/onboarding.ts', 'lib/frontend/copy.ts', 'lib/frontend/types.ts',
  'app/globals.css', 'app/onboarding.css', 'app/layout.tsx',
  'public/halo-logo-mark.png', 'public/fonts/instrument-sans-latin.woff2',
  'public/fonts/fraunces-latin.woff2', 'public/fonts/ibm-plex-mono-latin.woff2',
  'public/fonts/ibm-plex-mono-OFL.txt',
  'docs/foundation/reference/HALO_Frontend_Specification_2026-09-29.pdf',
];
const captures = (await fs.readdir(path.join(directory, 'screenshots'))).filter(name => name.endsWith('.png')).map(name => `docs/foundation/review/screenshots/${name}`);
const files = [...dependencies, ...captures, 'docs/foundation/review/light-overview.png', 'docs/foundation/review/dark-overview.png'].sort();
const hashes = await Promise.all(files.map(async file => ({ path: file, sha256: createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex') })));
await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ status: 'unapproved-review-evidence', referenceMain: '9f1ef88', scenarios: scenarios.length, files: hashes }, null, 2) + '\n');
console.log(`Built two contact sheets and an index for ${scenarios.length} states.`);
