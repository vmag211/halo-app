// Compile the small TypeScript domain modules in memory, without a new runner
// dependency or generated files. Production bundling remains Next.js's job.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const compiled = new Map();
function moduleUrl(filename) {
  if (compiled.has(filename)) return compiled.get(filename);
  let source = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  source = source.replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, (_match, before, relative, after) => {
    const dependency = path.resolve(path.dirname(filename), `${relative}.ts`);
    return `${before}${moduleUrl(dependency)}${after}`;
  });
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  compiled.set(filename, url);
  return url;
}
export function loadFrontend(name) {
  return import(moduleUrl(fileURLToPath(new URL(`../lib/frontend/${name}.ts`, import.meta.url))));
}
export function memoryStorage() {
  const values = new Map();
  return { get length() { return values.size; }, key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: (key) => values.delete(key), values };
}
