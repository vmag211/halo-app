# B02 checkpoint: identity linking and account recovery

Date: 2026-10-17. Branch: `vmag211/backend`. Plan: `docs/backend/plans/b02-identity-linking-and-recovery.md`.

The B01 checkpoint follows this section unchanged and is still the handoff for everything B01 covers. Nothing here is a deployment, provider or approval claim.

## Where B02 stands

| Task | State |
| --- | --- |
| 1. Capability proof and recovery schema | Complete locally at `b529f41` |
| 2. Operation ledger primitive | Complete locally at `6a66347` |
| 3. `GET /api/account`, recovery feature | Complete locally at `44d0b72` |
| 4. Link intent via `POST /api/account/commands` | Not started |
| 5. `POST /api/recovery/request` | Not started |
| 6. Turnstile verification | Blocked: no site key in any environment |
| 7. `POST /api/recovery/status` | Not started |
| 8. `POST /api/recovery/complete` | Not started |
| 9. Device listing and revocation | Not started |
| 10. Contracts, fixtures, tracker, checkpoint | Not started (this file is the interim checkpoint) |

Commits in order: `6a66347` (task 2, from the previous session), `b529f41` (task 1), `44d0b72` (task 3). **All three are unpushed**; `git log origin/vmag211/backend..HEAD` is the current list. Nothing is merged to main, and main/release approval is still Vibhav's.

## What exists

Migration 0017 adds `public.operations`, the idempotency ledger for all 72 frontend operations, with `recovery` as the one domain allowed a null owner because it runs before sign-in. `lib/operations.js` claims an id with an atomic insert-if-absent, so exactly one of several concurrent callers runs the effect; a pending row past its window reads as `unknown` rather than `pending`, and `unknown` is never reported as failure. `GET /api/operations` replays a settled receipt verbatim, and a stranger's id is byte-identical to a nonexistent one. `listUnresolvedOperations` answers the inventory every initial read carries.

Migration 0018 adds `public.recovery_challenges`. Hashes only: `email_hash`, `nonce_hash` and `restore_token_hash` each accept 64 lowercase hex characters and nothing else, so a plaintext address, nonce or token cannot be written to the column. Service role only: row level security on, zero policies, privileges revoked, so not even the owner reads their own challenge. A verified row must carry a token hash, and `consumed_at` cannot be set on a row that never had one. Only the statuses the frontend accepts are storable; `unknown` is never stored.

`GET /api/account?feature=recovery` returns the contract's `AccountSnapshot` for one feature. The capability is off unless `HALO_FEATURE_RECOVERY` is `on` or `true`, enforced in the handler, and while it is off the route reads neither the database nor the auth provider. When on it reports the linked method as a mask with its verification date, the one open challenge with its expiry, an empty `devices` list and the unresolved operation inventory.

## Verification

Gate at `44d0b72`: `node --test test/*.test.mjs` **1,925 passed, 0 failed, 0 skipped, 0 todo**; `npm run typecheck` clean; `npm run lint` **0 errors, the same 5 existing warnings**; `git diff --check` clean. The starting point for this session was 1,871 passing.

Mutation checks were run rather than assumed, and each is recorded in its commit: removing 0018's `revoke` fails 3 tests, gutting a back-out block in `YOUR_TODO.md` fails 5, making the capability flag return true fails 3, returning the address unmasked fails 2, flattening the revision fails 2, and naming a method the SDK does not have fails the capability probe. Everything runs on local fakes or PGlite. No `.env` file was read, no real Supabase project or production URL was contacted, and `scripts/smoke-test.mjs` was not run.

**The review for both tasks was done in this session. It was not an independent subagent review**, which is what the workflow prefers; the evidence is labelled accordingly rather than described as independent.

## Deliberate departures from the plan, with their cost

Recorded in full in the plan's "Rulings made during execution" section: `recovery_operations` is not built because 0017's generic ledger serves recovery too (cost: a recovery-only retention rule is harder to express, and is logged as an open retention decision rather than designed around); the schema ships as 0018 rather than inside 0017 so the ledger can be applied without the recovery schema; and task 1's capability proof is a presence proof, not an end-to-end exchange, because that needs provider access the local boundary excludes.

## Corrections made to existing documents

The spec was being reported as missing. It is not: the complete 521,027-byte working spec is in this repository's git objects on `origin/codex/october15-review-refinement`, sha256 `fc1fec4b...415be86`, which matches the figure in Yogi's wiring packet manifest and was verified this session. `WORKFLOW.md` step 2 now gives the command to read it, `YOUR_TODO.md` Part 3 item 2 is resolved rather than blocking, and the tracker header says which rows came from which source. The stale `Spec text not received` blockers on the DS/MP/UI/AC/ST/WF/AG/MA/VR placeholder rows are marked stale in the header but deliberately not mass-edited: re-baselining the tracker against all 1,630 named requirements is its own task.

`YOUR_TODO.md` gained apply steps and tested back-out blocks for 0017 and 0018 as sections 2.3 and 2.4 (the old 2.3 is now 2.5). 0017's back-out existed only as a comment in the migration and was never in the file the back-out test runs, so it was untested until now.

## Known limits and open gates

- **Recovery is not usable.** Tasks 4, 5, 7, 8 and 9 do not exist, so nothing can link an address or recover an account yet. The flag is off and applying 0018 does not turn it on.
- `recovery.devices` is always an empty list. That is not a claim that a household has no devices; task 9 populates it.
- The end-to-end Supabase session-minting exchange is unproven. Task 8 depends on it and keeps the stated fallback.
- **0015 and 0016 are applied to production** (confirmed 2026-10-17 by the state query in `YOUR_TODO.md` 2.6: `save_household` present, the four checks present, the revoke in effect, `home_contexts` and `daily_scores.home_context_id` present). They were applied after `baseline-audit.deployed.json` was captured, so that file records the pre-migration catalog and is now stale. 0015's four checks were validated the same day (`m15_validated` 4), so 0015 and 0016 are complete there. **0017 is applied to production** (2026-10-17, verification all five columns true). **0018 is applied nowhere.** Both back-out blocks are tested on PGlite only, unlike the 0015 and 0016 blocks which passed a throwaway-project trial.
- Vibhav's blockers are unchanged and were not worked around: no `NEXT_PUBLIC_TURNSTILE_SITE_KEY` in any environment (BE-340, blocks task 6), no backup or restore coverage on the current Supabase plan (BE-307), no recorded recovery objectives (BE-360), and no approved retention periods, including none for a consumed or expired challenge or for settled recovery receipts.
- **One unexplained test failure, seen once and not reproduced.** On a docs-only commit, `routeIsolation.test.mjs` "a request with a junk or foreign-looking token never reaches household data" failed in a full-suite run. It then passed 20 consecutive runs (12 of that file alone, 8 full-suite), and the assertion detail was not captured, so the cause is unknown. Nothing is being claimed about it: it is recorded here because an intermittent failure in an identity-isolation test deserves a prior sighting if it happens again. That test asserts a 401 and an empty query log for three bad tokens across four routes, so a limiter answering 429 or late async work reaching the log are the shapes worth checking first.
- Every B01 limit in the section below still applies.

## Next

Task 4, the link intent, in its own commit with its own review. It must attach a verified email to the signed-in anonymous identity while leaving `auth.users.id`, `profiles.id` and every owned row untouched, treat an address already linked elsewhere as a collision and never a merge, and keep link and recover on separate code paths.

---

# B01 continuation checkpoint

Date: 2026-10-11. Branch: `vmag211/backend`.

This was the current handoff until the B02 section above was added, and it remains the authority for everything B01 covers. `docs/backend-progress.md` records the older September baseline. B01 implementation began at `7894bd7`; the last implementation commit before the work was resumed in a later session was `4b07435` (Task 9c), with carries in `b5bf647`. This continuation began at `4b07435`, committed Task 10 at `d492e9e` and committed Task 11 at `405f2b9`, the commit that first contained this checkpoint. Later commits on the branch are review fixes to Tasks 10 and 11; `git log 405f2b9..HEAD` lists them. Push state: the controller pushes `vmag211/backend` after each reviewed task, so `git log origin/vmag211/backend..HEAD` shows what is not pushed yet. Nothing was merged to main. Main/release approval is still Vibhav's decision.

## What is complete locally

Tasks 1-9c: shared safe errors and validators, isolated route harness, identity/isolation tests, route hardening, reconstructed baseline and read-only audit query, migrations 0015/0016, home list/detail/revision updates, onboarding transitions, backfill state, context-linked daily writes and current-home history/findings. The starting branch's 1,723 tests passed during this session. The 9c review was performed in this session by reading its report, shared history/ownership changes, cron/findings wiring and tests; it was not an independent subagent review. Final risk-focused review also covered verified-token handling, service-role ownership boundaries, shared validation/errors, 0015 transaction/revoke behaviour, 0016 transition/update functions and ownership/cascade test evidence. No blocking issue surfaced in that reviewed scope; this was a self-review, not a comprehensive independent audit. Known limits are listed below.

Task 10: rejected POST/PUT/PATCH/DELETE writes return the original 401 response without replacement identity or replay. GET/HEAD retain one recovery attempt; 503 never triggers identity recovery. `recoverSession()` exposes user-confirmed replacement without replay, not restoration of an old household. Recovery ADR remains proposed. Privacy inventory covers every table in the migrations and reconstructed baseline; a test checks inventory completeness. Existing frontend tests were not edited.

Task 11: OpenAPI 3.1 version `b01-1` for six operations, synthetic success/failure/fallback fixtures, Ajv schema validation and real-handler conformance through the isolated harness, complete received-ID tracker, and this checkpoint/workflow. Frontend types remain handwritten; schema generation/integration is still open. Contracts do not certify source meaning or live provider rights.

Completed local child criteria: HO-065 reconstruction/replay (not deployed capture); HO-066 validation, transactionality, current-home/history and existing route/RLS isolation; HO-099 home operations (not interests/preferences expansion); HO-118 existing envelope/list/conflict semantics (not full pagination/coverage); HO-119 bounded existing writes and rejected-write response retention (not frontend recovery UX/export); HO-131 existing route/database identity isolation and rejected-write behaviour (the row for frontend identity-scoped caches in `lib/frontend/*` is Yogi's and rests on the existing frontend tests); HO-154 local replay/audit tests (not production audit/restore); BE-011, BE-019, BE-020 and BE-024-BE-031 only for the tested child criteria in `requirements-tracker.md`. No full B02-B12 requirement is claimed complete.

## Verification

Gate at `405f2b9` (2026-10-10): `node --test test/*.test.mjs` **1,816 passed, 0 failed, 0 skipped/todo**; `npm run typecheck` clean; `npm run lint` **0 errors, the same 5 existing warnings**; `git diff --check` clean. The tracker covers all 119 distinct received HO/BE definitions with 165 child/dependency rows, and the contract directory contains 52 synthetic JSON fixtures. Task 10: 1,741 tests passed, 0 failed, 0 skipped/todo; typecheck clean; lint 0 errors and 5 pre-existing warnings. Focused contract checks at `405f2b9`: 73 passed after adding internal-error fixtures and removing an unsupported onboarding 409 fixture. All use local fakes or PGlite, never production. The first contract run found two test-setup errors (duplicate seed and accidentally declared missing table), both corrected; the first inventory run found a regex excluding digits in table names, corrected. No unresolved failure is being hidden.

Review fix round after `405f2b9` (independent reviews of Tasks 10 and 11): `node --test test/*.test.mjs` **1,821 passed, 0 failed, 0 skipped/todo** (the 1,816 above plus one contract header-drift test, two Request-object recovery tests and two disclosure validation tests); `npm run typecheck` clean; `npm run lint` **0 errors, the same 5 existing warnings**; the 36 `MODULE_TYPELESS_PACKAGE_JSON` warnings are pre-existing; `git diff --check` clean. The tracker has 165 rows after BE-019 was split. Migrations 0015 and 0016 are still not applied anywhere.

Final-review fix round (after `f56918c`): `node --test test/*.test.mjs` **1,829 passed, 0 failed, 0 skipped/todo** (the 1,821 above plus the 8 tests of `test/migrationBackout.test.mjs`); `npm run typecheck` clean; `npm run lint` **0 errors, the same 5 existing warnings**; the 36 `MODULE_TYPELESS_PACKAGE_JSON` warnings are pre-existing; `git diff --check` clean. The tracker has 166 rows (one HO-159 row for the back-out blocks). The back-out blocks and the `ucmr5_utilities` remedy in `YOUR_TODO.md` are verified locally on PGlite only, not on any Supabase project. The 0016 apply-time locks (ACCESS EXCLUSIVE on `daily_scores`, SHARE ROW EXCLUSIVE on `profiles`, both until commit) were measured on PGlite.

A build and live browser flow were not run because the plan excludes loading `.env*` and real project/provider access. Those remain separate staging/human checks. The existing Node module-type warnings and legacy log lines are not newly introduced by this change. The five lint warnings remain in daily-score, district, backfill, assistantRag.test and uploadData.

## Changed files

This continuation modifies `lib/auth.js`, adds `test/authRecovery.test.mjs` and `test/privacyDisclosure.test.mjs`, and creates `docs/backend/decisions/B01-optional-recovery.md` and `docs/backend/privacy-and-retention.md`. The Task 11 commit also adds two tests to `test/authRecovery.test.mjs` (explicit recovery with no stored session creates one identity, and a failed session read during explicit recovery never signs out or signs in) and corrects the geocoding sentence in `docs/backend/privacy-and-retention.md` (the precise geocoded point goes to service-area lookup before rounding for storage). Task 11 adds `docs/backend/contracts/b01.openapi.json`, `docs/backend/contracts/README.md`, all JSON fixtures in `docs/backend/contracts/fixtures/b01/`, `test/contractsB01.test.mjs`, `docs/backend/requirements-tracker.md`, `docs/backend/checkpoint.md` and `docs/backend/WORKFLOW.md`, and the preserved ruling log at `docs/backend/decisions/B01-implementation-rulings.md`. It adds a current-checkpoint pointer to the historical `docs/backend-progress.md`. It adds dev dependencies `ajv` and `ajv-formats` in `package.json`/`package-lock.json`, and updates/records the existing user TODO. The review fix round also changes `lib/auth.js` (a Request-object write is treated as a write), `test/authRecovery.test.mjs`, `test/contractsB01.test.mjs` (documented and sent `X-Request-Id`/`Retry-After` headers are compared), `test/privacyDisclosure.test.mjs` (cell-level validation), the OpenAPI/README header wording, the privacy disclosure (assistant outbound data), the recovery decision (B and C dependencies) and this documentation set. The final-review fix round rewrites the 0016 header comments (wiring and measured locks; no executable SQL changed), adds `test/migrationBackout.test.mjs`, the tested back-out blocks, the guarded `ucmr5_utilities` remedy and the required throwaway-project trial to `YOUR_TODO.md`, drops a plan reference from a comment in `lib/limits.js`, and updates the tracker, the rulings log and this checkpoint. The full B01 file set is available from `git diff --name-only 7894bd7..HEAD`.

The pre-existing untracked `components/onboarding/mobile-review.css` is unrelated and remains untouched and uncommitted.

## Migrations and human checks

**0015 and 0016 were not applied anywhere at the time this B01 section was written.** They have since been applied to production (2026-10-17); see the B02 section above. Nothing in this B01 section applied them. Do not run `supabase/baseline/reconstructed_baseline.sql` on the real project: it is a local reconstruction with auth stubs.

1. **Done 2026-10-17**, findings in `docs/backend/baseline-audit.deployed.json`. That capture predates the 0015 and 0016 apply, so it now records the pre-migration schema and is marked superseded in the file; re-run `baseline-audit.sql` to capture the post-migration catalog.
2. Check legacy push endpoints and browser writes as described in `YOUR_TODO.md`.
3. **Done for 0015 and 0016**: the throwaway-project trial passed at Postgres 17.6 (including both back-out blocks and re-applying), and Vibhav applied both to production on 2026-10-17. 0015's four checks were validated on 2026-10-17. **Not done for 0017 and 0018**, which are applied nowhere and have been tested on PGlite only; nothing deployed references their tables, so there is no hurry. Do not infer authorization to apply anything from this checkpoint.
4. Review the recovery ADR and privacy disclosure. No choice or retention period is approved. B05 sensitive input remains disabled until both decisions are approved and selected safeguards pass tests.
5. **Resolved:** the complete working spec is in this repository's git objects on `origin/codex/october15-review-refinement` at `docs/product/ai/HALO_BACKEND_WORKING_SPEC.md`, sha256 `fc1fec4b...415be86`, verified 2026-10-17. `WORKFLOW.md` step 2 has the command to read it. Nothing further is needed from Vibhav here.

## Unresolved gates and known limits

- HO-152 interpretation/threshold review, HO-153 recovery, scheduler, storage/scanning, retention and budget decisions, and HO-154 live schema/config audit and restore drill remain open. HO-144 pollen retention and HO-145 geocoder storage rights remain unverified; code tests do not settle them.
- No recovery of an old household is implemented. A confirmed replacement loses access to the old data. GET/HEAD recovery can still replace identity, as the approved Task 10 scope explicitly retained. Yogi must add any explicit recovery/draft resubmission interface.
- No capabilities endpoint, complete export, new attachments, transcript storage or retention purge is implemented. Account cascades cover the existing local schema, not backups or provider copies.
- Homeguard's null utility wording still needs the current context's `service_area_status` to distinguish failed lookup from no match (carried 9b finding, BE-028).
- History reads are bounded before home filtering; very large earlier-home datasets can consume the read cap. `context=all` returns one point per date/home. Legacy unlinked readings are assumed current; pre-context historical moves cannot be reconstructed.
- The onboarding replay's four location fields reflect the saved context; other top-level utility/attribute fields still echo the request. Numeric but out-of-range geocoder points can reach SQL and return 500. Today's cache/assistant/source reads remain household-wide. These carried 9c concerns are not changes in this continuation.
- Profile PATCH's transitional located/no-context race and partial-0016 fallback can leave attributes inconsistent; complete rollout minimizes those already documented windows. Backfill retries can create duplicate date rows; history collapses latest refreshes.
- Migration 0015 can report success after a partial privilege revoke; the manual privilege check is necessary. TRUNCATE/REFERENCES/TRIGGER grants on four older tables and multidimensional symptom-array checks remain deferred hardening items.
- Some older backend copy still has em dashes; new app-facing text in this continuation has none. Approved frontend/archive files were not changed.

## Next package

B01 local code/docs handoff is the stopping boundary, not a deployment claim. Resolve the audit and recovery/privacy decisions and obtain the full spec. B02 evidence/source operations is next, with a new dependency-bounded plan only after its field, relationship and source-acquisition sections are received. B03-B12 must not be guessed from the partial handoff.
