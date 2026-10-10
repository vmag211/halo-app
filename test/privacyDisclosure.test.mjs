import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const disclosure = await readFile(new URL('docs/backend/privacy-and-retention.md', root), 'utf8');
function createdTables(sql) {
  // Strip comments first so an example cannot silently satisfy the inventory.
  const statements = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
  return [...statements.matchAll(/\bcreate\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?((?:"?[\w]+"?\.)?"?[\w]+"?)/gi)]
    .map((match) => { const name = match[1].replaceAll('"', '').toLowerCase(); return name.includes('.') ? name : `public.${name}`; });
}
test('every migrated or reconstructed table has an explicit privacy inventory row', async () => {
  const directory = new URL('supabase/migrations/', root);
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
  const tables = new Set();
  for (const url of [new URL('supabase/baseline/reconstructed_baseline.sql', root), ...files.map((file) => new URL(file, directory))]) {
    for (const table of createdTables(await readFile(url, 'utf8'))) tables.add(table);
  }
  assert.ok(tables.size >= 16, 'include the baseline, personal and public reference tables');
  const inventoried = new Set([...disclosure.matchAll(/^\| `((?:public|auth)\.[a-z0-9_]+)` \|/gm)].map((match) => match[1]));
  assert.deepEqual([...tables].filter((table) => !inventoried.has(table)), []);
  assert.deepEqual([...inventoried].filter((table) => !tables.has(table)), []);
});
test('table scanner handles qualified, quoted and unqualified table definitions, not comments', () => {
  assert.deepEqual(createdTables('-- create table ignored (id int);\nCREATE TABLE IF NOT EXISTS "public"."future_uploads" (id uuid);\ncreate table new_records (id int);\n/* create table also_ignored (id int); */'), ['public.future_uploads', 'public.new_records']);
});
