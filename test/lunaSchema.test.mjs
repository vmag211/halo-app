/**
 * Migration 0020's database rules: Luna's conversations, turns and runs (B03
 * plan, Task 1), on a local in-memory PGlite database (test/db/pgliteHarness.mjs)
 * with the reconstructed baseline and every migration.
 *
 * What the tables are for. A conversation is server held: the client sends one
 * new sentence per turn and never appends its own message to the transcript,
 * so the ordered transcript here, INCLUDING the person's own turn, is the only
 * thing that can be given back to them. A run is one attempt to answer one
 * turn; `POST /api/luna/messages` returns it inside the client's 20 second
 * timeout and the answer arrives later through polling.
 *
 * 1. Free text a person typed. A turn is the most sensitive thing in this
 *    package, so the service role is the only reader: row level security on,
 *    zero policies, no privilege for anon or authenticated, and the owner
 *    cannot read their own conversation directly either.
 * 2. Owner scoped twice. Every row carries `profile_id` and cascades from the
 *    account, and a turn or run also carries a composite foreign key to
 *    (conversation id, owner), so a row can never be attached to another
 *    household's conversation even if route code gets the owner wrong.
 * 3. Order is stored, never derived. `LunaMessage` has no timestamp and the
 *    client renders `messages` in array order, so `seq` is the contract.
 * 4. Only the statuses the client accepts are storable. 'unknown' is not one of
 *    them: like a stale pending row in the operation ledger, it is what a route
 *    reports, never a state the database records. For a run the equivalent
 *    derived answer is 'failed' (lib/luna.js), because `LunaRun.status` has no
 *    'unknown'.
 * 5. A settled run carries its settlement time and an unsettled one does not,
 *    so "still working" and "finished" cannot be confused by a reader.
 * 6. No household data. There is no column here for a reading, a symptom, a
 *    journal entry or a location (Ruling L2), so a later task cannot quietly
 *    store one without a migration that review would see.
 * 7. Deleting the account deletes its conversations, turns and runs.
 * 8. Re-running 0020 changes nothing.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { createDb, listMigrations, MIGRATION_FILE } from './db/pgliteHarness.mjs';

const CONVERSATIONS = 'luna_conversations';
const TURNS = 'luna_turns';
const RUNS = 'luna_runs';
const TABLES = [CONVERSATIONS, TURNS, RUNS];
const API_ROLES = ['anon', 'authenticated'];

const ALICE = 'a11ce000-0000-4000-8000-000000000001';
const BOB = 'b0b00000-0000-4000-8000-000000000002';

const MIGRATION = listMigrations().find((migration) => migration.number === 20);

let db;

/** Runs one statement as the service role, returning the error (or null) rather than throwing. */
async function write(sql, values = [], { commit = false } = {}) {
  try {
    await db.asService((tx) => tx.query(sql, values), { commit });
    return null;
  } catch (error) {
    return error;
  }
}

/** Inserts a row as the service role, returning the error (or null). */
async function insert(table, row, options = {}) {
  const columns = Object.keys(row);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  return write(
    `insert into public.${table} (${columns.join(', ')}) values (${placeholders.join(', ')})`,
    columns.map((column) => row[column]),
    options,
  );
}

/**
 * The household's conversation, created on first use. A household holds
 * exactly one, which is the whole point of the unique key on profile_id, so
 * this is get-or-create rather than insert.
 */
async function conversationFor(owner) {
  const { rows } = await db.asService(
    (tx) =>
      tx.query(
        `insert into public.${CONVERSATIONS} (profile_id) values ($1)
           on conflict (profile_id) do update set profile_id = excluded.profile_id
         returning id`,
        [owner],
      ),
    { commit: true },
  );
  return rows[0].id;
}

/** Appends a turn and returns its id. */
async function turnFor(conversationId, owner, { role = 'user', body = 'How is my air?', ...rest } = {}) {
  const row = { conversation_id: conversationId, profile_id: owner, role, body, ...rest };
  const columns = Object.keys(row);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  const { rows } = await db.asService(
    (tx) =>
      tx.query(
        `insert into public.${TURNS} (${columns.join(', ')}) values (${placeholders.join(', ')}) returning id`,
        columns.map((column) => row[column]),
      ),
    { commit: true },
  );
  return rows[0].id;
}

const count = async (sql, values = []) => (await db.query(sql, values)).rows[0].n;

before(async () => {
  db = await createDb();
  await db.exec(
    `insert into auth.users (id, is_anonymous) values ('${ALICE}', true), ('${BOB}', true)`,
  ); // the 0001 trigger adds their profiles
});

after(async () => {
  await db?.close();
});

test('0020 exists, is named for what it does and applies in order after 0019', () => {
  assert.ok(MIGRATION, 'supabase/migrations has a 0020 migration');
  assert.match(basename(MIGRATION.file), MIGRATION_FILE, 'the file name is four digits and a snake_case name');
  assert.match(MIGRATION.name, /luna/, 'the name says these are Luna\'s tables');
});

test('the three tables hold what the conversation contract needs, and no household data', async () => {
  const columnsOf = async (table) => {
    const { rows } = await db.query(
      `select column_name as name, is_nullable as nullable, data_type as type
         from information_schema.columns
        where table_schema = 'public' and table_name = $1
        order by column_name`,
      [table],
    );
    return Object.fromEntries(rows.map((row) => [row.name, row]));
  };

  const conversations = await columnsOf(CONVERSATIONS);
  for (const column of ['id', 'profile_id', 'revision', 'created_at', 'updated_at']) {
    assert.ok(conversations[column], `${CONVERSATIONS} has ${column}`);
  }
  assert.equal(conversations.profile_id.nullable, 'NO', 'a conversation always has an owner');
  assert.equal(conversations.revision.nullable, 'NO', 'the client requires a revision on every read');

  const turns = await columnsOf(TURNS);
  for (const column of ['id', 'conversation_id', 'profile_id', 'seq', 'role', 'body', 'sources', 'evidence', 'created_at']) {
    assert.ok(turns[column], `${TURNS} has ${column}`);
  }
  assert.equal(turns.seq.nullable, 'NO', 'array order is the contract, so it is stored');
  assert.equal(turns.body.nullable, 'NO', 'a turn is the text somebody typed or Luna wrote');

  const runs = await columnsOf(RUNS);
  for (const column of ['id', 'profile_id', 'conversation_id', 'turn_id', 'client_message_id', 'status', 'message', 'created_at', 'updated_at', 'settled_at']) {
    assert.ok(runs[column], `${RUNS} has ${column}`);
  }
  assert.equal(runs.client_message_id.nullable, 'NO', 'a run is found by the client id as well as by its own');
  assert.equal(runs.settled_at.nullable, 'YES', 'an unsettled run has no settlement time');

  // Ruling L2: Luna answers from the public corpus only in this package.
  for (const table of TABLES) {
    const columns = Object.keys(await columnsOf(table));
    for (const forbidden of ['aqi', 'reading', 'readings', 'symptoms', 'journal', 'household', 'lat', 'lng', 'county', 'note']) {
      assert.equal(columns.includes(forbidden), false, `public.${table} has no ${forbidden} column`);
    }
  }
});

test('a full ordered conversation, including the person\'s own turn, can be read back', async () => {
  const conversation = await conversationFor(ALICE);
  await turnFor(conversation, ALICE, { role: 'user', body: 'What is PFOS?' });
  await turnFor(conversation, ALICE, {
    role: 'assistant',
    body: 'PFOS is a man made chemical.',
    sources: JSON.stringify([{ title: 'EPA', url: 'https://epa.gov/pfas' }]),
    evidence: JSON.stringify([{ kind: 'fact', text: 'PFOS is man made.', sourceIndexes: [0] }]),
  });
  await turnFor(conversation, ALICE, { role: 'user', body: 'And in water?' });

  const { rows } = await db.query(
    `select role, body, sources from public.${TURNS} where conversation_id = $1 order by seq`,
    [conversation],
  );
  assert.deepEqual(
    rows.map((row) => [row.role, row.body]),
    [
      ['user', 'What is PFOS?'],
      ['assistant', 'PFOS is a man made chemical.'],
      ['user', 'And in water?'],
    ],
    'the transcript is ordered and starts with what the person asked',
  );
  assert.deepEqual(rows[0].sources, null, 'a user turn carries no sources');
  assert.deepEqual(rows[1].sources, [{ title: 'EPA', url: 'https://epa.gov/pfas' }]);
});

test('order is stored, so two turns cannot claim the same position', async () => {
  const conversation = await conversationFor(BOB);
  await insert(TURNS, { conversation_id: conversation, profile_id: BOB, seq: 9001, role: 'user', body: 'first' }, { commit: true });
  const clash = await insert(TURNS, { conversation_id: conversation, profile_id: BOB, seq: 9001, role: 'assistant', body: 'second' });
  assert.ok(clash, 'a repeated position is refused');
  assert.match(String(clash.message), /seq|unique/i);
});

test('a turn cannot be attached to another household\'s conversation, even with the owner spelled wrong', async () => {
  const alices = await conversationFor(ALICE);
  const stolen = await insert(TURNS, { conversation_id: alices, profile_id: BOB, role: 'user', body: 'BOB-MARKER' });
  assert.ok(stolen, 'a turn whose owner is not the conversation\'s owner is refused');
  assert.match(String(stolen.message), /foreign key|luna_conversations/i);
});

test('one household\'s conversation is invisible to another at the query level', async () => {
  const conversation = await conversationFor(ALICE);
  await turnFor(conversation, ALICE, { body: 'ALICE-TURN-MARKER' });
  assert.equal(
    await count(`select count(*)::int as n from public.${TURNS} where profile_id = $1 and body = 'ALICE-TURN-MARKER'`, [BOB]),
    0,
    'the marker is not reachable as bob',
  );
  assert.equal(
    await count(
      `select count(*)::int as n from public.${TURNS} t
         join public.${CONVERSATIONS} c on c.id = t.conversation_id
        where c.profile_id = $1 and t.body = 'ALICE-TURN-MARKER'`,
      [BOB],
    ),
    0,
    'and not through the conversation either',
  );
});

test('a household holds one conversation, so a second one cannot be opened behind its back', async () => {
  const owner = ALICE;
  const { rows } = await db.query(`select count(*)::int as n from public.${CONVERSATIONS} where profile_id = $1`, [owner]);
  assert.ok(rows[0].n >= 1, 'alice has a conversation');
  const second = await insert(CONVERSATIONS, { profile_id: owner });
  assert.ok(second, 'a second conversation for the same household is refused');
  assert.match(String(second.message), /profile_id|unique/i);
});

test('a revision is a positive integer, because the client rejects zero', async () => {
  const zero = await write(`update public.${CONVERSATIONS} set revision = 0 where profile_id = $1`, [ALICE]);
  assert.ok(zero, 'revision 0 is refused');
  assert.match(String(zero.message), /revision/);
});

test('only the two roles the client renders are storable', async () => {
  const conversation = await conversationFor(BOB);
  for (const role of ['system', 'Luna', 'tool', '']) {
    const error = await insert(TURNS, { conversation_id: conversation, profile_id: BOB, role, body: 'x' });
    assert.ok(error, `${JSON.stringify(role)} is refused`);
    assert.match(String(error.message), /role/);
  }
});

test('a user turn is capped at the 1000 characters the client can send, an answer at 16000', async () => {
  const conversation = await conversationFor(ALICE);
  assert.equal(await insert(TURNS, { conversation_id: conversation, profile_id: ALICE, role: 'user', body: 'q'.repeat(1000) }), null);
  const long = await insert(TURNS, { conversation_id: conversation, profile_id: ALICE, role: 'user', body: 'q'.repeat(1001) });
  assert.ok(long, 'a user turn longer than the send cap is refused');
  assert.equal(await insert(TURNS, { conversation_id: conversation, profile_id: ALICE, role: 'assistant', body: 'a'.repeat(16000) }), null);
  const huge = await insert(TURNS, { conversation_id: conversation, profile_id: ALICE, role: 'assistant', body: 'a'.repeat(16001) });
  assert.ok(huge, 'an answer the client\'s validator would discard is refused');
  const empty = await insert(TURNS, { conversation_id: conversation, profile_id: ALICE, role: 'user', body: '' });
  assert.ok(empty, 'an empty turn is refused');
});

test('the control characters the client\'s validator rejects cannot be stored, but tabs and newlines can', async () => {
  const conversation = await conversationFor(BOB);
  assert.equal(
    await insert(TURNS, { conversation_id: conversation, profile_id: BOB, role: 'user', body: 'line\tone\nline two\r\n' }),
    null,
    'tab, newline and carriage return are ordinary text',
  );
  for (const code of [1, 8, 11, 12, 14, 31]) {
    const error = await insert(TURNS, {
      conversation_id: conversation,
      profile_id: BOB,
      role: 'user',
      body: `bad${String.fromCharCode(code)}text`,
    });
    assert.ok(error, `U+${code.toString(16).padStart(4, '0')} is refused`);
    assert.match(String(error.message), /body/);
  }
});

test('only an answer carries sources and evidence, never the person\'s own turn', async () => {
  const conversation = await conversationFor(ALICE);
  const sourced = await insert(TURNS, {
    conversation_id: conversation,
    profile_id: ALICE,
    role: 'user',
    body: 'what about this',
    sources: JSON.stringify([{ title: 'EPA', url: 'https://epa.gov/pfas' }]),
  });
  assert.ok(sourced, 'a user turn with sources is refused, because the client discards the conversation for it');
  const evidenced = await insert(TURNS, {
    conversation_id: conversation,
    profile_id: ALICE,
    role: 'user',
    body: 'what about this',
    evidence: JSON.stringify([{ kind: 'fact', text: 'x', sourceIndexes: [0] }]),
  });
  assert.ok(evidenced, 'and so is a user turn with evidence');
});

test('sources and evidence are bounded arrays, the way the client validates them', async () => {
  const conversation = await conversationFor(BOB);
  const source = { title: 'EPA', url: 'https://epa.gov/pfas' };
  const block = { kind: 'fact', text: 'x', sourceIndexes: [0] };
  const tooMany = await insert(TURNS, {
    conversation_id: conversation,
    profile_id: BOB,
    role: 'assistant',
    body: 'answer',
    sources: JSON.stringify(new Array(31).fill(source)),
  });
  assert.ok(tooMany, 'more than 30 sources is refused');
  const tooManyBlocks = await insert(TURNS, {
    conversation_id: conversation,
    profile_id: BOB,
    role: 'assistant',
    body: 'answer',
    sources: JSON.stringify([source]),
    evidence: JSON.stringify(new Array(21).fill(block)),
  });
  assert.ok(tooManyBlocks, 'more than 20 evidence blocks is refused');
  const emptyEvidence = await insert(TURNS, {
    conversation_id: conversation,
    profile_id: BOB,
    role: 'assistant',
    body: 'answer',
    evidence: JSON.stringify([]),
  });
  assert.ok(emptyEvidence, 'empty evidence is refused, because the client rejects it');
  const notAnArray = await insert(TURNS, {
    conversation_id: conversation,
    profile_id: BOB,
    role: 'assistant',
    body: 'answer',
    sources: JSON.stringify({ title: 'EPA' }),
  });
  assert.ok(notAnArray, 'sources must be an array');
});

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

test('a run starts queued and unsettled, and settles with a time', async () => {
  const conversation = await conversationFor(ALICE);
  const turn = await turnFor(conversation, ALICE, { body: 'What is radon?' });
  const error = await insert(
    RUNS,
    {
      profile_id: ALICE,
      conversation_id: conversation,
      turn_id: turn,
      client_message_id: 'c0ffee00-0000-4000-8000-000000000001',
    },
    { commit: true },
  );
  assert.equal(error, null, 'the service role can create a run');
  const { rows } = await db.query(`select status, settled_at from public.${RUNS} where turn_id = $1`, [turn]);
  assert.deepEqual([rows[0].status, rows[0].settled_at], ['queued', null], 'a new run is queued and unsettled');

  assert.equal(
    await write(`update public.${RUNS} set status = 'completed', settled_at = now() where turn_id = $1`, [turn], { commit: true }),
    null,
    'a run settles',
  );
  const settled = await db.query(`select status, settled_at from public.${RUNS} where turn_id = $1`, [turn]);
  assert.equal(settled.rows[0].status, 'completed');
  assert.ok(settled.rows[0].settled_at, 'a settled run records when');
});

test('only the five statuses the client accepts are storable, and unknown is not one of them', async () => {
  const conversation = await conversationFor(BOB);
  const turn = await turnFor(conversation, BOB, { body: 'What is PFOA?' });
  const run = (overrides) => ({
    profile_id: BOB,
    conversation_id: conversation,
    turn_id: turn,
    client_message_id: `b0b00000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`,
    ...overrides,
  });
  for (const status of ['queued', 'generating']) {
    assert.equal(await insert(RUNS, run({ status })), null, `${status} is a valid stored status`);
  }
  for (const status of ['completed', 'failed', 'cancelled']) {
    assert.equal(await insert(RUNS, run({ status, settled_at: '2026-10-18T00:00:00Z' })), null, `${status} is a valid settled status`);
  }
  // Settled, so the only constraint left to fail is the status itself.
  for (const status of ['unknown', 'pending', 'succeeded', 'Queued', '']) {
    const error = await insert(RUNS, run({ status, settled_at: '2026-10-18T00:00:00Z' }));
    assert.ok(error, `${JSON.stringify(status)} is refused`);
    assert.match(String(error.message), /status/);
  }
});

test('a settled run must say when, and an unsettled one must not pretend it finished', async () => {
  const conversation = await conversationFor(ALICE);
  const turn = await turnFor(conversation, ALICE, { body: 'What is ozone?' });
  const base = { profile_id: ALICE, conversation_id: conversation, turn_id: turn, client_message_id: 'a11ce000-0000-4000-8000-00000000000a' };
  const unsettled = await insert(RUNS, { ...base, status: 'completed' });
  assert.ok(unsettled, 'completed with no settlement time is refused');
  assert.match(String(unsettled.message), /settled/);
  const settledQueue = await insert(RUNS, { ...base, status: 'queued', settled_at: '2026-10-18T00:00:00Z' });
  assert.ok(settledQueue, 'queued with a settlement time is refused');
  assert.match(String(settledQueue.message), /settled/);
});

test('a run is found by the client\'s own message id, which is unique per household', async () => {
  const conversation = await conversationFor(BOB);
  const first = await turnFor(conversation, BOB, { body: 'one' });
  const second = await turnFor(conversation, BOB, { body: 'two' });
  const clientId = 'b0b00000-0000-4000-8000-0000000000cc';
  assert.equal(
    await insert(RUNS, { profile_id: BOB, conversation_id: conversation, turn_id: first, client_message_id: clientId }, { commit: true }),
    null,
  );
  const repeat = await insert(RUNS, { profile_id: BOB, conversation_id: conversation, turn_id: second, client_message_id: clientId });
  assert.ok(repeat, 'the same client message id cannot start two runs for one household');
  assert.match(String(repeat.message), /client_message_id|unique/i);
});

test('one turn has at most one run, so a reply cannot be generated twice', async () => {
  const conversation = await conversationFor(ALICE);
  const turn = await turnFor(conversation, ALICE, { body: 'What is PM2.5?' });
  assert.equal(
    await insert(
      RUNS,
      { profile_id: ALICE, conversation_id: conversation, turn_id: turn, client_message_id: 'a11ce000-0000-4000-8000-0000000000d1' },
      { commit: true },
    ),
    null,
  );
  const second = await insert(RUNS, {
    profile_id: ALICE,
    conversation_id: conversation,
    turn_id: turn,
    client_message_id: 'a11ce000-0000-4000-8000-0000000000d2',
  });
  assert.ok(second, 'a second run for the same turn is refused');
  assert.match(String(second.message), /turn_id|unique/i);
});

test('a run message is bounded at the 1000 characters the client will show', async () => {
  const conversation = await conversationFor(BOB);
  const turn = await turnFor(conversation, BOB, { body: 'What is mold risk?' });
  const error = await insert(RUNS, {
    profile_id: BOB,
    conversation_id: conversation,
    turn_id: turn,
    client_message_id: 'b0b00000-0000-4000-8000-0000000000e1',
    status: 'failed',
    settled_at: '2026-10-18T00:00:00Z',
    message: 'm'.repeat(1001),
  });
  assert.ok(error, 'a message the client would discard is refused');
  assert.match(String(error.message), /message/);
});

// ---------------------------------------------------------------------------
// Service role only, ownership, idempotence
// ---------------------------------------------------------------------------

test('row level security is on and none of the three tables carries a policy', async () => {
  for (const table of TABLES) {
    const { rows: [state] } = await db.query(
      `select relrowsecurity as rls from pg_class where oid = ('public.' || $1)::regclass`,
      [table],
    );
    assert.equal(state.rls, true, `${table}: row level security is enabled`);
    const { rows: policies } = await db.query(
      `select policyname from pg_policies where schemaname = 'public' and tablename = $1`,
      [table],
    );
    assert.deepEqual(policies, [], `${table}: no policy, the service role is the only reader`);
  }
});

test('neither anon nor authenticated holds any privilege, so an owner cannot read their own conversation directly', async () => {
  for (const table of TABLES) {
    for (const role of API_ROLES) {
      const { rows: [privileges] } = await db.query(
        `select has_any_column_privilege($1, ($2::text)::regclass, 'SELECT') as select,
                has_any_column_privilege($1, ($2::text)::regclass, 'INSERT') as insert,
                has_any_column_privilege($1, ($2::text)::regclass, 'UPDATE') as update,
                has_table_privilege($1, ($2::text)::regclass, 'DELETE') as delete`,
        [role, `public.${table}`],
      );
      assert.deepEqual(
        privileges,
        { select: false, insert: false, update: false, delete: false },
        `${role} holds no privilege on ${table}`,
      );
    }
  }
});

test('the owner reading their own turns with their own session is denied', async () => {
  for (const table of TABLES) {
    await assert.rejects(
      () => db.asRole('authenticated', ALICE, (tx) => tx.query(`select 1 from public.${table}`)),
      /permission denied/i,
      `a signed-in owner cannot select ${table}`,
    );
  }
});

test('deleting the account deletes its conversations, turns and runs', async () => {
  const conversation = await conversationFor(BOB);
  const turn = await turnFor(conversation, BOB, { body: 'BOB-DELETE-MARKER' });
  await insert(
    RUNS,
    { profile_id: BOB, conversation_id: conversation, turn_id: turn, client_message_id: 'b0b00000-0000-4000-8000-0000000000f1' },
    { commit: true },
  );
  for (const table of TABLES) {
    assert.ok(
      (await count(`select count(*)::int as n from public.${table} where profile_id = $1`, [BOB])) > 0,
      `bob has ${table} rows to lose`,
    );
  }

  await db.exec(`delete from auth.users where id = '${BOB}'`);

  for (const table of TABLES) {
    assert.equal(
      await count(`select count(*)::int as n from public.${table} where profile_id = $1`, [BOB]),
      0,
      `${table} went with the account`,
    );
  }
  // Alice keeps hers.
  assert.ok((await count(`select count(*)::int as n from public.${CONVERSATIONS} where profile_id = $1`, [ALICE])) > 0);
});

test('deleting a conversation deletes its turns and runs, and nothing else', async () => {
  const conversation = await conversationFor(ALICE);
  const turn = await turnFor(conversation, ALICE, { body: 'What is UV?' });
  await insert(
    RUNS,
    { profile_id: ALICE, conversation_id: conversation, turn_id: turn, client_message_id: 'a11ce000-0000-4000-8000-0000000000f2' },
    { commit: true },
  );
  await write(`delete from public.${CONVERSATIONS} where id = $1`, [conversation], { commit: true });
  assert.equal(await count(`select count(*)::int as n from public.${TURNS} where conversation_id = $1`, [conversation]), 0);
  assert.equal(await count(`select count(*)::int as n from public.${RUNS} where conversation_id = $1`, [conversation]), 0);
  assert.ok(
    (await count(`select count(*)::int as n from public.profiles where id = $1`, [ALICE])) === 1,
    'the account itself is untouched',
  );
});

test('running 0020 again changes nothing', async () => {
  const shape = async () => {
    const { rows: columns } = await db.query(
      `select table_name, column_name, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = any($1) order by table_name, column_name`,
      [TABLES],
    );
    const { rows: constraints } = await db.query(
      `select conname from pg_constraint
        where conrelid = any($1::regclass[]) order by conname`,
      [TABLES.map((table) => `public.${table}`)],
    );
    const { rows: indexes } = await db.query(
      `select indexname from pg_indexes where schemaname = 'public' and tablename = any($1) order by indexname`,
      [TABLES],
    );
    return { columns, constraints, indexes };
  };
  const first = await shape();
  await db.exec(MIGRATION.sql);
  assert.deepEqual(await shape(), first, 're-running the migration is a no-op');
});
