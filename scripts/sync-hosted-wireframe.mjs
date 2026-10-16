// Mechanical source sync for the isolated static review. Never copies app routes,
// root layout, credentials, or production authentication initialization.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(process.argv[2] ?? '');
if (!process.argv[2] || target === source || target.startsWith(source + sep)) throw new Error('Supply a separate existing Sites checkout.');
const manifest = JSON.parse(readFileSync(resolve(target, '.openai/hosting.json'), 'utf8'));
if (manifest.project_id !== 'appgprj_6abd679629688191ae2eea6173fb2b49' || manifest.static?.directory !== 'out') throw new Error('Unexpected review Site.');
const pending = ['components/foundation/FoundationPreview.tsx', 'components/map-preview/MapPreview.tsx', 'components/onboarding/Preview.tsx'];
const copied = new Set();
function allowed(path) {
  // assistant.js is the reviewed, pure diagnostic guard, not the assistant API.
  // Shared components now import production context/read helpers. Copy their
  // definitions, never mount ProductionApp, AuthInitializer or live route shells.
  const sharedProduction = ['ProductionContext.tsx','ProductionLearnSheet.tsx','WeekSources.tsx','ProductionRestoreAccessFlow.tsx','ProductionAccountFlows.tsx','ProductionAlerts.tsx','ProductionPreferences.tsx','ProductionPrivacy.tsx','ProductionReadingStatus.tsx','ProductionSourceOperations.tsx','useAccountService.ts'];
  return /^(components\/(foundation|expanded|homeguard|map-preview|onboarding|ui)\/|lib\/frontend\/)/.test(path)
    || sharedProduction.some(name=>path===`components/production/${name}`)
    || ['components/stage/StageSession.tsx','components/stage/HomeEvidence.tsx','app/OnboardingScreen.tsx','lib/learnContent.js', 'lib/assistant.js', 'lib/auth.js', 'lib/supabase.js', 'public/explore/photo-sources.json'].includes(path);
}
function copy(path) {
  mkdirSync(dirname(resolve(target, path)), { recursive: true });
  copyFileSync(resolve(source, path), resolve(target, path));
}
while (pending.length) {
  const path = pending.pop();
  if (copied.has(path)) continue;
  if (!allowed(path)) throw new Error(`Unreviewed dependency: ${path}`);
  copied.add(path);
  const content = readFileSync(resolve(source, path), 'utf8');
  // Include type-only dependencies for TypeScript. They do not initialize a live
  // runtime; browser tests must separately reject API/auth/provider requests.
  if (/\.(tsx?|jsx?)$/.test(path)) for (const match of content.matchAll(/(?:from\s*|import\s*\(?\s*)['"]([^'"]+)['"]/g)) {
    const spec = match[1];
    if (!spec.startsWith('@/') && !spec.startsWith('.')) continue;
    const base = spec.startsWith('@/') ? resolve(source, spec.slice(2)) : resolve(source, dirname(path), spec);
    const dependency = [base, ...['.ts', '.tsx', '.js', '.jsx', '.css', '/index.ts', '/index.tsx'].map(suffix => base + suffix)].find(candidate => extname(candidate) && existsSync(candidate));
    if (!dependency) throw new Error(`Missing dependency: ${path} -> ${spec}`);
    pending.push(relative(source, dependency).split(sep).join('/'));
  }
  copy(path);
}
function copyTree(path) {
  for (const entry of readdirSync(resolve(source, path), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Unexpected link: ${path}/${entry.name}`);
    const next = `${path}/${entry.name}`;
    if (entry.isDirectory()) copyTree(next); else copy(next);
  }
}
copyTree('public');
for (const path of ['app/globals.css', 'app/onboarding.css', 'app/onboarding-mobile.css', 'app/foundation/preview/preview.css']) copy(path);
// Static-only short entries. Production /app and its authentication are not copied.
for (const [template,destination] of [
  ['PreviewShell.tsx.txt','components/PreviewShell.tsx'],
  ['app-page.tsx.txt','app/app/page.tsx'],
  ['tools-page.tsx.txt','app/tools/page.tsx'],
  ['legacy-layout.tsx.txt','app/foundation/preview/layout.tsx'],
]) {
  mkdirSync(dirname(resolve(target,destination)),{recursive:true});
  copyFileSync(resolve(source,'scripts/hosted-preview',template),resolve(target,destination));
}
const layoutPath=resolve(target,'app/layout.tsx');
const layout=readFileSync(layoutPath,'utf8');
if(!layout.includes("import PreviewShell from '@/components/PreviewShell'")) {
  if(!layout.includes('{children}</body>'))throw new Error('Review the retained static root layout before adding its shared preview scope.');
  writeFileSync(layoutPath,"import PreviewShell from '@/components/PreviewShell';\n"+layout.replace('{children}</body>','<PreviewShell>{children}</PreviewShell></body>'));
}
console.log(JSON.stringify({ target, modules: [...copied].sort(), wrapperPolicy: 'Retain static-only routes and root layout; verify provider wiring separately.' }, null, 2));
