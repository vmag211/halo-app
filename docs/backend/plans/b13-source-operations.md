# B13: operator source operations

Base `origin/vmag211/backend` (f2b49e3). Migration 0027. Night run of 2026-10-20.

## The frontend contract (binding)

- Registry: `lib/frontend/production/runtime.ts:19-21`: `sourceOps.read` GET `/api/operator/sources`,
  `sourceOps.history` GET `/api/operator/sources/history`, `sourceOps.command` POST
  `/api/operator/sources/commands`. A GET body becomes the query string (runtime.ts:89-93); a POST
  carries `Idempotency-Key` (the operation id) and `If-Match` (runtime.ts:97-98).
- Validators: `lib/frontend/production/source-operations-service.ts`: `validSourceOpsSnapshot`
  (:28), `validSource` (:20-27), `validSourceVersion` (:18), `validSourceAudit` (:19),
  `validSourceOpsHistory` (:29), `sourceOpsError` (:30-41), `validSourceOpsReceipt` (:42),
  `sourceReceiptCoversCommand` (:43-48). A denied snapshot must carry no sources and no cursor.
  No string may contain U+2014.
- Screen: `components/production/ProductionSourceOperations.tsx`. Reads with `{cursor}` only when
  the snapshot gave one (:15); a command is `{operationId, sourceId, sourceRevision, target,
  decision, reason, recordedAt, snapshotRevision, locale?}` (:27); a lost answer is reconciled with
  `operations.read` and domain `source-operations` (:29); a `failed` receipt closes the review,
  keeps the reason and shows `message` (:22); 401/403 clears the snapshot (:28).
- Wiring doc: `docs/product/HALO_BACKEND_WIRING_CURRENT.md:101,380,600-611`; X07 at :2985-3016.

## What is built

1. **0027** `operator_roles` (profile_id PK, role viewer|reviewer|publisher, granted_at, granted_by)
   and `source_ops_audit` (append-only: a trigger refuses UPDATE, DELETE and TRUNCATE for every
   role). RLS on, no policies, no grants to anon or authenticated. There is no API that grants a
   role; only SQL in the editor does.
2. **`lib/sourceOps.js`**: the role lookup, the source registry and the snapshot builder.
3. **GET /api/operator/sources**: 401 without a session. A signed-in caller with no role, or an
   anonymous-auth caller, gets the contract's denied snapshot `{role:'denied', revision:1,
   sources:[], unresolvedOperations:[], nextCursor:null}` (200). viewer/reviewer/publisher get
   every registered source that has a stored record, with `allowedDecisions: []`.
4. **GET /api/operator/sources/history**: viewer and up; others 403. `sourceRevision` must be the
   current one (409 otherwise). Audit pages are real (applied entries, 20 per page, keyset cursor).
   Versions are never paged (every version is in the snapshot), so a versions cursor is a 400.
5. **POST /api/operator/sources/commands**: reviewer or publisher; others 403. The body is checked
   with the client's own bounds before anything is recorded (400s). Then the operation ledger,
   domain `source-operations` (the client's reconcile domain, already in `OPERATION_DOMAINS`; the
   brief's `sourceOps` is the operation key, not the domain), and one append-only audit row with
   outcome `refused`. The answer is a 200 receipt `{operationId, status:'failed', reason,
   message}`: `forbidden` (role revoked between check and ledger), `changed` (source or registry
   revision moved), else `unsupported`.

## What a source is, and where its freshness comes from (never invented)

| id | evidence read |
| --- | --- |
| `airnow-current` | newest `daily_scores.created_at` with `aqi_source = 'airnow'` |
| `open-meteo-air` | newest with `aqi_source = 'open-meteo'` |
| `uv-index` | newest with `uv_index` not null (Open-Meteo, OpenUV fallback: the row does not say which) |
| `nws-hourly` | newest with `mold_risk` not null |
| `google-pollen` | newest of the last 50 non-null `pollen_level` rows holding a number |
| `daily-maxima` | `daily_maxima_recorder.last_run_at` and its counts (0025) |
| `arcgis-water-boundaries` | the shared Redis cache's refresh time (`waterGeoRefreshedAt`) |
| `epa-ucmr5` | newest `ucmr5_utilities.created_at` and the row count |
| `census-places`, `census-counties`, `census-nc08` | the bundled file's header (`retrieved`, counts) |
| `ncdeq-lead-inventory` | the bundled file's header |

Only timestamps and counts leave these reads; no household id or value is selected for output.
A source with no stored record is left out of the page rather than given a status: before 0025 the
recorder, with no Redis the ArcGIS cache, with no readings a feed. **Not listed at all:** the
forecast adapters (only per-point, expiring Redis entries; no run record), Mapbox (no record), and
OpenUV on its own (indistinguishable in `daily_scores`). Adding a run record is the way in.

Reference files and the UCMR load each have one version, `status: 'published'` (it is what the
app serves), reviewer "No recorded review". UCMR's evidence is `partial`: `uploadData.js` keeps only
`=` results. Live feeds have no versions and no publication pointer: readings are used as fetched.

## What is refused, and why

Every decision (approve, quarantine, publish, withdraw, translation, retry, rollback,
publish-translation). There is no release registry, candidate, quarantine, publication pointer,
translation or per-source retry job in this backend, so none of them can have a real effect.
`allowedDecisions` is `[]` everywhere, so the screen offers no button, and the route refuses
anything sent anyway. Retry is refused too: the daily job runs every source for every household and
calls paid or quota-limited providers, so a scoped retry needs a job model first.

## Decisions (proposed, Vibhav to confirm)

1. Roles live in `operator_roles`, granted only by SQL; no grant API. Anonymous-auth accounts are
   always denied, even with a row.
2. `operator_roles` and `source_ops_audit` have no foreign key to `profiles`: an access and audit
   record is not household data, so it stays out of the privacy export and clear, and the audit
   outlives an account. A deleted account's role row is inert (its id can never sign in again);
   remove it by hand.
3. Refused commands are audited (who, role, source, revision, target, decision, reason, refusal,
   server time). The snapshot and history show only `applied` entries, so a refusal never looks
   like a recorded decision. Audit retention is not set yet.
4. Freshness rule: a live feed is `current` when its last stored record is under 36 hours old; a
   reference dataset is `current` for 365 days after retrieval, and `nextReview` is that date.
   Live feeds show `nextReview` "Not scheduled".
5. `link` is the latest record's result (HALO does not probe the page); `rejected` is 0 and
   `attempts` 1 where nothing counts them, and the diagnostic says so. `owner` is "Not assigned";
   `terms` is the file's licence where it has one, else "Not recorded in HALO".
6. Revisions: a source's is 1 plus its applied audit entries, the registry's 1 plus all applied
   entries, so both stay 1 until a decision can apply.

## Tests

`test/routesOperatorSources.test.mjs` (harness: anonymous, ordinary, anonymous-auth with a row,
viewer, reviewer, publisher; missing 0027 and 0017; every refusal; replay and mismatch;
reconcile), `test/operatorSourcesDb.test.mjs` (PGlite: 0027 applies twice, no client access,
append-only for every role, the grant SQL), `test/contractsB13.test.mjs` (the client's real
runtime, validators and screen decisions over the real handlers).

## Granting the role (Vibhav, SQL editor, after 0027)

```sql
insert into public.operator_roles (profile_id, role, granted_by)
values ('<your auth user id>', 'publisher', 'vibhav')
on conflict (profile_id) do update set role = excluded.role, granted_at = now(), granted_by = excluded.granted_by;
```
