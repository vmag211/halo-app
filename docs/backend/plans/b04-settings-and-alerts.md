# B04 Settings and alerts: implementation plan

Spec: `docs/product/ai/HALO_BACKEND_WORKING_SPEC.md` on `origin/codex/october15-review-refinement`, sha256 `fc1fec4b180dc5057b2edf1c2203143d85535b43364502e674d34e04d415be86`. Branch: `vmag211/backend`.

Contract digest, cited and binding where it quotes the frontend: `.superpowers/sdd/b04-settings-alerts-evidence/contract-digest.md` (1,463 lines, file:line citation per claim).

Decision this package implements: Vibhav, 2026-10-18, stop building account recovery and move to the wiring and features the app needs.

## What this package is, and the two things it deliberately drops

Four surfaces were scoped. The digest found two of them unbuildable, and dropping them is the plan's first useful act rather than a failure.

**Dropped: `GET /api/capabilities`.** It has **no consumer**. `ProductionApp.tsx:43` passes no capabilities and nothing calls the operation; there is no response validator, so any body we invent is a guess; and the prose in the wiring packet asks for a rich body the typed contract cannot read. Building it would mean writing a shape nothing checks for a caller that does not exist.

Worse, the digest establishes that the mechanism is dangerous where it does work. `runtime.ts:110` refuses to dispatch an operation whose `enabled` is exactly `false`, before credentials or fetch, and surfaces one fixed string. So **disabling a read operation breaks the UI**: `settings.read` off leaves `snapshot === null` forever (`SettingsWorkspace.tsx:51-52`), and `alerts.read` off makes every mutation return early (`ProductionAlerts.tsx:14`). The `reason` field is declared (`runtime.ts:3`) and rendered nowhere. The honest pattern is the per-domain `{enabled, reason}` snapshot already shipping on `GET /api/account`, not a central capabilities map.

**Dropped: `GET /api/evidence`.** Its validator accepts only `comparison.basis === 'daily maximum'`, while `daily_scores` stores app-time observations collapsed by `latestPerDay`. So a truthful response cannot validate and a validating response is a false provenance claim about how the number was derived. That is a scientific-honesty problem, not a plumbing one, and it is Vibhav's to resolve: either the pipeline starts recording daily maxima, or the contract gains a basis word for what we actually have. A second blocker sits behind it: `comparison.context` must `===` the home context id, which is `null` for any household without a home context although the type declares `string`.

**In scope:** `GET`/`PATCH /api/settings` and `GET /api/alerts` plus `POST /api/alerts/state`, over one new migration.

## Rulings made before execution

- **Ruling S1, the trap that would silently freeze two surfaces.** `unresolvedOperations` is a **lock, not a log**. Any non-empty array makes the whole settings surface and the whole alerts surface read-only until reconciled (`ProductionPreferences.tsx:18`, `ProductionAlerts.tsx:14`). So it must be populated only from genuinely unsettled operations in that domain, never from operation history. `listUnresolvedOperations` in `lib/operations.js` already filters to stored-pending rows, which is the correct behaviour; do not widen it.
- **Ruling S2, neither surface can be served from existing tables, so there is one migration.** Settings needs somewhere for display, quiet hours, calendar and Luna-context values, an aggregate revision, and a three-state tenure that `profiles.renter_mode boolean` cannot express. Alerts needs a per-alert `revision` (the whole optimistic-concurrency contract), a `category`, and a navigation target. One migration, `0021`, covers both. Cost: another hand-applied production step, on top of 0019 and 0020 which are already written and unapplied.
- **Ruling S3, tenure is a new column beside the old one.** Add `tenure text` with a three-value check, and leave `renter_mode` as the derived boolean every existing reader already uses. Migrating the readers is a separate job nobody asked for, and a lossy single column would make `owner` and `other` indistinguishable.
- **Ruling S4, the settings revision is a real column, not a ledger count.** This deliberately differs from the account revision (B02 Ruling 1), and the reason is that we are creating the table anyway, so a column costs no extra migration, and it avoids the wart that ruling accepted: there, a *failed* command advances the revision because the ledger row is written before the effect. A column incremented only on a successful save does not.
- **Ruling S5, the legacy writers must bump the settings revision.** `PUT /api/notifications` and `PUT /api/household` already write `notification_prefs` and `household_bands`, which are inside the settings snapshot. If only `PATCH /api/settings` bumps the revision, a change made through a legacy route is invisible to a settings client holding a stale snapshot, which is a lost-update window on real preferences. So those two routes bump it too. This is additive and should be a few lines; if it turns out to need more, report rather than sprawl.
- **Ruling S6, opening an alert is not reading it.** The contract is explicit and so is the spec: opening an alert or following its destination must not mark it read. Only an explicit `alerts.update` does. Undo is another revision-bound operation, never a local reversal.

## Global constraints

Everything in the B01 to B03 plans' global constraints still applies: identity only from the verified token with owner scoping on the query itself, additive responses, no app-facing em dashes, server-side schema validation on every mutation with the client never authority, nothing proof-bearing in responses or logs, idempotent migrations that degrade cleanly, mutations idempotent only through the existing operation ledger, `node --test` only, the full gate before every commit, conventional commits with no Claude attribution, and scope discipline. Every new table is service-role only: row level security on, no policy, and an explicit revoke, following 0017, 0018 and 0020.

## Tasks

### Task 1: migration 0021 (sequential, blocks both routes)

The preferences table keyed by `profile_id` holding display, quiet-hours, calendar and Luna-context values plus the aggregate `revision`; `profiles.tenure`; and the alerts columns (`revision`, `category`, navigation target). Guardrail declarations the repo requires for a new owned table (`test/helpers/tables.mjs`, `rlsIsolation.test.mjs`, `isolationSeed.mjs`, the privacy inventory), apply steps and a tested `<!-- backout-0021 -->` block in `YOUR_TODO.md`, and clean degradation so both routes report the feature unavailable until it is applied.

Derive every column from the digest's section 8, not from imagination, and record the retention question for preference rows as undecided.

### Task 2a: `GET` and `PATCH /api/settings` (parallel, own worktree)

Group-scoped saves against a captured revision, conflict on a stale one, the full snapshot back on success, and `unresolvedOperations` per Ruling S1. Includes the Ruling S5 revision bump in the two legacy routes, because that is a settings-consistency obligation and belongs with the writer that depends on it.

### Task 2b: `GET /api/alerts` and `POST /api/alerts/state` (parallel, own worktree)

The existing read gains the contract's fields; the new write takes exact `{id, revision}` selections and a read/dismissed patch, returns every selected row with an advancing revision, and is idempotent through the ledger. Opening is not reading (Ruling S6).

### Task 3: contracts, conformance, tracker, checkpoint (sequential, last)

As B03's task 3 did: extend `docs/backend/contracts/`, conformance-test the real handlers against validators transcribed verbatim from the frontend, update the tracker, and write the checkpoint. State plainly what was dropped and why.

## Open questions for Vibhav, tracked not worked around

1. **The evidence basis.** Either the daily pipeline records daily maxima, or the contract gains a word for app-time observations. Until one happens, `GET /api/evidence` cannot be both truthful and valid.
2. **Whether `GET /api/capabilities` should exist at all**, given it has no consumer and the per-domain pattern already works.
3. **Retention for preference rows**, which joins every other open retention period.
