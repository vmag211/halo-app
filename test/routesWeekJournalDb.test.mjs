/**
 * My Week's Journal end to end (migration 0034, lib/weekJournalStore.js): the
 * `weekJournal` collection through GET /api/frontend/workspace, POST
 * /api/frontend/workspace/commands and GET /api/operations?domain=workspace,
 * stored in the journal table that already existed (public.symptom_logs),
 * with 0034's REAL functions and the REAL 0017 ledger on PGlite below the
 * routes and the CLIENT's own runtime, adapter and validators above them
 * (test/helpers/workspaceWorld.mjs, the provider's decisions in
 * test/helpers/frontendB11.mjs).
 *
 * Covered: create, edit, reload, remove (and a stale remove), a change of
 * date, an entry written before 0034 or by the legacy route, one entry per
 * day and group, the table's own rules, the home check, a lost answer and its
 * reconcile, Patterns and Season over the saved entries, and the privacy
 * integration (the export includes them; Clear Journal and clear all remove
 * them). The flag off is the honest "not available yet" (no retry).
 *
 * Everything is local: synthetic identities, PGlite, a fetch that throws on any host.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDb, listMigrations } from './db/pgliteHarness.mjs';
import { pgliteSelect } from './db/pgliteSelect.mjs';
import { createWorld, body, sampleRecord, COMMANDS, JOURNAL_ON } from './helpers/workspaceWorld.mjs';
import { validProductionCollection } from './helpers/frontendB11.mjs';
import { loadFrontend } from './frontend-test-loader.mjs';

const { REFUSALS, JOURNAL_OFF, WORKSPACE_COLLECTIONS } = await import('../lib/workspaceStore.js');
const { bandFromTable, bandToTable, entryFromRecord, recordFromRow, JOURNAL_TITLE } = await import('../lib/weekJournalStore.js');
const { buildExportDocument } = await import('../lib/privacyExport.js');
const { analyzeHistory, seasonBounds } = await loadFrontend('week-evidence-preview');

const TODAY = '2026-10-22';
const NOTE = 'PRIVATE-JOURNAL-MARKER woke up wheezing after the leaf burn';

let db;
before(async () => { db = await createDb(); });
after(async () => { await db?.close(); });

/** A loaded My Week for `who` with the journal stored, every collection the provider preloads. */
async function loaded(w, who = 'alice', options = {}) {
  const ws = w.workspace(who, options);
  await ws.loadAll(WORKSPACE_COLLECTIONS);
  return ws;
}
const journalWorld = (options = {}) => createWorld(db, { env: JOURNAL_ON, ...options });
/** A check-in as WeekJournal.tsx saves one: its id is journal:<home>:<date>:<group>. */
function checkIn(w, date, over = {}) {
  const band = over.band ?? 'household';
  return sampleRecord('weekJournal', { id: `journal:${w.home.alice}:${date}:${band}`, title: `${date} check-in`, homeContextId: w.home.alice, date, ...over });
}
const locked = (ws) => ws.state.unknownOperations.map((item) => item.operationId);

test('the adapter maps the screen and the table both ways, and refuses what the table could not hold', () => {
  assert.equal(bandToTable('toddler'), 'has_toddler');
  assert.equal(bandToTable('household'), 'household');
  assert.equal(bandFromTable('has_respiratory'), 'respiratory');
  assert.equal(bandFromTable('household'), 'household');
  const base = { id: 'j', title: 't', revision: 1, date: '2026-10-20', band: 'teen', fine: false, symptoms: ['Cough'], severity: 'moderate', illness: true, note: '', recalled: true };
  assert.deepEqual(entryFromRecord(base, { today: TODAY }), {
    ok: true,
    homeContextId: null,
    entry: { entry_date: '2026-10-20', band: 'has_teen', symptoms: ['Cough'], severity: 'moderate', note: null, retrospective: true, possibly_illness: true },
  });
  const fine = entryFromRecord({ ...base, fine: true, symptoms: [], severity: '' }, { today: TODAY });
  assert.deepEqual([fine.ok, fine.entry.symptoms, fine.entry.severity], [true, [], null]);
  for (const [label, broken] of [
    ['fine with symptoms', { ...base, fine: true }],
    ['fine with a rating', { ...base, fine: true, symptoms: [], severity: 'mild' }],
    ['neither fine nor a symptom nor a rating', { ...base, symptoms: [], severity: '' }],
    ['a rating outside the three', { ...base, severity: 'severe' }],
    ['a journal:<date>:<group> id for another day', { ...base, id: 'journal:2026-10-05:has_teen' }],
    ['a journal:<date>:<group> id for another group', { ...base, id: 'journal:2026-10-20:household' }],
    ['a group the table does not know', { ...base, band: 'pet' }],
    ['a note over 500 characters', { ...base, note: 'n'.repeat(501) }],
    ['a date after tomorrow', { ...base, date: '2026-10-30' }],
    ['a date before 2000', { ...base, date: '1999-12-31' }],
    ['more than 20 symptoms', { ...base, symptoms: Array.from({ length: 21 }, (_, at) => `s${at}`) }],
  ]) assert.equal(entryFromRecord(broken, { today: TODAY }).ok, false, label);
  // What the table has always held stays editable: a rating with no symptoms, symptoms with no rating,
  // and an entry's own derived id.
  for (const [label, kept] of [
    ['a rating with no symptoms', { ...base, symptoms: [] }],
    ['symptoms with no rating', { ...base, severity: '' }],
    ['its own derived id', { ...base, id: 'journal:2026-10-20:has_teen' }],
  ]) assert.equal(entryFromRecord(kept, { today: TODAY }).ok, true, label);
  // A legacy row: no app id, a rating with no symptoms.
  const legacy = recordFromRow({ id: 'journal:2026-09-01:has_child', revision: 3, entry_date: '2026-09-01', band: 'has_child', symptoms: [], severity: 'mild', note: null, retrospective: false, possibly_illness: false, home_context_id: null });
  assert.deepEqual(legacy, { id: 'journal:2026-09-01:has_child', title: JOURNAL_TITLE, revision: 3, date: '2026-09-01', band: 'child', fine: false, symptoms: [], severity: 'mild', illness: false, note: '', recalled: false });
  assert.ok(validProductionCollection('weekJournal', [legacy]), 'the client accepts what the adapter reads back');
});

test('flag off: the journal is a settled "not available yet", no save is sent, and a direct command stores nothing', async () => {
  const w = await createWorld(db);
  const ws = await loaded(w);
  assert.deepEqual(ws.status('weekJournal'), { status: 'error', complete: false, featureUnavailable: true, message: JOURNAL_OFF.load });
  assert.equal(await ws.write('weekJournal', checkIn(w, TODAY)), false);
  assert.equal(ws.state.message, 'Saving these records is not available yet. Nothing was saved, and your draft is kept.');
  const raw = await (await w.command(body({ kind: 'write', collection: 'weekJournal', record: checkIn(w, TODAY), expectedRevision: null }))).json();
  assert.deepEqual([raw.status, raw.reason, raw.message], ['failed', 'week_journal_unavailable', JOURNAL_OFF.write]);
  assert.deepEqual(await w.journalRows('alice'), []);
});

test('create, edit, reload and remove through the client, stored in symptom_logs, with the safeguard on a stale remove', async () => {
  const w = await journalWorld();
  const ws = await loaded(w);
  assert.deepEqual(ws.status('weekJournal'), { status: 'ready', revision: undefined, complete: true, message: undefined });
  const entry = checkIn(w, '2026-10-20', { band: 'toddler', symptoms: ['Wheezing', 'Cough'], severity: 'moderate', note: NOTE });
  assert.equal(await ws.write('weekJournal', entry), true, ws.state.message);
  assert.equal(ws.state.message, 'Saved.');
  assert.deepEqual(ws.records.weekJournal.map((row) => [row.id, row.revision, row.band, row.severity, row.note, row.homeContextId]),
    [[entry.id, 1, 'toddler', 'moderate', NOTE, w.home.alice]]);
  assert.deepEqual(await w.journalRows('alice'), [{
    record_id: entry.id, revision: 1, entry_date: '2026-10-20', band: 'has_toddler', symptoms: ['Wheezing', 'Cough'], severity: 'moderate',
    note: NOTE, retrospective: false, possibly_illness: false, home_context_id: w.home.alice,
  }]);
  assert.ok(!(await w.ledgerText()).includes('PRIVATE-JOURNAL-MARKER'), 'the ledger holds names, ids and revisions only');

  // Edit: felt fine instead.
  const stored = ws.records.weekJournal[0];
  assert.equal(await ws.write('weekJournal', { ...stored, fine: true, symptoms: [], severity: '', note: '' }), true, ws.state.message);
  assert.deepEqual(ws.records.weekJournal.map((row) => [row.revision, row.fine, row.symptoms, row.severity]), [[2, true, [], '']]);

  // Reload on another device: the same rows.
  const again = await loaded(w);
  assert.deepEqual(again.records.weekJournal, ws.records.weekJournal);
  assert.ok(validProductionCollection('weekJournal', again.records.weekJournal));

  // The other device edits; this one's remove is now stale and is refused, nothing removed.
  assert.equal(await again.write('weekJournal', { ...again.records.weekJournal[0], illness: true }), true);
  const staleRemove = await (await w.command(body({ kind: 'remove', collection: 'weekJournal', recordId: entry.id, expectedRevision: 2 }))).json();
  assert.deepEqual([staleRemove.status, staleRemove.reason], ['failed', 'stale_revision']);
  assert.equal((await w.journalRows('alice')).length, 1);

  // Remove at the current revision.
  assert.equal(await again.remove('weekJournal', entry.id, 3), true, again.state.message);
  assert.deepEqual(again.records.weekJournal, []);
  assert.deepEqual(await w.journalRows('alice'), []);
  assert.deepEqual(locked(again), []);

  // Undo delete: the same entry saved again as new.
  assert.equal(await again.write('weekJournal', { ...stored, revision: 0 }), true, again.state.message);
  assert.deepEqual(again.records.weekJournal.map((row) => [row.id, row.revision]), [[entry.id, 1]]);
});

test('a change of date is a new entry for that day; the first is kept; another group on the same day is its own entry', async () => {
  const w = await journalWorld();
  const ws = await loaded(w);
  assert.equal(await ws.write('weekJournal', checkIn(w, '2026-10-20')), true);
  assert.equal(await ws.write('weekJournal', checkIn(w, '2026-10-21', { recalled: true })), true);
  assert.equal(await ws.write('weekJournal', checkIn(w, '2026-10-21', { band: 'senior', fine: true, symptoms: [], severity: '' })), true);
  assert.deepEqual((await w.journalRows('alice')).map((row) => [row.entry_date, row.band, row.retrospective]),
    [['2026-10-20', 'household', false], ['2026-10-21', 'has_senior', false], ['2026-10-21', 'household', true]]);
  // Newest first from the server.
  assert.deepEqual(ws.records.weekJournal.map((row) => row.date), ['2026-10-21', '2026-10-21', '2026-10-20']);
});

test('one entry per day and group: another id for a taken day (another home or device) is refused with its sentence, nothing changes', async () => {
  const w = await journalWorld();
  const ws = await loaded(w);
  assert.equal(await ws.write('weekJournal', checkIn(w, '2026-10-20')), true);
  const other = { ...checkIn(w, '2026-10-20'), id: 'journal:another-home:2026-10-20:household', severity: 'bad' };
  assert.equal(await ws.write('weekJournal', other), false);
  assert.equal(ws.state.message, REFUSALS.journal_day_taken.message);
  assert.deepEqual(locked(ws), [], 'a refusal does not lock');
  assert.deepEqual((await w.journalRows('alice')).map((row) => row.severity), ['mild']);
  // The commit function says the same under its lock, if the early check is passed.
  const op = crypto.randomUUID();
  await db.query(`insert into public.operations (operation_id, profile_id, domain, kind, status, request_hash) values ($1, $2, 'workspace', 'workspace.write', 'pending', 'x')`, [op, w.ids.alice]);
  await assert.rejects(db.asService((tx) => tx.query('select public.commit_week_journal($1, $2, $3::jsonb)', [w.ids.alice, op, JSON.stringify({
    kind: 'write', id: other.id, expectedRevision: null, homeContextId: null,
    entry: { entry_date: '2026-10-20', band: 'household', symptoms: ['Cough'], severity: 'bad', note: null, retrospective: false, possibly_illness: false },
  })]), { commit: true }), /HALO_JOURNAL_DAY_TAKEN/);
  // The SQL backstop for an id in the legacy form that names another day.
  await assert.rejects(db.asService((tx) => tx.query('select public.commit_week_journal($1, $2, $3::jsonb)', [w.ids.alice, op, JSON.stringify({
    kind: 'write', id: 'journal:2026-10-05:household', expectedRevision: null, homeContextId: null,
    entry: { entry_date: '2026-10-09', band: 'household', symptoms: ['Cough'], severity: 'bad', note: null, retrospective: false, possibly_illness: false },
  })]), { commit: true }), /HALO_INVALID_INPUT/);
});

test('the table\'s rules and the home are checked before any claim or under the lock; another household\'s home is refused', async () => {
  const w = await journalWorld();
  const send = async (record) => (await w.command(body({ kind: 'write', collection: 'weekJournal', record, expectedRevision: null }))).json();
  const claims = async () => Number((await db.query('select count(*)::int as n from public.operations where profile_id = $1', [w.ids.alice])).rows[0].n);
  const before = await claims();
  for (const record of [
    checkIn(w, '2026-10-20', { fine: true }),
    checkIn(w, '2026-10-20', { symptoms: [], severity: '' }),
    // Would read back with the id a later legacy save of 2026-10-05 gets (two rows, one id).
    checkIn(w, '2026-10-20', { id: 'journal:2026-10-05:household' }),
    checkIn(w, '2026-10-20', { note: 'n'.repeat(501) }),
    checkIn(w, '2026-10-20', { band: 'pet' }),
  ]) {
    const answer = await send(record);
    assert.deepEqual([answer.status, answer.reason], ['failed', 'invalid_record'], JSON.stringify(record).slice(0, 80));
  }
  assert.equal(await claims(), before, 'an invalid record records nothing');
  const foreign = await send(checkIn(w, '2026-10-20', { homeContextId: w.home.bob }));
  assert.deepEqual([foreign.status, foreign.reason], ['failed', 'invalid_reference']);
  assert.deepEqual(await w.journalRows('alice'), []);
  assert.deepEqual(await w.journalRows('bob'), []);
});

test('an entry from before 0034 (or the legacy route) loads with its derived id, edits keep that id, and a legacy save makes an older copy stale', async () => {
  const w = await journalWorld();
  await db.query(`insert into public.symptom_logs (profile_id, entry_date, band, symptoms, severity, note) values ($1, '2026-10-01', 'has_child', array['Sneezing'], 'mild', 'older')`, [w.ids.alice]);
  const ws = await loaded(w);
  const [legacy] = ws.records.weekJournal;
  assert.deepEqual([legacy.id, legacy.revision, legacy.band, legacy.note, 'homeContextId' in legacy], ['journal:2026-10-01:has_child', 1, 'child', 'older', false]);
  assert.equal(await ws.write('weekJournal', { ...legacy, severity: 'bad' }), true, ws.state.message);
  assert.deepEqual(ws.records.weekJournal.map((row) => [row.id, row.revision, row.severity]), [['journal:2026-10-01:has_child', 2, 'bad']]);
  assert.equal((await w.journalRows('alice'))[0].record_id, 'journal:2026-10-01:has_child', 'the id is written down on the first edit');
  // The legacy route's upsert (the same statement it runs) bumps the revision too.
  await db.query(`insert into public.symptom_logs (profile_id, entry_date, band, symptoms, severity, note) values ($1, '2026-10-01', 'has_child', array['Cough'], 'mild', null)
    on conflict (profile_id, entry_date, band) do update set symptoms = excluded.symptoms, severity = excluded.severity, note = excluded.note`, [w.ids.alice]);
  assert.equal(await ws.write('weekJournal', { ...ws.records.weekJournal[0], note: 'stale tab' }), false);
  assert.equal(ws.state.message, REFUSALS.stale_revision.message);
  assert.deepEqual((await w.journalRows('alice')).map((row) => [row.revision, row.symptoms]), [[3, ['Cough']]]);
  // Moving a legacy-id entry to another day would let a later legacy save share its id: refused.
  await ws.retry('weekJournal');
  assert.equal(await ws.write('weekJournal', { ...ws.records.weekJournal[0], date: '2026-10-02' }), false);
  assert.equal(ws.state.message, REFUSALS.invalid_record.message);
});

test('an older entry with a rating and no symptoms can be edited, deleted and restored by Undo', async () => {
  const w = await journalWorld();
  await db.query(`insert into public.symptom_logs (profile_id, entry_date, band, symptoms, severity) values ($1, '2026-10-03', 'household', '{}', 'mild')`, [w.ids.alice]);
  const ws = await loaded(w);
  const [older] = ws.records.weekJournal;
  assert.deepEqual([older.fine, older.symptoms, older.severity], [false, [], 'mild']);
  assert.equal(await ws.write('weekJournal', { ...older, note: 'added later' }), true, ws.state.message);
  const edited = ws.records.weekJournal[0];
  assert.equal(await ws.remove('weekJournal', edited.id, edited.revision), true, ws.state.message);
  assert.equal(await ws.write('weekJournal', { ...edited, revision: 0 }), true, ws.state.message);
  assert.deepEqual((await w.journalRows('alice')).map((row) => [row.entry_date, row.severity, row.note]), [['2026-10-03', 'mild', 'added later']]);
});

test('a save whose answer is lost after the commit stays succeeded: the client locks, reconciles to "Saved." and holds the entry', async () => {
  const w = await journalWorld();
  let lose = true;
  const ws = await loaded(w, 'alice', { lose: (path) => path === COMMANDS && lose && !(lose = false) });
  const entry = checkIn(w, '2026-10-19');
  assert.equal(await ws.write('weekJournal', entry), false);
  const [id] = locked(ws);
  assert.ok(id, 'locked on the unconfirmed save');
  assert.equal((await w.journalRows('alice')).length, 1, 'the commit happened');
  assert.equal(await ws.reconcile(id), true, ws.state.message);
  assert.equal(ws.state.message, 'Saved.');
  assert.deepEqual(locked(ws), []);
  assert.deepEqual(ws.records.weekJournal.map((row) => [row.id, row.revision]), [[entry.id, 1]]);
});

test('Patterns and Season read the saved check-ins: logged, felt fine, recalled and possible illness, for the current home', async () => {
  const w = await journalWorld();
  const ws = await loaded(w);
  const days = ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20'];
  for (const [at, date] of days.entries()) {
    const fine = at % 2 === 0;
    assert.equal(await ws.write('weekJournal', checkIn(w, date, fine ? { fine: true, symptoms: [], severity: '' } : { illness: at === 5, recalled: at === 3 })), true, ws.state.message);
  }
  const reloaded = (await loaded(w)).records.weekJournal;
  const comparison = { context: w.home.alice, basis: 'daily maximum', version: 'history-v1' };
  const readings = days.map((date, at) => ({ date, factor: 'Air', value: 30 + at, unit: 'AQI', source: 'test', issued: `${date}T06:00:00Z`, basis: 'daily maximum', context: w.home.alice, version: 'history-v1' }));
  const report = analyzeHistory(reloaded, readings, '2026-10-14', '2026-10-20', 'household', 'Air', comparison);
  assert.deepEqual([report.logged, report.fine, report.recalled, report.illness, report.comparable], [7, 4, 1, 1, 5]);
  assert.deepEqual([report.fineCount, report.symptomCount], [4, 1]);
  const fall = seasonBounds('Fall', '2026');
  assert.equal(reloaded.filter((entry) => entry.date >= fall.start && entry.date <= fall.end).length, 7, 'Season counts the saved entries in its bounds');
});

test('the backout in YOUR_TODO.md removes exactly 0034 and keeps every entry; 0034 applies again afterwards', async () => {
  const todo = readFileSync(new URL('../docs/backend/YOUR_TODO.md', import.meta.url), 'utf8').split('\n');
  const at = todo.findIndex((line) => line.trim() === '<!-- backout-0034 -->');
  assert.ok(at >= 0, 'YOUR_TODO.md has the backout-0034 block');
  const open = todo.findIndex((line, index) => index > at && line.trim() === '```sql');
  const close = todo.findIndex((line, index) => index > open && line.trim() === '```');
  const backout = todo.slice(open + 1, close).join('\n');
  const fresh = await createDb();
  try {
    const owner = 'a11ce000-0000-4000-8000-0000000b0034';
    await fresh.exec(`insert into auth.users (id, is_anonymous) values ('${owner}', true);
      insert into public.symptom_logs (profile_id, entry_date, band, symptoms, severity, record_id) values ('${owner}', '2026-10-20', 'household', array['Cough'], 'mild', 'journal:h:2026-10-20:household');`);
    await fresh.exec(backout);
    await fresh.exec(backout);
    const { rows: columns } = await fresh.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'symptom_logs' and column_name in ('revision', 'record_id', 'home_context_id')`);
    assert.deepEqual(columns, []);
    const { rows: functions } = await fresh.query(`select to_regprocedure('public.read_week_journal(uuid)') as r, to_regprocedure('public.commit_week_journal(uuid, uuid, jsonb)') as c`);
    assert.deepEqual(functions, [{ r: null, c: null }]);
    assert.deepEqual((await fresh.query(`select symptoms from public.symptom_logs where profile_id = '${owner}'`)).rows, [{ symptoms: ['Cough'] }], 'the entry stays');
    const migration = listMigrations().find((item) => item.number === 34);
    await fresh.applyMigration(migration);
    assert.deepEqual((await fresh.query(`select revision, record_id from public.symptom_logs where profile_id = '${owner}'`)).rows, [{ revision: 1, record_id: null }]);
  } finally {
    await fresh.close();
  }
});

test('privacy: the export includes saved check-ins; Clear Journal and clear all remove them, and the journal then loads empty', async () => {
  const w = await journalWorld();
  const ws = await loaded(w);
  assert.equal(await ws.write('weekJournal', checkIn(w, '2026-10-20', { note: NOTE })), true);
  assert.equal(await ws.write('weekJournal', checkIn(w, '2026-10-21')), true);

  const exported = await buildExportDocument({ from: (name) => pgliteSelect(db, name) }, { profileId: w.ids.alice, groups: ['journal'], privateText: true });
  assert.deepEqual(exported.document.journal.symptom_logs.map((row) => [row.entry_date, row.note ?? null]).sort(), [['2026-10-20', NOTE], ['2026-10-21', null]]);
  const columns = Object.keys(exported.document.journal.symptom_logs[0]);
  for (const hidden of ['record_id', 'revision', 'home_context_id', 'id', 'profile_id']) assert.ok(!columns.includes(hidden), `${hidden} is withheld`);

  async function clear(owner, scope) {
    const op = crypto.randomUUID();
    await db.query(`insert into public.operations (operation_id, profile_id, domain, kind, status, request_hash) values ($1, $2, 'privacy', $3, 'pending', 'x')`, [op, owner, `privacy.clear.${scope}`]);
    return db.asService(async (tx) => {
      const tables = scope === 'journal' ? ['symptom_logs'] : ['profiles', 'home_contexts', 'household_bands', 'symptom_logs', 'notification_prefs', 'push_subscriptions', 'profile_preferences', 'explore_areas', 'household_actions', 'household_action_preferences', 'luna_conversations', 'luna_turns'];
      const { rows: [{ fp }] } = await tx.query('select public.privacy_fingerprint($1, $2::text[]) as fp', [owner, tables]);
      return (await tx.query('select public.clear_household_records($1, $2, $3, $4) as result', [owner, op, scope, fp])).rows[0].result;
    }, { commit: true });
  }
  await clear(w.ids.alice, 'journal');
  assert.deepEqual(await w.journalRows('alice'), []);
  await ws.retry('weekJournal');
  assert.deepEqual(ws.records.weekJournal, [], 'the journal loads empty after Clear Journal');

  const bobWs = await loaded(w, 'bob');
  assert.equal(await bobWs.write('weekJournal', { ...checkIn(w, '2026-10-20'), id: 'journal:bob-home:2026-10-20:household', homeContextId: w.home.bob }), true, bobWs.state.message);
  await clear(w.ids.bob, 'all');
  assert.deepEqual(await w.journalRows('bob'), [], 'clear all removes the journal too');
});
