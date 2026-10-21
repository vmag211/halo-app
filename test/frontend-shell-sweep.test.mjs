import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('push notifications use the full-colour icon; the alpha mark stays the monochrome badge', () => {
  const worker = read('public/halo-notifications-sw.js');
  assert.match(worker, /icon: '\/halo-icon\.png'/);
  assert.match(worker, /badge: '\/halo-logo-mark\.png'/);
});

test('every product route names its page for the browser tab and history', () => {
  for (const [path, title] of [['app/(halo)/plan/page.tsx', 'My Week'], ['app/(halo)/act/page.tsx', 'Explore'], ['app/(halo)/today/page.tsx', 'Today'], ['app/(halo)/home/page.tsx', 'Homeguard'], ['app/(halo)/settings/page.tsx', 'Settings']])
    assert.match(read(path), new RegExp(`title: '${title}'`), path);
  assert.match(read('app/(halo)/factors/[factor]/page.tsx'), /generateMetadata/);
  assert.match(read('app/(halo)/household/[member]/page.tsx'), /generateMetadata/);
  assert.doesNotMatch(read('app/operations/page.tsx'), /title:'HALO /, 'the root template already prefixes HALO');
});

test('not-found and error screens use the shared readable status layout', () => {
  for (const path of ['app/not-found.tsx', 'app/error.tsx']) {
    const source = read(path);
    assert.match(source, /className="halo-status-page"/, path);
    assert.doesNotMatch(source, /fontFamily:'Arial/, path);
  }
  assert.match(read('app/globals.css'), /\.halo-status-page h1 \{/);
});

test('the public Learn library heading follows the page title without skipping a level', () => {
  assert.match(read('components/expanded/PublicBrowse.tsx'), /<LearnLibrary level=\{2\}\/>/);
  assert.match(read('components/expanded/LearnLibrary.tsx'), /<h3 aria-level=\{level\}>/);
});

test('the pointer-only sheet grab handle is hidden from assistive technology', () => {
  assert.match(read('components/ui/Foundation.tsx'), /className="halo-f-sheet-grab" aria-hidden="true"/);
});
