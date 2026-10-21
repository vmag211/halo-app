import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRouteHarness } from './helpers/routeHarness.mjs';
import { readIfMatch } from '../lib/ifMatch.js';

const ROOT = path.resolve(import.meta.dirname, '..');
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(js|jsx|ts|tsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

test('readIfMatch: custom header first, standard header still honoured, absent is null', () => {
  const req = (h) => new Request('http://x.test/', { headers: h });
  assert.equal(readIfMatch(req({ 'X-Halo-If-Match': '3' })), '3');
  assert.equal(readIfMatch(req({ 'If-Match': '4' })), '4');
  assert.equal(readIfMatch(req({ 'X-Halo-If-Match': '3', 'If-Match': '4' })), '3');
  assert.equal(readIfMatch(req({})), null);
});

test('no route reads the standard If-Match directly: all 12 go through readIfMatch', () => {
  const routes = walk(path.join(ROOT, 'app/api')).filter((f) => /route\.js$/.test(f));
  const users = [];
  for (const f of routes) {
    const src = readFileSync(f, 'utf8');
    assert.equal(/headers\.get\(\s*['"]if-match['"]/i.test(src), false, `${f} reads if-match directly`);
    if (/readIfMatch\(request\)/.test(src)) users.push(f);
  }
  assert.equal(users.length, 12);
});

test('nothing in components/ or lib/ sends a standard If-Match header', () => {
  const files = [...walk(path.join(ROOT, 'components')), ...walk(path.join(ROOT, 'lib'))];
  for (const f of files) {
    const src = readFileSync(f, 'utf8').replace(/X-Halo-If-Match/gi, '');
    assert.equal(/['"]If-Match['"]\s*[:\]]/i.test(src), false, `${f} sets If-Match`);
    assert.equal(/headers\.set\(\s*['"]if-match/i.test(src), false, `${f} sets If-Match`);
  }
});

const ID = '11111111-1111-4111-8111-111111111111';
const REFUSING = [
  ['/api/privacy/exports', 'privacy exports', { operationId: ID, scope: 'journal', reviewToken: 'x' }],
  ['/api/privacy/clear', 'privacy clear', { operationId: ID, scope: 'journal', reviewToken: 'x' }],
  ['/api/week/changes/acknowledge', 'week acknowledge', { operationId: ID, id: 'a', version: '1', actionId: ID }],
];
const refused = async (res) => JSON.stringify((await res.json()).field_errors?.map((e) => e.field));

for (const [route, label, body] of REFUSING) {
  test(`${label} refuses X-Halo-If-Match exactly as If-Match, and only then`, async () => {
    const h = createRouteHarness({});
    const call = (headers) => h.call(route, 'POST', { as: 'alice', headers: { 'Idempotency-Key': ID, ...headers }, body });
    const std = await call({ 'If-Match': '1' });
    const custom = await call({ 'X-Halo-If-Match': '1' });
    const none = await call({});
    assert.equal(std.status, 400);
    assert.equal(custom.status, 400);
    assert.equal(await refused(custom), '["If-Match"]');
    assert.equal(await refused(std), '["If-Match"]');
    assert.notEqual(await refused(none), '["If-Match"]');
  });
}
