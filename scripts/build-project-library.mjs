#!/usr/bin/env node
/**
 * Builds lib/data/exploreProjectLibrary.json, the curated project library the
 * Explore project routes select from (B16 plan, docs/backend/plans/b16-explore-projects.md).
 *
 *   node scripts/build-project-library.mjs           write the library
 *   node scripts/build-project-library.mjs --check   exit 1 if the committed file differs
 *
 * WHERE THE CONTENT COMES FROM. The guides are the reviewed, source-backed
 * adaptations in lib/frontend/explore-project-guides.ts (their materials,
 * steps, constraints, completion and follow-up were written from the named
 * official public pages, each source with the date it was checked). This
 * script does not write advice. It only:
 *
 *   1. keeps the guides listed in KEPT (two are left out, see EXCLUDED),
 *      under the backend ids KEPT gives them;
 *   2. applies REWORDS, a fixed list of exact phrase changes that remove the
 *      word "safe" (and "safely") wherever the text could read as a claim.
 *      Every reword must match at least once, so a change to the frontend
 *      text fails the build instead of silently skipping it;
 *   3. gives every step a stable id (a slug of its title, unique in its guide)
 *      and every guide the library version;
 *   4. records, per project, every source: publisher, title, URL and the date
 *      it was checked against the text;
 *   5. checks the result: the client's own validProjectGuide, HTTPS sources
 *      from an official publisher, no U+2014, and no "safe" or "safely".
 *
 * test/projectLibrary.test.mjs rebuilds the library in memory and fails if the
 * committed file differs, so an edit to the frontend guides must be rebuilt
 * (and reviewed) here before the server serves it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LIBRARY_FILE = path.join(ROOT, 'lib/data/exploreProjectLibrary.json');
const GUIDES_FILE = 'lib/frontend/explore-project-guides.ts';

/** The version every guide in this build carries. Bump it whenever the output changes. */
export const LIBRARY_VERSION = '2026-10-20.1';

/** Publishers accepted as official public guidance (federal agencies and land-grant extension services). */
export const OFFICIAL_PUBLISHERS = Object.freeze([
  'US EPA',
  'NC State Extension',
  'NASA',
  'NASA Earth Observatory',
  'US Fish and Wildlife Service',
  'University of Minnesota Extension',
]);

/**
 * Frontend guide id -> backend id, with the fit the selection uses. `spaces`,
 * `mode`, `start`, `budget`, `topic`, `group` and `requires` are the preview's
 * reviewed fit (lib/frontend/explore-personalization.ts, familyFit), with
 * preview-only wording removed. `ongoing` marks guides that suit an ongoing
 * time choice (the preview's own list).
 */
export const KEPT = Object.freeze({
  'demo-habitat-project': { id: 'native-pollinator-space', spaces: ['yard', 'community'], mode: 'either', start: 'half-day', budget: 'quote', ongoing: true, topic: ['plant', 'native', 'pollinator', 'garden', 'flower'], group: 'habitat', requires: 'Confirm permitted ground space, plants and establishment care.' },
  'bee-house': { id: 'bee-house', spaces: ['yard', 'balcony', 'community'], mode: 'either', start: 'half-day', budget: 'quote', ongoing: true, topic: ['bee', 'build', 'habitat', 'pollinator'], group: 'build', requires: 'Adult tool supervision, suitable mounting and seasonal nest maintenance are required.' },
  'solar-oven': { id: 'solar-oven', spaces: ['yard', 'balcony', 'community'], mode: 'either', start: 'half-day', budget: 'low', ongoing: false, topic: ['solar', 'energy', 'experiment', 'build', 'fun'], group: 'learning', requires: 'A permitted sunny test space, a suitable thermometer and adult supervision are required.' },
  'demo-water-project': { id: 'water-report-check', spaces: ['indoors', 'balcony', 'yard', 'community'], mode: 'solo', start: 'quick', budget: 'reuse', ongoing: false, topic: ['water', 'report', 'testing', 'pfas', 'lead'], group: 'home' },
  'balcony-pollinators': { id: 'balcony-pollinators', spaces: ['balcony', 'yard'], mode: 'solo', start: 'quick', budget: 'quote', ongoing: true, topic: ['balcony', 'container', 'small', 'plant', 'pollinator'], group: 'habitat', requires: 'Confirm permission, container placement and load limits.' },
  'native-tree': { id: 'native-tree', spaces: ['yard', 'community'], mode: 'either', start: 'half-day', budget: 'quote', ongoing: true, topic: ['tree', 'native', 'habitat', 'plant'], group: 'habitat', requires: 'Confirm mature root and canopy space, utilities, permission and establishment care.' },
  'winter-habitat': { id: 'winter-habitat', spaces: ['yard', 'community'], mode: 'solo', start: 'quick', budget: 'reuse', ongoing: true, topic: ['winter', 'leaves', 'habitat', 'season', 'native'], group: 'habitat', requires: 'Keep paths, drains and local fire-clearance areas clear.' },
  'home-compost': { id: 'home-compost', spaces: ['indoors', 'balcony', 'yard', 'community'], mode: 'either', start: 'quick', budget: 'quote', ongoing: true, topic: ['compost', 'scraps', 'waste', 'worms'], group: 'waste', requires: 'Choose and maintain the method that fits your space; a collection program must be verified.' },
  'rain-garden-plan': { id: 'rain-garden-plan', spaces: ['yard'], mode: 'solo', start: 'quick', budget: 'reuse', ongoing: false, topic: ['rain', 'runoff', 'drainage', 'water', 'garden'], group: 'water', requires: 'This is a site-planning project, not permission to dig or alter drainage.' },
  'rain-barrel': { id: 'rain-barrel', spaces: ['yard'], mode: 'either', start: 'quick', budget: 'quote', ongoing: true, topic: ['rain', 'barrel', 'water', 'ornamental'], group: 'water', requires: 'Confirm collection rules, stable installation and non-edible ornamental use.' },
  'garden-water': { id: 'garden-water', spaces: ['yard', 'balcony', 'community'], mode: 'solo', start: 'quick', budget: 'reuse', ongoing: true, topic: ['watering', 'irrigation', 'water', 'garden'], group: 'water', requires: 'Resolve the actual garden-water source and the watering instructions that apply.' },
  'home-leak-check': { id: 'home-leak-check', spaces: ['indoors', 'balcony', 'yard', 'community'], mode: 'solo', start: 'quick', budget: 'reuse', ongoing: false, topic: ['leak', 'water', 'toilet', 'maintenance'], group: 'home' },
  'soil-test-plan': { id: 'soil-test-plan', spaces: ['indoors', 'balcony', 'yard', 'community'], mode: 'solo', start: 'quick', budget: 'reuse', ongoing: false, topic: ['soil', 'test', 'garden', 'lab'], group: 'learning' },
  'food-waste-week': { id: 'food-waste-week', spaces: ['indoors', 'balcony', 'yard', 'community'], mode: 'solo', start: 'quick', budget: 'reuse', ongoing: false, topic: ['food', 'waste', 'kitchen', 'scraps'], group: 'waste' },
  'moisture-check': { id: 'moisture-check', spaces: ['indoors', 'balcony', 'yard', 'community'], mode: 'solo', start: 'quick', budget: 'reuse', ongoing: false, topic: ['moisture', 'humidity', 'condensation', 'damp', 'mold'], group: 'home' },
  'filter-check': { id: 'filter-check', spaces: ['indoors', 'balcony', 'yard', 'community'], mode: 'solo', start: 'quick', budget: 'reuse', ongoing: false, topic: ['filter', 'pfas', 'water', 'maintenance'], group: 'home' },
  'air-cleaner-plan': { id: 'air-cleaner-plan', spaces: ['indoors', 'balcony', 'yard', 'community'], mode: 'either', start: 'half-day', budget: 'quote', ongoing: false, topic: ['air', 'particle', 'smoke', 'filter', 'build'], group: 'build', requires: 'Use the exact reviewed electrical and equipment requirements. No smoke or indoor condition is inferred.' },
});

/** Frontend guides left out of the server library, with the reason (B16 Ruling J4). */
export const EXCLUDED = Object.freeze({
  'community-cleanup': 'Built on one city\'s supply program (City of Charlotte); a household elsewhere would be sent to a program that does not serve it.',
  'community-garden': 'Built on one county\'s program example (Mecklenburg County Park and Recreation), which its own text says is not a local match for most households.',
});

/** Exact phrase changes, applied to every string of a kept guide (step 2 above). */
export const REWORDS = Object.freeze([
  ['It cannot establish that food is safe to eat or water is disinfected.', 'It cannot establish whether food can be eaten or water is disinfected.'],
  ['Do not infer contamination or safe water from appearance', 'Do not infer contamination, or its absence, from appearance'],
  ['safe container placement', 'secure container placement'],
  ['safe placement', 'secure placement'],
  ['Leave enough room to move safely.', 'Leave clear room to move around them.'],
  ['Stop if the tree cannot be moved safely.', 'Stop and get help if the tree is too heavy or awkward to move.'],
  ['Choose a safe, permitted corner', 'Choose a permitted corner clear of hazards'],
  ['From a safe position', 'From stable footing'],
  ['from a safe position', 'from stable footing'],
  ['Resolve safe support and overflow', 'Resolve stable support and overflow'],
  ['with safe access to fixtures', 'with easy access to fixtures'],
  ['a safe way to handle the tank lid', 'a careful way to handle the tank lid'],
  ['With safe help for the lid and permission', 'With help lifting the lid and permission'],
  ['Follow safe storage instructions', 'Follow the source’s storage instructions'],
  ['Safe food-storage instructions', 'Food-storage instructions from the source'],
  ['A safely accessible room', 'An easily accessible room'],
  ['Follow safe existing ventilation and equipment instructions.', 'Follow the existing ventilation and equipment instructions.'],
  ['A safe indoor space', 'A suitable indoor space'],
  ['reviewed and safely set up', 'reviewed and set up following its safety instructions'],
]);

/** The word the library never uses (B16 Ruling J3): "safe" and its adverb and comparatives. "Safety" and "unsafe" stay. */
export const SAFE_WORD = /\bsafe(ly|r|st)?\b/i;

// --- A minimal in-memory TypeScript loader (the test loader's approach) ---
const compiled = new Map();
function moduleUrl(filename) {
  if (compiled.has(filename)) return compiled.get(filename);
  let source = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  source = source.replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, (_m, before, relative, after) =>
    `${before}${moduleUrl(path.resolve(path.dirname(filename), `${relative}.ts`))}${after}`);
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  compiled.set(filename, url);
  return url;
}
const loadTs = (relative) => import(moduleUrl(path.join(ROOT, relative)));

const slug = (text) => text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'step';

function strings(value, visit) {
  if (typeof value === 'string') return visit(value);
  if (Array.isArray(value)) return value.map((item) => strings(item, visit));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, strings(item, visit)]));
  return value;
}

/** The library, built in memory. Throws on any check that fails. */
export async function buildLibrary() {
  const { projectGuides } = await loadTs(GUIDES_FILE);
  const { validProjectGuide, safeSourceUrl } = await loadTs('lib/frontend/production/explore-service.ts');
  const known = new Set(projectGuides.map((guide) => guide.id));
  for (const id of [...Object.keys(KEPT), ...Object.keys(EXCLUDED)]) if (!known.has(id)) throw new Error(`build-project-library: ${id} is not in ${GUIDES_FILE}`);
  const unplaced = [...known].filter((id) => !Object.hasOwn(KEPT, id) && !Object.hasOwn(EXCLUDED, id));
  if (unplaced.length) throw new Error(`build-project-library: place these guides in KEPT or EXCLUDED: ${unplaced.join(', ')}`);

  const used = new Map(REWORDS.map(([from]) => [from, 0]));
  const projects = [];
  for (const source of projectGuides) {
    const fit = KEPT[source.id];
    if (!fit) continue;
    const reworded = strings(source, (text) => {
      let next = text;
      for (const [from, to] of REWORDS) {
        if (next.includes(from)) { used.set(from, used.get(from) + next.split(from).length - 1); next = next.split(from).join(to); }
      }
      return next;
    });
    const ids = new Set();
    const steps = reworded.steps.map((step) => {
      let id = slug(step.title);
      for (let n = 2; ids.has(id); n += 1) id = `${slug(step.title)}-${n}`;
      ids.add(id);
      return { id, ...step };
    });
    const guide = { ...reworded, id: fit.id, version: LIBRARY_VERSION, steps };
    const fitOnly = { ...fit };
    delete fitOnly.id;
    projects.push({ guide, fit: { ...fitOnly, requires: fit.requires ?? null }, frontendId: source.id });
  }
  for (const [from, count] of used) if (!count) throw new Error(`build-project-library: the reword "${from}" no longer matches; review the frontend text`);

  const problems = [];
  for (const { guide } of projects) {
    if (!validProjectGuide(guide)) problems.push(`${guide.id}: fails validProjectGuide`);
    for (const source of guide.sources) {
      if (!safeSourceUrl(source.url)) problems.push(`${guide.id}: source ${source.id} is not an HTTPS URL`);
      if (!OFFICIAL_PUBLISHERS.includes(source.publisher)) problems.push(`${guide.id}: ${source.publisher} is not an official publisher`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(source.checked)) problems.push(`${guide.id}: source ${source.id} has no checked date`);
    }
    const text = JSON.stringify(guide);
    if (text.includes('—')) problems.push(`${guide.id}: contains U+2014`);
    if (SAFE_WORD.test(text)) problems.push(`${guide.id}: uses "${text.match(SAFE_WORD)[0]}"`);
  }
  if (new Set(projects.map(({ guide }) => guide.id)).size !== projects.length) problems.push('duplicate backend ids');
  if (problems.length) throw new Error(`build-project-library:\n  ${problems.join('\n  ')}`);

  return {
    version: LIBRARY_VERSION,
    builtFrom: GUIDES_FILE,
    note: 'Generated by scripts/build-project-library.mjs. Do not edit by hand.',
    excluded: Object.entries(EXCLUDED).map(([id, reason]) => ({ id, reason })),
    rewords: REWORDS.map(([from, to]) => ({ from, to })),
    projects: projects.map(({ guide, fit, frontendId }) => ({
      id: guide.id,
      frontendId,
      sources: guide.sources.map(({ id, publisher, title, url, checked }) => ({ id, publisher, title, url, checked })),
      fit,
      guide,
    })),
  };
}

export const serialize = (library) => `${JSON.stringify(library, null, 2)}\n`;

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const text = serialize(await buildLibrary());
  if (process.argv.includes('--check')) {
    const current = (() => { try { return readFileSync(LIBRARY_FILE, 'utf8'); } catch { return ''; } })();
    if (current !== text) { console.error('lib/data/exploreProjectLibrary.json is out of date: run node scripts/build-project-library.mjs'); process.exit(1); }
    console.log('project library is current');
  } else {
    writeFileSync(LIBRARY_FILE, text);
    const library = JSON.parse(text);
    console.log(`wrote ${library.projects.length} projects to ${path.relative(ROOT, LIBRARY_FILE)}`);
  }
}
