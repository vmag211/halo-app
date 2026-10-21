/**
 * The expected-revision precondition never travels as a standard If-Match.
 * Vercel's edge evaluates If-Match against a function's 2xx and replaces it
 * with its own 412 after the function has committed (seen in production on
 * PATCH /api/explore/area, 2026-10-21), so the client sends X-Halo-If-Match
 * and every route reads the precondition through lib/ifMatch.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers/routeLoader.mjs';
import { IF_MATCH_HEADER, readIfMatch } from '../lib/ifMatch.js';

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);

test('readIfMatch reads X-Halo-If-Match first and falls back to If-Match', () => {
  assert.equal(IF_MATCH_HEADER, 'X-Halo-If-Match');
  const req = (headers) => new Request('https://example.test/', { headers });
  assert.equal(readIfMatch(req({ 'X-Halo-If-Match': '4' })), '4');
  assert.equal(readIfMatch(req({ 'If-Match': '5' })), '5');
  assert.equal(readIfMatch(req({ 'X-Halo-If-Match': '4', 'If-Match': '5' })), '4');
  assert.equal(readIfMatch(req({})), null);
});

test('the production client sends X-Halo-If-Match and never sets If-Match', () => {
  const runtime = readFileSync(path.join(REPO_ROOT, 'lib/frontend/production/runtime.ts'), 'utf8');
  assert.match(runtime, /headers\['X-Halo-If-Match'\] = String\(options\.expectedRevision\)/);
  for (const file of walk(path.join(REPO_ROOT, 'lib/frontend')).concat(walk(path.join(REPO_ROOT, 'components')))) {
    if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
    assert.doesNotMatch(readFileSync(file, 'utf8'), /['"]If-Match['"]\s*[:\]]/, `${path.relative(REPO_ROOT, file)} sets a standard If-Match`);
  }
});

test('no route reads If-Match except through readIfMatch', () => {
  const routes = walk(path.join(REPO_ROOT, 'app/api')).filter((file) => file.endsWith('.js'));
  let readers = 0;
  for (const file of routes) {
    const source = readFileSync(file, 'utf8');
    const label = path.relative(REPO_ROOT, file);
    assert.doesNotMatch(source, /headers\.get\(\s*['"]if-match['"]\s*\)/i, `${label} reads If-Match directly`);
    if (source.includes('readIfMatch(request)')) {
      readers++;
      assert.match(source, /import \{ readIfMatch \} from '@\/lib\/ifMatch';/, `${label} imports the helper`);
    }
  }
  assert.ok(readers >= 12, `every precondition route uses the helper (${readers})`);
});
