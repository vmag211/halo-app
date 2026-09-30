// Assemble review images from the production Playwright captures.
// Run after: npx playwright test mobile-review.spec.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const screens = ['01-welcome', '02-address', '03-household', '04-home', '05-results'];
const labels = ['Welcome', 'Your address', 'Your household', 'Your home', 'Your results'];

async function build() {
  await fs.mkdir(path.join(directory, 'screenshots'), { recursive: true });
  for (const appearance of ['light', 'dark']) {
    const background = appearance === 'light' ? '#f4f8f8' : '#06111c';
    const ink = appearance === 'light' ? '#0b1f33' : '#e8f3f5';
    const images = [];
    for (const [index, screen] of screens.entries()) {
      const source = path.join(root, 'test-results', `mobile-review-mobile-proposal-flow-${appearance}-375`, `${screen}.png`);
      const destination = path.join(directory, 'screenshots', `${appearance}-${screen}.png`);
      await fs.copyFile(source, destination);
      images.push({ input: destination, left: 24 + index * 375, top: 114 });
    }
    const titles = labels.map((label, index) => `<text x="${24 + index * 375}" y="94" font-size="20">${index + 1}. ${label}</text>`).join('');
    const heading = Buffer.from(`<svg width="1900" height="900" xmlns="http://www.w3.org/2000/svg"><g fill="${ink}" font-family="Arial, sans-serif"><text x="24" y="34" font-size="26" font-weight="700">HALO: approved mobile onboarding</text><text x="24" y="58" font-size="16">375px phone screens. Design review with sample data.</text>${titles}</g></svg>`);
    await sharp({ create: { width: 1900, height: 900, channels: 4, background } })
      .composite([{ input: heading, left: 0, top: 0 }, ...images])
      .png().toFile(path.join(directory, `${appearance}-overview.png`));
  }
}

build().catch(error => { console.error(error); process.exitCode = 1; });
