// node check-integrity.cjs --write creates a reviewed archive manifest.
// node check-integrity.cjs verifies it without changing any files.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const manifestPath = path.join(__dirname, 'sha256-manifest.json');
const hash = (filename) => createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    const filename = path.join(directory, item.name);
    return item.isDirectory() ? walk(filename) : [filename];
  });
}
if (process.argv.includes('--write')) {
  const files = [...walk(__dirname), ...walk(path.join(root, 'reference'))]
    .filter((filename) => filename !== manifestPath)
    .sort()
    .map((filename) => ({
      path: path.relative(root, filename).replaceAll('\\', '/'),
      bytes: fs.statSync(filename).size,
      sha256: hash(filename),
    }));
  fs.writeFileSync(manifestPath, JSON.stringify({ algorithm: 'SHA-256', files }, null, 2) + '\n');
  console.log(`Wrote ${files.length} preserved file checksums.`);
} else {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const entry of manifest.files) {
    const filename = path.join(root, entry.path);
    if (!fs.existsSync(filename) || hash(filename) !== entry.sha256) throw new Error(`Preservation mismatch: ${entry.path}`);
  }
  console.log(`Verified ${manifest.files.length} preserved files. No changes detected.`);
}
