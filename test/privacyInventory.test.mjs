/**
 * lib/privacyInventory.js, the structural guards (B07 plan, Rulings P2, P5,
 * P6, P12 and P13; Vibhav's D-P1, D-P2, D-P4 and D-P5).
 *
 *   1. Pure: the inventory places every table of OWNED_TABLES plus auth.users,
 *      each for export (a group or an exclusion with a reason) and for both
 *      clears (an action, and a reason for every keep); its tiers are
 *      consistent; no denied column and no secret-named column without a
 *      reasoned exception is exported; Clear Journal removes exactly what the
 *      journal group exports.
 *   2. Catalog: against the live PGlite schema (the baseline plus every
 *      migration), the owned tables are exactly the tables that reach
 *      auth.users through foreign keys; every column of every owned table is
 *      exported or withheld; every `profiles` column is reset or kept, and the
 *      reset values are the columns' own defaults; the optional columns are
 *      the ones a later migration adds; a table named like a journal is in
 *      the journal clear (P13's tripwire).
 *   3. Negative controls: each guard is shown to fail on a copy of the
 *      inventory, OWNED_TABLES or the catalog with the defect it exists to
 *      catch.
 *   4. The helpers the export, inspect and clear code use.
 *
 * Every guard is a function returning a list of problems, so the real
 * inventory is asserted to produce none and each negative control to produce
 * the expected one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDb, listMigrations } from './db/pgliteHarness.mjs';
import { OWNED_TABLES } from './helpers/tables.mjs';
import {
  BASE_META_KEYS,
  CLEAR_ACTIONS,
  CLEAR_SCOPES,
  EXPORT_GROUPS,
  FINGERPRINT_TABLES,
  INVENTORY_COPY,
  OWN_OPERATION,
  PRIVACY_INVENTORY,
  PRIVATE_META_KEYS,
  PRIVATE_ONLY_GROUPS,
  PROFILE_KEPT_COLUMNS,
  PROFILE_RESET_COLUMNS,
  SECRET_NAME_EXCEPTIONS,
  UNSTORED_RECORDS,
  clearActionFor,
  columnsFor,
  exportParts,
  fingerprintTables,
  groupsFor,
  projectRow,
  tablesFor,
} from '../lib/privacyInventory.js';

const EM_DASH = String.fromCharCode(0x2014);
const AUTH_USERS = 'auth.users';

/**
 * Columns no allowlist may ever name (P12), with no exception possible:
 * credentials, the ledger's internals, legacy exact location, provider
 * payloads and internal idempotency keys. Plus any `*_hash` (checked below).
 */
const DENIED_EXPORT_COLUMNS = Object.freeze([
  'endpoint', 'p256dh', 'auth', 'request_hash', 'result', 'address', 'zip', 'onboard_request_id',
  'details', 'client_message_id', 'dedupe_key',
]);

/**
 * Names that look like a secret or identity material. An exported column
 * matching one needs an entry in SECRET_NAME_EXCEPTIONS with its reason.
 * Substrings for words that never appear innocently inside another word;
 * whole underscore-separated words for the short ones (`auth`, `key`, `ip`,
 * `code`), plurals included (`keys`, as in `api_keys` or `push_keys`).
 */
const SECRET_SUBSTRINGS = [
  'token', 'hash', 'secret', 'passw', 'p256dh', 'endpoint', 'nonce', 'credential', 'signature', 'cookie', 'jwt',
  'fingerprint', 'email', 'challenge', 'apikey', 'verifier', 'digest', 'cipher', 'encrypted', 'user_agent',
];
const SECRET_WORDS = ['auth', 'key', 'keys', 'salt', 'otp', 'session', 'ip', 'pin', 'private', 'request', 'code'];
function secretNamed(column) {
  const name = column.toLowerCase();
  return SECRET_SUBSTRINGS.some((part) => name.includes(part)) || name.split('_').some((word) => SECRET_WORDS.includes(word));
}

const isReason = (value) => typeof value === 'string' && value.trim().length > 0;
const clone = (value) => structuredClone(value);

/** Every column a table's parts export, in either tier. */
function exportedColumns(entry) {
  const columns = new Set();
  for (const part of entry.export.parts ?? []) for (const column of [...part.base, ...part.private]) columns.add(column);
  return columns;
}

/** Every string anywhere inside a value. */
function stringsIn(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object') for (const inner of Object.values(value)) stringsIn(inner, out);
  return out;
}

const sameWhere = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The filters of a `where`: none (every row), one, or several that must all hold. */
const filtersOf = (where) => (where == null ? [] : Array.isArray(where) ? where : [where]);

/** A well formed filter: a column and exactly one of equals, notEquals or a non-empty `in`. */
function filterProblem(filter) {
  if (!filter || typeof filter !== 'object' || typeof filter.column !== 'string' || !filter.column) return 'a filter without a column';
  const tests = ['equals', 'notEquals', 'in'].filter((name) => Object.hasOwn(filter, name));
  if (tests.length !== 1) return `a filter on ${filter.column} without exactly one test`;
  if (tests[0] === 'in' && !(Array.isArray(filter.in) && filter.in.length)) return `an empty in filter on ${filter.column}`;
  return null;
}

/**
 * Whether two filters can never both hold for one row. False whenever that
 * cannot be shown from the filters alone: different columns, or two
 * notEquals, which always leave rows in common.
 */
function filtersExclude(a, b) {
  if (a.column !== b.column) return false;
  const values = (f) => (Object.hasOwn(f, 'equals') ? { only: [f.equals] } : Object.hasOwn(f, 'in') ? { only: [...f.in] } : { not: [f.notEquals] });
  const x = values(a);
  const y = values(b);
  if (x.only && y.only) return !x.only.some((value) => y.only.includes(value));
  if (x.only && y.not) return x.only.every((value) => y.not.includes(value));
  if (x.not && y.only) return y.only.every((value) => x.not.includes(value));
  return false;
}

/** Two parts cover disjoint rows when some filter of one excludes some filter of the other. */
const partsDisjoint = (a, b) => filtersOf(a.where).some((fa) => filtersOf(b.where).some((fb) => filtersExclude(fa, fb)));

/**
 * The rows guard (Task 2 review, finding 1). Within one table, two parts that
 * may cover the same rows must export no column in common (a part split by
 * columns, like the profile's home and preferences parts, is fine), and above
 * all no column may be private in one and base in the other: that is how
 * journal-derived season-summary text would reach an export without private
 * text.
 */
function partRowProblems(table, parts) {
  const problems = [];
  for (let i = 0; i < parts.length; i += 1) {
    for (let j = i + 1; j < parts.length; j += 1) {
      const [a, b] = [parts[i], parts[j]];
      if (partsDisjoint(a, b)) continue;
      const columnsA = [...a.base, ...a.private];
      const shared = [...b.base, ...b.private].filter((column) => columnsA.includes(column));
      if (shared.length) problems.push(`${table}: parts ${a.group} and ${b.group} may cover the same rows and both export ${shared.join(', ')}`);
      const crossed = [...a.private.filter((column) => b.base.includes(column)), ...b.private.filter((column) => a.base.includes(column))];
      if (crossed.length) problems.push(`${table}: ${crossed.join(', ')} private in one part and base in an overlapping sibling`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The pure guard
// ---------------------------------------------------------------------------

function inventoryProblems({
  inventory = PRIVACY_INVENTORY,
  ownedTables = OWNED_TABLES,
  resetColumns = PROFILE_RESET_COLUMNS,
  keptColumns = PROFILE_KEPT_COLUMNS,
  exceptions = SECRET_NAME_EXCEPTIONS,
  fingerprint = FINGERPRINT_TABLES,
} = {}) {
  const problems = [];
  const expected = new Set([...Object.keys(ownedTables), AUTH_USERS]);
  for (const table of expected) if (!Object.hasOwn(inventory, table)) problems.push(`${table}: not placed in the privacy inventory`);
  for (const table of Object.keys(inventory)) if (!expected.has(table)) problems.push(`${table}: in the inventory but not an owned table`);

  const usedExceptions = new Set();
  const groupsWithParts = new Set();
  for (const [table, entry] of Object.entries(inventory)) {
    const owner = table === AUTH_USERS ? 'id' : ownedTables[table];
    if (owner !== undefined && entry.owner !== owner) problems.push(`${table}: owner is ${entry.owner}, OWNED_TABLES says ${owner}`);

    // Export placement.
    const { export: placement } = entry;
    if (!placement || typeof placement !== 'object') {
      problems.push(`${table}: no export placement`);
      continue;
    }
    const excluded = Object.hasOwn(placement, 'excluded');
    if (excluded && !isReason(placement.excluded)) problems.push(`${table}: excluded from export without a reason`);
    if (excluded && placement.parts) problems.push(`${table}: both excluded and exported`);
    if (!excluded && !(Array.isArray(placement.parts) && placement.parts.length > 0)) problems.push(`${table}: neither exported nor excluded`);
    const exported = exportedColumns(entry);
    for (const part of placement.parts ?? []) {
      if (!EXPORT_GROUPS.includes(part.group)) problems.push(`${table}: unknown export group ${part.group}`);
      groupsWithParts.add(part.group);
      if (!Array.isArray(part.base) || !Array.isArray(part.private)) {
        problems.push(`${table}: a part without base and private tiers`);
        continue;
      }
      const both = part.base.filter((column) => part.private.includes(column));
      if (both.length) problems.push(`${table}: ${both.join(', ')} in both tiers`);
      const columns = [...part.base, ...part.private];
      if (new Set(columns).size !== columns.length) problems.push(`${table}: a column repeated in one part`);
      const counted = Boolean(part.countAs || part.countOnly);
      if (counted && columns.length) problems.push(`${table}: a count-only part also names columns`);
      if (!counted && !columns.length) problems.push(`${table}: a part that exports nothing`);
      if (part.countOnly && !isReason(part.warning)) problems.push(`${table}: a count-only part without a warning`);
      if (PRIVATE_ONLY_GROUPS.includes(part.group) && (part.base.length || counted)) {
        problems.push(`${table}: exported in ${part.group} without private text`);
      }
      if (Object.hasOwn(part, 'privateKeys')) problems.push(`${table}: privateKeys is a denylist; name the base keys instead (baseKeys)`);
      for (const [column, keys] of Object.entries(part.baseKeys ?? {})) {
        if (!part.base.includes(column)) problems.push(`${table}: base keys of ${column}, which the base tier does not export`);
        if (!Array.isArray(keys) || !keys.length) problems.push(`${table}: empty base keys for ${column}`);
      }
      for (const column of part.rounded ?? []) if (!columns.includes(column)) problems.push(`${table}: rounds ${column}, which it does not export`);
      for (const filter of filtersOf(part.where)) {
        const malformed = filterProblem(filter);
        if (malformed) problems.push(`${table}: ${malformed}`);
        else if (!columns.includes(filter.column) && columns.length) problems.push(`${table}: filters on ${filter.column} without exporting it`);
      }
    }
    problems.push(...partRowProblems(table, (placement.parts ?? []).filter((part) => Array.isArray(part.base) && Array.isArray(part.private))));
    if (placement.withheldAll !== undefined && !isReason(placement.withheldAll)) problems.push(`${table}: withheldAll without a reason`);
    for (const [column, reason] of Object.entries(placement.withheld ?? {})) {
      if (!isReason(reason)) problems.push(`${table}.${column}: withheld without a reason`);
      if (exported.has(column)) problems.push(`${table}.${column}: both exported and withheld`);
    }
    for (const [column, migration] of Object.entries(placement.optional ?? {})) {
      if (!exported.has(column)) problems.push(`${table}.${column}: optional but not exported`);
      if (!Number.isInteger(migration) || migration < 1) problems.push(`${table}.${column}: optional without the migration that adds it`);
    }
    if (exported.has(entry.owner)) problems.push(`${table}.${entry.owner}: the owner column is exported`);
    if (exported.has('profile_id')) problems.push(`${table}.profile_id: exported`);
    for (const column of exported) {
      if (DENIED_EXPORT_COLUMNS.includes(column) || column.endsWith('_hash')) problems.push(`${table}.${column}: a denied column is exported`);
      if (secretNamed(column)) {
        const key = `${table}.${column}`;
        if (isReason(exceptions[key])) usedExceptions.add(key);
        else problems.push(`${key}: named like a secret and exported without a reasoned exception`);
      }
    }

    // Clear placement, both scopes.
    for (const scope of CLEAR_SCOPES) {
      const action = entry.clear?.[scope];
      if (!action || !CLEAR_ACTIONS.includes(action.action)) {
        problems.push(`${table}: no clear action for ${scope}`);
        continue;
      }
      if (action.action === 'keep' && !isReason(action.reason)) problems.push(`${table}: kept by clear ${scope} without a reason`);
      if (action.action === 'delete-filtered' && (!filtersOf(action.where).length || !isReason(action.reason))) {
        problems.push(`${table}: a filtered clear ${scope} without its filter and reason`);
      }
      for (const filter of [...filtersOf(action.where), ...filtersOf(action.refuseWhen?.where)]) {
        const malformed = filterProblem(filter);
        if (malformed) problems.push(`${table}: clear ${scope}: ${malformed}`);
      }
      if (action.refuseWhen !== undefined) {
        if (action.action !== 'delete-filtered') problems.push(`${table}: clear ${scope} refuses, but is not a filtered delete`);
        if (!filtersOf(action.refuseWhen.where).length || !/^HALO_[A-Z_]+$/.test(action.refuseWhen.refusal ?? '')) {
          problems.push(`${table}: clear ${scope} refuses without its filter and refusal code`);
        }
      }
      if (action.action === 'reset') {
        if (table !== 'profiles') problems.push(`${table}: only the profile is reset`);
        if (!sameWhere(action.columns, resetColumns)) problems.push(`${table}: the reset is not PROFILE_RESET_COLUMNS`);
      }
      if (action.via !== undefined && !Object.hasOwn(inventory, action.via)) problems.push(`${table}: cleared via ${action.via}, not in the inventory`);
    }

    // Clear Journal removes exactly what the journal group exports (D-P4).
    const parts = placement.parts ?? [];
    const journalParts = parts.filter((part) => part.group === 'journal');
    const journal = entry.clear?.journal?.action;
    if (journal === 'delete' && !(parts.length && journalParts.length === parts.length)) {
      problems.push(`${table}: Clear Journal deletes every row, but not every row is journal`);
    }
    if (journal === 'delete-filtered' && !(journalParts.length === 1 && sameWhere(journalParts[0].where, entry.clear.journal.where))) {
      problems.push(`${table}: Clear Journal's filter is not the journal export's filter`);
    }
    if (journal === 'keep' && journalParts.length) problems.push(`${table}: journal records that Clear Journal keeps`);
    if (journal === 'reset') problems.push(`${table}: Clear Journal never resets`);
    if (entry.clear?.all?.action === 'keep' && !['auth.users', 'recovery_challenges'].includes(table)) {
      problems.push(`${table}: clear all keeps it, but D-P1 keeps only the login`);
    }
  }

  for (const [key, reason] of Object.entries(exceptions)) {
    if (!isReason(reason)) problems.push(`${key}: a secret-name exception without a reason`);
    if (!usedExceptions.has(key)) problems.push(`${key}: a secret-name exception for a column that is not exported`);
  }
  for (const group of EXPORT_GROUPS) if (!groupsWithParts.has(group)) problems.push(`${group}: an export group with no table`);

  // The profile: reset or kept, never both, and the reset values are scalars.
  for (const column of Object.keys(keptColumns)) {
    if (Object.hasOwn(resetColumns, column)) problems.push(`profiles.${column}: both reset and kept`);
    if (!isReason(keptColumns[column])) problems.push(`profiles.${column}: kept without a reason`);
  }

  // The fingerprint list is exactly the tables flagged for it, all in the inventory.
  const flagged = Object.keys(inventory).filter((table) => inventory[table].fingerprint === true);
  if (JSON.stringify([...flagged].sort()) !== JSON.stringify([...fingerprint].sort())) {
    problems.push(`fingerprint: flagged ${flagged.join(', ')}, listed ${fingerprint.join(', ')}`);
  }

  for (const text of stringsIn(inventory)) if (text.includes(EM_DASH)) problems.push(`an em dash in: ${text}`);
  return problems;
}

// ---------------------------------------------------------------------------
// The catalog guard
// ---------------------------------------------------------------------------

/**
 * The live schema: columns, defaults, foreign keys and the My Week preference
 * key check, from PGlite with the baseline and every migration applied.
 */
async function readCatalog(db) {
  const columns = await db.query(`
    select table_schema, table_name, column_name, column_default, is_nullable
      from information_schema.columns
     where table_schema in ('public', 'auth')
     order by table_schema, table_name, ordinal_position`);
  const foreignKeys = await db.query(`
    select child.relname as child, parent_ns.nspname || '.' || parent.relname as parent, c.confdeltype as on_delete
      from pg_constraint c
      join pg_class child on child.oid = c.conrelid
      join pg_namespace child_ns on child_ns.oid = child.relnamespace
      join pg_class parent on parent.oid = c.confrelid
      join pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
     where c.contype = 'f' and child_ns.nspname = 'public'`);
  const prefCheck = await db.query(`
    select pg_get_constraintdef(oid) as definition from pg_constraint where conname = 'household_action_preferences_key_check'`);
  const tables = {};
  for (const row of columns.rows) {
    const name = row.table_schema === 'public' ? row.table_name : `${row.table_schema}.${row.table_name}`;
    (tables[name] ??= {})[row.column_name] = { default: row.column_default, nullable: row.is_nullable === 'YES' };
  }
  return {
    tables,
    foreignKeys: foreignKeys.rows.map((row) => ({
      child: row.child,
      parent: row.parent.startsWith('public.') ? row.parent.slice('public.'.length) : row.parent,
      cascade: row.on_delete === 'c',
    })),
    prefKeys: [...(prefCheck.rows[0]?.definition ?? '').matchAll(/'([^']+)'::text/g)].map((match) => match[1]),
  };
}

/** The public tables that reach auth.users through foreign keys, transitively, plus auth.users. */
function catalogOwned(catalog) {
  const owned = new Set([AUTH_USERS]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const { child, parent } of catalog.foreignKeys) {
      if (owned.has(parent) && !owned.has(child)) {
        owned.add(child);
        grew = true;
      }
    }
  }
  return owned;
}

/** What a reset value looks like as information_schema's column_default. */
function defaultMatches(value, columnDefault) {
  if (value === null) return columnDefault === null;
  if (typeof value === 'boolean') return columnDefault === String(value);
  return columnDefault === `'${value}'::text`;
}

function catalogProblems(catalog, {
  inventory = PRIVACY_INVENTORY,
  resetColumns = PROFILE_RESET_COLUMNS,
  keptColumns = PROFILE_KEPT_COLUMNS,
} = {}) {
  const problems = [];
  const owned = catalogOwned(catalog);
  for (const table of owned) if (!Object.hasOwn(inventory, table)) problems.push(`${table}: reaches auth.users but is not in the privacy inventory`);
  for (const table of Object.keys(inventory)) {
    if (!owned.has(table)) problems.push(`${table}: in the inventory but does not reach auth.users in the schema`);
  }

  for (const table of owned) {
    const entry = inventory[table];
    const columns = catalog.tables[table];
    if (!entry || !columns) continue;
    const exported = exportedColumns(entry);
    const withheld = new Set(Object.keys(entry.export.withheld ?? {}));
    const allCovered = Object.hasOwn(entry.export, 'excluded') || isReason(entry.export.withheldAll);
    for (const column of Object.keys(columns)) {
      if (allCovered || column === entry.owner || exported.has(column) || withheld.has(column)) continue;
      problems.push(`${table}.${column}: a column placed neither for export nor as withheld`);
    }
    for (const column of [...exported, ...withheld]) {
      if (!Object.hasOwn(columns, column)) problems.push(`${table}.${column}: placed, but the schema has no such column`);
    }
    // P13's tripwire: a table named like a journal must go with Clear Journal.
    if (/journal|week/i.test(table) && !['delete', 'delete-filtered'].includes(entry.clear?.journal?.action)) {
      problems.push(`${table}: named like a journal but not in Clear Journal`);
    }
    for (const scope of CLEAR_SCOPES) {
      const via = entry.clear?.[scope]?.via;
      if (via && !catalog.foreignKeys.some((fk) => fk.child === table && fk.parent === via && fk.cascade)) {
        problems.push(`${table}: cleared via ${via}, but its foreign key to it does not cascade`);
      }
    }
  }

  // Every profiles column is reset or kept, and the reset value is its default.
  const profileColumns = catalog.tables.profiles ?? {};
  for (const column of Object.keys(profileColumns)) {
    if (!Object.hasOwn(resetColumns, column) && !Object.hasOwn(keptColumns, column)) {
      problems.push(`profiles.${column}: neither reset nor kept by clear all`);
    }
  }
  for (const [column, value] of Object.entries(resetColumns)) {
    const info = profileColumns[column];
    if (!info) problems.push(`profiles.${column}: reset, but the schema has no such column`);
    else if (!defaultMatches(value, info.default)) problems.push(`profiles.${column}: reset to ${JSON.stringify(value)}, the default is ${info.default}`);
    else if (value === null && !info.nullable) problems.push(`profiles.${column}: reset to null, but it is not nullable`);
  }
  for (const column of Object.keys(keptColumns)) {
    if (!Object.hasOwn(profileColumns, column)) problems.push(`profiles.${column}: kept, but the schema has no such column`);
  }

  // Every My Week preference key the schema allows is placed in exactly one tier.
  const placedKeys = (inventory.household_action_preferences?.export.parts ?? []).flatMap((part) => part.where?.in ?? []);
  if (JSON.stringify([...placedKeys].sort()) !== JSON.stringify([...catalog.prefKeys].sort())) {
    problems.push(`household_action_preferences: placed keys ${placedKeys.join(', ')}, the schema allows ${catalog.prefKeys.join(', ')}`);
  }
  return problems;
}

/** `alter table <t> add column <c>` statements, per migration, with comments removed. */
function addedColumns() {
  const added = [];
  for (const migration of listMigrations()) {
    const sql = migration.sql.replace(/--[^\n]*/g, '');
    for (const statement of sql.matchAll(/alter table\s+(?:if exists\s+)?(?:only\s+)?(?:public\.)?(\w+)\s+([^;]*);/gi)) {
      for (const column of statement[2].matchAll(/add column\s+(?:if not exists\s+)?(\w+)/gi)) {
        added.push({ table: statement[1], column: column[1], migration: migration.number });
      }
    }
  }
  return added;
}

const db = await createDb();
let catalog;
try {
  catalog = await readCatalog(db);
} finally {
  await db.close();
}

// ---------------------------------------------------------------------------
// 1. Pure
// ---------------------------------------------------------------------------

test('every owned table, and auth.users, is placed for export and for both clears, consistently (P2, P12)', () => {
  assert.deepEqual(inventoryProblems(), []);
  assert.deepEqual(Object.keys(PRIVACY_INVENTORY).sort(), [...Object.keys(OWNED_TABLES), AUTH_USERS].sort());
});

test('the decisions are encoded: D-P1 keeps only the login, D-P4 clears the journal, D-P5 exports email and rounded location', () => {
  // D-P1: clear all keeps only the login and its recovery material; the profile is reset.
  const keptByAll = Object.keys(PRIVACY_INVENTORY).filter((table) => clearActionFor(table, 'all').action === 'keep').sort();
  assert.deepEqual(keptByAll, ['auth.users', 'recovery_challenges']);
  assert.equal(clearActionFor('profiles', 'all').action, 'reset');
  // The ledger: settled rows only, the clear's own receipt kept, and a pending row refuses (0024 steps 4 and 5).
  assert.deepEqual(clearActionFor('operations', 'all').where, [
    { column: 'status', notEquals: 'pending' },
    { column: 'operation_id', notEquals: OWN_OPERATION },
  ]);
  assert.deepEqual(clearActionFor('operations', 'all').refuseWhen, {
    where: [{ column: 'status', equals: 'pending' }, { column: 'operation_id', notEquals: OWN_OPERATION }],
    refusal: 'HALO_BUSY',
  });
  // D-P4: symptom logs and season summaries, nothing else stored.
  const journal = Object.keys(PRIVACY_INVENTORY).filter((table) => clearActionFor(table, 'journal').action !== 'keep').sort();
  assert.deepEqual(journal, ['alerts', 'symptom_logs']);
  assert.deepEqual(clearActionFor('alerts', 'journal').where, { column: 'type', equals: 'season_summary' });
  assert.deepEqual(UNSTORED_RECORDS.weekJournal.clear, { journal: 'delete', all: 'delete' });
  assert.equal(UNSTORED_RECORDS.weekJournal.storage, 'none');
  // D-P5: in the base tier, so present without private text.
  assert.deepEqual(columnsFor(AUTH_USERS, false), ['email']);
  assert.ok(columnsFor('profiles', false, 'home').includes('lat'));
  assert.ok(columnsFor('home_contexts', false).includes('lng'));
  // D-P2: the ledger and recovery material are never exported.
  assert.ok(PRIVACY_INVENTORY.operations.export.excluded);
  assert.ok(PRIVACY_INVENTORY.recovery_challenges.export.excluded);
  assert.ok(PRIVACY_INVENTORY.household_action_state.export.excluded);
});

test('the inventory is frozen all the way down', () => {
  assert.ok(Object.isFrozen(PRIVACY_INVENTORY));
  assert.ok(Object.isFrozen(PRIVACY_INVENTORY.profiles.export.parts[0].base));
  assert.ok(Object.isFrozen(PRIVACY_INVENTORY.alerts.clear.journal.where));
  assert.throws(() => { PRIVACY_INVENTORY.push_subscriptions.export.parts[0].base.push('endpoint'); }, TypeError);
});

test('no string the inventory carries has an em dash', () => {
  for (const text of stringsIn({ PRIVACY_INVENTORY, INVENTORY_COPY, UNSTORED_RECORDS, PROFILE_KEPT_COLUMNS, SECRET_NAME_EXCEPTIONS })) {
    assert.ok(!text.includes(EM_DASH), text);
  }
});

test('the secret-name check recognises the names it exists for', () => {
  for (const name of [
    'endpoint', 'p256dh', 'auth', 'restore_token_hash', 'email_hash', 'nonce_hash', 'request_hash', 'api_key', 'client_secret', 'session_id', 'password', 'email',
    // Task 2 review, finding 4: plurals, compounds and the other names of key material.
    'push_keys', 'api_keys', 'keys', 'apikey', 'recovery_code', 'verification_code', 'code', 'pkce_verifier', 'code_verifier',
    'digest', 'body_digest', 'cipher', 'ciphertext', 'encrypted', 'encrypted_note', 'user_agent',
  ]) {
    assert.ok(secretNamed(name), name);
  }
  for (const name of ['title', 'author_note', 'state', 'updated_at', 'lat', 'place_id', 'has_pregnant', 'county', 'zone', 'reason']) {
    assert.ok(!secretNamed(name), name);
  }
});

test('the secret-name list trips no exported column without its reasoned exception, and no exception is stale', () => {
  // inventoryProblems holds both directions; this names what the list matches today, so a widened list is reviewed.
  const flagged = [];
  for (const [table, entry] of Object.entries(PRIVACY_INVENTORY)) {
    for (const column of exportedColumns(entry)) if (secretNamed(column)) flagged.push(`${table}.${column}`);
  }
  assert.deepEqual(flagged.sort(), Object.keys(SECRET_NAME_EXCEPTIONS).sort());
});

// ---------------------------------------------------------------------------
// 2. Catalog
// ---------------------------------------------------------------------------

test('against the live schema: owned tables, every column, the profile reset and the My Week keys are placed (P12)', () => {
  assert.deepEqual(catalogProblems(catalog), []);
  // The guard really read the schema, not an empty one.
  assert.ok(Object.keys(catalog.tables.profiles).length >= 16);
  assert.equal(catalogOwned(catalog).size, Object.keys(OWNED_TABLES).length + 1);
  assert.equal(catalog.prefKeys.length, 6);
});

test('the profile columns are exactly the reset list plus id and created_at', () => {
  assert.deepEqual(
    Object.keys(catalog.tables.profiles).sort(),
    [...Object.keys(PROFILE_RESET_COLUMNS), ...Object.keys(PROFILE_KEPT_COLUMNS)].sort(),
  );
});

test('the optional columns are exactly the exported ones a later migration adds, and are absent before it', async () => {
  const optional = [];
  for (const [table, entry] of Object.entries(PRIVACY_INVENTORY)) {
    for (const [column, migration] of Object.entries(entry.export.optional ?? {})) optional.push({ table, column, migration });
  }
  const added = addedColumns().filter(({ table, column }) => PRIVACY_INVENTORY[table] && exportedColumns(PRIVACY_INVENTORY[table]).has(column));
  const key = ({ table, column, migration }) => `${table}.${column}@${migration}`;
  assert.deepEqual(optional.map(key).sort(), added.map(key).sort());
  assert.ok(optional.length >= 6, 'the parse found the added columns');

  for (const migration of [...new Set(optional.map((item) => item.migration))].sort((a, b) => a - b)) {
    const before = await createDb({ upTo: migration - 1 });
    try {
      const earlier = await readCatalog(before);
      for (const item of optional.filter((entry) => entry.migration === migration)) {
        assert.ok(!earlier.tables[item.table]?.[item.column], `${item.table}.${item.column} exists before ${migration}`);
        assert.ok(catalog.tables[item.table][item.column], `${item.table}.${item.column} exists after every migration`);
      }
    } finally {
      await before.close();
    }
  }
});

// ---------------------------------------------------------------------------
// 3. Negative controls: each guard fails on the defect it is for
// ---------------------------------------------------------------------------

test('negative control: a new owned table that the inventory does not place fails', () => {
  const owned = { ...OWNED_TABLES, household_notes: 'profile_id' };
  assert.ok(inventoryProblems({ ownedTables: owned }).includes('household_notes: not placed in the privacy inventory'));
});

test('negative control: a new table in the schema that reaches auth.users fails', () => {
  const copy = clone(catalog);
  copy.tables.household_notes = { id: { default: null, nullable: false }, profile_id: { default: null, nullable: false } };
  copy.foreignKeys.push({ child: 'household_notes', parent: 'profiles', cascade: true });
  assert.ok(catalogProblems(copy).includes('household_notes: reaches auth.users but is not in the privacy inventory'));
  // Transitively too: a child of a child.
  copy.tables.household_note_files = { id: { default: null, nullable: false } };
  copy.foreignKeys.push({ child: 'household_note_files', parent: 'household_notes', cascade: true });
  assert.ok(catalogProblems(copy).includes('household_note_files: reaches auth.users but is not in the privacy inventory'));
});

test('negative control: a new column on an owned table that is neither exported nor withheld fails', () => {
  const copy = clone(catalog);
  copy.tables.symptom_logs.photo_url = { default: null, nullable: true };
  assert.ok(catalogProblems(copy).includes('symptom_logs.photo_url: a column placed neither for export nor as withheld'));
});

test('negative control: a profiles column removed from the reset list fails, in both guards', () => {
  const { tenure: _dropped, ...reset } = PROFILE_RESET_COLUMNS;
  void _dropped;
  assert.ok(catalogProblems(catalog, { resetColumns: reset }).includes('profiles.tenure: neither reset nor kept by clear all'));
  assert.ok(inventoryProblems({ resetColumns: reset }).includes('profiles: the reset is not PROFILE_RESET_COLUMNS'));
});

test('negative control: a new profiles column fails until it is reset or kept', () => {
  const copy = clone(catalog);
  copy.tables.profiles.birth_year = { default: null, nullable: true };
  assert.ok(catalogProblems(copy).includes('profiles.birth_year: neither reset nor kept by clear all'));
});

test('negative control: a reset value that is not the column default fails', () => {
  const reset = { ...PROFILE_RESET_COLUMNS, locale: 'es' };
  assert.ok(catalogProblems(catalog, { resetColumns: reset }).some((line) => line.startsWith('profiles.locale: reset to "es"')));
});

test('negative control: endpoint added to an allowlist fails as denied and as secret-named', () => {
  const inventory = clone(PRIVACY_INVENTORY);
  const part = inventory.push_subscriptions.export.parts[0];
  delete part.countAs;
  part.base.push('endpoint');
  delete inventory.push_subscriptions.export.withheld.endpoint;
  const problems = inventoryProblems({ inventory });
  assert.ok(problems.includes('push_subscriptions.endpoint: a denied column is exported'));
  assert.ok(problems.includes('push_subscriptions.endpoint: named like a secret and exported without a reasoned exception'));
});

test('negative control: a secret-named column without an exception, and a stale exception, both fail', () => {
  const inventory = clone(PRIVACY_INVENTORY);
  inventory.household_actions.export.parts[0].base.push('share_token');
  assert.ok(inventoryProblems({ inventory }).includes('household_actions.share_token: named like a secret and exported without a reasoned exception'));

  const { 'household_actions.action_key': _gone, ...fewer } = SECRET_NAME_EXCEPTIONS;
  void _gone;
  assert.ok(inventoryProblems({ exceptions: fewer }).includes('household_actions.action_key: named like a secret and exported without a reasoned exception'));
  assert.ok(inventoryProblems({ exceptions: { ...SECRET_NAME_EXCEPTIONS, 'luna_turns.body': 'not a secret name' } })
    .includes('luna_turns.body: a secret-name exception for a column that is not exported'));
  assert.ok(inventoryProblems({ exceptions: { ...SECRET_NAME_EXCEPTIONS, 'auth.users.email': ' ' } })
    .includes('auth.users.email: a secret-name exception without a reason'));
});

test('negative control: a table without a clear action, or kept without a reason, fails', () => {
  const inventory = clone(PRIVACY_INVENTORY);
  delete inventory.explore_areas.clear.all;
  inventory.daily_scores.clear.journal = { action: 'keep' };
  const problems = inventoryProblems({ inventory });
  assert.ok(problems.includes('explore_areas: no clear action for all'));
  assert.ok(problems.includes('daily_scores: kept by clear journal without a reason'));
});

test('negative control: an exclusion without a reason, and a table neither exported nor excluded, fail', () => {
  const inventory = clone(PRIVACY_INVENTORY);
  inventory.operations.export = { excluded: '' };
  inventory.explore_areas.export = { withheld: {} };
  const problems = inventoryProblems({ inventory });
  assert.ok(problems.includes('operations: excluded from export without a reason'));
  assert.ok(problems.includes('explore_areas: neither exported nor excluded'));
});

test('negative control: Clear Journal out of step with the journal export fails', () => {
  const inventory = clone(PRIVACY_INVENTORY);
  inventory.alerts.clear.journal = { action: 'delete' };
  inventory.symptom_logs.clear.journal = { action: 'keep', reason: 'kept' };
  const problems = inventoryProblems({ inventory });
  assert.ok(problems.includes('alerts: Clear Journal deletes every row, but not every row is journal'));
  assert.ok(problems.includes('symptom_logs: journal records that Clear Journal keeps'));
});

test('negative control: clear all keeping anything but the login fails (D-P1)', () => {
  const inventory = clone(PRIVACY_INVENTORY);
  inventory.home_contexts.clear.all = { action: 'keep', reason: 'history' };
  assert.ok(inventoryProblems({ inventory }).includes('home_contexts: clear all keeps it, but D-P1 keeps only the login'));
});

test('negative control: a column both exported and withheld, or exported and absent from the schema, fails', () => {
  const inventory = clone(PRIVACY_INVENTORY);
  inventory.daily_scores.export.parts[0].base.push('details', 'state');
  const problems = inventoryProblems({ inventory });
  assert.ok(problems.includes('daily_scores.details: both exported and withheld'));
  assert.ok(problems.includes('daily_scores.details: a denied column is exported'));
  assert.ok(catalogProblems(catalog, { inventory }).includes('daily_scores.state: placed, but the schema has no such column'));
});

test('negative control: a conversation column in the base tier fails (no transcript without private text)', () => {
  const inventory = clone(PRIVACY_INVENTORY);
  inventory.luna_turns.export.parts[0].base.push('created_at');
  inventory.luna_turns.export.parts[0].private = inventory.luna_turns.export.parts[0].private.filter((column) => column !== 'created_at');
  assert.ok(inventoryProblems({ inventory }).includes('luna_turns: exported in conversation without private text'));
});

test('negative control: the owner column exported fails', () => {
  const inventory = clone(PRIVACY_INVENTORY);
  inventory.symptom_logs.export.parts[0].base.push('profile_id');
  assert.ok(inventoryProblems({ inventory }).includes('symptom_logs.profile_id: the owner column is exported'));
});

test('negative control: a journal-named table outside Clear Journal fails (P13 tripwire)', () => {
  const copy = clone(catalog);
  copy.tables.week_journal_entries = { id: { default: null, nullable: false }, profile_id: { default: null, nullable: false } };
  copy.foreignKeys.push({ child: 'week_journal_entries', parent: 'profiles', cascade: true });
  const inventory = clone(PRIVACY_INVENTORY);
  inventory.week_journal_entries = {
    owner: 'profile_id',
    export: { parts: [{ group: 'home', base: ['id'], private: [] }], withheld: {} },
    fingerprint: false,
    clear: { journal: { action: 'keep', reason: 'oops' }, all: { action: 'delete' } },
  };
  assert.ok(catalogProblems(copy, { inventory }).includes('week_journal_entries: named like a journal but not in Clear Journal'));
});

test('negative control: a new My Week preference key in the schema fails until placed', () => {
  const copy = clone(catalog);
  copy.prefKeys.push('week:private-goal');
  assert.ok(catalogProblems(copy).some((line) => line.startsWith('household_action_preferences: placed keys')));
});

test('negative control: a cascade the schema does not have fails', () => {
  const copy = clone(catalog);
  copy.foreignKeys = copy.foreignKeys.map((fk) => (fk.child === 'luna_turns' && fk.parent === 'luna_conversations' ? { ...fk, cascade: false } : fk));
  assert.ok(catalogProblems(copy).includes('luna_turns: cleared via luna_conversations, but its foreign key to it does not cascade'));
});

test('negative control: the fingerprint list out of step with the flags fails', () => {
  assert.ok(inventoryProblems({ fingerprint: FINGERPRINT_TABLES.filter((table) => table !== 'symptom_logs') })
    .some((line) => line.startsWith('fingerprint:')));
});

test('negative control R1: the home alerts part without its season-summary filter fails the rows guard', () => {
  const inventory = clone(PRIVACY_INVENTORY);
  const home = inventory.alerts.export.parts.find((part) => part.group === 'home');
  delete home.where;
  const problems = inventoryProblems({ inventory });
  assert.ok(problems.includes('alerts: message private in one part and base in an overlapping sibling'), problems.join('\n'));
  assert.ok(problems.includes('alerts: parts home and journal may cover the same rows and both export type, title, fired_at, message'));
});

test('negative control R2: the season-summary filter widened to notEquals none fails the rows guard', () => {
  const inventory = clone(PRIVACY_INVENTORY);
  inventory.alerts.export.parts.find((part) => part.group === 'home').where = { column: 'type', notEquals: 'none' };
  assert.ok(inventoryProblems({ inventory }).includes('alerts: message private in one part and base in an overlapping sibling'));
});

test('the rows guard: what it proves disjoint, and what it does not', () => {
  const part = (where, base = ['x'], extra = {}) => ({ group: 'home', base, private: [], ...(where ? { where } : {}), ...extra });
  const disjoint = (a, b) => partRowProblems('t', [a, b]).length === 0;
  // Proved disjoint: an equals against its own notEquals, distinct values, non-overlapping lists.
  assert.ok(disjoint(part({ column: 'type', equals: 'a' }), part({ column: 'type', notEquals: 'a' })));
  assert.ok(disjoint(part({ column: 'type', equals: 'a' }), part({ column: 'type', equals: 'b' })));
  assert.ok(disjoint(part({ column: 'k', in: ['a', 'b'] }), part({ column: 'k', in: ['c'] })));
  assert.ok(disjoint(part({ column: 'k', in: ['a'] }), part({ column: 'k', notEquals: 'a' })));
  // One filter of a conjunction is enough.
  assert.ok(disjoint(part([{ column: 's', notEquals: 'z' }, { column: 'type', equals: 'a' }]), part({ column: 'type', equals: 'b' })));
  // Not proved: no filter, another column, two notEquals, overlapping lists, an in list wider than the excluded value.
  assert.ok(!disjoint(part(null), part({ column: 'type', equals: 'a' })));
  assert.ok(!disjoint(part({ column: 'type', equals: 'a' }), part({ column: 'kind', notEquals: 'a' })));
  assert.ok(!disjoint(part({ column: 'type', notEquals: 'a' }), part({ column: 'type', notEquals: 'b' })));
  assert.ok(!disjoint(part({ column: 'k', in: ['a', 'b'] }), part({ column: 'k', in: ['b', 'c'] })));
  assert.ok(!disjoint(part({ column: 'k', in: ['a', 'b'] }), part({ column: 'k', notEquals: 'a' })));
  // Overlapping rows are fine when the parts split the columns, as the profile's home and preferences parts do.
  assert.ok(disjoint(part(null, ['lat']), part(null, ['locale'])));
  assert.deepEqual(partRowProblems('profiles', PRIVACY_INVENTORY.profiles.export.parts), []);
  // But never one column private in one and base in the other.
  assert.deepEqual(partRowProblems('t', [part(null, ['a']), { group: 'journal', base: [], private: ['a'] }]), [
    't: parts home and journal may cover the same rows and both export a',
    't: a private in one part and base in an overlapping sibling',
  ]);
});

test('negative control: a meta denylist, empty base keys, base keys of an unexported column, and a malformed filter fail', () => {
  const inventory = clone(PRIVACY_INVENTORY);
  const tasks = inventory.household_actions.export.parts[0];
  tasks.privateKeys = { meta: ['note', 'history'] };
  tasks.baseKeys = { meta: [] };
  inventory.household_action_preferences.export.parts[0].where = { column: 'pref_key', in: [] };
  inventory.operations.clear.all.refuseWhen = { where: [{ column: 'status' }], refusal: 'busy' };
  const problems = inventoryProblems({ inventory });
  assert.ok(problems.includes('household_actions: privateKeys is a denylist; name the base keys instead (baseKeys)'));
  assert.ok(problems.includes('household_actions: empty base keys for meta'));
  assert.ok(problems.includes('household_action_preferences: an empty in filter on pref_key'));
  assert.ok(problems.includes('operations: clear all: a filter on status without exactly one test'));
  assert.ok(problems.includes('operations: clear all refuses without its filter and refusal code'));
  const unexported = clone(PRIVACY_INVENTORY);
  unexported.household_actions.export.parts[0].baseKeys = { details: ['a'] };
  assert.ok(inventoryProblems({ inventory: unexported }).includes('household_actions: base keys of details, which the base tier does not export'));
});

test('negative control: an em dash in an inventory string fails', () => {
  const inventory = clone(PRIVACY_INVENTORY);
  inventory.operations.export.excluded = `Ledger ${EM_DASH} internal`;
  assert.ok(inventoryProblems({ inventory }).some((line) => line.startsWith('an em dash in:')));
});

// ---------------------------------------------------------------------------
// 4. The helpers
// ---------------------------------------------------------------------------

test('groupsFor: the selection for an export, the journal, or all six; clears accept an empty selection (trap P-3)', () => {
  assert.deepEqual(groupsFor('export', ['preferences', 'tasks']), ['tasks', 'preferences']);
  assert.deepEqual(groupsFor('journal', []), ['journal']);
  assert.deepEqual(groupsFor('journal', ['tasks']), ['journal']);
  assert.deepEqual(groupsFor('all', []), [...EXPORT_GROUPS]);
  assert.throws(() => groupsFor('export', []), TypeError);
  assert.throws(() => groupsFor('export', ['tasks', 'tasks']), TypeError);
  assert.throws(() => groupsFor('export', ['photos']), TypeError);
  assert.throws(() => groupsFor('delete', ['tasks']), TypeError);
});

test('columnsFor: the base tier, plus private with private text, per group', () => {
  assert.deepEqual(columnsFor('symptom_logs', false), ['entry_date', 'retrospective', 'created_at', 'updated_at']);
  assert.deepEqual(columnsFor('symptom_logs', true), ['entry_date', 'retrospective', 'created_at', 'updated_at', 'band', 'symptoms', 'severity', 'possibly_illness', 'note']);
  assert.deepEqual(columnsFor('alerts', false, 'journal'), ['type', 'title', 'fired_at']);
  assert.deepEqual(columnsFor('alerts', true, 'journal'), ['type', 'title', 'fired_at', 'message']);
  assert.deepEqual(columnsFor('profiles', false, 'preferences'), ['locale']);
  assert.deepEqual(columnsFor('household_bands', false), []);
  assert.deepEqual(columnsFor('push_subscriptions', true), []);
  assert.deepEqual(columnsFor('operations', true), []);
  assert.deepEqual(columnsFor('no_such_table', true), []);
  for (const table of Object.keys(PRIVACY_INVENTORY)) {
    for (const column of columnsFor(table, true)) assert.ok(!DENIED_EXPORT_COLUMNS.includes(column), `${table}.${column}`);
  }
});

test('tablesFor and fingerprintTables follow the groups, in a fixed order (P6)', () => {
  assert.deepEqual(tablesFor(['journal']), ['alerts', 'symptom_logs']);
  assert.deepEqual(tablesFor(['tasks']), ['household_actions', 'household_action_preferences']);
  assert.deepEqual(fingerprintTables('journal', ['tasks']), ['symptom_logs']);
  assert.deepEqual(fingerprintTables('all', []), [...FINGERPRINT_TABLES]);
  assert.deepEqual(fingerprintTables('export', ['tasks']), ['household_actions', 'household_action_preferences']);
  assert.deepEqual(fingerprintTables('export', ['preferences', 'home']), [
    'profiles', 'home_contexts', 'household_bands', 'notification_prefs', 'push_subscriptions', 'profile_preferences',
  ]);
  // Server-written tables are counted but never bound, so a background refresh cannot refuse a clear.
  for (const table of ['daily_scores', 'alerts', 'home_risks', 'luna_runs', 'household_action_state', 'operations']) {
    assert.ok(!fingerprintTables('all').includes(table), table);
  }
});

test('exportParts: without private text, private columns, private-only rows and the conversation are left out', () => {
  const withoutPrivate = exportParts([...EXPORT_GROUPS], false);
  assert.ok(!withoutPrivate.some((part) => part.group === 'conversation'));
  assert.ok(!withoutPrivate.some((part) => part.table === 'household_bands'));
  const prefs = withoutPrivate.filter((part) => part.table === 'household_action_preferences');
  assert.equal(prefs.length, 1);
  assert.ok(!prefs[0].where.in.includes('week:focus') && !prefs[0].where.in.includes('outdoorPlan'));
  const tasks = withoutPrivate.find((part) => part.table === 'household_actions');
  assert.deepEqual(tasks.baseKeys, { meta: [...BASE_META_KEYS] });
  assert.deepEqual(withoutPrivate.find((part) => part.table === 'push_subscriptions').countAs, 'deviceDelivery');
  const risks = withoutPrivate.find((part) => part.table === 'home_risks');
  assert.equal(risks.countOnly, true);
  assert.equal(risks.warning, INVENTORY_COPY.homeRisksWarning);
  assert.deepEqual(withoutPrivate.find((part) => part.table === 'profiles' && part.group === 'home').optional.sort(), ['renter_mode', 'state', 'tenure']);

  const withPrivate = exportParts([...EXPORT_GROUPS], true);
  assert.deepEqual(withPrivate.filter((part) => part.group === 'conversation').map((part) => part.table), ['luna_conversations', 'luna_turns', 'luna_runs']);
  assert.deepEqual(withPrivate.find((part) => part.table === 'household_actions').baseKeys, {});
  assert.equal(withPrivate.filter((part) => part.table === 'household_action_preferences').length, 2);
  // 0026 (B11): the Explore workspace collections' rows, without their private record; 0028 (B14): the note photos' metadata.
  assert.deepEqual(exportParts(['explore'], false).map((part) => part.table), ['explore_areas', 'household_workspace_records', 'household_attachments', 'household_project_generations']);
  assert.throws(() => exportParts(['tasks'], 'yes'), TypeError);
});

test('projectRow keeps only allowlisted columns, rounds coordinates and keeps only the base keys of meta', () => {
  const home = exportParts(['home'], false).find((part) => part.table === 'profiles');
  const row = { id: 'x', lat: 35.123456, lng: -80.987654, address: '1 Main St', zip: '28144', county: 'Rowan', locale: 'en' };
  assert.deepEqual(projectRow(home, row), { lat: 35.123, lng: -80.988, county: 'Rowan' });

  const tasks = exportParts(['tasks'], false).find((part) => part.table === 'household_actions');
  const projected = projectRow(tasks, { id: 't1', profile_id: 'p', title: 'Test', meta: { note: 'private', history: ['a'], time: '09:00' } });
  assert.deepEqual(projected, { id: 't1', title: 'Test', meta: { time: '09:00' } });
  const tasksPrivate = exportParts(['tasks'], true).find((part) => part.table === 'household_actions');
  assert.deepEqual(projectRow(tasksPrivate, { meta: { note: 'private', history: ['a'] } }), { meta: { note: 'private', history: ['a'] } });
  // A null meta passes through as null; a non-object (0023 forbids one) is left out without private text.
  assert.deepEqual(projectRow(tasks, { meta: null }), { meta: null });
  assert.deepEqual(projectRow(tasks, { title: 'Test', meta: ['free text'] }), { title: 'Test' });
  assert.deepEqual(projectRow(tasks, { title: 'Test', meta: 'free text' }), { title: 'Test' });
});

test('meta is an allowlist: an unknown free-text key is private text, kept only with private text (Task 2 review, finding 2)', () => {
  const meta = {
    paused: false, archived: false, completedOn: '2026-10-01', time: '09:00', duration: 45, estimateSet: true,
    zone: 'America/New_York', recurrence: 'weekly', reminder: true,
    note: 'Call the landlord about the mold', history: ['Moved from Monday'],
    description: 'My neighbour, Sam, has the spare key', // a key the client might add later
  };
  const base = exportParts(['tasks'], false).find((part) => part.table === 'household_actions');
  const { meta: exported } = projectRow(base, { meta });
  assert.deepEqual(Object.keys(exported).sort(), [...BASE_META_KEYS].sort());
  assert.ok(!JSON.stringify(exported).includes('Sam'), 'the unknown key leaked without private text');
  assert.ok(!JSON.stringify(exported).includes('landlord'));
  const full = exportParts(['tasks'], true).find((part) => part.table === 'household_actions');
  assert.deepEqual(projectRow(full, { meta }).meta, meta);
});

test('the meta allowlist and the private keys together are exactly the WeekMeta type (lib/frontend/week-preview.ts)', () => {
  const source = readFileSync(new URL('../lib/frontend/week-preview.ts', import.meta.url), 'utf8');
  const body = source.match(/export type WeekMeta = \{([^}]*)\}/)?.[1];
  assert.ok(body, 'WeekMeta is no longer declared as one object type in week-preview.ts');
  const keys = [...body.matchAll(/(\w+)\??\s*:/g)].map((match) => match[1]);
  assert.ok(keys.length >= 10, 'the parse found the WeekMeta keys');
  assert.deepEqual(
    [...BASE_META_KEYS, ...PRIVATE_META_KEYS].sort(),
    [...keys].sort(),
    'WeekMeta changed: place each new key in BASE_META_KEYS (exported without private text) or PRIVATE_META_KEYS',
  );
  assert.ok(!BASE_META_KEYS.some((key) => PRIVATE_META_KEYS.includes(key)));
});
