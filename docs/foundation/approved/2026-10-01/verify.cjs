// Read-only byte-integrity and exact-pixel comparison. No update mode exists.
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS preservation tool. */
const fs = require('node:fs');
const path = require('node:path');
const { filesManifest, hash } = require('./capture.cjs');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'sha256-manifest.json')));
const actual = filesManifest(__dirname).filter(entry => entry.path !== 'sha256-manifest.json');
if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) throw new Error('Approval archive integrity mismatch: a file was added, removed, or changed.');
console.log(`Verified ${manifest.files.length} immutable approval files.`);
const at = process.argv.indexOf('--candidate');
if (at >= 0) {
  const candidate = path.resolve(process.argv[at + 1]);
  const report = JSON.parse(fs.readFileSync(path.join(candidate, 'capture-report.json')));
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'capture-report.json')));
  if (report.failures.length) throw new Error('Candidate capture reported failures.');
  if (JSON.stringify(report.browserArguments) !== JSON.stringify(baseline.browserArguments) || report.stabilization !== baseline.stabilization) throw new Error('Browser rendering/stabilization settings differ from the baseline.');
  for (const key of ['browser', 'platform', 'architecture', 'playwrightVersion', 'fixedTime', 'timezone', 'locale', 'sceneTime', 'motion', 'viewportHeight', 'deviceScaleFactor']) {
    if (report[key] !== baseline[key]) throw new Error(`Capture environment mismatch for ${key}: ${report[key]} versus ${baseline[key]}`);
  }
  const missing = baseline.captures.filter(entry => !report.captures.some(next => next.file === entry.file));
  if (missing.length) throw new Error(`Candidate is missing ${missing.length} required captures.`);
  const mismatches = baseline.captures.filter(entry => hash(fs.readFileSync(path.join(candidate, entry.file))) !== hash(fs.readFileSync(path.join(__dirname, entry.file)))).map(entry => entry.file);
  if (mismatches.length) throw new Error(`Exact visual comparison failed for ${mismatches.length} captures:\n${mismatches.join('\n')}`);
  console.log(`All ${baseline.captures.length} screenshots are byte-identical to the approved baseline.`);
}
