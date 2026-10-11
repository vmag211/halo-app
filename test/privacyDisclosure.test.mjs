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

// ---- Cell-level validation of the personal-data inventory (the table names above are not enough) ----
const PERSONAL_COLUMNS = ['Table', 'Personal data held', 'Owner column', 'Sensitivity class', 'Free-text fields', 'Current retention', 'Deletion path', 'Export path'];
// A row may list several classes, comma separated; each must be one of these.
const SENSITIVITY_CLASSES = ['none', 'household_context', 'health_adjacent', 'location_approximate', 'credentials'];
const REQUIRED_CELLS = ['Sensitivity class', 'Current retention', 'Export path'];
const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
const joinRow = (cells) => `| ${cells.join(' | ')} |`;
function personalRows(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.startsWith('| Table | Personal data held |'));
  let end = start + 2;
  while (start >= 0 && end < lines.length && lines[end].startsWith('|')) end += 1;
  return { lines, start, end };
}
// Returns a list of problems; an empty list means every personal-data row is acceptable.
function inventoryProblems(markdown) {
  const { lines, start, end } = personalRows(markdown);
  if (start < 0) return ['the personal table header was not found'];
  const problems = [];
  if (splitRow(lines[start]).join('|') !== PERSONAL_COLUMNS.join('|')) problems.push('the personal table columns changed');
  for (const line of lines.slice(start + 2, end)) {
    const cells = splitRow(line);
    if (cells.length !== PERSONAL_COLUMNS.length) {
      problems.push(`${cells[0]}: ${cells.length} cells, expected ${PERSONAL_COLUMNS.length}`);
      continue;
    }
    const [name] = cells;
    for (const column of REQUIRED_CELLS) {
      if (!cells[PERSONAL_COLUMNS.indexOf(column)]) problems.push(`${name}: the ${column} cell is empty`);
    }
    const classes = cells[PERSONAL_COLUMNS.indexOf('Sensitivity class')].split(',').map((item) => item.trim()).filter(Boolean);
    for (const item of classes) {
      if (!SENSITIVITY_CLASSES.includes(item)) problems.push(`${name}: sensitivity class "${item}" is not one of ${SENSITIVITY_CLASSES.join(', ')}`);
    }
    if (classes.length > 1 && classes.includes('none')) problems.push(`${name}: sensitivity class none cannot be combined with another class`);
    if (new Set(classes).size !== classes.length) problems.push(`${name}: a sensitivity class is listed twice`);
  }
  // Public reference tables carry one class for the whole section, declared in its intro.
  if (!markdown.includes('Sensitivity class: `none`')) problems.push('the public reference section no longer declares sensitivity class none');
  const publicStart = lines.findIndex((line) => line.startsWith('| Table | Contents and text |'));
  if (publicStart < 0) problems.push('the public reference table header was not found');
  for (let index = publicStart + 2; publicStart >= 0 && index < lines.length && lines[index].startsWith('|'); index += 1) {
    const cells = splitRow(lines[index]);
    if (cells.length !== 3 || cells.some((cell) => !cell)) problems.push(`${cells[0]}: a public reference row needs three non-empty cells`);
  }
  return problems;
}
// `column` is a personal-table column name, or a cell position for the public reference table.
function withCell(markdown, table, column, value) {
  const lines = markdown.split('\n');
  const index = lines.findIndex((line) => line.startsWith(`| \`${table}\` |`));
  assert.ok(index >= 0, `${table} row not found`);
  const cells = splitRow(lines[index]);
  cells[typeof column === 'number' ? column : PERSONAL_COLUMNS.indexOf(column)] = value;
  lines[index] = joinRow(cells);
  return lines.join('\n');
}
test('the personal-data inventory has valid cells in every row', () => {
  assert.deepEqual(inventoryProblems(disclosure), []);
});
test('the personal-data validation rejects a junk class, an empty retention or export cell and a malformed row', () => {
  const messages = (markdown) => inventoryProblems(markdown).join('\n');
  assert.match(messages(withCell(disclosure, 'public.notification_prefs', 'Sensitivity class', 'banana')), /notification_prefs.*banana/);
  assert.match(messages(withCell(disclosure, 'public.profiles', 'Sensitivity class', 'location_approximate, banana')), /profiles.*banana/);
  assert.match(messages(withCell(disclosure, 'public.profiles', 'Sensitivity class', 'none, household_context')), /profiles.*none/);
  assert.match(messages(withCell(disclosure, 'public.profiles', 'Sensitivity class', '')), /profiles.*class/);
  assert.match(messages(withCell(disclosure, 'public.symptom_logs', 'Current retention', '')), /symptom_logs.*retention/i);
  assert.match(messages(withCell(disclosure, 'public.symptom_logs', 'Export path', '  ')), /symptom_logs.*export/i);
  const junk = disclosure.replace('| `public.home_contexts` |', '| `public.junk` | x | y | banana | | | | |\n| `public.home_contexts` |');
  assert.match(messages(junk), /junk.*banana/);
  assert.match(messages(disclosure.replace('| `public.home_contexts` |', '| `public.short` | x | y |\n| `public.home_contexts` |')), /short.*3 cells/);
  assert.match(messages(withCell(disclosure, 'public.learn_content', 2, '')), /learn_content.*non-empty/);
  assert.match(messages(disclosure.replace('Sensitivity class: `none`', 'Sensitivity class: unknown')), /public reference section/);
});
