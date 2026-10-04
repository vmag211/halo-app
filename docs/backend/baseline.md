# HALO schema baseline

The database tests need the schema the migrations start from. That schema was never captured, so it has been reconstructed instead. This page explains what the reconstruction is, how far to trust it, and how to check it against the real HALO project.

## Status: reconstructed and unverified

`supabase/baseline/reconstructed_baseline.sql` was **reconstructed** from the numbered migrations (`0001` to `0014`) and from the code that reads and writes each table. It was **not captured from the deployed database** and has **not been verified against it**. Nothing here says that any migration is or is not applied in the HALO project.

What it contains, in the order a fresh Supabase project would have it:

1. The API roles `anon`, `authenticated` and `service_role` (only `service_role` bypasses row level security).
2. The `auth` and `extensions` schemas.
3. Supabase's default privileges: every table, sequence and function created in `public` is granted to all three roles. Row level security is therefore the only gate on table rows, as on Supabase.
4. An auth stub: `auth.users` (id, email, is_anonymous, created_at), `auth.uid()` and `auth.role()`, which read the JWT claims the way Supabase does.
5. The four tables created by hand before `0001`: `profiles`, `daily_scores`, `home_risks` and `ucmr5_utilities`, with row level security on and no policies (as `0001` describes) and with the original foreign keys that do not cascade (so `0001` really re-creates them).

It is a test fixture, not a migration. Never run it against the HALO project.

## Assumptions to check first

These are the guesses that matter most. The audit below answers each one.

| Assumption | Why it matters | Where to look in the audit result |
|---|---|---|
| `ucmr5_utilities` has row level security **on** with a public read policy. `0001` only says it is "readable with the anon key"; row level security could instead be off. | If it is off, the default grants let anyone with the public anon key **insert, update and delete** EPA reference rows. | `tables` entry for `ucmr5_utilities`: `rls_enabled`; `policies` for that table |
| Row level security is on for `profiles`, `daily_scores` and `home_risks` (`0001` says it already was). | `0001` only enables it again; if a table were ever switched off, every household's rows would be exposed. | `tables`: `rls_enabled` for each |
| The API roles have Supabase's default grants (every privilege) on every public table and function. | The isolation tests assume row level security is the only gate. If the real grants are narrower, the real database is stricter than the tests say. | `table_grants`, `function_grants`, `default_privileges` |
| `match_assistant_corpus` is executable by `service_role` only (`0008`, `0013`). | Otherwise anyone could run the retrieval function directly. | `function_grants` |
| Column types: `daily_scores.uv_index` is a decimal type, `aqi` and `score` are integers, `date` is a `date`, `pollen_level` is text (a JSON string), `profiles.lat`/`lng` are `double precision`, `home_year` and `build_year` are integers, `ucmr5_utilities.contaminants` is `jsonb`. | Inferred from the values the code writes. A wrong type can make an insert fail in production but not in tests. | `tables`: `columns` |
| `daily_scores` and `home_risks` have an `id uuid` primary key; `profiles` and `daily_scores` have a `created_at` default. | No code reads them, so they were assumed. | `tables`: `columns` and `constraints` |
| `home_risks` columns beyond `id`, `profile_id` and `created_at` are unknown (no code uses the table). | Only matters if a later package starts using it. | `tables`: `columns` |
| Every foreign key on a household table cascades from `profiles`, and `profiles` cascades from `auth.users`. | Account deletion relies on it (`DELETE /api/account`). | `foreign_keys`: `on_delete` |

## The local test database (PGlite)

`test/db/pgliteHarness.mjs` boots PGlite (Postgres compiled to WebAssembly, in memory, local to the test process), loads the baseline and applies every migration in numeric order, unmodified.

- **pgvector is real**, from `@electric-sql/pglite-pgvector` (in PGlite 0.5 the extension moved out of the main package, which no longer has `@electric-sql/pglite/vector`). So `0007`, `0008` and `0013` run as written. **No statement is stubbed or skipped.**
- PGlite 0.5.8 is Postgres 18. The HALO project may run an older major version; nothing in the migrations is known to depend on the difference, and the audit's `server_version_num` shows which one it is.
- PGlite has no Supabase services: no PostgREST, no GoTrue, no `authenticator` role. The harness switches roles directly with `set local role` and sets `request.jwt.claim.sub` (and `request.jwt.claims`) the way PostgREST does for a signed-in request.

Tests that use it:

- `test/dbMigrations.test.mjs`: each migration applies in order on the baseline and again straight away; each re-applies over the fully migrated schema without changing it; the audit query is one read-only statement that returns one JSON document and no table rows.
- `test/rlsIsolation.test.mjs`: the guardrail and the cross-household checks (see "Adding a table or function" below).

### Known finding: 0007 cannot be re-run after 0013

`0007_assistant_corpus.sql` says it is safe to re-run, but running it again after `0013` fails: it re-creates the HNSW index on `assistant_corpus.embedding`, and `0013` widened that column to 2,048 dimensions, above HNSW's 2,000 limit (`column cannot have more than 2000 dimensions for hnsw index`). Run in order on a fresh database, everything works. The test is kept as a `todo` in `test/dbMigrations.test.mjs` so it stays visible without failing the suite. Fixing it means editing an applied migration (for example guarding the index), which is Vibhav's call.

## Running the audit (Vibhav)

`docs/backend/baseline-audit.sql` is one read-only `select`. It reads only the system catalogs and returns one row with one JSON column, `halo_baseline_audit`. It returns no rows from any HALO table and no passwords or keys. From the migration ledger it reads only each migration's version and name. The tests run the same file inside a read-only transaction.

1. Open the HALO project in the Supabase dashboard and go to **SQL Editor**, then **New query**.
2. Paste the whole of `docs/backend/baseline-audit.sql` and press **Run**.
3. The result is one row with one cell, `halo_baseline_audit`. Copy that cell's whole value (open the cell, or use the results panel's copy or JSON export; a JSON export of the result rows also works). Do not use a CSV export.
4. Check that what you copied starts with `{` (or `[` for a JSON export) and ends with `}` (or `]`).

## Pasting the result back

Save what you copied as a file, for example `docs/backend/baseline-audit.deployed.json`, then either commit it or give it to Claude in the chat. It holds schema metadata only (table definitions, policies, grants, function settings), no data rows and no secrets, but read it before committing.

## Diffing it against the reconstruction

From the repository root:

```sh
node test/db/pgliteHarness.mjs audit > /tmp/halo-audit-reconstructed.json
node test/db/pgliteHarness.mjs normalize docs/backend/baseline-audit.deployed.json > /tmp/halo-audit-deployed.json
git diff --no-index /tmp/halo-audit-reconstructed.json /tmp/halo-audit-deployed.json
```

The first command builds the reconstructed database in PGlite and runs the same audit on it. The second pretty-prints the deployed result the same way (it also unwraps a JSON export of the result rows). The third shows the differences, with the reconstruction as the old side and the deployed database as the new side.

Differences that are expected and can be ignored:

- `server_version_num`.
- Owner names inside `proacl` and `default_privileges` (`supabase_admin` or `postgres` on Supabase).
- Extra rows in `extensions`, `roles` (`authenticator`) and `auth_users_columns` (Supabase's `auth.users` has many more columns), and extra `default_privileges` entries for Supabase's own roles.
- `supabase_migrations_ledger`: `null` locally; on Supabase it lists whatever was recorded there (migrations pasted into the SQL editor are usually not recorded).

Differences that matter, and what to do:

- **Columns, types, nullability, defaults, constraints, indexes of a pre-0001 table** (`profiles`, `daily_scores`, `home_risks`, `ucmr5_utilities`): update `supabase/baseline/reconstructed_baseline.sql` to match, then run `npm test`.
- **Anything that a migration creates** (a missing column, policy, index or table from `0002` onward): the deployed database is behind the migrations. List which migration is missing; do not change the baseline for it.
- **`rls_enabled` false on any table, a policy that is not in the migrations, or a grant to `anon` or `authenticated` beyond the defaults**: treat it as a possible exposure and raise it before anything else.

## Adding a table or function (later packages)

`test/rlsIsolation.test.mjs` fails when the schema and its declarations disagree:

- A new `public` table must be added to `OWNED_TABLES` (with its owner column, an `OWNED_ROW` sample row and an `OWNER_DIRECT_ACCESS` line) or to `PUBLIC_REFERENCE_TABLES` (`read` or `none`, with a `REFERENCE_ROW` sample row). Row level security must be on.
- Every policy on an owned table must compare against `auth.uid()`.
- `OWNER_DIRECT_ACCESS` lists what an owner may do to their own rows directly through the database, bypassing route validation (privilege and policy together). A migration that changes it, such as revoking owner writes, changes that table's one line.
- A new `public` function must be added to `PUBLIC_FUNCTIONS` (`service_role` or `trigger`). Functions are executable by `anon` and `authenticated` by default, so a `service_role` function must revoke them, as `0008` does.
- A view or materialized view in `public` fails the suite until it has its own deliberate decision and test, because a view skips row level security unless it is created with `security_invoker`.
