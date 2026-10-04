/**
 * Migration 0015's database rules, on a local in-memory PGlite database
 * (test/db/pgliteHarness.mjs) with the reconstructed baseline and every
 * migration.
 *
 * 1. symptom_logs check constraints, added NOT VALID: their limits are the ones
 *    in lib/limits.js (the file text and the catalog both), each one refuses a
 *    breaking row and accepts the edge of what is allowed, and what NOT VALID
 *    leaves behind for rows written before 0015 is pinned, including the read
 *    only query and the validate statements its comment gives Vibhav.
 * 2. One validated write path: anon and authenticated can no longer insert,
 *    update or delete profiles, household_bands, symptom_logs or
 *    notification_prefs, not even through a column grant; the owner can still
 *    read their rows and the policies stay. The cross-household matrix for the
 *    same tables is test/rlsIsolation.test.mjs.
 * 3. Running 0015 again changes nothing.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/routeLoader.mjs'; // registers the module hooks, so lib files load as ES modules
import { createDb, listMigrations, runAudit } from './db/pgliteHarness.mjs';

const limits = await import('../lib/limits.js');

const MIGRATION = listMigrations().find((migration) => migration.number === 15);
const DIRECT_WRITE_TABLES = ['profiles', 'household_bands', 'symptom_logs', 'notification_prefs'];
const API_ROLES = ['anon', 'authenticated'];

/** The constraints 0015 adds NOT VALID; severity's check already exists, validated, from 0003. */
const NEW_CHECKS = ['symptom_logs_band_check', 'symptom_logs_entry_date_check', 'symptom_logs_note_length_check', 'symptom_logs_symptoms_count_check'];

const ALICE = 'a11ce000-0000-4000-8000-000000000001';

let db;

before(async () => {
  db = await createDb();
  await db.exec(`insert into auth.users (id, is_anonymous) values ('${ALICE}', true)`); // the 0001 trigger adds her profile
  await db.asService(
    (tx) =>
      tx.exec(`insert into public.household_bands (profile_id, has_child) values ('${ALICE}', true);
        insert into public.symptom_logs (profile_id, entry_date, symptoms) values ('${ALICE}', '2026-09-10', array['cough']);
        insert into public.notification_prefs (profile_id) values ('${ALICE}');`),
    { commit: true },
  );
});

after(async () => {
  await db?.close();
});

/** The check constraints on symptom_logs: name -> { def, validated }. */
async function symptomChecks(runner = db) {
  const { rows } = await runner.query(
    `select conname, pg_get_constraintdef(oid) as def, convalidated from pg_constraint
      where conrelid = 'public.symptom_logs'::regclass and contype = 'c' order by conname`,
  );
  return Object.fromEntries(rows.map((row) => [row.conname, { def: row.def, validated: row.convalidated }]));
}

/** The text between `add constraint <name>` and the `not valid` that ends it, in 0015. */
function constraintText(name) {
  const match = new RegExp(`add constraint ${name}\\s+check\\s*([\\s\\S]*?)\\s+not valid`, 'i').exec(MIGRATION.sql);
  assert.ok(match, `0015 adds ${name} ... not valid`);
  return match[1].replace(/\s+/g, ' ');
}

const quoted = (text) => [...text.matchAll(/'([^']*)'/g)].map((m) => m[1]);
const sqlList = (values) => `ARRAY[${values.map((value) => `'${value}'::text`).join(', ')}]`;

/** The 0015 comment's read-only query for old rows that break a rule, and its validate statements. */
function commentedSql() {
  const lines = MIGRATION.sql.split('\n');
  const start = lines.findIndex((line) => /^--\s+select id, entry_date/.test(line));
  assert.ok(start > 0, '0015 documents a read-only query for old rows that break a rule');
  const query = [];
  for (const line of lines.slice(start)) {
    query.push(line.replace(/^--\s?/, ''));
    if (line.trim().endsWith(';')) break;
  }
  const validates = lines
    .map((line) => /^--\s+(alter table public\.symptom_logs validate constraint (\w+);)$/.exec(line))
    .filter(Boolean)
    .map((match) => ({ statement: match[1], name: match[2] }));
  return { query: query.join('\n'), validates };
}

/** Runs `statement` as the service role in a rolled-back transaction: 'ok', or the error's code and constraint. */
async function serviceWrite(statement, values = []) {
  try {
    await db.asService((tx) => tx.query(statement, values));
    return 'ok';
  } catch (error) {
    return `${error.code} ${error.constraint ?? ''}`.trim();
  }
}

const insertLog = (row) => {
  const full = { profile_id: ALICE, entry_date: '2026-09-11', ...row };
  const columns = Object.keys(full);
  return serviceWrite(
    `insert into public.symptom_logs (${columns.join(', ')}) values (${columns.map((_, at) => `$${at + 1}`).join(', ')})`,
    Object.values(full),
  );
};

// ---------------------------------------------------------------------------
// The limits agree with lib/limits.js
// ---------------------------------------------------------------------------

test('0015 exists and its symptom_logs constraints repeat the numbers and lists in lib/limits.js', () => {
  assert.ok(MIGRATION, 'supabase/migrations/0015_*.sql exists');
  assert.match(MIGRATION.name, /^0015_household_transaction_and_constraints$/);
  assert.deepEqual(quoted(constraintText('symptom_logs_band_check')), [...limits.JOURNAL_BANDS]);
  assert.deepEqual(quoted(constraintText('symptom_logs_severity_check')), [...limits.JOURNAL_SEVERITIES]);
  assert.match(constraintText('symptom_logs_note_length_check'), new RegExp(`^\\(char_length\\(note\\) <= ${limits.JOURNAL_NOTE_MAX}\\)$`));
  assert.match(
    constraintText('symptom_logs_symptoms_count_check'),
    new RegExp(`^\\(coalesce\\(array_length\\(symptoms, 1\\), 0\\) <= ${limits.JOURNAL_SYMPTOMS_MAX}\\)$`),
  );
  assert.equal(constraintText('symptom_logs_entry_date_check'), `(entry_date >= date '${limits.JOURNAL_MIN_DATE}')`);
});

test('the check constraints in the migrated database agree with lib/limits.js, and the new ones are NOT VALID', async () => {
  assert.deepEqual(await symptomChecks(), {
    symptom_logs_band_check: { def: `CHECK ((band = ANY (${sqlList(limits.JOURNAL_BANDS)}))) NOT VALID`, validated: false },
    symptom_logs_entry_date_check: { def: `CHECK ((entry_date >= '${limits.JOURNAL_MIN_DATE}'::date)) NOT VALID`, validated: false },
    symptom_logs_note_length_check: { def: `CHECK ((char_length(note) <= ${limits.JOURNAL_NOTE_MAX})) NOT VALID`, validated: false },
    // From 0003 (validated); 0015 adds its own only where this one is missing.
    symptom_logs_severity_check: { def: `CHECK ((severity = ANY (${sqlList(limits.JOURNAL_SEVERITIES)})))`, validated: true },
    symptom_logs_symptoms_count_check: {
      def: `CHECK ((COALESCE(array_length(symptoms, 1), 0) <= ${limits.JOURNAL_SYMPTOMS_MAX})) NOT VALID`,
      validated: false,
    },
  });
});

test('where the severity check is missing, 0015 adds it NOT VALID with the same three ratings', async () => {
  const checks = await db.pg.transaction(async (tx) => {
    await tx.exec('alter table public.symptom_logs drop constraint symptom_logs_severity_check;');
    await tx.exec(MIGRATION.sql);
    const result = await symptomChecks(tx);
    await tx.rollback();
    return result;
  });
  assert.deepEqual(checks.symptom_logs_severity_check, {
    def: `CHECK (((severity IS NULL) OR (severity = ANY (${sqlList(limits.JOURNAL_SEVERITIES)})))) NOT VALID`,
    validated: false,
  });
});

// ---------------------------------------------------------------------------
// Each rule refuses a breaking row and accepts the edge of what is allowed
// ---------------------------------------------------------------------------

test('band: each of the seven groups and household is accepted; anything else is refused', async () => {
  for (const band of limits.JOURNAL_BANDS) assert.equal(await insertLog({ band }), 'ok', band);
  for (const band of ['toddler', 'Household', 'has_pet', '']) {
    assert.equal(await insertLog({ band }), '23514 symptom_logs_band_check', band);
  }
});

test('severity: null and the three ratings are accepted; anything else is refused', async () => {
  for (const severity of [null, ...limits.JOURNAL_SEVERITIES]) assert.equal(await insertLog({ severity }), 'ok', String(severity));
  for (const severity of ['severe', 'Mild', '']) {
    assert.equal(await insertLog({ severity }), '23514 symptom_logs_severity_check', severity);
  }
});

test('note: null and up to the limit in characters (an emoji is one) are accepted; one more is refused', async () => {
  const max = limits.JOURNAL_NOTE_MAX;
  assert.equal(await insertLog({ note: null }), 'ok');
  assert.equal(await insertLog({ note: 'n'.repeat(max) }), 'ok');
  assert.equal(await insertLog({ note: '\u{1F600}'.repeat(max) }), 'ok', 'characters, not bytes');
  assert.equal(await insertLog({ note: 'n'.repeat(max + 1) }), '23514 symptom_logs_note_length_check');
  assert.equal(await insertLog({ note: '\u{1F600}'.repeat(max + 1) }), '23514 symptom_logs_note_length_check');
});

test('symptoms: none up to the limit are accepted; one more is refused', async () => {
  const max = limits.JOURNAL_SYMPTOMS_MAX;
  const list = (n) => Array.from({ length: n }, (_, at) => `symptom ${at}`);
  assert.equal(await insertLog({ symptoms: [] }), 'ok');
  assert.equal(await insertLog({ symptoms: list(max) }), 'ok');
  assert.equal(await insertLog({ symptoms: list(max + 1) }), '23514 symptom_logs_symptoms_count_check');
});

test('entry_date: the first allowed day is accepted; the day before is refused', async () => {
  assert.equal(await insertLog({ entry_date: limits.JOURNAL_MIN_DATE }), 'ok');
  assert.equal(await insertLog({ entry_date: '1999-12-31' }), '23514 symptom_logs_entry_date_check');
});

test('an update is checked too: changing a row to break a rule is refused', async () => {
  const breaking = {
    band: `band = 'toddler'`,
    note: `note = repeat('n', ${limits.JOURNAL_NOTE_MAX + 1})`,
    symptoms: `symptoms = array_fill('x'::text, array[${limits.JOURNAL_SYMPTOMS_MAX + 1}])`,
    entry_date: `entry_date = date '1999-12-31'`,
  };
  for (const [column, assignment] of Object.entries(breaking)) {
    const outcome = await serviceWrite(`update public.symptom_logs set ${assignment} where profile_id = $1`, [ALICE]);
    assert.match(outcome, /^23514 symptom_logs_\w+_check$/, column);
  }
});

// ---------------------------------------------------------------------------
// NOT VALID: rows written before 0015
// ---------------------------------------------------------------------------

test('NOT VALID: an old row that breaks a rule stays, the documented query finds it, and validating waits until it is fixed', async () => {
  const { query, validates } = commentedSql();
  assert.deepEqual(validates.map((v) => v.name).sort(), [...NEW_CHECKS, 'symptom_logs_severity_check'].sort());

  const outcome = await db.pg.transaction(async (tx) => {
    // Rows from before 0015: drop the new rules, write one row breaking each, then run 0015 again.
    await tx.exec(NEW_CHECKS.map((name) => `alter table public.symptom_logs drop constraint ${name};`).join('\n'));
    await tx.query(
      `insert into public.symptom_logs (id, profile_id, entry_date, band, note, symptoms) values
         ('0dd00000-0000-4000-8000-000000000001', $1, '2026-08-01', 'household', repeat('n', ${limits.JOURNAL_NOTE_MAX + 1}), '{}'),
         ('0dd00000-0000-4000-8000-000000000002', $1, '2026-08-02', 'toddler', null, '{}'),
         ('0dd00000-0000-4000-8000-000000000003', $1, '1999-12-31', 'household', null, '{}'),
         ('0dd00000-0000-4000-8000-000000000004', $1, '2026-08-04', 'household', null, array_fill('x'::text, array[${limits.JOURNAL_SYMPTOMS_MAX + 1}]))`,
      [ALICE],
    );
    await tx.exec(MIGRATION.sql); // adding NOT VALID does not scan, so this succeeds with the old rows in place

    const attempt = async (sql, values) => {
      await tx.exec('savepoint attempt');
      try {
        await tx.query(sql, values);
        await tx.exec('release savepoint attempt');
        return 'ok';
      } catch (error) {
        await tx.exec('rollback to savepoint attempt');
        return `${error.code} ${error.constraint ?? ''}`.trim();
      }
    };

    const found = (await tx.query(query)).rows.map((row) => row.id).sort();
    const validateBefore = await attempt(validates.find((v) => v.name === 'symptom_logs_note_length_check').statement);
    // The residual: changing only another column of the old row still runs every check on it.
    const unrelatedUpdate = await attempt(`update public.symptom_logs set possibly_illness = true where id = '0dd00000-0000-4000-8000-000000000001'`);
    // The journal route's upsert rewrites every checked column, so saving that day again works.
    const routeUpsert = await attempt(
      `insert into public.symptom_logs (profile_id, entry_date, band, symptoms, severity, note, retrospective, possibly_illness, updated_at)
       values ($1, '2026-08-01', 'household', array['cough'], 'mild', 'better today', false, false, now())
       on conflict (profile_id, entry_date, band) do update set
         symptoms = excluded.symptoms, severity = excluded.severity, note = excluded.note,
         retrospective = excluded.retrospective, possibly_illness = excluded.possibly_illness, updated_at = excluded.updated_at`,
      [ALICE],
    );
    await tx.exec(`delete from public.symptom_logs where id in ('0dd00000-0000-4000-8000-000000000002', '0dd00000-0000-4000-8000-000000000003', '0dd00000-0000-4000-8000-000000000004')`);
    const foundAfterFix = (await tx.query(query)).rows.length;
    const validateAfter = [];
    for (const { statement } of validates) validateAfter.push(await attempt(statement));
    const checks = await symptomChecks(tx);
    await tx.rollback();
    return { found, validateBefore, unrelatedUpdate, routeUpsert, foundAfterFix, validateAfter, checks };
  });

  assert.deepEqual(outcome.found, [1, 2, 3, 4].map((n) => `0dd00000-0000-4000-8000-00000000000${n}`), 'the query lists each breaking row and no other');
  assert.equal(outcome.validateBefore, '23514 symptom_logs_note_length_check');
  assert.equal(outcome.unrelatedUpdate, '23514 symptom_logs_note_length_check');
  assert.equal(outcome.routeUpsert, 'ok');
  assert.equal(outcome.foundAfterFix, 0);
  assert.deepEqual(outcome.validateAfter, validates.map(() => 'ok'));
  assert.ok(Object.values(outcome.checks).every((check) => check.validated), 'every check is a full constraint once validated');
});

test('the documented query reads only ids, dates, groups, ratings and sizes, never a note or a symptom', () => {
  const { query } = commentedSql();
  const selected = /select([\s\S]*?)\bfrom\b/i.exec(query)[1];
  assert.doesNotMatch(selected, /(^|[\s,])(note|symptoms)(\s*,|\s*$)/);
  assert.doesNotMatch(query, /\b(update|delete|insert|alter|drop)\b/i);
});

// ---------------------------------------------------------------------------
// One validated write path
// ---------------------------------------------------------------------------

async function privileges(role, table, runner = db) {
  const { rows: [row] } = await runner.query(
    `select has_table_privilege($1, $2::regclass, 'SELECT') as select,
            has_any_column_privilege($1, $2::regclass, 'INSERT') as insert,
            has_any_column_privilege($1, $2::regclass, 'UPDATE') as update,
            has_table_privilege($1, $2::regclass, 'DELETE') as delete`,
    [role, `public.${table}`],
  );
  return row;
}

test('anon and authenticated hold no insert, update or delete on the four household tables, on the table or any column', async () => {
  for (const table of DIRECT_WRITE_TABLES) {
    for (const role of API_ROLES) {
      const { insert, update, delete: remove } = await privileges(role, table);
      assert.deepEqual({ insert, update, delete: remove }, { insert: false, update: false, delete: false }, `${role} on ${table}`);
    }
    assert.equal((await privileges('authenticated', table)).select, true, `authenticated still reads ${table} (row level security limits it to its own rows)`);
    assert.deepEqual(await privileges('service_role', table), { select: true, insert: true, update: true, delete: true }, `the routes still write ${table}`);
  }
});

test('0015 also clears column grants made earlier, so no column is left writable', async () => {
  const after0015 = await db.pg.transaction(async (tx) => {
    await tx.exec(`grant update (county, lat, lng) on public.profiles to authenticated;
      grant insert (profile_id, has_child) on public.household_bands to anon;
      grant update (note) on public.symptom_logs to authenticated;
      grant insert (profile_id, season_summary) on public.notification_prefs to authenticated;`);
    const granted = await privileges('authenticated', 'profiles', tx);
    await tx.exec(MIGRATION.sql);
    const result = { granted: granted.update, tables: {} };
    for (const table of DIRECT_WRITE_TABLES) {
      for (const role of API_ROLES) result.tables[`${role} ${table}`] = await privileges(role, table, tx);
    }
    await tx.rollback();
    return result;
  });
  assert.equal(after0015.granted, true, 'the column grant was in place before 0015 ran');
  for (const [label, { insert, update, delete: remove }] of Object.entries(after0015.tables)) {
    assert.deepEqual({ insert, update, delete: remove }, { insert: false, update: false, delete: false }, label);
  }
});

test('a signed-in owner still reads their own rows but cannot write them directly, and every policy stays as a second guard', async () => {
  const probe = { profiles: ['county', 'id'], household_bands: ['has_child', 'profile_id'], symptom_logs: ['note', 'profile_id'], notification_prefs: ['season_summary', 'profile_id'] };
  for (const table of DIRECT_WRITE_TABLES) {
    const [column, owner] = probe[table];
    const seen = await db.asRole('authenticated', ALICE, (tx) => tx.query(`select count(*)::int as n from public.${table} where ${owner} = $1`, [ALICE]));
    assert.equal(seen.rows[0].n, 1, `alice reads her ${table} row`);
    const attempts = {
      insert: `insert into public.${table} (${owner}) values ('${ALICE}')`,
      update: `update public.${table} set ${column} = ${column} where ${owner} = '${ALICE}'`,
      delete: `delete from public.${table} where ${owner} = '${ALICE}'`,
    };
    for (const [command, statement] of Object.entries(attempts)) {
      await assert.rejects(
        db.asRole('authenticated', ALICE, (tx) => tx.query(statement)),
        new RegExp(`permission denied for table ${table}`),
        `alice ${command} on ${table}`,
      );
    }
  }
  const { rows } = await db.query(
    `select tablename, count(*)::int as n from pg_policies where schemaname = 'public' and tablename = any ($1) group by tablename order by tablename`,
    [DIRECT_WRITE_TABLES],
  );
  assert.deepEqual(Object.fromEntries(rows.map((row) => [row.tablename, row.n])), {
    household_bands: 4, notification_prefs: 3, profiles: 3, symptom_logs: 4,
  });
});

// ---------------------------------------------------------------------------
// Re-running 0015
// ---------------------------------------------------------------------------

test('running 0015 again leaves the schema, the grants and the data exactly as they were', async () => {
  const before = await runAudit(db);
  const { rows: rowsBefore } = await db.query('select * from public.symptom_logs order by id');
  await db.applyMigration(MIGRATION);
  await db.applyMigration(MIGRATION);
  assert.deepEqual(await runAudit(db), before);
  assert.deepEqual((await db.query('select * from public.symptom_logs order by id')).rows, rowsBefore);
  assert.deepEqual(Object.keys(await symptomChecks()).sort(), [...NEW_CHECKS, 'symptom_logs_severity_check'].sort(), 'no duplicate constraints');
});
