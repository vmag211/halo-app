/**
 * Every route that writes an operation outcome declares a ceiling under the
 * ledger's staleness window.
 *
 * Why. `runOperation` claims a row as pending, runs the effect, then settles
 * the row with an unconditional update by id. Past DEFAULT_STALE_AFTER_MS a
 * reader reaps a pending row to failed (reason 'abandoned'), and the client is
 * told the change was not applied. An invocation still alive after that would
 * settle late and overwrite the reaped row with its real outcome, after the
 * client has already stopped tracking the id. The bound on that is the route's
 * `maxDuration`, which must therefore sit strictly under the window.
 *
 * What counts as a writer. A route that names `runOperation`, or that imports
 * a lib module which (directly or through another lib module) does. The reap
 * itself (readOperation, listUnresolvedOperations) is not a writer for this
 * purpose: it is one UPDATE guarded on `status = 'pending'` and staleness, so
 * a late reap can never overwrite a settled outcome.
 *
 * Read only: the source files are read as text and nothing is imported from
 * app/.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './helpers/routeLoader.mjs';

const { DEFAULT_STALE_AFTER_MS } = await import('@/lib/operations');

const CEILING_SECONDS = DEFAULT_STALE_AFTER_MS / 1000;
const SOURCE = /\.(?:js|mjs|ts|tsx)$/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (SOURCE.test(entry.name)) out.push(full);
  }
  return out;
}

const rel = (file) => path.relative(REPO_ROOT, file).split(path.sep).join('/');
const read = (file) => readFileSync(file, 'utf8');

/** Every module specifier a source file imports or re-exports, static or dynamic. */
function specifiers(source) {
  const found = [];
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) found.push(match[1]);
  return found;
}

/** The repo file a specifier names, or null for a package. */
function resolve(specifier, fromFile) {
  let base;
  if (specifier.startsWith('@/')) base = path.join(REPO_ROOT, specifier.slice(2));
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;
  for (const candidate of [base, `${base}.js`, `${base}.mjs`, `${base}.ts`, path.join(base, 'index.js')]) {
    if (SOURCE.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}

const OPERATIONS = path.join(REPO_ROOT, 'lib', 'operations.js');
/**
 * Source with comments removed, so a route whose header explains that it
 * never calls runOperation (recovery/status) is not counted as calling it. A
 * line comment is only taken at a line start or after whitespace, which keeps
 * the `//` inside a URL string.
 */
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const callsRunOperation = (source) => /\brunOperation\b/.test(code(source));

/** Lib modules that write operation outcomes: they name runOperation, or import a module that does. */
function ledgerWriterLibs() {
  const libs = walk(path.join(REPO_ROOT, 'lib')).filter((file) => file !== OPERATIONS);
  const writers = new Set(libs.filter((file) => callsRunOperation(read(file))));
  let grew = true;
  while (grew) {
    grew = false;
    for (const file of libs) {
      if (writers.has(file)) continue;
      if (specifiers(read(file)).some((spec) => writers.has(resolve(spec, file)))) {
        writers.add(file);
        grew = true;
      }
    }
  }
  return writers;
}

/**
 * The declared ceiling: `{ ok: true, seconds }` for one literal
 * `export const maxDuration = <integer>`, otherwise `{ ok: false, why }`. A
 * computed value is refused, because this test could not check it and the
 * platform reads the literal from the build output.
 */
function declaredMaxDuration(source) {
  const mentions = source.match(/^\s*export\b[^\n]*\bmaxDuration\b[^\n]*$/gm) ?? [];
  if (mentions.length === 0) return { ok: false, why: 'exports no maxDuration' };
  if (mentions.length > 1) return { ok: false, why: 'exports maxDuration more than once' };
  const literal = /^\s*export\s+const\s+maxDuration\s*=\s*(\d+(?:_\d+)*)\s*;?\s*(?:\/\/.*)?$/.exec(mentions[0]);
  if (!literal) return { ok: false, why: `does not export maxDuration as a numeric literal: ${mentions[0].trim()}` };
  return { ok: true, seconds: Number(literal[1].replaceAll('_', '')) };
}

function ledgerRoutes() {
  const writers = ledgerWriterLibs();
  return walk(path.join(REPO_ROOT, 'app', 'api'))
    .filter((file) => /^route\.(?:js|mjs|ts)$/.test(path.basename(file)))
    .filter((file) => {
      const source = read(file);
      return callsRunOperation(source) || specifiers(source).some((spec) => writers.has(resolve(spec, file)));
    })
    .map(rel)
    .sort();
}

test('the scan finds the ledger routes that exist today, so a broken scan cannot pass by finding none', () => {
  const routes = ledgerRoutes();
  for (const known of [
    'app/api/account/commands/route.js',
    'app/api/luna/conversations/clear/route.js',
    'app/api/luna/messages/route.js',
    'app/api/luna/runs/cancel/route.js',
    'app/api/recovery/request/route.js',
  ]) {
    assert.ok(routes.includes(known), `${known} calls runOperation and must be found by the scan`);
  }
});

test(`every route that settles an operation declares a literal maxDuration under the ${CEILING_SECONDS} s staleness window`, () => {
  const failures = [];
  for (const route of ledgerRoutes()) {
    const declared = declaredMaxDuration(read(path.join(REPO_ROOT, route)));
    if (!declared.ok) failures.push(`${route} ${declared.why}`);
    else if (!(declared.seconds > 0 && declared.seconds < CEILING_SECONDS)) {
      failures.push(`${route} declares maxDuration = ${declared.seconds}, which is not strictly under ${CEILING_SECONDS} s`);
    }
  }
  assert.deepEqual(
    failures,
    [],
    `A ledger route could outlive DEFAULT_STALE_AFTER_MS and overwrite a reaped row with a late settle. Add or lower its maxDuration:\n  ${failures.join('\n  ')}`,
  );
});

test('the ceiling parser accepts only one literal and refuses everything else', () => {
  assert.deepEqual(declaredMaxDuration('export const maxDuration = 60;\n'), { ok: true, seconds: 60 });
  assert.deepEqual(declaredMaxDuration('export const maxDuration = 1_20;'), { ok: true, seconds: 120 });
  assert.equal(declaredMaxDuration('const x = 1;\n').ok, false, 'none');
  assert.equal(declaredMaxDuration('// export const maxDuration = 60;\n').ok, false, 'a comment is not an export');
  assert.equal(declaredMaxDuration('export const maxDuration = LIMIT;\n').ok, false, 'computed');
  assert.equal(declaredMaxDuration('export const maxDuration = 30 * 4;\n').ok, false, 'an expression');
  assert.equal(declaredMaxDuration('export let maxDuration = 60;\n').ok, false, 'not a const');
  assert.equal(
    declaredMaxDuration('export const maxDuration = 60;\nexport const maxDuration = 300;\n').ok,
    false,
    'twice',
  );
});
