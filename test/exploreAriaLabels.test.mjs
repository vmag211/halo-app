import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// axe aria-prohibited-attr: a div, span or text element without a role cannot carry an accessible name, so
// its aria-label is never announced. Found on .ex-generated-list by the overnight sweep, 2026-10-21.
const ROOT = path.resolve(import.meta.dirname, '..');
const files = [
  ...readdirSync(path.join(ROOT, 'components/expanded')).filter(name => /^(Explore|Production(Outreach|ProjectGeneration|NoteLuna)|Note|ProjectIllustration).*\.tsx$/.test(name)).map(name => `components/expanded/${name}`),
  ...readdirSync(path.join(ROOT, 'components/map-preview')).filter(name => name.endsWith('.tsx')).map(name => `components/map-preview/${name}`),
];

test('Explore and map elements that carry an aria-label also carry a role that allows it', () => {
  const offenders = [];
  for (const file of files) {
    const source = readFileSync(path.join(ROOT, file), 'utf8');
    for (const match of source.matchAll(/<(div|span|p|small|strong|b|i)\b([^<>]*?)\saria-label=/g)) {
      if (!/\srole=/.test(match[2])) offenders.push(`${file}: <${match[1]}${match[2].slice(0, 60)}`);
    }
  }
  assert.deepEqual(offenders, []);
});
