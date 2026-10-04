import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HALO_TABLES, OWNED_TABLES, haloTables } from './helpers/tables.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');

// Created before the numbered migrations; 0001 only adds their cascades and policies.
const PREDATES_MIGRATIONS = ['profiles', 'daily_scores', 'home_risks', 'ucmr5_utilities'];

const sql = readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => readFileSync(path.join(MIGRATIONS, file), 'utf8').replace(/--[^\n]*/g, ''))
  .join('\n');

/** Splits on commas that are not inside parentheses or quotes. */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let quote = false;
  let start = 0;
  [...body].forEach((char, at) => {
    if (char === "'") quote = !quote;
    if (quote) return;
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(body.slice(start, at));
      start = at + 1;
    }
  });
  parts.push(body.slice(start));
  return parts.map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

const columnsOf = (text) => text.split(',').map((column) => column.trim());

/**
 * table -> { primaryKey: string[], unique: string[][], partialUnique: {name, columns, where}[], owner: string|null }
 * as the migrations define them.
 */
function parseMigrations() {
  const tables = new Map();
  const table = (name) => {
    if (!tables.has(name)) tables.set(name, { primaryKey: [], unique: [], partialUnique: [], owner: null, created: false });
    return tables.get(name);
  };

  for (const match of sql.matchAll(/create table if not exists public\.(\w+)\s*\(([\s\S]*?)\n\)\s*;/gi)) {
    const entry = table(match[1]);
    entry.created = true;
    for (const part of splitTopLevel(match[2])) {
      let found;
      if ((found = /^primary key \(([^)]*)\)/i.exec(part))) entry.primaryKey = columnsOf(found[1]);
      else if ((found = /^unique \(([^)]*)\)/i.exec(part))) entry.unique.push(columnsOf(found[1]));
      else if (/^(constraint|check|foreign key)\b/i.test(part)) continue;
      else {
        const column = part.split(' ')[0];
        if (/\bprimary key\b/i.test(part)) entry.primaryKey = [column];
        if (/\bunique\b/i.test(part)) entry.unique.push([column]);
        if (/references public\.profiles \(id\) on delete cascade/i.test(part)) entry.owner = column;
      }
    }
  }

  for (const match of sql.matchAll(/create unique index (?:if not exists )?(\w+)\s+on public\.(\w+)\s*\(([^)]*)\)(?:\s+where\s+([^;]+?))?\s*;/gi)) {
    const [, name, tableName, columnText, whereText] = match;
    const columns = columnsOf(columnText);
    const where = whereText?.replace(/\s+/g, ' ').trim();
    // "where <key column> is not null" leaves a plain unique key (NULLs never collide); any other predicate does not.
    const notNull = where && /^(\w+) is not null$/i.exec(where);
    if (!where || (notNull && columns.includes(notNull[1]))) table(tableName).unique.push(columns);
    else table(tableName).partialUnique.push({ name, columns, where });
  }

  for (const match of sql.matchAll(/alter table public\.(\w+)\s+add constraint \w+\s+foreign key \((\w+)\)\s+references (?:public\.profiles|auth\.users) \(id\) on delete cascade/gi)) {
    table(match[1]).owner = match[2];
  }
  return tables;
}

const normalizeKeys = (keys) => keys.map((key) => [...key].sort().join(',')).sort();
const normalizePartial = (keys) =>
  keys.map(({ name, columns, where }) => `${name}: (${[...columns].sort().join(',')}) where ${where}`).sort();

test('the migration parser still finds the tables it is meant to read', () => {
  const found = [...parseMigrations()].filter(([, entry]) => entry.created).map(([name]) => name).sort();
  assert.deepEqual(found, [
    'alerts', 'assistant_corpus', 'home_contexts', 'household_bands', 'learn_content', 'map_layers', 'notification_prefs',
    'push_subscriptions', 'symptom_logs', 'volunteer_orgs', 'water_snapshots',
  ]);
});

test('declared keys, unique constraints and cascades match the migrations for every table they create', () => {
  for (const [name, entry] of parseMigrations()) {
    if (!entry.created) continue;
    const declared = HALO_TABLES[name];
    assert.ok(declared, `${name} is created by a migration but not declared in test/helpers/tables.mjs`);
    assert.deepEqual([...[].concat(declared.primaryKey ?? [])].sort(), [...entry.primaryKey].sort(), `${name}: primary key`);
    assert.deepEqual(normalizeKeys(declared.unique ?? []), normalizeKeys(entry.unique), `${name}: unique constraints`);
    assert.deepEqual(normalizePartial(declared.partialUnique ?? []), normalizePartial(entry.partialUnique), `${name}: partial unique indexes`);
    assert.equal(declared.ownerColumn ?? null, entry.owner, `${name}: ON DELETE CASCADE from profiles`);
  }
});

test('a partial unique index is read as a plain key only when its predicate is "<key column> is not null"', () => {
  const parsed = parseMigrations();
  assert.deepEqual(parsed.get('alerts').unique, [['profile_id', 'dedupe_key']]);
  assert.deepEqual(parsed.get('alerts').partialUnique, []);
  assert.deepEqual(parsed.get('home_contexts').partialUnique, [
    { name: 'home_contexts_one_current', columns: ['profile_id'], where: 'effective_to is null' },
  ]);
});

test('the pre-existing tables declare exactly the cascades 0001 gives them', () => {
  const parsed = parseMigrations();
  assert.equal(parsed.get('profiles').owner, 'id'); // auth.users -> profiles
  assert.equal(parsed.get('daily_scores').owner, 'profile_id');
  assert.equal(parsed.get('home_risks').owner, 'profile_id');
  for (const name of PREDATES_MIGRATIONS) {
    assert.equal(HALO_TABLES[name].ownerColumn ?? null, parsed.get(name)?.owner ?? null, `${name}: ownerColumn`);
  }
});

test('every table the app and libs query is declared, so no test has to re-declare it', () => {
  const queried = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.m?js$/.test(entry.name)) {
        for (const match of readFileSync(full, 'utf8').matchAll(/\.from\(\s*'([a-z_0-9]+)'/g)) queried.add(match[1]);
      }
    }
  };
  walk(path.join(ROOT, 'app'));
  walk(path.join(ROOT, 'lib'));
  assert.ok(queried.size >= 12, `expected the app's tables, found ${queried.size}`);
  for (const name of queried) assert.ok(HALO_TABLES[name], `${name} is queried by the app but not declared`);
});

test('OWNED_TABLES lists every table with an owner column, and haloTables picks and validates names', () => {
  assert.deepEqual(Object.keys(OWNED_TABLES).sort(), [
    'alerts', 'daily_scores', 'home_contexts', 'home_risks', 'household_bands', 'notification_prefs', 'profiles',
    'push_subscriptions', 'symptom_logs',
  ]);
  assert.equal(OWNED_TABLES.profiles, 'id');
  assert.deepEqual(Object.keys(haloTables('alerts', 'profiles')), ['alerts', 'profiles']);
  assert.throws(() => haloTables('nope'), /no declaration for "nope"/);
});
