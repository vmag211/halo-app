# B01 privacy and retention inventory

Status: **Proposed disclosure, awaiting Vibhav's approval**. Written 2026-10-10.
This describes repository behaviour, not a verified production policy. The baseline is reconstructed, not captured from Supabase. Migrations 0015 and 0016 are written and tested locally, not applied by this work. Audit the deployed schema with `docs/backend/baseline-audit.sql` before rollout.

**Sensitive input (test results, attachments, fish notes, observations) stays disabled until this document and the recovery decision are approved.** See [the recovery decision](decisions/B01-optional-recovery.md). This is a release gate, not a claim that a new capabilities endpoint enforces it; these future sensitive-input features have no implementation here. The existing symptom journal is inventoried below.

## Personal table inventory

All export paths are **none yet, due B12**. Existing read APIs are not a complete export. No age, birthdate or person name is deliberately requested. Presence bands and symptom logs can nonetheless reveal sensitive household facts. Ownership is always the verified token's user id, never a supplied owner id.

| Table | Personal data held | Owner column | Sensitivity class | Free-text fields | Current retention | Deletion path | Export path |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `auth.users` | Anonymous identity, creation time; baseline stub has email, real Supabase auth has provider-managed credential/session metadata outside the reconstruction | `id` | credentials | Email if a future approved identity links one; no HALO note | No HALO scheduled expiry. The 30-day SQL in 0001 is a commented example, not an enforced policy | `DELETE /api/account` with `confirm: DELETE` invokes admin deletion for the verified caller | none yet, due B12 |
| `public.profiles` | Rounded lat/lng, county/state, utility, water source, home year, locale, renter mode, request id. Legacy address/ZIP/build_year columns exist; current onboarding discards raw address and clears ZIP | `id` | location_approximate, household_context | Legacy `address` and `zip` may contain older data; current route does not store the submitted address | Kept until account deletion; current attributes may be replaced on edit/move | Auth-user deletion cascades through 0001 | none yet, due B12 |
| `public.daily_scores` | Household-linked dated environmental readings, source/detail payloads and home link | `profile_id` | household_context | Provider/source text inside `details`, no user note | Kept until account deletion; moving deletes the closing home's today readings; no scheduled age purge | Profile cascade (0001), move RPC deletes today's closing-home rows (0016) | none yet, due B12 |
| `public.home_risks` | Legacy household assessment table; only keys reconstructed, remaining deployed columns unverified; no current code writes it | `profile_id` | household_context | Unknown deployed fields, requires schema audit | Kept until account deletion; no scheduled expiry found | Profile cascade (0001) | none yet, due B12 |
| `public.household_bands` | Seven presence booleans including pregnancy and respiratory sensitivity | `profile_id` | health_adjacent, household_context | None | Kept until account deletion; save replaces the present booleans | Profile cascade (0002) | none yet, due B12 |
| `public.symptom_logs` | Dates, household band, symptom names, severity, illness and retrospective flags, optional note | `profile_id` | health_adjacent | `note` (500 characters), `symptoms` names (bounded); treat both as potentially sensitive | Kept until user deletes entries or the account; re-logging date/band updates the row; no scheduled expiry | `DELETE /api/journal?id=<owned-id>` or `?all=true`; profile cascade (0003) | none yet, due B12 |
| `public.alerts` | Household-specific notification type, generated title/message, fired/read/dismissed times/state and dedupe key | `profile_id` | household_context | Generated `title`, `message`, not a user note | Kept until account deletion; marking read/dismissed does not delete | Profile cascade (0006) | none yet, due B12 |
| `public.notification_prefs` | Household's enabled notification categories and update time | `profile_id` | household_context | None | Kept until account deletion, replaced on save | Profile cascade (0010) | none yet, due B12 |
| `public.push_subscriptions` | Device endpoint and encryption/auth material linked to a household | `profile_id` | credentials | Endpoint and keys are credentials, not public text | Kept until unsubscribe, account deletion, or provider 404/410 during push delivery; unsupported old endpoints are skipped rather than purged | `DELETE /api/push/subscribe` for caller's endpoint; profile cascade (0010); cron removes expired endpoints | none yet, due B12 |
| `public.home_contexts` | Rounded coordinates and attributes for every stay, move chronology, revision, utility match, request id and backfill state | `profile_id` | location_approximate, household_context | No user note; match/status text comes from server | Current and closed stays retained until account deletion; moving closes rather than erases the previous stay | Profile cascade (0016); no separate context-delete route | none yet, due B12 |

Coordinates are rounded to 3 decimal degrees before storage, approximately 100 metres, not precise street addresses. Retaining closed contexts still reveals approximate location history and must be disclosed. The legacy context cannot separate readings from moves that happened before context tracking. Unknown deployed columns and legacy raw-address values must be checked in the read-only schema/data audit; this inventory makes no claim they were erased from production.

## Public reference, no personal data

These tables have no household owner column or user-submitted free text. Their text is public reference/editorial material. Sensitivity class: `none`. Current retention is until an operator replaces or deletes it, with no implemented universal timed purge. Account deletion does not delete public reference data. Household export path: none yet, due B12 (source licence/expiry rules still apply).

| Table | Contents and text | Deletion/replacement path |
| --- | --- | --- |
| `public.ucmr5_utilities` | Public EPA utility/contaminant data and utility names | Operator import/admin; reconstructed public-read RLS assumption needs deployed audit |
| `public.volunteer_orgs` | Public organization contacts, descriptions, geography and verification metadata | Operator seed/admin |
| `public.learn_content` | Curated bilingual guidance, titles/body/source URLs | Operator seed/admin |
| `public.assistant_corpus` | Public source passages, titles, URLs and embeddings, not household chats | Corpus ingestion/admin |
| `public.water_snapshots` | Utility PWSID fingerprints for change detection | Daily job overwrites per utility; operator admin |
| `public.map_layers` | Prebuilt public geographic layers and metadata | Daily job replaces layer payload; operator admin |

## Outside the table inventory

Browser Supabase sessions live in localStorage. Frontend caches/drafts are scoped by identity; changing identity clears their accessible cache namespace. Account deletion callers must clear local session/cache state after success. The deletion route is not a claim to remotely erase every device cache or downloaded file.

The submitted address is transiently sent to Mapbox for geocoding and the rounded point to service-area lookup; it is not saved by current onboarding. Private context sent to the assistant depends on `ASSISTANT_SEND_HOUSEHOLD_CONTEXT`; this work does not read or change live configuration. If enabled, selected environmental readings and symptom names/dates may leave the app, never Journal notes through the current context builder. `assistant_corpus` stores public passages, not transcripts. Provider retention, application/platform logs, auth internals and backups are separate from database cascades and have not been audited. Upstash rate-limit counters are outside Postgres and have limiter-specific windows, not a household export or deletion implementation. Do not place secrets or private row contents in logs, fixtures or this disclosure.

## Decisions and proposed periods

No new retention period is enforced by B01. **Proposed, awaiting decision:** Vibhav must choose retention and any inactivity policy separately for journals, home/location history, environmental history, alerts, abandoned anonymous accounts, backups/logs and future uploads/exports/transcripts. No numeric default is selected here. Any approved period needs implementation, purge tests, deletion/restore handling and disclosure before it is described as enforced. The commented 30-day anonymous cleanup in 0001 is not a promise of deletion.

HO-144 source-specific retention/licensing remains unverified and can override a general household period; B02/B03 must reconcile provider rules with historical data, exports and model use. Future private files require approved storage/scanning, ownership, deletion and retention rules. B12 must inventory all new nested records/objects and prove no cross-household export or deletion. Account deletion cascades are proven locally by the isolation and home-context database tests, but live migration state, provider copies and backups remain human verification items.
