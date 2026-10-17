# B02 Identity linking and account recovery: implementation plan

Spec: `docs/product/ai/HALO_BACKEND_WORKING_SPEC.md` on `origin/codex/october15-review-refinement`, sha256 `fc1fec4b180dc5057b2edf1c2203143d85535b43364502e674d34e04d415be86`, 521,027 bytes, verified 2026-10-17. Primary requirements: **BE-174, BE-197, BE-227, BE-263, BE-334, BE-340, BE-351, BE-360**, with **BE-050, BE-199, BE-201, BE-230** as standing constraints. Release gates: **HO-153**, and the recovery half of **HO-131**.

Decision this package implements: `docs/backend/decisions/B01-optional-recovery.md`, **Option B accepted 2026-10-17**, plus Vibhav's 2026-10-17 narrowing to **email only** for v1. Phone is out of scope.

Branch: `vmag211/backend`. Push after each task passes independent review. Supersedes the older "B02 is evidence and source operations" sequencing in `docs/backend/checkpoint.md`; Vibhav chose recovery first on 2026-10-17 because it is the architectural keystone for every owned record and it gates B05.

## Executable contracts (these outrank prose)

The frontend branch carries the authoritative types. Read them before writing any handler:

| Contract | File on `origin/codex/october15-review-refinement` |
| --- | --- |
| `RecoveryStatus` + `validRecoveryStatus` | `lib/frontend/production/recovery-service.ts` |
| `AccountSnapshot`, `AccountReceipt`, `AccountFeature` | `lib/frontend/production/account-service.ts` |
| Caller behaviour, nonce handling, session verification | `components/production/ProductionRestoreAccessFlow.tsx` |

Shapes the server must satisfy exactly:

```
RecoveryStatus = {
  operationId: string;                       // must equal the operationId the client sent
  status: 'pending'|'verified'|'expired'|'collision'|'failed'|'unknown';
  challengeId: string|null;                  // <= 500 chars
  expiresAt: string|null;                    // parseable date
  restoreToken?: string;                     // <= 8192 chars; REQUIRED when status==='verified'
  session?: { identityId, accessToken, refreshToken }   // each <= 16000 chars
}
```

`validRecoveryStatus` rejects a `verified` response that carries neither `restoreToken` nor `session`. Requests:

- `recovery.request` → `{ email, clientNonce, operationId }`
- `recovery.status` → `{ challengeId, clientNonce, operationId, requestOperationId, scope: 'challenge'|'request'|'complete' }`
- `recovery.complete` → `{ challengeId, restoreToken, clientNonce, operationId, confirmAccountSwitch: true }`

All three send `Idempotency-Key: operationId`. The client re-verifies its own session identity before and after every call, and verifies any returned session with `supabase.auth.getUser(accessToken)` against `identityId` **before** `setSession`. The server must not rely on that client check for safety.

## Global constraints (every task, every reviewer)

Everything in `docs/backend/plans/b01-baseline-private-identity.md` "Global constraints" still applies unchanged: installed Next.js docs first, identity only from the verified token, additive responses, no em dashes in app-facing strings, no production access, idempotent migrations that degrade cleanly, no secrets in fixtures, `node --test` only, the full gate before every commit, conventional commits with **no `Co-Authored-By` and no Claude attribution**, scope discipline, and the truthfulness rules. Additions for this package:

- **Link and recover are separate operations with separate code paths** (BE-227). Do not let one handler serve both intents.
- **Never merge two identities.** BE-334: a credential that already belongs to another identity is a `collision`, never a merge, regardless of matching address, email string, device label or household ID.
- **Enumeration safety.** `recovery.request` returns the same `pending` shape and the same timing characteristics whether or not the email maps to a linked identity. No "no such account" path, no observable timing fork, no distinct error code.
- **Secrets never leave the server.** Store only hashes of the email, the client nonce and the restore token. The restore token is single-use with a recorded `consumed_at`. Nothing proof-bearing goes into URLs, logs, telemetry or error envelopes (BE-201).
- **The operation ledger is authoritative** for unknown-outcome reconciliation. A repeated `operationId` returns the first outcome; it never performs the effect twice.

## Rulings made before execution

- **Ruling, capability verified 2026-10-17:** session minting for a recovered identity uses the Supabase Admin API server-side. The client contract requires a real `{accessToken, refreshToken}` pair bound to `identityId`, and the installed `@supabase/supabase-js@2.110.7` supports the two-step path: `auth.admin.generateLink({ type: 'magiclink', email })` yields a `hashed_token`, and `auth.verifyOtp({ token_hash, type })` exchanges it for a session. Both methods are present on the installed client (checked by enumerating the prototype chain, not from documentation). Task 1 still proves the pair end to end against a real exchange before Task 8 depends on it; what is settled is that the approach is available rather than hypothetical. Cost if the end-to-end exchange fails: `recovery.complete` returns only a `restoreToken` and the client finishes through a provider-native verification, changing the `complete` response and the frontend's `setSession` path.
- **Ruling:** the same client exposes `updateUser({ email })` for the link intent and `getUserIdentities()` for reporting linked credentials, so Task 4 needs no custom credential storage.
- **Ruling:** the email credential is attached using Supabase's supported anonymous-to-permanent conversion so `auth.users.id` is preserved (BE-050, BE-334). No custom credential table holds a password or session.
- **Ruling:** `recovery_challenges` rows are created only for an email that resolves to a linked identity, but `recovery.request` returns `pending` either way. The response is therefore not evidence that a challenge exists. This keeps enumeration safety without storing attacker-chosen addresses.
- **Ruling:** device revocation (BE-227) is scoped to listing sessions and revoking them. Per-device naming and trust levels are deferred; the `devices[]` contract field is populated from provider session data only.

## Blockers Vibhav must clear (tracked, not worked around)

1. **`NEXT_PUBLIC_TURNSTILE_SITE_KEY` is unset in every environment.** BE-340 requires working human verification and a supported path when the challenge is inaccessible, not a silent bypass. Task 6 is written but cannot be accepted until the key exists. Until then the capability flag stays off.
2. **BE-307 backup and restore coverage** must exist "before enabling valuable user records". Production is Supabase free tier with no scheduled backups and no PITR (confirmed 2026-10-17). Recovery is what makes records worth keeping.
3. **BE-360** needs recorded recovery time, acceptable data-loss window and on-call targets.
4. **Retention periods** in `docs/backend/privacy-and-retention.md` remain unapproved and still gate B05 independently of this package.

Per **BE-351** the whole capability ships behind a server-enforced feature flag, default off, so none of the above can be bypassed by a deployed UI.

---

### Task 1: Capability proof and migration 0017

Prove the Supabase Admin session-minting ruling against the installed SDK in an isolated test before anything depends on it. Then write `0017_identity_recovery.sql`:

- `recovery_challenges`: id, profile_id, email_hash, nonce_hash, restore_token_hash, status, attempts, expires_at, consumed_at, created_at.
- `recovery_operations`: operation_id primary key, kind, scope, status, result_json, created_at. The idempotency ledger.
- Service-role only. RLS enabled, **no policy for anon or authenticated**, and an explicit `revoke all ... from anon, authenticated` because Supabase's default privileges grant `arwdDxtm` on every new public table (confirmed by the 2026-10-17 audit).
- Degrades cleanly: every route returns a non-retryable 503 `feature_unavailable` until 0017 exists, matching the 0016 convention.

Evidence: PGlite tests for the schema, the revoke, and cross-identity isolation; `test/rlsIsolation.test.mjs` updated deliberately for the two new tables; a tested back-out block added to `YOUR_TODO.md`.

### Task 2: Operation ledger primitive

A shared `lib/operations.js` implementing record-first, execute, record-outcome, with `Idempotency-Key` handling and canonical status read. **This is foundational for all 72 frontend operations, not just recovery**, so it is built once here and reviewed accordingly. Must cover: first call executes, repeat returns the stored outcome without re-executing, concurrent duplicates serialize, and an interrupted operation reports `unknown` rather than a false failure.

### Task 3: `GET /api/account`, recovery feature

Return `AccountSnapshot` with `recovery.method` (masked address and `verifiedAt`, or null), `recovery.challenge` (masked, expiry, status, or null) and `recovery.devices[]`. Masking only; never the full address. Include `unresolvedOperations`.

### Task 4: Link intent via `POST /api/account/commands`

Attach a verified email to the signed-in anonymous identity, preserving the user id. Returns `AccountReceipt`. Must cover: happy path, re-send throttling, an address already linked to another identity (**collision, explicit failure, no merge**), an address already linked to this identity (no-op), and proof via test that `auth.users.id`, `profiles.id` and every owned row are unchanged after linking.

### Task 5: `POST /api/recovery/request`

Enumeration-safe. Always `pending` with a stable shape and no timing fork. Rate limited per address hash and per client. Creates a challenge and sends verification only when the address resolves to a linked identity.

### Task 6: Turnstile verification (BE-340)

Server-side verification on `recovery.request`, plus an accessible fallback path that is not a silent bypass. **Acceptance blocked on the site key existing.** Feature flag stays off until then.

### Task 7: `POST /api/recovery/status`

Handles all three scopes (`challenge`, `request`, `complete`). Returns the canonical status for a prior `operationId` when reconciling an unknown outcome, and a fresh operation's status otherwise. Must return `collision`, `expired` and `failed` as distinct terminal states, and never leak whether an address exists.

### Task 8: `POST /api/recovery/complete`

Requires `confirmAccountSwitch: true`, a matching `challengeId`, the single-use `restoreToken` and the `clientNonce`. Verifies, consumes the token (recorded `consumed_at`, replay returns the ledger outcome rather than a second session), mints the session, returns `session: {identityId, accessToken, refreshToken}`. Must prove: replay does not mint twice, a token bound to another challenge fails, an expired token fails, and the caller's prior anonymous identity is **neither merged nor deleted** (BE-334).

### Task 9: Device listing and revocation

Populate `recovery.devices[]` and support revoking a session by id with a revision. BE-227 requires revocation support and available records.

### Task 10: Contracts, fixtures, tracker, checkpoint

Extend `docs/backend/contracts/` with the recovery and account operations and synthetic fixtures, conformance-test the real handlers through the isolated harness against `validRecoveryStatus` and the account validators, update `requirements-tracker.md` for every BE id above, and write the B02 checkpoint.

---

## Out of scope

Phone credentials. Household membership or shared accounts (BE-175 explicitly warns these must not arrive as a side effect of device linking). Account deletion beyond what `DELETE /api/account` already does; full B12 deletion orchestration (BE-263, BE-332) is its own package. Sensitive uploads and attachments (B05), which remain gated on retention approval regardless of this package. The other 66 frontend operations.
