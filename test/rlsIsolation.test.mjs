/**
 * Database-level household isolation: what a signed-in user talking to Supabase
 * directly (the public anon key plus their own session, no HALO route in
 * between) can read and write. The route-level half is routeIsolation.test.mjs
 * and routeIsolationFlows.test.mjs.
 *
 * Runs on a local in-memory PGlite database (test/db/pgliteHarness.mjs) loaded
 * with the reconstructed baseline and every migration, so it proves the
 * policies and privileges as the repository defines them. The baseline is not
 * captured from the deployed database (docs/backend/baseline.md).
 *
 * Guardrail for every later package. Every public table must be declared here,
 * in OWNED_TABLES (household rows, with the owner column) or in
 * PUBLIC_REFERENCE_TABLES (no personal data); a new table in neither fails, as
 * does one with row level security off. Every public function must be declared
 * in PUBLIC_FUNCTIONS. OWNER_DIRECT_ACCESS is what an owner can do to their own
 * rows directly; a migration that changes it must change its line here too.
 *
 * Users: alice and bob each own one seeded row in every owned table. carol has
 * a profile and nothing else, and dave has no profile yet: they are the owners
 * for "insert your own row", so that attempt never collides with a seeded key.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from './db/pgliteHarness.mjs';
import { OWNED_TABLES as ROUTE_HARNESS_OWNED_TABLES } from './helpers/tables.mjs';
import { OWNED_ROW } from './db/ownedRows.mjs';

/** Household tables: table -> the column holding the owner's auth user id, as its policies compare it. */
const OWNED_TABLES = {
  profiles: 'id',                   // baseline; policies in 0001
  daily_scores: 'profile_id',       // baseline; policy in 0001
  home_risks: 'profile_id',         // baseline; policy in 0001
  household_bands: 'profile_id',    // 0002
  symptom_logs: 'profile_id',       // 0003
  alerts: 'profile_id',             // 0006
  notification_prefs: 'profile_id', // 0010
  push_subscriptions: 'profile_id', // 0010
  home_contexts: 'profile_id',      // 0016
  operations: 'profile_id',         // 0017 (nullable only for the unauthenticated 'recovery' domain)
  recovery_challenges: 'profile_id', // 0018
  luna_conversations: 'profile_id', // 0020
  luna_turns: 'profile_id',         // 0020
  luna_runs: 'profile_id',          // 0020
  profile_preferences: 'profile_id', // 0021
  explore_areas: 'profile_id',      // 0022
  household_actions: 'profile_id',  // 0023
  household_action_preferences: 'profile_id', // 0023
  household_action_state: 'profile_id', // 0023
  daily_maxima: 'profile_id',       // 0025 (its home link cascades too)
  household_workspace_records: 'profile_id', // 0026
  household_attachments: 'profile_id', // 0028
  household_summaries: 'profile_id', // 0029
  household_project_generations: 'profile_id', // 0030
};

/**
 * What an owner can do to their own rows directly through the database, which
 * bypasses every route's validation. A command counts when the authenticated
 * role holds the privilege (on the table, or on any one of its columns) and a
 * policy covers it; every other command must be denied. One line per table, in
 * any order: change a line only with the migration that changes that table's
 * surface.
 */
const OWNER_DIRECT_ACCESS = {
  profiles: ['select'],           // 0001 policies; 0015 revokes insert, update, delete (written through the routes only)
  daily_scores: ['select'],       // 0001: written with the service role only
  home_risks: ['select'],         // 0001
  household_bands: ['select'],    // 0002 policies; 0015 revokes insert, update, delete
  symptom_logs: ['select'],       // 0003 policies; 0015 revokes insert, update, delete
  alerts: ['select'],             // 0006: written with the service role only
  notification_prefs: ['select'], // 0010 policies; 0015 revokes insert, update, delete
  push_subscriptions: ['select'], // 0010: written with the service role only
  home_contexts: ['select'],      // 0016: written through its two service-role functions only; anon may not even select
  operations: [],                 // 0017: no policy at all. Receipts are read back only through GET /api/operations, which uses the service role.
  recovery_challenges: [],        // 0018: no policy at all. The caller is not signed in while a challenge is live, and the owner has no reason to read it either: status comes from POST /api/recovery/status, which checks the client nonce first.
  luna_conversations: [],         // 0020: no policy at all. A conversation is read back only through the Luna routes, which use the service role.
  luna_turns: [],                 // 0020: no policy at all. A turn is free text a person typed, so the service role is the only reader.
  luna_runs: [],                  // 0020: no policy at all. A run's status is reported by GET /api/luna/runs/status, never read from the browser.
  profile_preferences: [],        // 0021: no policy at all. The display, quiet-hours, calendar and Luna-context values come back through GET /api/settings, which reads them with the service role.
  explore_areas: [],              // 0022: no policy at all. The saved discovery area comes back through GET /api/explore/area, which reads it with the service role.
  household_actions: [],          // 0023: no policy at all. A task is free text a person typed; My Week reads it through read_household_actions with the service role, and writes it only through commit_household_actions.
  household_action_preferences: [], // 0023: no policy at all. Read and written only inside the two 0023 functions, called by the service role.
  household_action_state: [],     // 0023: no policy at all. The commit version is internal and never leaves the server.
  daily_maxima: [],               // 0025: no policy at all. Written only through record_daily_maxima and read only by GET /api/evidence, both with the service role.
  household_workspace_records: [], // 0026: no policy at all. Free text a person typed; read and written only through the 0026 functions, which only the service role may execute.
  household_attachments: [],      // 0028: no policy at all. Private file records; read and written only through the 0028 functions, which only the service role may execute.
  household_summaries: [],        // 0029: no policy at all. Saved private reports; read and written only through the 0029 functions, which only the service role may execute.
  household_project_generations: [], // 0030: no policy at all. Saved idea sets with the typed interest; read and written only through the 0030 functions, which only the service role may execute.
};

/**
 * Owned tables that deliberately carry NO policy, so not even their owner can
 * reach them directly. This is stricter than a select-own policy, not weaker:
 * the only reader is a route using the service role. A table may be listed here
 * only with the migration that makes it service-only, and the invariant below
 * still proves it has row level security on, zero policies and zero privileges
 * for anon and authenticated. Anything not listed must have an auth.uid()
 * scoped policy as before.
 */
const SERVICE_ONLY_OWNED = new Set([
  'operations', // 0017: receipts are replayed through GET /api/operations only
  'recovery_challenges', // 0018: hashes of an unauthenticated ownership proof; the service role is the only reader
  'luna_conversations', // 0020: served only by the Luna routes, which read it with the service role after verifying the token
  'luna_turns', // 0020: free text a person typed and the answers Luna gave; nothing in the browser reads it directly
  'luna_runs', // 0020: the answer is collected through GET /api/luna/runs/status, never from the table
  'profile_preferences', // 0021: served only by GET/PATCH /api/settings, which read and write it with the service role after verifying the token
  'explore_areas', // 0022: served only by GET/PATCH /api/explore/area, which read and write it with the service role after verifying the token
  'household_actions', // 0023: free text a person typed; read and written only through the two 0023 functions, which only the service role may execute
  'household_action_preferences', // 0023: the same two functions only
  'household_action_state', // 0023: the internal commit version, never emitted
  'daily_maxima', // 0025: dated values at a home's point; the recorder writes and GET /api/evidence reads them with the service role
  'household_workspace_records', // 0026: the Homeguard workspace; read and written only through the 0026 functions, called by the service role
  'household_attachments', // 0028: private file records; read and written only through the 0028 functions, called by the service role
  'household_summaries', // 0029: saved household summaries; read and written only through the 0029 functions, called by the service role
  'household_project_generations', // 0030: saved project idea sets; read and written only through the 0030 functions, called by the service role
]);

/** Tables that hold no personal data. 'read': anyone may read, nobody but the service role writes. 'none': service role only. */
const PUBLIC_REFERENCE_TABLES = {
  ucmr5_utilities: 'read',  // baseline (reconstructed): EPA UCMR 5 results; 0001 says it is readable with the anon key
  volunteer_orgs: 'read',   // 0004: directory of organizations
  learn_content: 'read',    // 0005: educational content
  assistant_corpus: 'read', // 0007: curated source passages
  water_snapshots: 'none',  // 0010: per-utility reading fingerprints, no policies
  map_layers: 'none',       // 0011: pre-built map layers, no policies
  daily_maxima_recorder: 'none', // 0025: the recorder's one row (recording_from and counts), no policies
  // 0027: staff access and audit records, not household data and not linked to profiles (B13).
  // They hold an operator's account id and the reasons they typed, so no browser role may read them.
  operator_roles: 'none',
  source_ops_audit: 'none',
  // 0028: storage object paths queued for deletion (B14 Ruling A9). A path
  // holds a household id, so no browser role may read it; no owner column on
  // purpose, so an account's deletion cascade cannot take the queue with it.
  attachment_object_sweep: 'none',
};

/** Every function in schema public. 'service_role': only the service role may execute it. 'trigger': runs only as a trigger. */
const PUBLIC_FUNCTIONS = {
  handle_new_user: 'trigger',             // 0001: creates the profile row for a new auth user
  match_assistant_corpus: 'service_role', // 0008, 0013
  save_household: 'service_role',         // 0015: PUT /api/household in one transaction
  transition_home_context: 'service_role',        // 0016: onboarding saves the home (first, same or a move)
  update_home_context_attributes: 'service_role', // 0016: revisioned answers about the current home
  save_settings: 'service_role',                  // 0021: PATCH /api/settings, one transaction per save
  advance_settings_revision: 'trigger',           // 0021: a snapshot value changed, so the settings revision advances
  reconcile_profile_tenure: 'trigger',            // 0021: tenure kept in step with renter_mode
  guard_settled_settings_operation: 'trigger',    // 0021: a settled 'settings' operation keeps its status
  read_household_actions: 'service_role',         // 0023: My Week's one snapshot
  commit_household_actions: 'service_role',       // 0023: a task command and its ledger settle in one transaction
  guard_settled_action_operation: 'trigger',      // 0023: a settled 'actions' operation keeps its status
  privacy_schema_version: 'service_role',         // 0024: privacy.status's probe
  privacy_fingerprint: 'service_role',            // 0024: what a privacy review binds
  privacy_counts: 'service_role',                 // 0024: what a clear would remove, for inspect's count
  clear_household_records: 'service_role',        // 0024: a privacy clear and its ledger settle in one transaction
  purge_privacy_receipts: 'service_role',         // 0024: settled privacy receipts go after 24 hours
  guard_settled_privacy_operation: 'trigger',     // 0024: a settled 'privacy' operation keeps its status
  daily_maxima_schema_version: 'service_role',    // 0025: the evidence routes' probe
  begin_daily_maxima_run: 'service_role',         // 0025: sets recording_from once
  record_daily_maxima: 'service_role',            // 0025: one batch of daily maxima, pending rows only rewritten
  finish_daily_maxima_run: 'service_role',        // 0025: the last run's time and counts
  guard_final_daily_maximum: 'trigger',           // 0025: a recorded value or a final missing day is never rewritten
  read_household_workspace: 'service_role',       // 0026: the workspace collections, one consistent read
  commit_household_workspace: 'service_role',     // 0026: a workspace command and its ledger settle in one transaction
  workspace_privacy_counts: 'service_role',       // 0026: what clear all removes from the workspace, for inspect's count
  guard_settled_workspace_operation: 'trigger',   // 0026: a settled 'workspace' operation keeps its status
  clear_workspace_with_privacy_clear: 'trigger',  // 0026: clear all removes the workspace in the clear's own transaction
  guard_source_ops_audit: 'trigger',              // 0027: a source operations audit entry is never changed or removed
  household_attachment_json: 'service_role',      // 0028: a file row as the client's HomeAttachment, called inside the 0028 functions
  read_household_attachment: 'service_role',      // 0028: one file of a household, for inspect, download and remove
  household_attachment_usage: 'service_role',     // 0028: a household's file count and bytes, the early limit answer
  check_attachment_references: 'service_role',    // 0028: the files a workspace write names, the early answer
  reserve_attachment_object: 'service_role',      // 0028: queues an upload's object path before its bytes are written
  commit_household_attachment: 'service_role',    // 0028: an upload and its ledger settle in one transaction
  remove_household_attachment: 'service_role',    // 0028: a removal and its ledger settle in one transaction
  attachment_privacy_counts: 'service_role',      // 0028: what clear all removes from the files, for inspect's count
  expire_staged_attachments: 'service_role',      // 0028: staged uploads never linked go after 24 hours
  due_attachment_objects: 'service_role',         // 0028: queued objects the sweep may delete
  forget_attachment_objects: 'service_role',      // 0028: drops queue entries the Storage API deleted
  attachment_storage_state: 'service_role',       // 0028: the verification's view of the private bucket
  guard_settled_attachments_operation: 'trigger', // 0028: a settled 'attachments' operation keeps its status
  link_workspace_attachments: 'trigger',          // 0028: a workspace record names only its own ready files, and links them
  delete_record_attachments: 'trigger',           // 0028: a deleted record's files go with it
  queue_attachment_object: 'trigger',             // 0028: every deleted file queues its storage object
  clear_attachments_with_privacy_clear: 'trigger', // 0028: clear all removes the files in the clear's own transaction
  household_summary_json: 'service_role',         // 0029: a saved summary row as the client's SummarySnapshot, called inside the 0029 functions
  read_household_summaries: 'service_role',       // 0029: the household's archive list
  read_household_summary: 'service_role',         // 0029: one saved summary of a household
  household_summary_usage: 'service_role',        // 0029: how many summaries a household has saved, the early limit answer
  commit_household_summary: 'service_role',       // 0029: a summary and its ledger settle in one transaction
  summary_privacy_counts: 'service_role',         // 0029: what clear all removes from the summaries, for inspect's count
  guard_household_summary_update: 'trigger',      // 0029: a saved summary is never changed
  guard_settled_summary_operation: 'trigger',     // 0029: a settled 'summary' operation keeps its status
  clear_summaries_with_privacy_clear: 'trigger',  // 0029: clear all removes the summaries in the clear's own transaction
  project_generation_json: 'service_role',        // 0030: a saved idea set as the routes answer it, called inside the 0030 functions
  record_project_generation: 'service_role',      // 0030: one request's idea set, kept if its id is already there
  read_project_generation: 'service_role',        // 0030: one saved idea set by its request id
  read_current_project_generation: 'service_role', // 0030: the newest completed idea set
  project_privacy_counts: 'service_role',         // 0030: what clear all removes from the idea sets, for inspect's count
  clear_project_generations_with_privacy_clear: 'trigger', // 0030: clear all removes the idea sets in the clear's own transaction
};

const ALICE = 'a11ce000-0000-4000-8000-000000000001';
const BOB = 'b0b00000-0000-4000-8000-000000000002';
const CAROL = 'ca201000-0000-4000-8000-000000000003';
const DAVE = 'da5e0000-0000-4000-8000-000000000004';

/** Who inserts "their own" new row: dave for profiles (he has none), carol for the rest (her profile exists). */
const newcomerFor = (table) => (table === 'profiles' ? DAVE : CAROL);

/** A valid row for each reference table; `n` varies the key (seeds use 0, attempts use 1). */
const REFERENCE_ROW = {
  ucmr5_utilities: (n) => ({ pwsid: `NC999000${n}`, pws_name: 'Test Utility', status: 'measured', contaminants: {} }),
  volunteer_orgs: (n) => ({ name: `Test Org ${n}`, description: 'Test', url: 'https://example.test' }),
  learn_content: (n) => ({ topic: `test-${n}`, locale: 'en', what_it_is: 'Test' }),
  assistant_corpus: () => ({ source_label: 'Test', source_url: 'https://example.test', retrieved: '2026-01-01', passage: 'Test' }),
  water_snapshots: (n) => ({ pwsid: `NC999000${n}`, fingerprint: 'test' }),
  map_layers: (n) => ({ layer: `test-${n}`, payload: {} }),
  // One row only: an attempt (n = 1) is refused by privilege before the key is reached.
  daily_maxima_recorder: (n) => ({ singleton: true, recording_from: `2026-09-0${n + 1}` }),
  operator_roles: (n) => ({ profile_id: `b1300000-0000-4000-8000-00000000000${n}`, role: 'viewer', granted_by: 'test' }),
  attachment_object_sweep: (n) => ({ object_path: `a77ac000-0000-4000-8000-00000000000${n}/a77ac000-0000-4000-8000-0000000000a${n}` }),
  source_ops_audit: (n) => ({
    operation_id: `b1300000-0000-4000-8000-0000000000a${n}`, actor_profile_id: 'b1300000-0000-4000-8000-000000000000', role: 'reviewer',
    source_id: 'census-places', source_revision: 1, target: 'test', decision: 'approve', reason: 'A test reason.', outcome: 'refused', refusal: 'unsupported',
  }),
};

/**
 * For every declared table, a column that is neither a key nor the owner column, the kind an
 * owner could legitimately change. Update probes self-assign it (`set c = c`), so a grant
 * narrowed to some columns is still detected as update access.
 */
const PROBE_COLUMN = {
  profiles: 'county',
  daily_scores: 'aqi',
  home_risks: 'created_at', // its only column besides the keys
  household_bands: 'has_child',
  symptom_logs: 'note',
  alerts: 'read',
  notification_prefs: 'air_quality_change',
  push_subscriptions: 'p256dh',
  home_contexts: 'water_source',
  operations: 'request_hash',
  recovery_challenges: 'attempts',
  luna_conversations: 'revision',
  luna_turns: 'body',
  luna_runs: 'message',
  profile_preferences: 'display_appearance',
  explore_areas: 'label',
  household_actions: 'title',
  household_action_preferences: 'value',
  household_action_state: 'version',
  daily_maxima: 'value',
  household_workspace_records: 'record',
  household_attachments: 'name',
  household_summaries: 'title',
  household_project_generations: 'idea_set',
  attachment_object_sweep: 'due_at',
  ucmr5_utilities: 'pws_name',
  volunteer_orgs: 'description',
  learn_content: 'what_it_is',
  assistant_corpus: 'passage',
  water_snapshots: 'fingerprint',
  map_layers: 'payload',
  daily_maxima_recorder: 'last_run_at',
  operator_roles: 'granted_by',
  source_ops_audit: 'reason',
};

const COMMANDS = ['select', 'insert', 'update', 'delete'];
const DENIED = /row-level security|permission denied/;

let db;

const ident = (name) => {
  assert.match(name, /^[a-z_][a-z0-9_]*$/, `not a plain identifier: ${name}`);
  return `"${name}"`;
};

function insertStatement(table, row) {
  const columns = Object.keys(row);
  return [
    `insert into public.${ident(table)} (${columns.map(ident).join(', ')}) values (${columns.map((_, at) => `$${at + 1}`).join(', ')})`,
    Object.values(row),
  ];
}

/** Rows `role` (as `userId`) can see, or 'denied' when it may not select at all. */
async function visibleRows(role, userId, table, where = '', values = []) {
  try {
    return await db.asRole(role, userId, async (tx) => {
      const { rows } = await tx.query(`select count(*)::int as n from public.${ident(table)} ${where}`, values);
      return rows[0].n;
    });
  } catch (error) {
    if (/permission denied/.test(error.message)) return 'denied';
    throw error;
  }
}

/**
 * One write attempt, rolled back: 'allowed' when it changed a row, 'denied' when
 * row level security or a missing privilege stopped it (an error, or zero rows).
 * Any other error means the attempt itself is broken, so it is rethrown.
 */
async function attempt(role, userId, statement, values = [], options = {}) {
  try {
    const { affectedRows } = await db.asRole(role, userId, (tx) => tx.query(statement, values), options);
    return affectedRows > 0 ? 'allowed' : 'denied';
  } catch (error) {
    if (DENIED.test(error.message)) return 'denied';
    throw error;
  }
}

/** An update that changes nothing (`set <probe> = <probe>`) on the rows matching `where`: [statement, values]. */
const probeUpdate = (table, where = '', values = []) => {
  const probe = ident(PROBE_COLUMN[table]);
  return [`update public.${ident(table)} set ${probe} = ${probe} ${where}`.trimEnd(), values];
};

async function catalogTables() {
  const { rows } = await db.query(
    `select c.relname as name, c.relrowsecurity as rls
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by c.relname`,
  );
  return rows;
}

async function policiesOf(table, runner = db) {
  const { rows } = await runner.query(
    `select policyname as name, cmd, permissive, roles, qual, with_check
       from pg_policies where schemaname = 'public' and tablename = $1 order by policyname`,
    [table],
  );
  return rows;
}

/**
 * The commands the authenticated role can run on its own rows: privilege and a covering policy,
 * sorted. A grant on even one column counts (has_any_column_privilege is true for a table-level
 * grant or any column grant), so narrowing writes to some columns is still reported as access.
 * `runner` is anything with query(), such as an asRole transaction trying other grants.
 */
async function catalogSurface(table, runner = db) {
  const { rows: [privileges] } = await runner.query(
    `select has_any_column_privilege('authenticated', $1::regclass, 'SELECT') as select,
            has_any_column_privilege('authenticated', $1::regclass, 'INSERT') as insert,
            has_any_column_privilege('authenticated', $1::regclass, 'UPDATE') as update,
            has_table_privilege('authenticated', $1::regclass, 'DELETE') as delete,
            (select relrowsecurity from pg_class where oid = $1::regclass) as rls`,
    [`public.${table}`],
  );
  const policies = await policiesOf(table, runner);
  const covered = (command) =>
    !privileges.rls ||
    policies.some(
      (policy) =>
        policy.permissive === 'PERMISSIVE' &&
        (policy.cmd === 'ALL' || policy.cmd === command.toUpperCase()) &&
        policy.roles.some((role) => role === 'public' || role === 'authenticated'),
    );
  return COMMANDS.filter((command) => privileges[command] && covered(command)).sort();
}

before(async () => {
  db = await createDb();
  // Supabase Auth creates users; here the owner does. The 0001 trigger creates each profile.
  await db.exec(`insert into auth.users (id, is_anonymous) values
    ('${ALICE}', true), ('${BOB}', true), ('${CAROL}', true), ('${DAVE}', true)`);
  await db.exec(`delete from public.profiles where id = '${DAVE}'`);

  // A table without a sample row is skipped here; the declarations test names it.
  await db.asService(
    async (tx) => {
      for (const owner of [ALICE, BOB]) {
        for (const table of Object.keys(OWNED_TABLES)) {
          if (table === 'profiles' || !OWNED_ROW[table]) continue; // profiles: created by the trigger
          await tx.query(...insertStatement(table, OWNED_ROW[table](owner, 0)));
        }
      }
      for (const table of Object.keys(PUBLIC_REFERENCE_TABLES)) {
        if (REFERENCE_ROW[table]) await tx.query(...insertStatement(table, REFERENCE_ROW[table](0)));
      }
    },
    { commit: true },
  );
});

after(async () => {
  await db?.close();
});

// ---------------------------------------------------------------------------
// Guardrails: the catalog against the declarations above
// ---------------------------------------------------------------------------

test('every public table is declared in OWNED_TABLES or PUBLIC_REFERENCE_TABLES', async () => {
  for (const { name } of await catalogTables()) {
    assert.ok(
      name in OWNED_TABLES || name in PUBLIC_REFERENCE_TABLES,
      `public.${name} is in neither OWNED_TABLES nor PUBLIC_REFERENCE_TABLES. Add it to one of them in ` +
        'test/rlsIsolation.test.mjs with a deliberate row level security decision (owner column and ' +
        'OWNER_DIRECT_ACCESS line for household data; read or none for reference data).',
    );
  }
});

test('every declared table exists, is declared once and has its sample row and access line', async () => {
  const existing = new Set((await catalogTables()).map((table) => table.name));
  for (const name of [...Object.keys(OWNED_TABLES), ...Object.keys(PUBLIC_REFERENCE_TABLES)]) {
    assert.ok(existing.has(name), `${name} is declared in test/rlsIsolation.test.mjs but public.${name} does not exist`);
  }
  for (const name of Object.keys(OWNED_TABLES)) {
    assert.ok(!(name in PUBLIC_REFERENCE_TABLES), `${name} is declared both owned and reference`);
    assert.ok(OWNED_ROW[name], `${name}: add an OWNED_ROW sample row`);
    assert.ok(OWNER_DIRECT_ACCESS[name], `${name}: add an OWNER_DIRECT_ACCESS line`);
  }
  for (const [name, access] of Object.entries(PUBLIC_REFERENCE_TABLES)) {
    assert.ok(REFERENCE_ROW[name], `${name}: add a REFERENCE_ROW sample row`);
    assert.ok(['read', 'none'].includes(access), `${name}: reference access must be 'read' or 'none', not ${access}`);
  }
  for (const name of [...Object.keys(OWNED_TABLES), ...Object.keys(PUBLIC_REFERENCE_TABLES)]) {
    assert.ok(PROBE_COLUMN[name], `${name}: add a PROBE_COLUMN (a non-key column the update probes can self-assign)`);
  }
  assert.deepEqual(Object.keys(OWNER_DIRECT_ACCESS).sort(), Object.keys(OWNED_TABLES).sort());
});

test('every probe column exists and is neither a primary key column nor the owner column', async () => {
  for (const [table, probe] of Object.entries(PROBE_COLUMN)) {
    const { rows } = await db.query(
      `select exists (select 1 from pg_index i where i.indrelid = a.attrelid and i.indisprimary and a.attnum = any (i.indkey)) as in_primary_key
         from pg_attribute a where a.attrelid = $1::regclass and a.attname = $2 and a.attnum > 0 and not a.attisdropped`,
      [`public.${table}`, probe],
    );
    assert.equal(rows.length, 1, `PROBE_COLUMN ${table}.${probe} does not exist`);
    assert.equal(rows[0].in_primary_key, false, `PROBE_COLUMN ${table}.${probe} is a primary key column`);
    assert.notEqual(probe, OWNED_TABLES[table], `PROBE_COLUMN ${table}.${probe} is the owner column`);
  }
});

test('the owned tables and owner columns agree with the route harness declarations', () => {
  const sorted = (map) => Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
  assert.deepEqual(sorted(OWNED_TABLES), sorted(ROUTE_HARNESS_OWNED_TABLES), 'test/helpers/tables.mjs and this file disagree about household tables');
});

test('every public table has row level security enabled', async () => {
  for (const { name, rls } of await catalogTables()) {
    assert.equal(rls, true, `public.${name} has row level security disabled, so the API roles' table grants expose every row`);
  }
});

test('there are no views or materialized views in public', async () => {
  const { rows } = await db.query(
    `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('v', 'm')`,
  );
  assert.deepEqual(
    rows.map((row) => row.name),
    [],
    'a view runs with its owner\'s rights and skips row level security unless created with security_invoker; ' +
      'add a deliberate decision and test for it here before adding one',
  );
});

test('every owned table has policies, and each one is scoped to the caller by auth.uid()', async () => {
  for (const table of Object.keys(OWNED_TABLES)) {
    const policies = await policiesOf(table);
    if (SERVICE_ONLY_OWNED.has(table)) {
      // Declared service-only: prove it really is closed, rather than skipping it.
      assert.equal(policies.length, 0, `public.${table} is declared SERVICE_ONLY_OWNED but has ${policies.length} policies`);
      for (const role of ['anon', 'authenticated']) {
        const { rows: [grant] } = await db.query(
          `select has_any_column_privilege($1, $2, 'SELECT')
               or has_any_column_privilege($1, $2, 'INSERT')
               or has_any_column_privilege($1, $2, 'UPDATE')
               or has_table_privilege($1, $2, 'DELETE') as any_access`,
          [role, `public.${table}`],
        );
        assert.equal(grant.any_access, false, `public.${table} is service-only but ${role} still holds a privilege on it`);
      }
      continue;
    }
    assert.ok(policies.length > 0, `public.${table} has no policy referencing auth.uid(), so its owner cannot read it`);
    for (const policy of policies) {
      for (const expression of [policy.qual, policy.with_check].filter(Boolean)) {
        assert.match(
          expression,
          /auth\.uid\(\)/,
          `public.${table} policy "${policy.name}" (${policy.cmd}) is not scoped by auth.uid(): ${expression}`,
        );
      }
    }
  }
});

test('the owner direct-access surface in the catalog matches OWNER_DIRECT_ACCESS', async () => {
  for (const table of Object.keys(OWNED_TABLES)) {
    assert.deepEqual(
      await catalogSurface(table),
      [...OWNER_DIRECT_ACCESS[table]].sort(),
      `public.${table}: what the authenticated role may do (privileges and policies) changed; ` +
        'update OWNER_DIRECT_ACCESS only together with the migration that changes it',
    );
  }
});

test('a column-level grant still counts as direct access, in the catalog surface and in behaviour', async () => {
  // How a later migration might narrow writes: revoke the table privilege, then grant one column back.
  const columnGrant = (tx) =>
    tx.exec('revoke update on public.profiles from authenticated; grant update (county) on public.profiles to authenticated;');
  const fullRevoke = (tx) => tx.exec('revoke update on public.profiles from authenticated;');
  for (const [label, prepare, allowed] of [['column grant', columnGrant, true], ['full revoke', fullRevoke, false]]) {
    const surface = await db.asRole('authenticated', ALICE, (tx) => catalogSurface('profiles', tx), { prepare });
    assert.equal(surface.includes('update'), allowed, `${label}: catalog surface is [${surface.join(', ')}]`);
    const outcome = await attempt('authenticated', ALICE, ...probeUpdate('profiles', 'where id = $1', [ALICE]), { prepare });
    assert.equal(outcome, allowed ? 'allowed' : 'denied', `${label}: alice updating her own profile directly`);
  }
});

test('reference tables: read tables have one public select policy and nothing else, none tables have no policy', async () => {
  for (const [table, access] of Object.entries(PUBLIC_REFERENCE_TABLES)) {
    const policies = (await policiesOf(table)).map((policy) => `${policy.cmd} using ${policy.qual}`);
    assert.deepEqual(policies, access === 'read' ? ['SELECT using true'] : [], `public.${table} policies (declared ${access})`);
  }
});

test('every public function is declared in PUBLIC_FUNCTIONS', async () => {
  const { rows } = await db.query(
    `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and not exists (select 1 from pg_depend d
                         where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
      order by p.proname`,
  );
  for (const { name } of rows) {
    assert.ok(
      name in PUBLIC_FUNCTIONS,
      `public.${name}() is not in PUBLIC_FUNCTIONS. Functions are executable by anon and authenticated by default; ` +
        'declare who may call it and revoke the rest',
    );
  }
  assert.deepEqual(rows.map((row) => row.name), Object.keys(PUBLIC_FUNCTIONS).sort());
});

test('service-role functions cannot be executed by anon or authenticated, and trigger functions only run as triggers', async () => {
  for (const [name, kind] of Object.entries(PUBLIC_FUNCTIONS)) {
    const { rows } = await db.query(
      `select p.oid::regprocedure::text as signature, p.prorettype = 'trigger'::regtype as is_trigger,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
              has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`,
      [name],
    );
    assert.ok(rows.length > 0, `public.${name}() does not exist`);
    for (const fn of rows) {
      if (kind === 'trigger') {
        assert.equal(fn.is_trigger, true, `${fn.signature} is declared a trigger function but does not return trigger`);
      } else {
        assert.deepEqual(
          { anon: fn.anon, authenticated: fn.authenticated, service_role: fn.service_role },
          { anon: false, authenticated: false, service_role: true },
          `${fn.signature} execute privileges`,
        );
      }
    }
  }
});

test('match_assistant_corpus refuses anon and authenticated callers and answers the service role', async () => {
  const call = `select count(*)::int as n from public.match_assistant_corpus(array_fill(0, array[2048])::extensions.vector, 1, 0)`;
  for (const [role, userId] of [['anon', null], ['authenticated', ALICE]]) {
    await assert.rejects(db.asRole(role, userId, (tx) => tx.query(call)), /permission denied for function match_assistant_corpus/, role);
  }
  const { rows } = await db.asService((tx) => tx.query(call));
  assert.equal(rows[0].n, 0); // the seeded passage has no embedding
});

// ---------------------------------------------------------------------------
// Owned tables: alice against bob's rows, her own writes, and anon
// ---------------------------------------------------------------------------

test('the seed is in place: the service role sees one alice row and one bob row in every owned table', async () => {
  for (const [table, owner] of Object.entries(OWNED_TABLES)) {
    for (const user of [ALICE, BOB]) {
      assert.equal(await visibleRows('service_role', null, table, `where ${ident(owner)} = $1`, [user]), 1, `${table} seed for ${user}`);
    }
  }
});

for (const [table, owner] of Object.entries(OWNED_TABLES)) {
  const column = ident(owner);
  const surface = OWNER_DIRECT_ACCESS[table];

  test(`${table}: alice reads only her own rows, none of bob's`, async () => {
    const bobs = await visibleRows('authenticated', ALICE, table, `where ${column} = $1`, [BOB]);
    assert.ok(bobs === 0 || bobs === 'denied', `alice can read ${bobs} of bob's ${table} rows`);
    const notHers = await visibleRows('authenticated', ALICE, table, `where ${column} is distinct from $1`, [ALICE]);
    assert.ok(notHers === 0 || notHers === 'denied', `alice can read ${notHers} ${table} rows that are not hers`);
    const own = await visibleRows('authenticated', ALICE, table, `where ${column} = $1`, [ALICE]);
    assert.equal(own === 1, surface.includes('select'), `alice sees ${own} of her own ${table} rows`);
  });

  test(`${table}: alice cannot insert a row owned by bob`, async () => {
    assert.equal(await attempt('authenticated', ALICE, ...insertStatement(table, OWNED_ROW[table](BOB, 1))), 'denied');
  });

  test(`${table}: alice cannot update or delete bob's rows, or hand her own rows to bob`, async () => {
    const outcomes = {
      'update bob': await attempt('authenticated', ALICE, ...probeUpdate(table, `where ${column} = $1`, [BOB])),
      'delete bob': await attempt('authenticated', ALICE, `delete from public.${ident(table)} where ${column} = $1`, [BOB]),
      'move own to bob': await attempt('authenticated', ALICE, `update public.${ident(table)} set ${column} = $1 where ${column} = $2`, [BOB, ALICE]),
    };
    assert.deepEqual(outcomes, { 'update bob': 'denied', 'delete bob': 'denied', 'move own to bob': 'denied' });
  });

  test(`${table}: an owner's direct writes to their own rows match OWNER_DIRECT_ACCESS (${surface.join(', ')})`, async () => {
    const newcomer = newcomerFor(table);
    const outcomes = {
      insert: await attempt('authenticated', newcomer, ...insertStatement(table, OWNED_ROW[table](newcomer, 1))),
      update: await attempt('authenticated', ALICE, ...probeUpdate(table, `where ${column} = $1`, [ALICE])),
      delete: await attempt('authenticated', ALICE, `delete from public.${ident(table)} where ${column} = $1`, [ALICE]),
    };
    const expected = Object.fromEntries(['insert', 'update', 'delete'].map((command) => [command, surface.includes(command) ? 'allowed' : 'denied']));
    assert.deepEqual(outcomes, expected);
  });

  test(`${table}: anon (no session) sees no rows and cannot write`, async () => {
    const seen = await visibleRows('anon', null, table);
    assert.ok(seen === 0 || seen === 'denied', `anon can read ${seen} ${table} rows`);
    const outcomes = {
      insert: await attempt('anon', null, ...insertStatement(table, OWNED_ROW[table](ALICE, 1))),
      update: await attempt('anon', null, ...probeUpdate(table)),
      delete: await attempt('anon', null, `delete from public.${ident(table)}`),
    };
    assert.deepEqual(outcomes, { insert: 'denied', update: 'denied', delete: 'denied' });
  });
}

// ---------------------------------------------------------------------------
// Reference tables: readable or not as declared, never writable by API roles
// ---------------------------------------------------------------------------

for (const [table, access] of Object.entries(PUBLIC_REFERENCE_TABLES)) {
  test(`${table}: ${access === 'read' ? 'anyone may read it' : 'only the service role may read it'}, and no API role may write it`, async () => {
    const all = await visibleRows('service_role', null, table);
    assert.ok(all > 0, `${table} seed missing`);
    for (const [role, userId] of [['anon', null], ['authenticated', ALICE]]) {
      const seen = await visibleRows(role, userId, table);
      if (access === 'read') assert.equal(seen, all, `${role} reads ${table}`);
      else assert.ok(seen === 0 || seen === 'denied', `${role} can read ${seen} ${table} rows`);

      const outcomes = {
        insert: await attempt(role, userId, ...insertStatement(table, REFERENCE_ROW[table](1))),
        update: await attempt(role, userId, ...probeUpdate(table)),
        delete: await attempt(role, userId, `delete from public.${ident(table)}`),
      };
      assert.deepEqual(outcomes, { insert: 'denied', update: 'denied', delete: 'denied' }, `${role} writing ${table}`);
    }
  });
}
