# B01 optional account recovery

Status: **Accepted, Option B**. Decided by Vibhav 2026-10-17. Written 2026-10-10.
Requirements: HO-066, HO-131, HO-153, BE-174, BE-227, BE-334. See "Decision" below for what approval does and does not open.

Today each device gets an anonymous Supabase identity. Clearing browser storage or replacing a rejected session does not restore that identity's household. Its server records may remain until account deletion; a replacement account has no access to them. A failed write now returns its original 401 without resetting identity or replaying the write. `recoverSession()` is an explicit replacement hook, to be called only after explaining the loss and receiving user confirmation. It is not account recovery. GET/HEAD retain the existing one-time replacement behaviour; a read can therefore still change identity. A confirmation interface and draft resubmission flow are not implemented in this package.

| Option | Consequences and work | Abuse, CAPTCHA and cost |
| --- | --- | --- |
| A. Anonymous only, no recovery (current) | A lost device/session loses access to the household, journal and any uploads. Lowest implementation effort; disclose this before accepting valuable data. B12 export/deletion requires a still-valid session; support cannot safely identify a lost household from an address alone. | Anonymous sign-in abuse controls still matter. No new messaging provider, but anonymous accounts and retained abandoned records still consume storage. |
| B. Optional upgrade of the same anonymous user to email or phone (recommended) | Link a verified credential while signed in, preserving the user id and ownership. Onboarding remains anonymous and never requires upgrade. Build linking, verification, return/sign-in, collision handling, user confirmation and cross-device ownership tests. An existing account must not silently absorb another household. Data already orphaned before linking is not automatically recoverable. B05 uploads and B12 export/deletion depend on the same user id being kept, so ownership, RLS and cascade deletion carry over unchanged; the newly linked email or phone becomes a credential that B12 must also export and delete. | Adds credential privacy, account takeover and recovery abuse controls. Verify email/phone ownership; enforce resend/rate limits and CAPTCHA at the provider. Email/SMS delivery and support have costs that require a budget decision; no price is assumed here. |
| C. Device recovery code | Generate a high-entropy secret, show once, store only a verifier, and implement throttled redemption, revocation/rotation, replay protection and same-owner session issuance. Losing both device and code still loses access. A stolen code can grant household access. Requires new credential lifecycle/storage and security tests. B05 uploads and B12 export/deletion depend on the code being a credential the user holds: losing it is the same as option A for recovery, and rotation and revocation (including the stored verifier) must be part of account deletion. | No email/SMS requirement, but higher custom security and support effort. CAPTCHA alone does not protect redemption; guessing and reuse need server controls. Storage, operations and review have costs. |

Recommendation: B, optional and never required for onboarding. Supabase supports adding an email/phone identity to an anonymous user; see [official anonymous sign-in documentation](https://supabase.com/docs/guides/auth/auth-anonymous). The same documentation recommends CAPTCHA against anonymous signup abuse. Linking and returning to the same user must be tested in an isolated project before release. This record does not claim live configuration was inspected.

## Release gate and dependencies

**Sensitive input (test results, attachments, fish notes, observations) stays disabled until this document and the recovery decision are approved.** Specifically, B05 must not enable sensitive input unless Vibhav records a chosen recovery policy, approves `docs/backend/privacy-and-retention.md`, and the selected policy's required safeguards and ownership/deletion tests pass. Approval of B alone does not ship an unimplemented recovery flow. If A is chosen, explicitly approve the permanent-loss disclosure and suitability for valuable input. B05 also needs the missing storage/scanning/specification sections and their own acceptance checks.

B12 must authorize exports and account deletion against the verified identity, cover all nested data/objects and expiry classes, and prove cross-household isolation. A replacement identity cannot export or delete the old identity's records. Existing `DELETE /api/account` removes the signed-in auth user with database cascades, but does not establish B12 completeness for future uploads, queued exports or provider copies.

Not decided: option selection; email versus phone and verification UX; whether upgrade is needed for particular sensitive features; provider and cost limits; existing-account collisions; recovery support; inactivity cleanup; retention periods; source-specific retention; private object storage/scanning; transcript/provider retention. No code implementing B or C is included. Record Vibhav's decision here with date and required follow-up tests before opening the gate.

## Decision

**2026-10-17, Vibhav chose Option B**: optional upgrade of the same anonymous user to a verified email or phone credential, keeping the `auth.users.id`. Onboarding stays anonymous and never requires the upgrade.

Why this fits the specification, now that the full text is available at `docs/product/ai/HALO_BACKEND_WORKING_SPEC.md` (sha256 `fc1fec4b…be86`):

- **BE-334** requires choosing one supported method before advertising recoverability, and says to "prefer the existing identity provider's supported capabilities over custom password/session storage". Option B is verified account linking through Supabase rather than a custom credential, so it satisfies that preference directly. Option C would have meant custom credential lifecycle and storage.
- **BE-050** warns that "new recovery or membership cannot casually rekey every row". Keeping the same user id means `profiles.id`, every owned table's `profile_id`, all RLS policies and all cascade deletes carry over unchanged. No rekeying.
- **BE-174** requires a specific authenticated flow with collision handling, device/session management and an explanation of what is recoverable, and forbids treating possession of a household ID or public URL as authorization.
- **BE-227** requires **separate link and recover intents**. These are two different operations and must not share one code path:
  - *Link*: a signed-in anonymous user attaches a verified email or phone. Same id, no session switch.
  - *Recover*: a new device proves ownership of that credential and receives a session for the original id, abandoning that device's throwaway anonymous identity. This is what the frontend's `confirmAccountSwitch: true` corresponds to.
- **BE-334** also forbids merging two identities' records because they share an address, email-looking string, device label or household ID. A collision (the credential already belongs to another identity) must fail explicitly, never merge.

### Still not decided, and still required before the gate opens

Approving B does not ship a recovery flow and does not by itself open the B05 sensitive-input gate. Outstanding:

1. **Retention periods** (`docs/backend/privacy-and-retention.md` is still unapproved). The gate below requires it.
2. **Email versus phone**, or both, and the verification experience. Email is cheaper and has no carrier dependency.
3. **Provider and cost limits** for delivery, and resend/rate limits.
4. **Collision policy wording** shown to the user when a credential already belongs to another identity.
5. **Device and session revocation** behaviour, and lost-device behaviour (BE-227, BE-334).
6. **Inactivity cleanup** for abandoned anonymous identities. Roughly 47 of 62 production profiles currently hold no location and several were created microseconds apart, so this is a real population, not a hypothetical.

### New blockers this decision surfaces

- **BE-340 human verification**: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is documented in `.env.example` but is **not set in any environment**. The Supabase anonymous-sign-in guidance recommends CAPTCHA against signup abuse, and recovery request is an enumeration and abuse surface. This needs configuring before recovery ships.
- **BE-307 backup and restore**: "Establish backup and restore coverage for both database rows and object storage before enabling valuable user records." Production is on the Supabase free tier with **no scheduled backups and no PITR** (confirmed 2026-10-17). Recovery makes records durable and therefore valuable, which puts this requirement in direct tension with the current plan.
- **BE-360**: Vibhav must record measurable recovery time, acceptable data-loss window and on-call response targets before release. No value is recorded yet.
