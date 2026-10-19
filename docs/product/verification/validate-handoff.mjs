// Structural documentation checks only. Does not validate scientific claims or deployment.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(root, file), 'utf8');
const master = read('HALO_MASTER_PLAN.md');
const handoff = read('HALO_BACKEND_BUILD_HANDOFF.md');
const guide = read('HALO_SOURCE_ACQUISITION_GUIDE.md');
const planned = [...master.matchAll(/^### ([A-Z]\d{2}) /gm)].map(m => m[1]);
const mapped = [...handoff.matchAll(/^\| ([A-Z]\d{2}) /gm)].map(m => m[1]);
assert.equal(planned.length, 45, 'Expected master feature inventory changed; review coverage');
assert.equal(new Set(mapped).size, mapped.length, 'Duplicate feature row');
assert.deepEqual([...mapped].sort(), [...planned].sort(), 'Feature coverage differs');

const sources = [...guide.matchAll(/^### (S\d{2}) /gm)].map(m => m[1]);
assert.equal(sources.length, 24);
assert.equal(new Set(sources).size, sources.length);
for (const match of (handoff + guide).matchAll(/\bS\d{2}\b/g)) {
  assert(sources.includes(match[0]), `Undefined source: ${match[0]}`);
}
for (const file of [...readdirSync(root).filter(f => f.endsWith('.md')), 'verification/SOURCE_CHECKS_2026-10-03.md']) {
  const body = read(file);
  assert(!body.includes('\u2014'), `${file}: em dash`);
  assert(!/^.*[\t ]+$/m.test(body), `${file}: trailing whitespace`);
  for (const match of body.matchAll(/\]\((?:<([^>]+)>|([^\s)]+))\)/g)) {
    const target = match[1] || match[2];
    if (/^(https?:|#)/.test(target)) continue;
    assert(existsSync(resolve(dirname(resolve(root, file)), target.split('#')[0])), `${file}: missing link ${target}`);
  }
  let columns = null;
  for (const line of body.split('\n')) {
    if (!line.startsWith('|')) { columns = null; continue; }
    const count = line.split('|').length;
    if (columns === null) columns = count;
    assert.equal(count, columns, `${file}: uneven table row ${line.slice(0, 90)}`);
  }
}
console.log('PASS: all 45 master features mapped once; 24 source families defined; product-plan local links, tables and punctuation valid.');
console.log('Scope: structural documentation checks, not API integration or scientific validation.');
