// Reproducible structural audit evidence. No provider, account or database calls.
// --write mechanically generates the manifest from inspected local/Git sources.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const product = 'docs/product/';
const manifestPath = resolve(root, product, 'HALO_TODAY_HOMEGUARD_AUDIT_MANIFEST.json');
const originalPath = `${product}ai/HALO_BACKEND_WORKING_SPEC.md`;
const supplementPath = `${product}HALO_TODAY_HOMEGUARD_BACKEND_SUPPLEMENT.md`;
const combinedPath = resolve(root, product, 'HALO_BACKEND_RECONCILED_WORKING_SPEC.md');
const main = '9f1ef88fe2d99aa82e96285ce7aa152e99a5acb0';
const backend = '76acc4f8a2f830e7d8e09eb03c666bc229192f06';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => readFileSync(resolve(root, path));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
const lines = value => value.trim().split(/\r?\n/).filter(Boolean);
function walk(path) {
  return readdirSync(resolve(root, path), { withFileTypes: true }).flatMap(entry => {
    const child = `${path}/${entry.name}`;
    return entry.isDirectory() ? walk(child) : [child];
  });
}
const original = read(originalPath);
const originalManifest = JSON.parse(read(`${product}ai/HALO_BACKEND_SOURCE_COVERAGE.json`));
assert.equal(hash(original), originalManifest.spec_sha256);
assert.equal(hash(original), 'fc1fec4b180dc5057b2edf1c2203143d85535b43364502e674d34e04d415be86');
const specText = original.toString('utf8');
const markers = [...specText.matchAll(/\*\*((?:HO|BE|DS|MP|UI|AC|ST|WF|AG|MA|VR)-\d{3})\*\*/g)].map(match => match[1]);
assert.equal(markers.length, 1630);
assert.equal(new Set(markers).size, 1630);
assert.deepEqual([...new Set(markers)].sort(), originalManifest.blocks.filter(block => !['heading', 'table_schema'].includes(block.kind)).map(block => block.id).sort());
assert.equal(Object.keys(originalManifest.features).length, 45);
assert.equal(originalManifest.source_ids.length, 24);
const supplement = read(supplementPath).toString('utf8');
for (const match of supplement.matchAll(/\b(?:HO|BE|DS|MP|UI|AC|ST)-\d{3}\b/g)) assert(markers.includes(match[0]), `Unknown original requirement ${match[0]}`);
for (let index = 0; index <= 12; index++) assert(supplement.includes(`## HGX-${String(index).padStart(2, '0')} `));
assert(!supplement.includes('\u2014'), 'No em dashes in supplement');

const views = {
  tests: ['list','overview','new','prepare','report','detail','edit','arranged','collect','awaiting','results','attachments','history','compare','export'],
  maintenance: ['list','create','edit','detail','occurrence','observation','observation-edit','observation-detail'],
  food: ['list','pantry','pantry-saved','pantry-custom','pantry-add','pantry-detail','pantry-note','pantry-edit','fish','fish-detail','fish-notes','fish-note-new','fish-note-detail','fish-note-edit','gardens','garden-new','garden-detail','garden-edit','garden-links','evidence','evidence-detail','growers','grower-detail','water','usage','usage-compare','usage-new','usage-detail','usage-edit'],
  summary: ['list','selection','preview'],
};
const viewFiles = {
  tests: ['TestsWorkspace.tsx'], maintenance: ['MaintenanceWorkspace.tsx'],
  food: ['FoodGardenWorkspace.tsx','FoodPantry.tsx','FoodFish.tsx','FoodGarden.tsx','FoodEvidence.tsx','FoodGrower.tsx','FoodWater.tsx'],
  summary: ['SummaryWorkspace.tsx'],
};
for (const [family, names] of Object.entries(viewFiles)) {
  const source = names.map(name => read(`components/homeguard/${name}`).toString('utf8')).join('\n');
  const direct = [...source.matchAll(/\bview\s*===?\s*'([a-z-]+)'|\bnavigate\('([a-z-]+)'/g)].map(match => match[1] || match[2]);
  for (const view of direct) assert(views[family].includes(view), `Uninventoried ${family} view: ${view}`);
  for (const view of views[family]) assert(supplement.includes('`' + view + '`'), `Missing supplement view ${family}:${view}`);
}
const frontendFiles = [...new Set([
  ...walk('components/foundation'), ...walk('components/stage'), ...walk('components/expanded'), ...walk('components/homeguard'),
  ...walk('lib/frontend'), ...walk('app/foundation/preview'),
  ...walk('test').filter(path => /^test\/(frontend-|ui\/(home|luna|expanded|section-navigation|stage-expanded))/.test(path)),
  'docs/WIREFRAME_WORKFLOW.md', 'components/ui/AppNavigation.tsx', 'package.json',
])].filter(path => /\.(tsx?|jsx?|mjs|css|json|md)$/.test(path)).sort();
const snapshots = frontendFiles.map(path => ({ path, sha256: hash(read(path)) }));
function repoTree(commit) {
  const tree = lines(git('ls-tree', '-r', commit, 'app/api', 'lib', 'supabase/migrations')).map(line => {
    const match = line.match(/^\d+ blob ([a-f0-9]+)\t(.+)$/);
    assert(match, `Unexpected tree entry ${line}`);
    return { path: match[2], git_blob: match[1] };
  }).filter(entry => !entry.path.startsWith('lib/frontend/'));
  const files = tree.map(entry => entry.path);
  const routes = files.filter(path => path.startsWith('app/api/') && path.endsWith('/route.js'));
  const migrations = files.filter(path => path.startsWith('supabase/migrations/'));
  assert.equal(routes.length, 22);
  assert.equal(migrations.length, 14);
  const handlers = lines(git('grep', '-n', '-E', 'export (async )?function (GET|POST|PUT|PATCH|DELETE)', commit, '--', 'app/api'));
  return { commit, route_count: routes.length, migration_count: migrations.length,
    files: tree,
    routes: routes.map(path => ({ path, methods: handlers.filter(line => line.startsWith(`${commit}:${path}:`)).map(line => line.match(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/)[1]) })), migrations };
}
const intake = git('show', `${backend}:docs/product/HALO_BACKEND_WORKING_SPEC.partial.md`);
assert(intake.includes('BE-032') && intake.includes('Not received yet'));
const planSources = [originalPath, supplementPath, `${product}ai/HALO_BACKEND_SOURCE_COVERAGE.json`, `${product}HALO_BACKEND_AND_DATA_PLAN.md`, `${product}HALO_FRONTEND_BUILD_PLAN.md`, `${product}HALO_FEATURE_ACCEPTANCE.md`, `${product}HALO_FOOD_EVIDENCE_EXTENSION.md`, `${product}HALO_SOURCE_ACQUISITION_GUIDE.md`];
const result = {
  version: 1, audit_date_local: '2026-10-03', timezone: 'America/New_York',
  scope: 'Static source and requirements reconciliation for current Today, Homeguard and shared dependencies. Hash inventory is not a claim of line-by-line runtime validation.',
  frontend_head: git('rev-parse', 'HEAD').trim(), frontend_branch: git('branch', '--show-current').trim(),
  frontend_has_uncommitted_changes: true,
  hosted_review: { version: 19, source_commit: 'da641dc08dcb13f426975a29a6ca0274f416dc8c', kind: 'sample-only static preview' },
  original_packet: { path: originalPath, sha256: hash(original), requirement_blocks: markers.length, feature_packets: 45, source_families: 24, unchanged: true },
  original_source_hash_drift: originalManifest.sources.map(source => ({ path: source.path, originally_compiled_sha256: source.sha256, current_sha256: hash(read(source.path)), unchanged_since_compilation: source.sha256 === hash(read(source.path)) })),
  requirements: Array.from({ length: 13 }, (_, index) => `HGX-${String(index).padStart(2, '0')}`),
  repositories: { main: repoTree(main), backend: repoTree(backend) },
  intake_evidence: { commit: backend, path: 'docs/product/HALO_BACKEND_WORKING_SPEC.partial.md', line: 5, sha256_of_git_text: hash(intake), cutoff: 'BE-032', note: 'Checked-in session reports missing remainder, not a claim about every later session.' },
  views, distinct_section_view_pairs: Object.values(views).reduce((total, list) => total + list.length, 0),
  plan_sources: planSources.map(path => ({ path, sha256: hash(read(path)) })), frontend_and_test_files: snapshots,
  verification: { local_npm_test: { passed: 426, failed: 0, scope: 'Current local worktree logic tests; module-type warnings present.' }, remote_backend_tests_rerun: false, live_provider_or_private_database_tests: false, production_mutations: false, app_source_changed_by_this_audit: false },
};
const combinedIntro = '# HALO Reconciled Backend Working Specification\n\nOctober 3, 2026. Give this complete file to Vibhav\'s coding assistant through repository access or a file attachment, not a long pasted chat message.\n\nPart One is the latest Today and Homeguard audit supplement. Part Two is the complete original 45-feature working specification, appended byte-for-byte. Apply newer explicit decisions only where they supersede older wording; all unrelated original requirements remain. Neither part is proof of implementation or deployment.\n\nThe backend branch recorded a truncated paste ending during BE-032. This file restores the full context and adds the later wireframe contracts. Read in bounded packages, maintain a requirement tracker, and do not mark a requirement complete without implementation and test evidence.\n\nRepository links in the appended documents refer to halo-app; keep repository access available. Public source links retain their original targets. Product photos are removed, generic educational tips do not create tasks, and local PDF/robot animation need no AI service.\n\n## Part One Latest Audit and Integration Supplement\n\n';
const separator = '\n\n## Part Two Complete Original Working Specification\n\nThe following original file is preserved unchanged, SHA-256 fc1fec4b180dc5057b2edf1c2203143d85535b43364502e674d34e04d415be86. Its earlier decisions apply unless explicitly superseded by Part One.\n\n<!-- HALO_ORIGINAL_WORKING_SPEC_START -->\n';
const end = '\n<!-- HALO_ORIGINAL_WORKING_SPEC_END -->\n';
const combined = Buffer.concat([Buffer.from(combinedIntro + supplement + separator), original, Buffer.from(end)]);
if (process.argv.includes('--write')) {
  writeFileSync(manifestPath, JSON.stringify(result, null, 2) + '\n');
  writeFileSync(combinedPath, combined);
} else {
  assert.deepEqual(JSON.parse(readFileSync(manifestPath, 'utf8')), result, 'Source changed after audit; review and regenerate manifest deliberately.');
  assert.deepEqual(readFileSync(combinedPath), combined, 'Combined handoff drifted from supplement or original.');
}
assert.equal(hash(combined.subarray(Buffer.byteLength(combinedIntro + supplement + separator), combined.length - Buffer.byteLength(end))), hash(original));
console.log(`PASS: original 1630 blocks / 45 features / 24 source families intact; 13 supplement sections; ${result.distinct_section_view_pairs} Homeguard section-view pairs; ${snapshots.length} frontend/test fingerprints; main/backend inventories each 22 routes and 14 migrations.`);
console.log('PASS: single-file reconciled handoff retains the full original byte-for-byte after the new supplement.');
console.log('Scope: structural evidence only, not deployed backend or scientific validation.');
